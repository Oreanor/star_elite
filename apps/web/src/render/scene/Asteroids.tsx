import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry, InstancedMesh, Object3D, PointsMaterial, type Texture } from 'three'
import { ASTEROID, BELT, renderPos, renderQuat } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { asteroidShapes } from '../geometry/rocks'
import { rockMaterial, rockTexturedMaterial } from '../materials/materials'
import { loadRockTexture } from '../materials/rockTextures'
import { worldShrink } from '../worldShrink'

/**
 * Пояс астероидов: по одному InstancedMesh на каждую форму.
 * Сотни камней рисуются пятью вызовами, а не сотнями.
 *
 * Запас на форму взят не на глаз: расколотый камень рождает до SPLIT_MAX
 * осколков, и за долгий бой пояс распухает в разы против начальных 260.
 */

const MAX_PER_SHAPE = 1024
// Тела вместо точек. На 40% дальше окна плотности: камни там уже есть, локатор и счёт не трогаем.
const MESH_RANGE = BELT.LOCAL_RANGE * 1.4
const _dummy = new Object3D()

function ShapeBatch({ shapeIndex }: { shapeIndex: number }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => asteroidShapes()[shapeIndex]!, [shapeIndex])

  // Единственный setState за всю жизнь партии — в момент загрузки картинки.
  // В кадре React не участвует: матрицы пишутся прямо в буфер инстансов.
  const [map, setMap] = useState<Texture | null>(null)
  useEffect(() => loadRockTexture(shapeIndex, setMap), [shapeIndex])

  const material = map ? rockTexturedMaterial(map) : rockMaterial()

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    // С галактикой пояс исчезает вместе с планетами (worldShrink → 0).
    const shrink = worldShrink(session.world.player.state.scale)
    if (shrink <= 0) {
      mesh.count = 0
      return
    }

    let count = 0
    for (const rock of session.world.asteroids) {
      if (!rock.alive || rock.shape !== shapeIndex || count >= MAX_PER_SHAPE) continue
      if (rock.beltKey && rock.pos.distanceToSquared(session.world.player.state.pos) > MESH_RANGE ** 2) continue

      renderPos(session.world, rock, _dummy.position)
      renderQuat(session.world, rock, _dummy.quaternion)
      // Геометрия единичного радиуса — настоящий размер задаёт масштаб.
      _dummy.scale.setScalar(rock.radius * shrink)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX_PER_SHAPE]} frustumCulled={false} />
}

const MAX_DOTS = 24000
const dotMaterial = new PointsMaterial({
  // 2 px: одинокая точка на 1 px тонет в сглаживании и среди звёзд.
  size: 2,
  sizeAttenuation: false,
  transparent: true,
  depthWrite: false,
  fog: false,
  vertexColors: true,
})

function BeltDots() {
  const session = useSession()
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_DOTS * 3), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(MAX_DOTS * 4), 4))
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(() => {
    const world = session.world
    const pos = geometry.getAttribute('position') as BufferAttribute
    const color = geometry.getAttribute('color') as BufferAttribute
    const shrink = worldShrink(world.player.state.scale)
    const player = world.player.state.pos
    let n = 0
    let near: number = BELT.VISIBLE_RANGE
    if (shrink > 0) for (const rock of world.asteroids) {
      if (!rock.alive || !rock.beltKey) continue
      const d = rock.pos.distanceTo(player)
      if (d > MESH_RANGE && d < near) near = d
    }
    // Спад по дистанции до края окна сжимается в последние градусы дуги: черта одной
    // яркости, и концы врезаются. Доля пути вдоль хорды растягивает тот же спад на весь хвост.
    const reach = Math.max(1, BELT.VISIBLE_RANGE * BELT.VISIBLE_RANGE - near * near)
    if (shrink > 0) for (const rock of world.asteroids) {
      if (!rock.alive || !rock.beltKey || n >= MAX_DOTS) continue
      const d = rock.pos.distanceTo(player)
      if (d <= MESH_RANGE || d >= BELT.VISIBLE_RANGE) continue
      renderPos(world, rock, _dummy.position)
      pos.setXYZ(n, _dummy.position.x, _dummy.position.y, _dummy.position.z)
      const along = Math.max(0, d * d - near * near)
      const t = 1 - Math.min(1, along / reach)
      const edge = t * t * (3 - 2 * t)
      // У локатора точки ещё лежат пачкой на один пиксель — низкий тон, иначе палец.
      // Дальше потолок нарочно ниже единицы: полная черта на небе слишком резкая.
      const lone = Math.min(1, Math.max(0, (d - MESH_RANGE) / 200_000))
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
      {Array.from({ length: ASTEROID.SHAPES }, (_, i) => (
        <ShapeBatch key={i} shapeIndex={i} />
      ))}
    </>
  )
}
