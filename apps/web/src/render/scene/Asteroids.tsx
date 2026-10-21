import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry, InstancedMesh, Object3D, PointsMaterial, type Texture } from 'three'
import { ASTEROID, BELT, renderPos, renderQuat, renderTime } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { asteroidShapes } from '../geometry/rocks'
import { rockMaterial, rockTexturedMaterial } from '../materials/materials'
import { loadRockTexture } from '../materials/rockTextures'
import { worldShrink } from '../worldShrink'

/**
 * Пояс астероидов: по одному InstancedMesh на каждую форму — сотни камней пятью вызовами.
 * Камни-ТЕЛА (`world.asteroids`, у пояса — только окно `BELT.ENTITY_RANGE`) раскладываются по
 * формам ОДНИМ проходом; дальняя дуга — точки из `AsteroidBelt.dots`, без тел вовсе.
 *
 * Запас на форму взят не на глаз: расколотый камень рождает до SPLIT_MAX
 * осколков, и за долгий бой пояс распухает в разы против начальных 260.
 */

const MAX_PER_SHAPE = 1024
const _dummy = new Object3D()
/** Счётчики инстансов по формам за кадр — без аллокаций. */
const _counts = new Int32Array(ASTEROID.SHAPES)

/**
 * Одна форма камня: свой меш и своя текстура (грузится лениво). Матрицы ей пишет общий
 * проход `RockMeshes` — так каждый камень перебирается раз, а не по разу на форму.
 */
function ShapeBatch({ shapeIndex, meshes }: { shapeIndex: number; meshes: (InstancedMesh | null)[] }) {
  const geometry = useMemo(() => asteroidShapes()[shapeIndex]!, [shapeIndex])

  // Единственный setState за всю жизнь партии — в момент загрузки картинки.
  // В кадре React не участвует: матрицы пишутся прямо в буфер инстансов.
  const [map, setMap] = useState<Texture | null>(null)
  useEffect(() => loadRockTexture(shapeIndex, setMap), [shapeIndex])

  const material = map ? rockTexturedMaterial(map) : rockMaterial()

  return (
    <instancedMesh
      ref={(el) => {
        meshes[shapeIndex] = el
      }}
      args={[geometry, material, MAX_PER_SHAPE]}
      frustumCulled={false}
    />
  )
}

function RockMeshes() {
  const session = useSession()
  const meshes = useRef<(InstancedMesh | null)[]>(Array.from({ length: ASTEROID.SHAPES }, () => null))

  useFrame(() => {
    const list = meshes.current
    // С галактикой пояс исчезает вместе с планетами (worldShrink → 0).
    const shrink = worldShrink(session.world.player.state.scale)
    _counts.fill(0)
    if (shrink > 0) {
      for (const rock of session.world.asteroids) {
        if (!rock.alive) continue
        const mesh = list[rock.shape]
        const n = _counts[rock.shape]!
        if (!mesh || n >= MAX_PER_SHAPE) continue
        renderPos(session.world, rock, _dummy.position)
        renderQuat(session.world, rock, _dummy.quaternion)
        // Геометрия единичного радиуса — настоящий размер задаёт масштаб.
        _dummy.scale.setScalar(rock.radius * shrink)
        _dummy.updateMatrix()
        mesh.setMatrixAt(n, _dummy.matrix)
        _counts[rock.shape] = n + 1
      }
    }
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i]
      if (!mesh) continue
      mesh.count = _counts[i]!
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      {Array.from({ length: ASTEROID.SHAPES }, (_, i) => (
        <ShapeBatch key={i} shapeIndex={i} meshes={meshes.current} />
      ))}
    </>
  )
}

const dotMaterial = new PointsMaterial({
  // 2 px: одинокая точка на 1 px тонет в сглаживании и среди звёзд.
  size: 2,
  sizeAttenuation: false,
  transparent: true,
  depthWrite: false,
  fog: false,
  vertexColors: true,
})

/**
 * Дальняя дуга пояса — точки. Позиция — истинная точка пересборки, сдвинутая дрейфом на
 * прошедшее время (`renderTime`), минус текущее плавающее начало. Конец окна гаснет плавно:
 * спад тянется вдоль хорды на весь хвост, чтобы черта не врезалась в небо оборванным концом.
 */
function BeltDots() {
  const session = useSession()
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(BELT.MAX_DOTS * 3), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(BELT.MAX_DOTS * 4), 4))
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(() => {
    const world = session.world
    const pos = geometry.getAttribute('position') as BufferAttribute
    const color = geometry.getAttribute('color') as BufferAttribute
    const shrink = worldShrink(world.player.state.scale)
    const belt = world.asteroidBelt
    if (!belt || shrink <= 0) {
      geometry.setDrawRange(0, 0)
      return
    }
    const dots = belt.dots
    const dt = renderTime(world) - dots.time
    const off = world.originOffset
    const player = world.player.state.pos
    const p = dots.pos
    const v = dots.drift

    // Ближайшая точка дуги — начало спада.
    let near: number = BELT.VISIBLE_RANGE
    for (let i = 0; i < dots.count; i++) {
      const o = i * 3
      const x = p[o]! + v[o]! * dt - off.x - player.x
      const y = p[o + 1]! + v[o + 1]! * dt - off.y - player.y
      const z = p[o + 2]! + v[o + 2]! * dt - off.z - player.z
      const d = Math.hypot(x, y, z)
      if (d < near) near = d
    }
    const reach = Math.max(1, BELT.VISIBLE_RANGE * BELT.VISIBLE_RANGE - near * near)

    let n = 0
    for (let i = 0; i < dots.count; i++) {
      const o = i * 3
      const x = p[o]! + v[o]! * dt - off.x
      const y = p[o + 1]! + v[o + 1]! * dt - off.y
      const z = p[o + 2]! + v[o + 2]! * dt - off.z
      const d = Math.hypot(x - player.x, y - player.y, z - player.z)
      if (d >= BELT.VISIBLE_RANGE) continue
      pos.setXYZ(n, x, y, z)
      const along = Math.max(0, d * d - near * near)
      const t = 1 - Math.min(1, along / reach)
      const edge = t * t * (3 - 2 * t)
      // У окна тел точки ещё лежат пачкой на один пиксель — низкий тон, иначе палец.
      // Дальше потолок нарочно ниже единицы: полная черта на небе слишком резкая.
      const lone = Math.min(1, Math.max(0, (d - BELT.ENTITY_RANGE) / 200_000))
      const gain = 0.16 + 0.34 * lone
      // Чуть серее тёплого: на чёрном небе (0.72, 0.62, 0.48) читается белой чёрточкой.
      color.setXYZW(n++, 0.55 * gain, 0.53 * gain, 0.5 * gain, edge * shrink * (0.28 + 0.38 * lone))
    }
    geometry.setDrawRange(0, n)
    pos.needsUpdate = color.needsUpdate = true
  })
  return <points geometry={geometry} material={dotMaterial} frustumCulled={false} />
}

export function AsteroidField() {
  return (
    <>
      <BeltDots />
      <RockMeshes />
    </>
  )
}
