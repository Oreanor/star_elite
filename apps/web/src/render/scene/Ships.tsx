import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { InstancedMesh, Mesh, Object3D, Plane, type Material } from 'three'
import {
  CHASSIS_CATALOGUE,
  isDroneShip,
  isVisible,
  renderPos,
  renderQuat,
  warpDepartHidden,
  warpEmergeHidden,
  type ShipEntity,
} from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { shownShipQuat } from '../shownPose'
import { jumpPortal, portalOpen } from '../../session/jumpPortal'
import { GIANT_RENDER_CAP } from '../config'
import { chassisGeometry, chassisSizeMul, droneGeometry, placeholderGeometry } from '../geometry/ships'
import { cloakMaterial, hullMaterial, hullMaterialFor } from '../materials/materials'
import { usePortalRenderSide } from './portalRenderContext'

/** Инстансов на ОДИН корпус: столько бортов одного облика влезает в кадр разом. */
const MAX_PER_CHASSIS = 28
/** Четыре у игрока — но врагам их однажды тоже выдадут. */
const MAX_DRONES = 16

/** Корпуса, что рисуются ботами: весь каталог, кроме дрона — у него свой InstancedMesh. */
const BOT_CHASSIS_IDS = CHASSIS_CATALOGUE.map((c) => c.id).filter((id) => id !== 'drone')

// Единственный объект для сборки матриц. `new Object3D()` в кадре — мусор для GC.
const _dummy = new Object3D()

/** Бесконечная clip-плоскость допустима только пока корпус касается диска портала. */
function touchesPortalPlane(ship: ShipEntity): boolean {
  const p = jumpPortal()
  const dx = ship.state.pos.x - p.ringPos.x
  const dy = ship.state.pos.y - p.ringPos.y
  const dz = ship.state.pos.z - p.ringPos.z
  const axial = dx * p.ringNormal.x + dy * p.ringNormal.y + dz * p.ringNormal.z
  const radius = ship.spec.hull.radius * ship.state.scale
  if (Math.abs(axial) > radius) return false
  const radialSq = Math.max(0, dx * dx + dy * dy + dz * dz - axial * axial)
  const reach = p.ringRadius + radius
  return radialSq <= reach * reach
}

export function PlayerShip() {
  const session = useSession()
  const gl = useThree((s) => s.gl)
  const ref = useRef<Mesh>(null)
  const portalSide = usePortalRenderSide()
  const portalClipMat = useRef<Material | null>(null)
  const portalClipBase = useRef<Material | null>(null)
  const destinationClip = useMemo(() => new Plane(), [])

  useEffect(() => () => portalClipMat.current?.dispose(), [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const player = session.world.player

    // Купил другой корпус — меняем геометрию. PlayerShip не перерисовывается от React
    // (пропсов нет), поэтому подмену ловим в кадре по id шасси, а не на маунте. Сравниваем
    // по ИДЕНТИЧНОСТИ объекта, а не по id: у «Авроры One» геометрия — асинхронно грузимый GLB,
    // до готовности отдаётся заглушка-«Аврора»; как только меш доедет, объект сменится — и
    // сравнение по id этого бы не поймало, а по идентичности ловит и подмену корпуса, и апгрейд.
    const geom = chassisGeometry(player.loadout.chassis.id)
    if (mesh.geometry !== geom) mesh.geometry = geom

    // Миелофон: корабль в мире и правда большой (коллизии это знают). На экране он
    // постоянен — камера отъезжает на тот же множитель (см. FlightCamera). Множитель зажат
    // потолком рендера (GIANT_RENDER_CAP), синхронно с камерой: выше него корпус мерцает
    // в лог-буфере глубины. По игре ты растёшь дальше — просто на экране размер замирает.
    const capped = Math.min(player.state.scale, GIANT_RENDER_CAP)
    // Поза для показа — между тактами (см. `poseTrail`), как и у камеры.
    // С наклоном за прицелом над поверхностью (`shownShipQuat`): нос ныряет вслед за линией огня.
    shownShipQuat(session.world, player, mesh.quaternion)
    renderPos(session.world, player.state, mesh.position)

    // Свой корпус виден на всём пути роста, до потолка: прятать его у верха зума читалось
    // как «корабль уехал». Живой множитель размера из редактора оснастки (клавиша K): дефолт 1.
    mesh.scale.setScalar(capped * chassisSizeMul(player.loadout.chassis.id))
    // Корабль исчезает, канув в кольцо прыжка: с этого мига его в старой системе уже нет.
    mesh.visible = player.alive

    // Свой корабль под полем видно — иначе пилот теряет собственный нос.
    // Чужой не видно вовсе, и это разные вещи: одна про интерфейс, другая про мир.
    // Материал зависит от корпуса: загруженный меш («Аврора One») — пластик, прочие — металл.
    const base = player.cloaked ? cloakMaterial() : hullMaterialFor(player.loadout.chassis.id)
    const destination = portalSide === 'destination'
    if (portalOpen() && (destination || touchesPortalPlane(player))) {
      gl.localClippingEnabled = true
      if (!portalClipMat.current || portalClipBase.current !== base) {
        portalClipMat.current?.dispose()
        portalClipMat.current = base.clone()
        portalClipBase.current = base
      }
      const clipped = portalClipMat.current
      if (destination) {
        const p = jumpPortal()
        // clipThere хранится в абсолютном кадре целевой системы, а её World уже
        // перецентрован. Переносим только constant, нормаль остаётся той же.
        destinationClip.copy(p.clipThere)
        destinationClip.constant += destinationClip.normal.dot(session.world.originOffset)
        clipped.clippingPlanes = [destinationClip]
      } else {
        clipped.clippingPlanes = [jumpPortal().clipHere]
      }
      mesh.material = clipped
    } else {
      mesh.material = base
    }
  })

  return <mesh ref={ref} geometry={placeholderGeometry()} material={hullMaterial()} frustumCulled={false} />
}

/**
 * Беспилотники. Отдельный InstancedMesh, потому что у них своя геометрия, —
 * а не потому, что они «особенные»: для симуляции это обычные корабли.
 */
export function Drones() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(droneGeometry, [])
  const material = useMemo(hullMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const ship of session.world.ships) {
      if (!isDroneShip(ship) || !isVisible(ship) || count >= MAX_DRONES) continue

      renderPos(session.world, ship.state, _dummy.position)
      renderQuat(session.world, ship.state, _dummy.quaternion)
      _dummy.scale.setScalar(ship.state.scale) // миелофон: истинный размер борта
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX_DRONES]} frustumCulled={false} />
}

/**
 * Боты ОДНОГО корпуса — один InstancedMesh (1 draw call на облик, а не на весь трафик).
 * Геометрию и материал берём по `chassis.id`: GLB грузится асинхронно, поэтому каждый кадр
 * сверяем идентичность и подменяем, как только меш доехал (как в PlayerShip). Оттого у каждого
 * борта СВОЙ облик и текстуры, а не общий сайдвиндер на всех.
 */
function BotChassisBatch({ chassisId }: { chassisId: string }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const geom = chassisGeometry(chassisId)
    if (mesh.geometry !== geom) mesh.geometry = geom
    const mat = hullMaterialFor(chassisId)
    if (mesh.material !== mat) mesh.material = mat

    const world = session.world
    let count = 0
    for (const ship of world.ships) {
      if (ship.loadout.chassis.id !== chassisId) continue
      // Замаскированный чужой не рисуется вовсе; дрон — свой меш; кинематический борт
      // (удалённый игрок) рисует `RemotePlayers`; варп-скрытые — тоже мимо. Всё из домена.
      if (
        isDroneShip(ship) ||
        ship.kinematic ||
        !isVisible(ship) ||
        warpEmergeHidden(world, ship) ||
        warpDepartHidden(world, ship) ||
        count >= MAX_PER_CHASSIS
      )
        continue

      renderPos(session.world, ship.state, _dummy.position)
      renderQuat(session.world, ship.state, _dummy.quaternion)
      _dummy.scale.setScalar(ship.state.scale) // миелофон: истинный размер борта
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={ref}
      args={[chassisGeometry(chassisId), hullMaterialFor(chassisId), MAX_PER_CHASSIS]}
      // Инстансы движутся каждый кадр: пересчёт общего bounding box дороже, чем draw call.
      frustumCulled={false}
    />
  )
}

/** Все боты — по одному батчу на корпус. Пустой батч (никого этого облика) draw call не тратит. */
export function EnemyShips() {
  return (
    <>
      {BOT_CHASSIS_IDS.map((id) => (
        <BotChassisBatch key={id} chassisId={id} />
      ))}
    </>
  )
}
