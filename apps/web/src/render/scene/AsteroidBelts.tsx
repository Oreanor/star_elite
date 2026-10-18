import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, Group, ShaderMaterial } from 'three'
import { ASTEROID, beltRockKey, beltRocks, renderPos, type AsteroidBeltEntity } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { worldShrink } from '../worldShrink'

/**
 * ПОЯСА АСТЕРОИДОВ издали — КАМНИ точками. Каждая точка — настоящий камень пояса
 * (`beltRocks`): то же место, где вблизи стоит его тело. Подлетая, точка гаснет ровно там,
 * где камень уже виден телом (`MATERIALIZE_RANGE` в домене), — не тает в пустоту, а
 * сменяется самим камнем. Сбитый камень гаснет и точкой (`world.beltGone`).
 *
 * Буфер выделен один раз на пояс; за кадр двигается только группа (за светилом), а признак
 * «жив» переписывается лишь когда кого-то сбили.
 */

const DOT_COLOR = 0x9a8f80
/** Точка гаснет ближе этого, м: дальше видно тело камня (оно рождается на 15 км). */
const HIDE_NEAR = 9_000
const HIDE_FAR = 13_000

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aSize;
  attribute float aAlive;
  uniform float uHideNear;
  uniform float uHideFar;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    vAlpha = aAlive * smoothstep(uHideNear, uHideFar, d);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    #include <logdepthbuf_fragment>
    if (vAlpha <= 0.001) discard;
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    if (dot(c, c) > 1.0) discard;
    gl_FragColor = vec4(uColor, uOpacity * vAlpha);
  }
`

function BeltDots({ belt, index }: { belt: AsteroidBeltEntity; index: number }) {
  const session = useSession()
  const group = useRef<Group>(null)
  const goneSeen = useRef(-1)
  const { geometry, alive } = useMemo(() => {
    const rocks = beltRocks(belt)
    const pos = new Float32Array(rocks.length * 3)
    const size = new Float32Array(rocks.length)
    const live = new Float32Array(rocks.length).fill(1)
    rocks.forEach((r, i) => {
      pos[i * 3] = r.x
      pos[i * 3 + 1] = r.y
      pos[i * 3 + 2] = r.z
      // Крупный камень — точка чуть больше: глыба читается издали заметнее мелочи.
      size[i] = 1.4 + 1.6 * (r.radius / ASTEROID.RADIUS_MAX)
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('aSize', new BufferAttribute(size, 1))
    const aliveAttr = new BufferAttribute(live, 1)
    g.setAttribute('aAlive', aliveAttr)
    return { geometry: g, alive: aliveAttr }
  }, [belt])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uColor: { value: new Color(DOT_COLOR) },
          uOpacity: { value: 0.75 },
          uHideNear: { value: HIDE_NEAR },
          uHideFar: { value: HIDE_FAR },
        },
        transparent: true,
        depthWrite: false,
      }),
    [],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

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
    material.uniforms.uHideNear!.value = HIDE_NEAR * shrink
    material.uniforms.uHideFar!.value = HIDE_FAR * shrink
    // Сбили камень — гасим его точку. Пересобираем признак только при перемене.
    if (world.beltGone.size !== goneSeen.current) {
      goneSeen.current = world.beltGone.size
      const arr = alive.array as Float32Array
      for (let i = 0; i < arr.length; i++) arr[i] = world.beltGone.has(beltRockKey(index, i)) ? 0 : 1
      alive.needsUpdate = true
    }
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
        <BeltDots key={`${belt.centerId}-${i}`} belt={belt} index={i} />
      ))}
    </>
  )
}
