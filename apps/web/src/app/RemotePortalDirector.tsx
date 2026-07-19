import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Matrix4, Quaternion, Vector3 } from 'three'
import {
  LINKED_PORTAL,
  crossedJumpGate,
  fitsInsideJumpGate,
  jumpGateSide,
  type JumpGate,
} from '@elite/sim'
import { jumpTo, useSession } from './GameContext'
import {
  portalSnapshotActive,
  subscribeSharedPortals,
  type PortalMouthSnapshot,
  type SharedPortalSnapshot,
} from './net/portal'

interface RemotePortal {
  snapshot: SharedPortalSnapshot
  gate: JumpGate
  previousSide: number | null
}

const _sourcePos = new Vector3()
const _destPos = new Vector3()
const _shipPos = new Vector3()
const _destVel = new Vector3()
const _angVel = new Vector3()
const _sourceQuat = new Quaternion()
const _destQuat = new Quaternion()
const _shipQuat = new Quaternion()
const _velocityQuat = new Quaternion()
const _unitScale = new Vector3(1, 1, 1)
const _sourceMat = new Matrix4()
const _destMat = new Matrix4()
const _inverse = new Matrix4()
const _link = new Matrix4()
const _shipMat = new Matrix4()
const _forward = new Vector3(0, 0, -1)

function readMouth(mouth: PortalMouthSnapshot, pos: Vector3, quat: Quaternion): void {
  pos.set(mouth.x, mouth.y, mouth.z)
  quat.set(mouth.qx, mouth.qy, mouth.qz, mouth.qw)
}

function removeGate(gates: JumpGate[], gate: JumpGate): void {
  const index = gates.indexOf(gate)
  if (index >= 0) gates.splice(index, 1)
}

/**
 * Чужое устье — не декорация: RTDB-снимок материализуется обычным JumpGate,
 * поэтому обод участвует в том же фиксированном шаге, что и собственный портал.
 * Пересечение переводит локального игрока через уже оплаченный тоннель без заряда.
 */
export function RemotePortalDirector() {
  const session = useSession()
  const portals = useRef(new Map<string, RemotePortal>())
  const systemIndex = session.world.systemIndex

  useEffect(() => {
    const world = session.world
    const records = portals.current

    const unsubscribe = subscribeSharedPortals(systemIndex, (snapshots) => {
      const seen = new Set<string>()
      for (const snapshot of snapshots) {
        if (snapshot.galaxySeed !== world.galaxySeed) continue
        const mouth = snapshot.fromSystem === systemIndex
          ? snapshot.from
          : snapshot.toSystem === systemIndex
            ? snapshot.to
            : null
        if (!mouth) continue

        seen.add(snapshot.uid)
        let record = records.get(snapshot.uid)
        if (!record) {
          record = {
            snapshot,
            gate: {
              pos: new Vector3(),
              normal: new Vector3(0, 0, -1),
              radius: snapshot.radius,
              tube: LINKED_PORTAL.TUBE,
            },
            previousSide: null,
          }
          records.set(snapshot.uid, record)
        }

        record.snapshot = snapshot
        readMouth(mouth, record.gate.pos, _sourceQuat)
        record.gate.pos.sub(world.originOffset)
        record.gate.normal.copy(_forward).applyQuaternion(_sourceQuat)
        record.gate.radius = snapshot.radius
        record.gate.tube = LINKED_PORTAL.TUBE
        if (!world.jumpGates.includes(record.gate)) world.jumpGates.push(record.gate)
      }

      for (const [uid, record] of records) {
        if (seen.has(uid)) continue
        removeGate(world.jumpGates, record.gate)
        records.delete(uid)
      }
    })

    return () => {
      unsubscribe()
      for (const record of records.values()) removeGate(world.jumpGates, record.gate)
      records.clear()
    }
  }, [session, systemIndex])

  useFrame(() => {
    const world = session.world
    // Другой постановщик мог сменить систему раньше в этом же кадре. Старую RTDB-
    // проекцию тогда не читаем; Scene с новым epoch переподпишется следом.
    if (world.systemIndex !== systemIndex) return
    const records = portals.current
    for (const [uid, record] of records) {
      const snapshot = record.snapshot
      if (!portalSnapshotActive(snapshot)) {
        removeGate(world.jumpGates, record.gate)
        records.delete(uid)
        continue
      }

      const side = jumpGateSide(world.player, record.gate)
      const crossed = crossedJumpGate(
        record.previousSide,
        side,
        fitsInsideJumpGate(world.player, record.gate),
      )
      record.previousSide = side
      if (!crossed) continue

      const fromHere = snapshot.fromSystem === world.systemIndex
      const destinationIndex = fromHere ? snapshot.toSystem : snapshot.fromSystem
      const source = fromHere ? snapshot.from : snapshot.to
      const destination = fromHere ? snapshot.to : snapshot.from

      // Исходное устье переводим из общего абсолютного кадра в локальный; целевое
      // оставляем абсолютным и вычтем новый originOffset уже после перестройки мира.
      readMouth(source, _sourcePos, _sourceQuat)
      _sourcePos.sub(world.originOffset)
      readMouth(destination, _destPos, _destQuat)

      const state = world.player.state
      _sourceMat.compose(_sourcePos, _sourceQuat, _unitScale)
      _destMat.compose(_destPos, _destQuat, _unitScale)
      _inverse.copy(_sourceMat).invert()
      _link.multiplyMatrices(_destMat, _inverse)
      _shipMat.compose(state.pos, state.quat, _unitScale).premultiply(_link)
      _shipMat.decompose(_shipPos, _shipQuat, _unitScale)
      _velocityQuat.copy(_sourceQuat).invert().premultiply(_destQuat)
      _destVel.copy(state.vel).applyQuaternion(_velocityQuat)
      _angVel.copy(state.angVel)

      if (!jumpTo(session, destinationIndex, null, { establishedPortal: true })) return

      const next = session.world.player.state
      next.pos.copy(_shipPos).sub(session.world.originOffset)
      next.quat.copy(_shipQuat)
      next.vel.copy(_destVel)
      next.angVel.copy(_angVel)
      return
    }
  })

  return null
}
