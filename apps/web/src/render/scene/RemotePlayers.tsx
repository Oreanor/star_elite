import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { InstancedMesh, Object3D, Quaternion, Vector3 } from 'three'
import { applyDamage, despawnRemotePlayer, isVisible, spawnRemotePlayer } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { useOnlinePlayers } from '../../app/net/presence'
import { sendHit, subscribeHits } from '../../app/net/hits'
import { clearPose, publishPose, selfPose, subscribePoses } from '../../app/net/pose'
import { PoseInterp } from '../../app/net/remotePlayers'
import { auroraGeometry } from '../geometry/ships'
import { hullMaterial } from '../materials/materials'

/**
 * Чужие игроки в мире. Связывает два канала: МЕДЛЕННЫЙ presence (кто в моей системе,
 * имя/вид/лицо — для спавна и портрета) и БЫСТРЫЙ pose (плавное положение). Каждый
 * такой игрок — обычный кинематический `ShipEntity` в `world.ships` (единый бой и
 * рендер), чью позу ставит интерполятор, а не физика.
 *
 * Компонент живёт под `Scene key={epoch}`: прыжок его пересобирает — тогда переподписка
 * на новую систему и чистый спавн происходят сами. Здесь же публикуем СВОЮ позу ~15 Гц.
 */

const MAX_REMOTE = 16
/** Свою позу шлём ~15 раз в секунду: чаще — лишний трафик, реже — рвано у соседей. */
const PUBLISH_HZ = 15

/**
 * Гигант-прокси против «голографического» мерцания. Километровый корпус вдали лог-буфер
 * глубины не тянет — грани спорят, весь корпус мигает. Поэтому выросший борт рисуем БЛИЖЕ
 * к камере и во столько же МЕНЬШЕ: угловой размер на экране тот же, а числа глубины малые —
 * точности хватает. Это идея «считать на малых числах, потом домножить масштабом». На
 * геймплей/позу/столкновения не влияет — только на матрицу отрисовки этого инстанса.
 */
const PROXY_MIN_SCALE = 4 // ниже — обычный борт, прокси не нужен
const PROXY_DIST = 4000 // на какую дистанцию (м) подносим гиганта: тут глубине хорошо

const _dummy = new Object3D()
const _pos = new Vector3()
const _quat = new Quaternion()
const _spawnQuat = /* @__PURE__ */ new Quaternion()
const _dv = /* @__PURE__ */ new Vector3()

export function RemotePlayers() {
  const session = useSession()
  const camera = useThree((s) => s.camera)
  const peers = useOnlinePlayers()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(auroraGeometry, [])
  const material = useMemo(hullMaterial, [])
  const interp = useMemo(() => new PoseInterp(), [])
  /** uid → id корабля в world.ships. Наш реестр материализованных чужих. */
  const idByUid = useRef(new Map<string, number>())
  /** Свежий список онлайна для кадрового колбэка — без устаревшего замыкания. */
  const peersRef = useRef(peers)
  peersRef.current = peers
  /** Аккумулятор публикации своей позы. */
  const pubAcc = useRef(0)

  const sys = session.world.systemIndex

  // Подписка на быстрые позы ТЕКУЩЕЙ системы. Прыжок меняет `sys` → переподписка.
  useEffect(() => {
    return subscribePoses(sys, (snaps) => interp.ingest(snaps, performance.now()))
  }, [sys, interp])

  // Уборка при размонтировании (прыжок/выход): снять свою позу и чужие борта из мира.
  useEffect(() => {
    const registry = idByUid.current
    return () => {
      const world = session.world
      for (const id of registry.values()) despawnRemotePlayer(world, id)
      registry.clear()
      void clearPose()
    }
  }, [session])

  // Приём попаданий по СЕБЕ: чужой болт долетел на клиенте стрелка, он прислал урон — и мы
  // сами бьём по своему HP (авторитет над своим здоровьем). Живёт, пока компонент смонтирован.
  useEffect(() => {
    return subscribeHits((dmg) => {
      const world = session.world
      if (world.player.alive) applyDamage(world.player, dmg, world.time)
    })
  }, [session])

  useFrame((_, dt) => {
    const world = session.world
    const now = performance.now()
    const registry = idByUid.current

    // 0) Переслать попадания по чужим бортам их владельцам. Домен зарегистрировал урон, но
    //    НЕ применил его (HP чужого — на его клиенте): кладём урон в ящик игрока по uid из
    //    нашего реестра, он применит сам. Затем список чистим — он живёт ровно один кадр.
    const hits = world.remoteHits
    if (hits.length > 0) {
      for (const h of hits) {
        for (const [uid, id] of registry) {
          if (id === h.targetId) {
            void sendHit(uid, h.damage)
            break
          }
        }
      }
      hits.length = 0
    }

    // 1) Публикуем свою позу ~PUBLISH_HZ, пока в космосе. В доке — снимаем: у причала
    //    борт не летает, соседи видят метку станции из presence, а не корабль.
    if (world.docked) {
      void clearPose()
    } else {
      pubAcc.current += dt
      if (pubAcc.current >= 1 / PUBLISH_HZ) {
        pubAcc.current = 0
        void publishPose(world.systemIndex, selfPose(world))
      }
    }

    // 2) Кто должен быть в мире: онлайн-игроки в МОЕЙ системе, чья ПОЗА свежа. Свежесть —
    //    решающая: перезагрузился/завис/вышел — поток поз встал, и борт растворяется САМ,
    //    не дожидаясь presence (его onDisconnect в RTDB тормозит до минуты, оттого призрак
    //    висел гигантом). Паузнутый шлёт позу каждый кадр рендера — он остаётся свежим и виден.
    const fresh = interp.freshUids(now)
    const want = new Map<string, (typeof peersRef.current)[number]>()
    for (const p of peersRef.current) {
      if (p.systemIndex === sys && fresh.has(p.uid)) want.set(p.uid, p)
    }

    // 3) Деспавн ушедших (сменили систему, вышли, зависли, встали в док).
    for (const [uid, id] of registry) {
      if (!want.has(uid)) {
        despawnRemotePlayer(world, id)
        registry.delete(uid)
        interp.drop(uid)
        // Был в мире и растворился. Если presence ещё числит его В ПОЛЁТЕ (place == null) —
        // это не штатный уход и не стыковка, а обрыв (перезагрузка/зависание): шлём весть
        // «похоже, вышел». Пристыковавшийся (place != null) гаснет тихо — он у причала.
        const peer = peersRef.current.find((q) => q.uid === uid)
        if (peer && peer.place == null) world.notices.push({ kind: 'player-left', name: peer.name, at: world.time })
      }
    }

    // 4) Спавн новых. Стартовую позу берём из presence (абсолютная) в локальный кадр;
    //    дальше её ведёт интерполятор быстрого канала.
    for (const [uid, p] of want) {
      if (registry.has(uid)) continue
      _pos.set(p.x - world.originOffset.x, p.y - world.originOffset.y, p.z - world.originOffset.z)
      const ship = spawnRemotePlayer(world, {
        name: p.name,
        species: p.species,
        portrait: p.face,
        pos: _pos,
        quat: _spawnQuat.identity(),
      })
      registry.set(uid, ship.id)
    }

    // 5) Интерполяция: абсолютную позу канала переводим в локальный кадр (−originOffset).
    for (const [uid, id] of registry) {
      const ship = world.ships.find((s) => s.id === id)
      if (!ship) {
        registry.delete(uid)
        continue
      }
      if (interp.sample(uid, now, _pos, _quat)) {
        ship.state.pos.set(_pos.x - world.originOffset.x, _pos.y - world.originOffset.y, _pos.z - world.originOffset.z)
        ship.state.quat.copy(_quat)
      }
      // Масштаб миелофона: вырос по сети — и на чужом экране ты гигант.
      ship.state.scale = interp.scaleOf(uid)
    }

    // 6) Отрисовка: один InstancedMesh на всех чужих (у всех дефолтная «Аврора»).
    const mesh = ref.current
    if (!mesh) return
    let count = 0
    for (const id of registry.values()) {
      const ship = world.ships.find((s) => s.id === id)
      if (!ship || !isVisible(ship) || count >= MAX_REMOTE) continue
      _dummy.quaternion.copy(ship.state.quat)
      const scale = ship.state.scale
      if (scale > PROXY_MIN_SCALE) {
        // Гигант: подносим ближе и во столько же уменьшаем — на экране то же, глубине легче.
        _dv.copy(ship.state.pos).sub(camera.position)
        const dist = _dv.length()
        const k = dist > PROXY_DIST ? dist / PROXY_DIST : 1
        _dummy.position.copy(camera.position).addScaledVector(_dv, 1 / k)
        _dummy.scale.setScalar(scale / k)
      } else {
        _dummy.position.copy(ship.state.pos)
        _dummy.scale.setScalar(scale)
      }
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX_REMOTE]} frustumCulled={false} />
}
