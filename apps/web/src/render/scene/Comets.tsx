import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CylinderGeometry, Group, Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three'
import { COMET, renderPos, renderTime, type AsteroidEntity, type World } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { createGlowMaterial, createStarBeamMaterial } from '../materials/starBeam'
import { worldShrink } from '../worldShrink'

/**
 * КОМЕТЫ — свечение и хвосты. Само ядро рисует `AsteroidField` (комета — тот же камень);
 * здесь только свет вокруг него:
 *
 *  - КОМА — мягкий шар газа вокруг ядра.
 *  - ИОННЫЙ ХВОСТ — голубой, узкий и длинный, строго ОТ ЗВЕЗДЫ: его сдувает звёздный ветер,
 *    и куда летит комета, ему всё равно.
 *  - ПЫЛЕВОЙ ХВОСТ — желтоватый, шире и короче, тоже от звезды, но слегка отстаёт по ходу:
 *    пыль тяжелее газа. Два хвоста от звезды с небольшим расхождением — главный признак кометы.
 *
 * Пул фиксированный (`COMET.MAX_LIVE` слотов) и выделен один раз; за кадр меняются только
 * позы и видимость. Свет — тот же мягкий материал, что у лучей светил.
 */

/**
 * Размеры — в радиусах ядра. Хвост начинается шириной с кому и расширяется медленно: от
 * точки-вершины он выходил раструбом-прожектором, а настоящий хвост — длинная тающая лента.
 */
const COMA_RADII = 16
const ION_LENGTH_RADII = 420
const ION_START_RADII = 2.5
const ION_END_RADII = 7
const DUST_LENGTH_RADII = 240
const DUST_START_RADII = 4
const DUST_END_RADII = 8
/**
 * Насколько пылевой хвост тянется против движения (остальное — от звезды). Мало: у настоящих
 * комет оба хвоста смотрят от звезды, пылевой лишь слегка отстаёт по ходу. При 0.65 он тянулся
 * назад по случайной скорости кометы, расходился с ионным под прямым углом и читался выхлопом.
 */
const DUST_DRAG = 0.25

const comaGeometry = new PlaneGeometry(2, 2)

/**
 * Хвост — усечённый конус: начало (y = 0, у ядра) уже конца (y = 1). Радиусы — в радиусах
 * ядра; меш масштабируется радиусом кометы. У каждого хвоста свой профиль, поэтому меша два.
 */
function tailGeometry(start: number, end: number) {
  const g = new CylinderGeometry(end, start, 1, 20, 1, true)
  g.translate(0, 0.5, 0) // начало хвоста у ядра (y = 0), конец на +1
  return g
}
const ionGeometry = tailGeometry(ION_START_RADII, ION_END_RADII)
const dustGeometry = tailGeometry(DUST_START_RADII, DUST_END_RADII)

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
  const camera = useThree((s) => s.camera)
  const group = useRef<Group>(null)
  const coma = useRef<Mesh>(null)
  const ion = useRef<Mesh>(null)
  const dust = useRef<Mesh>(null)
  const mats = useMemo(
    () => ({
      coma: createGlowMaterial(0xdff4ff, 0.55),
      ion: createStarBeamMaterial(0x8fc8ff, 0.32, 0.45),
      dust: createStarBeamMaterial(0xfff0cf, 0.15, 0.2),
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
    coma.current.quaternion.copy(camera.quaternion) // облако всегда лицом к камере
    coma.current.scale.setScalar(r * COMA_RADII)

    ion.current.position.copy(_pos)
    ion.current.quaternion.copy(_q.setFromUnitVectors(_up, _anti))
    ion.current.scale.set(r, r * ION_LENGTH_RADII, r)

    dust.current.position.copy(_pos)
    dust.current.quaternion.copy(_q.setFromUnitVectors(_up, _dust))
    dust.current.scale.set(r, r * DUST_LENGTH_RADII, r)

    mats.ion.uniforms.uTime!.value = time
    mats.dust.uniforms.uTime!.value = time
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={coma} geometry={comaGeometry} material={mats.coma} frustumCulled={false} renderOrder={3} />
      <mesh ref={ion} geometry={ionGeometry} material={mats.ion} frustumCulled={false} renderOrder={3} />
      <mesh ref={dust} geometry={dustGeometry} material={mats.dust} frustumCulled={false} renderOrder={3} />
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
