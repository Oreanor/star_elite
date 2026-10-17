import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Group, PointsMaterial } from 'three'
import { makeRng, renderPos, type AsteroidBeltEntity } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { worldShrink } from '../worldShrink'

/**
 * ПОЯСА АСТЕРОИДОВ издали — пылевое кольцо точек вокруг светила. Вблизи пояс — настоящие
 * камни (`stepBelts` рождает их вокруг корабля), а это лишь его силуэт на всю систему.
 *
 * Точки разложены один раз на пояс (детерминированно от его радиуса — у всех одинаково):
 * плотнее к средней линии, тоньше к кромкам — гауссов профиль, а не резкая шайба. За кадр
 * двигается только группа — вслед за светилом.
 */

/** Точек на пояс. Кольцо — силуэт, не тела: этого хватает, чтобы читалось сплошным. */
const DUST_COUNT = 9000
const DUST_COLOR = 0x9a8f80

/** Нормальное распределение (Бокс — Мюллер): плотнее к середине пояса. */
function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

function BeltDust({ belt }: { belt: AsteroidBeltEntity }) {
  const session = useSession()
  const group = useRef<Group>(null)
  const geometry = useMemo(() => {
    const rng = makeRng(Math.floor(belt.radius) >>> 0)
    const pos = new Float32Array(DUST_COUNT * 3)
    for (let i = 0; i < DUST_COUNT; i++) {
      const a = rng() * Math.PI * 2
      const r = belt.radius + Math.max(-0.5, Math.min(0.5, gauss(rng) * 0.22)) * belt.width
      pos[i * 3] = Math.cos(a) * r
      pos[i * 3 + 1] = Math.max(-0.5, Math.min(0.5, gauss(rng) * 0.25)) * belt.thickness
      pos[i * 3 + 2] = Math.sin(a) * r
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    return g
  }, [belt])
  const material = useMemo(
    () => new PointsMaterial({ color: DUST_COLOR, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }),
    [],
  )
  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const world = session.world
    const shrink = worldShrink(world.player.state.scale)
    const center = world.bodies.find((b) => b.id === belt.centerId)
    g.visible = shrink > 0 && center != null
    if (!center || shrink <= 0) return
    renderPos(world, center, g.position)
    g.scale.setScalar(shrink)
  })

  return (
    <group ref={group}>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  )
}

/** Все пояса системы. Список меняется только со сменой системы — как у прочих тел. */
export function AsteroidBelts() {
  const session = useSession()
  const belts = session.world.asteroidBelts
  if (belts.length === 0) return null
  return (
    <>
      {belts.map((belt, i) => (
        <BeltDust key={`${belt.centerId}-${i}`} belt={belt} />
      ))}
    </>
  )
}
