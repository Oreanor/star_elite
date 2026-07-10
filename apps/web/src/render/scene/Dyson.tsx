import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { LineSegments, Mesh, Quaternion, Vector3 } from 'three'
import { DYSON } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { dysonGeometry, dysonIsLines, ruinGeometry } from '../geometry/dyson'
import { dysonLineMaterial, dysonPanelMaterial } from '../materials/materials'

/**
 * Сфера Дайсона вокруг светила. Декорация: домен лишь помечает систему
 * (`world.dyson`), а строит структуру рендер и вешает её на ГЛАВНУЮ звезду.
 *
 * Стоит в нескольких радиусах над короной (DYSON.SHELL_RADIUS), медленно
 * вращается по `world.time` — угол из времени, не копится. У руин часть панелей
 * и балок выбита: геометрия та же, но прорежена детерминированно (см. ruinGeometry),
 * поэтому останки читаются останками, а не мерцают.
 */

const _spin = new Quaternion()
const AXIS = new Vector3(0.3, 1, 0.1).normalize()

function Structure({ variant, ruined }: { variant: number; ruined: boolean }) {
  const session = useSession()
  const meshRef = useRef<Mesh>(null)
  const lineRef = useRef<LineSegments>(null)

  const lines = dysonIsLines(variant)
  const geometry = useMemo(
    () => (ruined ? ruinGeometry(variant) : dysonGeometry(variant)),
    [variant, ruined],
  )
  const material = useMemo(() => (lines ? dysonLineMaterial() : dysonPanelMaterial()), [lines])

  useFrame(() => {
    const node = lines ? lineRef.current : meshRef.current
    if (!node) return
    // Позиция — из ГЛАВНОЙ звезды: у двойной структура висит на первой.
    const star = session.world.bodies.find((b) => b.kind === 'star')
    if (!star) return
    node.position.copy(star.pos)
    _spin.setFromAxisAngle(AXIS, DYSON.SPIN * session.world.time)
    node.quaternion.copy(_spin)
    node.scale.setScalar(star.radius * DYSON.SHELL_RADIUS)
  })

  // Каркас — отрезками, кольцо и рой — гранями: разные узлы, один активен.
  return lines ? (
    <lineSegments ref={lineRef} geometry={geometry} material={material} frustumCulled={false} />
  ) : (
    <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />
  )
}

export function Dyson() {
  const session = useSession()
  const dyson = session.world.dyson
  const star = session.world.bodies.find((b) => b.kind === 'star')
  if (!dyson || !star) return null
  return <Structure variant={dyson.variant} ruined={dyson.ruined} />
}
