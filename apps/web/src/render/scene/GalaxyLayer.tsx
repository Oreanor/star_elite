import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import { applyDelta, GALAXY, generateGalaxy, SCALE, type BodyEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { GALAXY_LAYER } from '../config'
import { galaxyRadar } from './galaxyRadar'

/**
 * Галактика как дальний край зума миелофона. С FADE_IN_START — сразу, без прозрачности.
 *
 * Якорь = барицентр своей системы (середина пары / звезда / дыра): local координаты
 * совпадают с телами — двойная проявляется двойной, подмена без шва.
 *
 * Размер точки = R·STAR_INFLATE (все классы одинаково раздуты, пропорции честные).
 * Сфера кадра шире локатора: в космосе поле, на мини-карте — соседи.
 *
 * Буфер: сначала главные (индекс = systemIndex), затем спутники двойных.
 */
const vertex = /* glsl */ `
attribute float size; // радиус в св.г слоя = R·STAR_INFLATE / LY_TO_M
attribute float boost; // 0 = спокойная, 1 = активная (jumpTarget)

uniform float uRadius;
uniform float uEdge;
uniform vec3 uPlayer;
uniform float uLayerScale;
uniform float uProj;
uniform float uSpeckPx;
uniform float uMaxPx;
uniform float uGlowSize;
uniform float uActiveSize;
uniform float uCalmSize;

varying vec3 vColor;
varying float vT;
varying float vPhase; // 0..1 — уникальная фаза мерцания от позиции
varying float vBoost;

void main() {
  vColor = color;
  vBoost = boost;
  // Стабильный hash: каждая звезда переливается в своём ритме, без атрибута.
  vPhase = fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec4 world = modelMatrix * vec4(position, 1.0);
  float dist = length(world.xyz - uPlayer);
  vT = clamp((uRadius - dist) / max(uEdge, 1.0), 0.0, 1.0);
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;

  float rRender = size * uLayerScale;
  float camDist = max(length(mv.xyz), 1.0);
  float diamPx = 2.0 * uProj * rRender / camDist;
  float sizeMul = mix(uCalmSize, uActiveSize, boost);
  gl_PointSize = min(max(diamPx * uGlowSize * sizeMul, uSpeckPx), uMaxPx);
}
`

const fragment = /* glsl */ `
uniform float uTime;
uniform float uTwinkleAmp;
uniform float uTwinkleSpeed;
uniform float uTwinkleSpread;
uniform float uActiveBright;
uniform float uCalmBright;
uniform float uActiveTwinkle;
uniform float uCalmTwinkle;

varying vec3 vColor;
varying float vT;
varying float vPhase;
varying float vBoost;

void main() {
  if (vT <= 0.0) discard;
  vec2 pc = gl_PointCoord - vec2(0.5);
  float r2 = dot(pc, pc) * 4.0;
  if (r2 > 1.0) discard;

  // Мячик: яркое ядро + мягкий ореол; цвет звезды читается, не белая пыль starfield.
  float core = exp(-10.0 * r2);
  float halo = exp(-1.35 * r2);
  float sphere = sqrt(max(0.0, 1.0 - r2));
  float bright = mix(uCalmBright, uActiveBright, vBoost);
  vec3 col = vColor * (0.35 + 0.55 * sphere + 1.4 * core + 0.4 * halo) * bright;
  float alpha = (core * 0.95 + halo * 0.5 + sphere * 0.25) * vT;

  float w1 = uTwinkleSpeed + vPhase * uTwinkleSpread;
  float w2 = uTwinkleSpeed * 0.37 + (1.0 - vPhase) * uTwinkleSpread * 0.5;
  float wave = 0.6 * sin(uTime * w1 + vPhase * 6.2831)
             + 0.4 * sin(uTime * w2 + vPhase * 4.1888);
  float twAmp = uTwinkleAmp * mix(uCalmTwinkle, uActiveTwinkle, vBoost);
  float twinkle = 1.0 + twAmp * wave;
  col *= twinkle;
  alpha *= mix(0.88, 1.05, 0.5 + 0.5 * wave * mix(uCalmTwinkle, 1.0, vBoost));

  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}
`

const _colour = new Color()
const _bary = new Vector3()
const _tmp = new Vector3()
const DEG2RAD = Math.PI / 180

/** Радиус точки в св.г слоя: (R_м · STAR_INFLATE) / LY_TO_M → rRender = R·INFLATE / scale. */
function sizeLy(radiusUnits: number): number {
  return (radiusUnits * SCALE.STAR_RADIUS * GALAXY_LAYER.STAR_INFLATE) / GALAXY_LAYER.LY_TO_M
}

type StarBuffers = {
  positions: Float32Array
  colors: Float32Array
  /** Каталожный radius — из него sizeLy (HMR конфига без пересборки геометрии). */
  radiusUnits: Float32Array
  /** 0/1: активная цель Tab / карты. */
  boost: Float32Array
  count: number
  systemCount: number
  homeCompanionIndex: number
}

/** Стабильное направление разноса двойной в осях слоя (x,z,y ← ly). */
function binaryDir(index: number, out: Vector3): Vector3 {
  const a = (index * 12.9898) % 1
  const b = (index * 78.233) % 1
  const yaw = a * Math.PI * 2
  const pitch = (b - 0.5) * 0.6
  const c = Math.cos(pitch)
  return out.set(Math.cos(yaw) * c, Math.sin(pitch), Math.sin(yaw) * c).normalize()
}

function homePair(bodies: BodyEntity[]): BodyEntity[] {
  const stars = bodies.filter((b) => b.kind === 'star')
  if (stars.length >= 2) return stars.slice(0, 2)
  if (stars.length === 1) {
    const hole = bodies.find((b) => b.kind === 'blackhole')
    return hole ? [stars[0]!, hole] : [stars[0]!]
  }
  const hole = bodies.find((b) => b.kind === 'blackhole')
  return hole ? [hole] : []
}

export function GalaxyLayer() {
  const session = useSession()
  const ref = useRef<Points>(null)

  const [awake, setAwake] = useState(false)
  const anchorTrue = useRef(new Vector3())
  const starData = useRef<StarBuffers | null>(null)
  const sizeKey = useRef(0)

  const geometry = useMemo(() => {
    if (!awake) return null
    const world = session.world
    const galaxy = applyDelta(generateGalaxy(world.galaxySeed), world.galaxyDelta)
    const origin = galaxy[world.systemIndex] ?? galaxy[0]!
    const systemCount = galaxy.length
    let companionCount = 0
    for (const s of galaxy) if (s.companion) companionCount++
    const count = systemCount + companionCount

    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const radiusUnits = new Float32Array(count)
    const boost = new Float32Array(count) // спокойные по умолчанию

    const pair = homePair(world.bodies)
    const homePrimary = pair[0] ?? null
    let homeCompanionIndex = -1
    let write = systemCount

    for (let i = 0; i < systemCount; i++) {
      const s = galaxy[i]!
      positions[i * 3] = s.x - origin.x
      positions[i * 3 + 1] = s.z - origin.z
      positions[i * 3 + 2] = s.y - origin.y
      _colour.setHex(s.star.color)
      colors[i * 3] = _colour.r
      colors[i * 3 + 1] = _colour.g
      colors[i * 3 + 2] = _colour.b
      radiusUnits[i] =
        i === world.systemIndex && homePrimary
          ? homePrimary.radius / SCALE.STAR_RADIUS
          : s.star.radius
      sizes[i] = sizeLy(radiusUnits[i]!)

      if (!s.companion) continue
      const b = write * 3
      binaryDir(i, _tmp)
      const sep = GALAXY_LAYER.BINARY_SEP_LY
      positions[b] = positions[i * 3]! + _tmp.x * sep
      positions[b + 1] = positions[i * 3 + 1]! + _tmp.y * sep
      positions[b + 2] = positions[i * 3 + 2]! + _tmp.z * sep
      _colour.setHex(s.companion.color)
      colors[b] = _colour.r
      colors[b + 1] = _colour.g
      colors[b + 2] = _colour.b
      radiusUnits[write] =
        i === world.systemIndex && pair[1]
          ? pair[1].radius / SCALE.STAR_RADIUS
          : s.companion.radius
      sizes[write] = sizeLy(radiusUnits[write]!)
      if (i === world.systemIndex) homeCompanionIndex = write
      write++
    }

    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setAttribute('color', new BufferAttribute(colors, 3))
    g.setAttribute('size', new BufferAttribute(sizes, 1))
    g.setAttribute('boost', new BufferAttribute(boost, 1))
    starData.current = {
      positions,
      colors,
      radiusUnits,
      boost,
      count,
      systemCount,
      homeCompanionIndex,
    }
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awake, session, session.world.epoch, session.world.galaxyEpoch])

  useEffect(() => () => geometry?.dispose(), [geometry])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uRadius: { value: 1 },
          uEdge: { value: 1 },
          uPlayer: { value: new Vector3() },
          uLayerScale: { value: 1 },
          uProj: { value: 1000 },
          uSpeckPx: { value: GALAXY_LAYER.SPECK_PX },
          uMaxPx: { value: GALAXY_LAYER.MAX_PIXELS },
          uGlowSize: { value: GALAXY_LAYER.GLOW_SIZE },
          uActiveSize: { value: GALAXY_LAYER.ACTIVE_SIZE_MUL },
          uCalmSize: { value: GALAXY_LAYER.CALM_SIZE_MUL },
          uActiveBright: { value: GALAXY_LAYER.ACTIVE_BRIGHT },
          uCalmBright: { value: GALAXY_LAYER.CALM_BRIGHT },
          uActiveTwinkle: { value: GALAXY_LAYER.ACTIVE_TWINKLE },
          uCalmTwinkle: { value: GALAXY_LAYER.CALM_TWINKLE },
          uTime: { value: 0 },
          uTwinkleAmp: { value: GALAXY_LAYER.TWINKLE_AMP },
          uTwinkleSpeed: { value: GALAXY_LAYER.TWINKLE_SPEED },
          uTwinkleSpread: { value: GALAXY_LAYER.TWINKLE_SPEED_SPREAD },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexColors: true,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  /** Какой индекс уже подсвечен — не гоняем весь буфер boost каждый кадр. */
  const activeKey = useRef<number | null>(null)
  const boostData = useRef<StarBuffers | null>(null)

  useFrame((state) => {
    const world = session.world
    const scale = world.player.state.scale
    if (!awake) {
      const gr = galaxyRadar()
      gr.active = false
      gr.sphereRadius = 0
      world.galaxyAnchorTrue = null
      if (scale >= GALAXY_LAYER.WAKE_SCALE) setAwake(true)
      return
    }
    const points = ref.current
    const data = starData.current
    if (!points || !data) return
    if (boostData.current !== data) {
      boostData.current = data
      activeKey.current = null
    }

    const pair = homePair(world.bodies)
    if (pair.length >= 2) {
      _bary.copy(pair[0]!.pos).add(pair[1]!.pos).multiplyScalar(0.5)
    } else if (pair[0]) {
      _bary.copy(pair[0].pos)
    } else {
      _bary.copy(world.player.state.pos)
    }
    points.position.copy(_bary)
    anchorTrue.current.copy(_bary).add(world.originOffset)
    world.galaxyAnchorTrue = anchorTrue.current

    const effScale = Math.min(scale, GALAXY_LAYER.LOCK_SCALE)
    const layerScale = GALAXY_LAYER.LY_TO_M / effScale
    points.scale.setScalar(layerScale)
    material.uniforms.uLayerScale!.value = layerScale

    // Своя пара — с реальных тел: орбита и барицентр, шов «звезда-в-звезду».
    const home = world.systemIndex
    if (pair[0] && layerScale > 0) {
      const posAttr = points.geometry.getAttribute('position') as BufferAttribute
      const pos = posAttr.array as Float32Array
      _tmp.copy(pair[0].pos).sub(_bary).divideScalar(layerScale)
      pos[home * 3] = _tmp.x
      pos[home * 3 + 1] = _tmp.y
      pos[home * 3 + 2] = _tmp.z
      if (pair[1] && data.homeCompanionIndex >= 0) {
        const c = data.homeCompanionIndex
        _tmp.copy(pair[1].pos).sub(_bary).divideScalar(layerScale)
        pos[c * 3] = _tmp.x
        pos[c * 3 + 1] = _tmp.y
        pos[c * 3 + 2] = _tmp.z
      }
      posAttr.needsUpdate = true
    }

    // Подтянуть size/speck после правки конфига (HMR) без пересборки геометрии.
    const sk =
      GALAXY_LAYER.STAR_INFLATE
      + GALAXY_LAYER.SPECK_PX
      + GALAXY_LAYER.GLOW_SIZE
      + GALAXY_LAYER.ACTIVE_SIZE_MUL
      + GALAXY_LAYER.CALM_SIZE_MUL
    if (sk !== sizeKey.current) {
      sizeKey.current = sk
      const sizeAttr = points.geometry.getAttribute('size') as BufferAttribute
      const sizes = sizeAttr.array as Float32Array
      for (let i = 0; i < data.count; i++) sizes[i] = sizeLy(data.radiusUnits[i]!)
      sizeAttr.needsUpdate = true
      material.uniforms.uSpeckPx!.value = GALAXY_LAYER.SPECK_PX
      material.uniforms.uMaxPx!.value = GALAXY_LAYER.MAX_PIXELS
      material.uniforms.uGlowSize!.value = GALAXY_LAYER.GLOW_SIZE
      material.uniforms.uActiveSize!.value = GALAXY_LAYER.ACTIVE_SIZE_MUL
      material.uniforms.uCalmSize!.value = GALAXY_LAYER.CALM_SIZE_MUL
      material.uniforms.uActiveBright!.value = GALAXY_LAYER.ACTIVE_BRIGHT
      material.uniforms.uCalmBright!.value = GALAXY_LAYER.CALM_BRIGHT
      material.uniforms.uActiveTwinkle!.value = GALAXY_LAYER.ACTIVE_TWINKLE
      material.uniforms.uCalmTwinkle!.value = GALAXY_LAYER.CALM_TWINKLE
    }

    // Подсветка jumpTarget: одна яркая, остальные спокойные.
    const tgt = world.jumpTargetIndex
    const active =
      tgt != null && tgt >= 0 && tgt < data.systemCount && tgt !== world.systemIndex ? tgt : null
    if (active !== activeKey.current) {
      activeKey.current = active
      const boostAttr = points.geometry.getAttribute('boost') as BufferAttribute
      data.boost.fill(0)
      if (active != null) data.boost[active] = 1
      boostAttr.needsUpdate = true
    }

    const cam = state.camera as PerspectiveCamera
    material.uniforms.uProj!.value = state.gl.domElement.height / Math.tan((cam.fov * DEG2RAD) / 2)
    material.uniforms.uTime!.value = world.time

    // Кадр и локатор — разные сферы: в космосе поле галактики, на мини-карте только соседи.
    const fade = GALAXY_LAYER.FADE_IN_START
    const lock = GALAXY_LAYER.LOCK_SCALE
    const t =
      effScale <= fade
        ? 0
        : Math.log(effScale / fade) / Math.log(lock / fade)
    const u = Math.min(1, Math.max(0, t))
    const viewFrac =
      GALAXY_LAYER.RANGE_LY_START_FRAC
      + (GALAXY_LAYER.RANGE_LY_END_FRAC - GALAXY_LAYER.RANGE_LY_START_FRAC) * u
    const viewLy = GALAXY.RADIUS_LY * viewFrac
    const radiusM = viewLy * layerScale
    const edgeM = radiusM * GALAXY_LAYER.SPHERE_EDGE_FRAC
    material.uniforms.uRadius!.value = radiusM
    material.uniforms.uEdge!.value = edgeM
    ;(material.uniforms.uPlayer!.value as Vector3).copy(world.player.state.pos)

    const locatorLy =
      GALAXY_LAYER.LOCATOR_RANGE_LY_START
      + (GALAXY_LAYER.LOCATOR_RANGE_LY_END - GALAXY_LAYER.LOCATOR_RANGE_LY_START) * u
    const locatorRadiusM = locatorLy * layerScale

    const on = scale >= GALAXY_LAYER.FADE_IN_START
    points.visible = on

    const gr = galaxyRadar()
    gr.active = on
    gr.anchor.copy(points.position)
    gr.layerScale = layerScale
    gr.sphereRadius = locatorRadiusM
    gr.originIndex = world.systemIndex
    gr.systemCount = data.systemCount
    gr.homeCompanionIndex = data.homeCompanionIndex
    gr.positions = data.positions
    gr.colors = data.colors
    gr.count = data.count
  })

  if (!geometry) return null
  return (
    <points
      ref={ref}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-1}
      visible={false}
    />
  )
}
