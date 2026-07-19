import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three'
import { useSession } from '../../app/GameContext'
import { portalSnapshotActive, sharedPortalSnapshots, type PortalMouthSnapshot } from '../../app/net/portal'
import { serverNow } from '../../app/net/firebase'
import { WARP_PORTAL } from '../config'
import { chassisGeometry } from '../geometry/ships'
import { hullMaterial } from '../materials/materials'

const MAX_REMOTE_PORTALS = 8
const REMOTE_CHASSIS = 'aurora_one'
const _ringGeometry = new TorusGeometry(1, WARP_PORTAL.TUBE, 10, 48)

interface Slot {
  group: Group
  ring: Mesh
  ship: Mesh
  plane: Plane
}

const _fromPos = new Vector3()
const _toPos = new Vector3()
const _shipPos = new Vector3()
const _normal = new Vector3()
const _unitScale = new Vector3(1, 1, 1)
const _fromQuat = new Quaternion()
const _toQuat = new Quaternion()
const _shipQuat = new Quaternion()
const _fromMat = new Matrix4()
const _toMat = new Matrix4()
const _inv = new Matrix4()
const _link = new Matrix4()
const _shipMat = new Matrix4()
const _forward = new Vector3(0, 0, -1)

function readMouth(m: PortalMouthSnapshot, pos: Vector3, quat: Quaternion): void {
  pos.set(m.x, m.y, m.z)
  quat.set(m.qx, m.qy, m.qz, m.qw)
}

function createSlot(): Slot {
  const group = new Group()
  const ring = new Mesh(
    _ringGeometry,
    new MeshBasicMaterial({
      color: 0x66e0ff,
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
    }),
  )
  const plane = new Plane()
  const material = hullMaterial().clone() as MeshStandardMaterial
  material.clippingPlanes = [plane]
  material.clipShadows = true
  const ship = new Mesh(chassisGeometry(REMOTE_CHASSIS), material)
  ship.frustumCulled = false
  group.add(ring, ship)
  group.visible = false
  return { group, ring, ship, plane }
}

/** Чужие пары устьев: один и тот же борт клипируется в старой и новой системах. */
export function RemoteJumpPortals() {
  const session = useSession()
  const gl = useThree((s) => s.gl)
  const { root, slots } = useMemo(() => {
    const nextRoot = new Group()
    const nextSlots: Slot[] = []
    for (let i = 0; i < MAX_REMOTE_PORTALS; i++) {
      const slot = createSlot()
      nextSlots.push(slot)
      nextRoot.add(slot.group)
    }
    return { root: nextRoot, slots: nextSlots }
  }, [])

  useEffect(() => () => {
    for (const slot of slots) {
      ;(slot.ring.material as MeshBasicMaterial).dispose()
      ;(slot.ship.material as MeshStandardMaterial).dispose()
    }
  }, [slots])

  useFrame(() => {
    const world = session.world
    const snapshots = sharedPortalSnapshots()
    if (snapshots.length > 0) gl.localClippingEnabled = true

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!
      const p = snapshots[i]
      if (!p || !portalSnapshotActive(p) || (p.fromSystem !== world.systemIndex && p.toSystem !== world.systemIndex)) {
        slot.group.visible = false
        continue
      }
      slot.group.visible = true
      readMouth(p.from, _fromPos, _fromQuat)
      readMouth(p.to, _toPos, _toQuat)

      // 12 Гц достаточно сети; короткая экстраполяция убирает ступеньки между пакетами.
      const age = Math.max(0, Math.min(0.2, (serverNow() - p.t) / 1000))
      _shipPos.set(
        p.traveler.x + p.traveler.vx * age,
        p.traveler.y + p.traveler.vy * age,
        p.traveler.z + p.traveler.vz * age,
      )
      _shipQuat.set(p.traveler.qx, p.traveler.qy, p.traveler.qz, p.traveler.qw)

      if (p.toSystem === world.systemIndex) {
        _fromMat.compose(_fromPos, _fromQuat, _unitScale)
        _toMat.compose(_toPos, _toQuat, _unitScale)
        _inv.copy(_fromMat).invert()
        _link.multiplyMatrices(_toMat, _inv)
        _shipMat.compose(_shipPos, _shipQuat, _unitScale).premultiply(_link)
        _shipMat.decompose(_shipPos, _shipQuat, _unitScale)
        _normal.copy(_forward).applyQuaternion(_toQuat).negate()
        slot.plane.setFromNormalAndCoplanarPoint(_normal, _toPos)
        slot.ring.position.copy(_toPos).sub(world.originOffset)
        slot.ring.quaternion.copy(_toQuat)
      } else {
        _normal.copy(_forward).applyQuaternion(_fromQuat)
        slot.plane.setFromNormalAndCoplanarPoint(_normal, _fromPos)
        slot.ring.position.copy(_fromPos).sub(world.originOffset)
        slot.ring.quaternion.copy(_fromQuat)
      }

      slot.ring.scale.setScalar(p.radius)
      slot.ship.position.copy(_shipPos).sub(world.originOffset)
      slot.ship.quaternion.copy(_shipQuat)
      slot.ship.scale.setScalar(Math.min(p.traveler.scale, 50))
      const geom = chassisGeometry(REMOTE_CHASSIS)
      if (slot.ship.geometry !== geom) slot.ship.geometry = geom
    }
  })

  return <primitive object={root} />
}
