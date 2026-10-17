import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Group, IcosahedronGeometry, Mesh, Quaternion, Vector3 } from 'three'
import { COMET, renderPos, renderTime, type AsteroidEntity, type World } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { createStarBeamMaterial } from '../materials/starBeam'
import { worldShrink } from '../worldShrink'
import { beamCone } from './StarBeams'

/**
 * КОМЕТЫ — свечение и хвосты. Само ядро рисует `AsteroidField` (комета — тот же камень);
 * здесь только свет вокруг него:
 *
 *  - КОМА — мягкий шар газа вокруг ядра.
 *  - ИОННЫЙ ХВОСТ — голубой, узкий и длинный, строго ОТ ЗВЕЗДЫ: его сдувает звёздный ветер,
 *    и куда летит комета, ему всё равно.
 *  - ПЫЛЕВОЙ ХВОСТ — желтоватый, шире и короче, загибается ПРОТИВ ДВИЖЕНИЯ: пыль тяжелее
 *    газа и отстаёт по орбите. Два хвоста в разные стороны — главный признак кометы.
 *
 * Пул фиксированный (`COMET.MAX_LIVE` слотов) и выделен один раз; за кадр меняются только
 * позы и видимость. Свет — тот же мягкий материал, что у лучей светил.
 */

/** Размеры — в радиусах ядра. */
const COMA_RADII = 14
const ION_LENGTH_RADII = 320
const ION_WIDTH_RADII = 10
const DUST_LENGTH_RADII = 170
const DUST_WIDTH_RADII = 34
/** Насколько пылевой хвост тянется против движения (остальное — от звезды). */
const DUST_DRAG = 0.65

const comaGeometry = new IcosahedronGeometry(1, 3)

const _pos = new Vector3()
const _anti = new Vector3()
const _back = new Vector3()
const _dust = new Vector3()
const _up = new Vector3(0, 1, 0)
const _q = new Quaternion()

/** Направление «от звезды» для кометы: от ближайшего светила (звезды или дыры). */
function antiStar(world: World, comet: AsteroidEntity, out: Vector3): Vector3 {
  let best = Infinity
  out.set(0, 0, 0)
  for (const body of world.bodies) {
    if (body.kind !== 'star' && body.kind !== 'blackhole') continue
    const d = body.pos.distanceToSquared(comet.pos)
    if (d < best) {
      best = d
      out.copy(comet.pos).sub(body.pos)
    }
  }
  // Светил нет (пустота) — хвост просто тянется за кометой.
  if (out.lengthSq() < 1e-6) out.copy(comet.vel).negate()
  return out.normalize()
}

function CometSlot({ index }: { index: number }) {
  const session = useSession()
  const group = useRef<Group>(null)
  const coma = useRef<Mesh>(null)
  const ion = useRef<Mesh>(null)
  const dust = useRef<Mesh>(null)
  const mats = useMemo(
    () => ({
      coma: createStarBeamMaterial(0xdff4ff, 0.35, 0, 0),
      ion: createStarBeamMaterial(0x8fc8ff, 0.5, 0.35),
      dust: createStarBeamMaterial(0xfff0cf, 0.32, 0.15),
    }),
    [],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])

  useFrame(() => {
    const g = group.current
    if (!g || !coma.current || !ion.current || !dust.current) return
    const world = session.world
    // Слот index — index-я ЖИВАЯ комета: порядок в списке камней стабилен между кадрами.
    let seen = 0
    let comet: AsteroidEntity | null = null
    for (const a of world.asteroids) {
      if (!a.alive || !a.comet) continue
      if (seen === index) {
        comet = a
        break
      }
      seen++
    }
    const shrink = worldShrink(world.player.state.scale)
    g.visible = comet !== null && shrink > 0
    if (!comet || shrink <= 0) return

    const r = comet.radius * shrink
    renderPos(world, comet, _pos)
    antiStar(world, comet, _anti)
    _back.copy(comet.vel).normalize().negate()
    _dust.copy(_anti).multiplyScalar(1 - DUST_DRAG).addScaledVector(_back, DUST_DRAG).normalize()
    const time = renderTime(world)

    coma.current.position.copy(_pos)
    coma.current.scale.setScalar(r * COMA_RADII)

    ion.current.position.copy(_pos)
    ion.current.quaternion.copy(_q.setFromUnitVectors(_up, _anti))
    ion.current.scale.set(r * ION_WIDTH_RADII, r * ION_LENGTH_RADII, r * ION_WIDTH_RADII)

    dust.current.position.copy(_pos)
    dust.current.quaternion.copy(_q.setFromUnitVectors(_up, _dust))
    dust.current.scale.set(r * DUST_WIDTH_RADII, r * DUST_LENGTH_RADII, r * DUST_WIDTH_RADII)

    mats.ion.uniforms.uTime!.value = time
    mats.dust.uniforms.uTime!.value = time
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={coma} geometry={comaGeometry} material={mats.coma} frustumCulled={false} renderOrder={3} />
      <mesh ref={ion} geometry={beamCone} material={mats.ion} frustumCulled={false} renderOrder={3} />
      <mesh ref={dust} geometry={beamCone} material={mats.dust} frustumCulled={false} renderOrder={3} />
    </group>
  )
}

export function Comets() {
  const slots = useMemo(() => Array.from({ length: COMET.MAX_LIVE }, (_, i) => i), [])
  return (
    <>
      {slots.map((i) => (
        <CometSlot key={i} index={i} />
      ))}
    </>
  )
}
