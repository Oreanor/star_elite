import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { InstancedMesh, Object3D, Vector3 } from 'three'
import { stereoProject } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { bushPlayerPoint, bushTravellers } from '../../session/bushTraffic'
import { bushExitScale } from '../../session/bushExit'
import { torusView } from '../../session/torusFlight'
import { publishPose, subscribePoses, type PoseSnapshot } from '../../session/net/pose'
import { useOnlinePlayers } from '../../session/net/presence'
import { chassisGeometry } from '../geometry/ships'
import { hullMaterialFor } from '../materials/materials'
import { TORUS } from '../config'
import { torusTuning } from './torusTuning'

/**
 * КОРАБЛИ КУСТА: путники (`bushTraffic`), изредка Слово на Святом Духе и ДРУЗЬЯ — другие игроки
 * в той же комнате. Место любого из них — точка S³; рисуем её тем же видом и той же
 * стереопроекцией, что галактики (`HypertorusLayer`), иначе корабль висел бы мимо решётки.
 *
 * Размер — угловой, как у пуфа галактики: подлетаешь — растёт, удаляется — тает в точку.
 * Курс — образ касательной: разность проекций точки и её сдвига вдоль касательной.
 *
 * Здесь же своя поза в канал `poses/bush`: точка S³ и нос — то, по чему друг нарисует тебя.
 */

/** Друг на кусте: подпись для HUD. Слой заполняет каждый кадр, HUD рисует. */
export interface BushPeerLabel {
  x: number
  y: number
  z: number
  name: string
}
export const bushPeerLabels: { count: number; items: BushPeerLabel[] } = {
  count: 0,
  items: Array.from({ length: 16 }, () => ({ x: 0, y: 0, z: 0, name: '' })),
}

const SHIP_CHASSIS = 'aurora_one'
const GOD_CHASSIS = 'spiritus_sanctus'
/** Паспортный радиус корпусов выше, м: геометрия в метрах, масштаб = нужный радиус / этот. */
const HULL_RADIUS_M = 12
/** Угловой радиус корабля на S³, рад; бог — крупнее, он в своём масштабе и здесь. */
const SHIP_ANGULAR_R = 0.05
const GOD_ANGULAR_R = 0.2
/** Сдвиг вдоль касательной для образа курса, рад. */
const HEADING_EPS = 1e-3
/** Публикация своей позы, Гц: как в системе. */
const PUBLISH_HZ = 15
/** Друг пропал, если его поза не менялась столько, с (перезагрузился, вышел из комнаты). */
const PEER_STALE_S = 3
const MAX_PEERS = 16

const _dummy = new Object3D()
const _a = { x: 0, y: 0, z: 0, depth: 0 }
const _b = { x: 0, y: 0, z: 0, depth: 0 }
const _dir = new Vector3()
const _nose = new Vector3(0, 0, -1)
const _q = new Float64Array(4)
const _qt = new Float64Array(4)
const _me = new Float64Array(4)
const _p = new Float64Array(4)
const _t = new Float64Array(4)

/** v ← V·src (поза вида на 4-вектор). */
function viewApply(src: Float64Array, out: Float64Array): void {
  const v = torusView()
  for (let i = 0; i < 4; i++) {
    out[i] = v[i * 4]! * src[0]! + v[i * 4 + 1]! * src[1]! + v[i * 4 + 2]! * src[2]! + v[i * 4 + 3]! * src[3]!
  }
}

/** Общие на кадр параметры проекции: модульные, чтобы `place` не был замыканием в кадре. */
const _frame = { scale: 1, at: new Vector3() }

/**
 * Поставить корабль `index` в точку S³ `p` курсом по касательной `t`. Ушёл за полюс
 * проекции — false (не рисуем).
 */
function place(mesh: InstancedMesh, index: number, p: Float64Array, t: Float64Array, angular: number): boolean {
  viewApply(p, _q)
  if (_q[3]! > TORUS.POLE_CULL) return false
  viewApply(t, _qt)
  const scale = _frame.scale
  stereoProject(_q[0]!, _q[1]!, _q[2]!, _q[3]!, scale, _a)
  const e = HEADING_EPS
  stereoProject(_q[0]! + _qt[0]! * e, _q[1]! + _qt[1]! * e, _q[2]! + _qt[2]! * e, _q[3]! + _qt[3]! * e, scale, _b)
  _dir.set(_b.x - _a.x, _b.y - _a.y, _b.z - _a.z)
  if (_dir.lengthSq() < 1e-12) _dir.set(0, 0, -1)
  const at = _frame.at
  _dummy.position.set(at.x + _a.x, at.y + _a.y, at.z + _a.z)
  _dummy.quaternion.setFromUnitVectors(_nose, _dir.normalize())
  // Угловой размер, как у пуфа галактики: k = SCALE/(1−w) — без раздвижки узлов.
  const k = (TORUS.SCALE * bushExitScale()) / Math.max(1e-4, 1 - _q[3]!)
  _dummy.scale.setScalar(Math.min(TORUS.PUFF_MAX_R_M, angular * k) / HULL_RADIUS_M)
  _dummy.updateMatrix()
  mesh.setMatrixAt(index, _dummy.matrix)
  return true
}

interface PeerTrack {
  snap: PoseSnapshot
  /** Когда поза в последний раз МЕНЯЛАСЬ (по отметке сервера), с часов кадра. */
  seenAt: number
}

export function BushShips() {
  const session = useSession()
  const peers = useOnlinePlayers()
  const shipsRef = useRef<InstancedMesh>(null)
  const godRef = useRef<InstancedMesh>(null)
  const shipMat = useMemo(() => hullMaterialFor(SHIP_CHASSIS), [])
  const godMat = useMemo(() => hullMaterialFor(GOD_CHASSIS), [])
  const tracks = useRef(new Map<string, PeerTrack>())
  const names = useRef(new Map<string, string>())
  const pubAcc = useRef(0)
  const clock = useRef(0)

  names.current.clear()
  for (const p of peers) names.current.set(p.uid, p.name)

  // Подписка на позы комнаты — пока в ней, без лишнего трафика в обычном полёте.
  const active = session.bush.active
  useEffect(() => {
    if (!active) return
    const map = tracks.current
    return subscribePoses('bush', (snaps) => {
      for (const s of snaps) {
        const was = map.get(s.uid)
        if (!was || was.snap.t !== s.t) map.set(s.uid, { snap: s, seenAt: clock.current })
      }
    })
  }, [active])

  useFrame((_, dt) => {
    clock.current += dt
    const ships = shipsRef.current
    const gods = godRef.current
    bushPeerLabels.count = 0
    if (!ships || !gods) return
    const on = session.bush.active
    ships.visible = on
    gods.visible = on
    if (!on) {
      tracks.current.clear()
      return
    }
    // GLB корпуса грузится асинхронно — подменяем, когда доехал.
    const shipGeo = chassisGeometry(SHIP_CHASSIS)
    if (ships.geometry !== shipGeo) ships.geometry = shipGeo
    const godGeo = chassisGeometry(GOD_CHASSIS)
    if (gods.geometry !== godGeo) gods.geometry = godGeo

    const world = session.world
    const at = world.player.state.pos
    const scale = TORUS.SCALE * torusTuning.spread * bushExitScale()

    // 1) Своя поза в канал комнаты: точка S³ и нос (касательная Vᵀ·(f,0)).
    pubAcc.current += dt
    if (pubAcc.current >= 1 / PUBLISH_HZ) {
      pubAcc.current = 0
      bushPlayerPoint(_me)
      _dir.copy(_nose).applyQuaternion(world.player.state.quat)
      const v = torusView()
      for (let i = 0; i < 4; i++) _t[i] = v[i]! * _dir.x + v[4 + i]! * _dir.y + v[8 + i]! * _dir.z
      const q = world.player.state.quat
      void publishPose('bush', {
        x: _me[0]!, y: _me[1]!, z: _me[2]!, w: _me[3]!,
        tx: _t[0]!, ty: _t[1]!, tz: _t[2]!, tw: _t[3]!,
        qx: q.x, qy: q.y, qz: q.z, qw: q.w, vx: 0, vy: 0, vz: 0, s: 1, c: performance.now(),
      })
    }

    _frame.scale = scale
    _frame.at.copy(at)
    let ns = 0
    let ng = 0

    // 2) Путники куста.
    for (const b of bushTravellers) {
      if (!b.alive) continue
      if (b.god) {
        if (ng < gods.instanceMatrix.count && place(gods, ng, b.p, b.t, GOD_ANGULAR_R)) ng++
      } else if (ns < MAX_PEERS && place(ships, ns, b.p, b.t, SHIP_ANGULAR_R)) {
        ns++
      }
    }

    // 3) Друзья в комнате — с подписью на HUD.
    for (const [uid, tr] of tracks.current) {
      if (clock.current - tr.seenAt > PEER_STALE_S) {
        tracks.current.delete(uid)
        continue
      }
      const s = tr.snap
      if (typeof s.w !== 'number') continue
      _p[0] = s.x
      _p[1] = s.y
      _p[2] = s.z
      _p[3] = s.w
      _t[0] = s.tx ?? 0
      _t[1] = s.ty ?? 0
      _t[2] = s.tz ?? 0
      _t[3] = s.tw ?? 0
      if (ns >= MAX_PEERS || !place(ships, ns, _p, _t, SHIP_ANGULAR_R)) continue
      ns++
      if (bushPeerLabels.count < bushPeerLabels.items.length) {
        const lab = bushPeerLabels.items[bushPeerLabels.count++]!
        lab.x = _dummy.position.x
        lab.y = _dummy.position.y
        lab.z = _dummy.position.z
        lab.name = names.current.get(uid) ?? ''
      }
    }

    ships.count = ns
    gods.count = ng
    ships.instanceMatrix.needsUpdate = true
    gods.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh
        ref={shipsRef}
        args={[chassisGeometry(SHIP_CHASSIS), shipMat, MAX_PEERS]}
        frustumCulled={false}
        visible={false}
      />
      <instancedMesh
        ref={godRef}
        args={[chassisGeometry(GOD_CHASSIS), godMat, 1]}
        frustumCulled={false}
        visible={false}
      />
    </>
  )
}
