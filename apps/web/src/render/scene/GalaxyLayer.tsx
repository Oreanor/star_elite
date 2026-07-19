import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import { applyDelta, GALAXY, generateGalaxy, SCALE, type BodyEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { GALAXY_LAYER } from '../config'
import {
  createGalaxyStarDiscMaterial,
  createGalaxyStarShellMaterial,
  galaxyStarDiscGeometry,
  galaxyStarShellGeometry,
} from '../materials/galaxyStarMesh'
import {
  preloadStarSurfaces,
  starSurfaceMaterial,
  starSurfaceTexture,
  tickStarSurfaceTime,
} from '../materials/starSurface'
import { galaxyRadar } from './galaxyRadar'

/**
 * Галактика как дальний край зума миелофона. С FADE_IN_START — сразу, без прозрачности.
 *
 * Якорь = барицентр своей системы (середина пары / звезда / дыра): local координаты
 * совпадают с телами — двойная проявляется двойной, подмена без шва.
 *
 * Дальние — мягкие точки; близкие (diamPx ≥ MESH_PX) — сфера+корона (до MESH_MAX);
 * самые крупные (TEXTURE_PX) — lo-карта класса (`/stars/lo/star-*.webp`, 512×256).
 *
 * Буфер: сначала главные (индекс = systemIndex), затем спутники двойных.
 */
const vertex = /* glsl */ `
attribute float size; // радиус в св.г слоя = R·STAR_INFLATE / LY_TO_M
attribute float boost; // 0 = спокойная, 1 = активная (jumpTarget)
attribute float lod;   // 1 = рисует меш — точку гасим

uniform float uRadius;
uniform float uEdge;
uniform vec3 uPlayer;
uniform float uLayerScale;
uniform float uProj;
uniform float uSpeckPx;
uniform float uMaxPx;
uniform float uGlowPaddingPx;
uniform float uActiveSize;
uniform float uCalmSize;

varying vec3 vColor;
varying float vT;
varying float vPhase;
varying float vBoost;

void main() {
  vColor = color;
  vBoost = boost;
  vPhase = fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec4 world = modelMatrix * vec4(position, 1.0);
  float dist = length(world.xyz - uPlayer);
  vT = clamp((uRadius - dist) / max(uEdge, 1.0), 0.0, 1.0);
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;

  if (lod > 0.5 || vT <= 0.0) {
    gl_PointSize = 0.0;
    return;
  }

  float rRender = size * uLayerScale;
  float camDist = max(length(mv.xyz), 1.0);
  float diamPx = 2.0 * uProj * rRender / camDist;
  float sizeMul = mix(uCalmSize, uActiveSize, boost);
  float discPx = diamPx * sizeMul;
  // Ореол растёт вместе с диском, но получает экранный запас по краям: вдали
  // звезда остаётся светом, вблизи свечение не превращается в наклейку одного размера.
  float glowPx = discPx + 2.0 * uGlowPaddingPx;
  gl_PointSize = min(max(glowPx, uSpeckPx), uMaxPx);
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
uniform float uHaloGain;
uniform float uHaloAlpha;
uniform float uBackgroundGlow;
uniform float uBackgroundAlpha;

varying vec3 vColor;
varying float vT;
varying float vPhase;
varying float vBoost;

void main() {
  if (vT <= 0.0) discard;
  vec2 pc = gl_PointCoord - vec2(0.5);
  float r = length(pc) * 2.0;
  if (r > 1.0) discard;

  // Второй draw call рисует только очень слабую широкую дымку. Отдельного ядра здесь
  // нет: одиночная звезда почти не меняется, а перекрытия в плотном поле подсвечивают фон.
  if (uBackgroundGlow > 0.5) {
    float haze = exp(-2.2 * r * r) * (1.0 - smoothstep(0.58, 1.0, r));
    float hazeAlpha = haze * uBackgroundAlpha * vT;
    if (hazeAlpha < 0.002) discard;
    gl_FragColor = vec4(vColor * 0.72, hazeAlpha);
    return;
  }

  // Дешёвое свечение: компактное ядро + широкий мягкий ореол (additive → рой с ребра).
  float soft = 1.0 - smoothstep(0.35, 1.0, r);
  float r2 = r * r;
  float core = exp(-18.0 * r2);
  float halo = exp(-1.4 * r2) * soft;
  float bright = mix(uCalmBright, uActiveBright, vBoost);
  vec3 col = vColor * (0.55 * core + uHaloGain * halo) * bright;
  // Белое горячее ядро пропускает через bloom все спектральные классы, включая красные.
  col += vec3(1.0) * core * 0.70 * bright;
  // halo уже содержит soft; второй множитель делал край слишком жёстким.
  float alpha = (core * 0.85 + halo * uHaloAlpha) * vT;

  float w1 = uTwinkleSpeed + vPhase * uTwinkleSpread;
  float w2 = uTwinkleSpeed * 0.37 + (1.0 - vPhase) * uTwinkleSpread * 0.5;
  float wave = 0.6 * sin(uTime * w1 + vPhase * 6.2831)
             + 0.4 * sin(uTime * w2 + vPhase * 4.1888);
  float twAmp = uTwinkleAmp * mix(uCalmTwinkle, uActiveTwinkle, vBoost);
  float twinkle = 1.0 + twAmp * wave;
  col *= twinkle;
  alpha *= mix(0.88, 1.05, 0.5 + 0.5 * wave * mix(uCalmTwinkle, 1.0, vBoost));

  // Слабый хвост нужен именно для суммарной засветки плотного звёздного поля.
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}
`

const _colour = new Color()
const _bary = new Vector3()
const _tmp = new Vector3()
const _obj = new Object3D()
const DEG2RAD = Math.PI / 180

/** Top-k LOD без аллокаций: индексы и diamPx лучших кандидатов. */
const _lodIdx = new Int32Array(32)
const _lodPx = new Float32Array(32)
/** Порядок mesh-кандидатов по diamPx (убыв.) — без аллокаций. */
const _lodOrder = new Int32Array(32)
/** Какие из mesh-слотов уже взяли текстуру в этом кадре. */
const _texTaken = new Uint8Array(32)

/** Радиус точки в св.г слоя: (R_м · STAR_INFLATE) / LY_TO_M → rRender = R·INFLATE / scale. */
function sizeLy(radiusUnits: number): number {
  return (radiusUnits * SCALE.STAR_RADIUS * GALAXY_LAYER.STAR_INFLATE) / GALAXY_LAYER.LY_TO_M
}

type StarBuffers = {
  positions: Float32Array
  colors: Float32Array
  /** Цвет класса (hex) — ключ lo-карты `/stars/lo/star-*.webp`. */
  colorHex: Uint32Array
  /** Каталожный radius — из него sizeLy (HMR конфига без пересборки геометрии). */
  radiusUnits: Float32Array
  /** 0/1: активная цель Tab / карты. */
  boost: Float32Array
  /** 0/1: эту звезду рисует меш, не точка. */
  lod: Float32Array
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

/** Вставить кандидата в top-k по diamPx (без полной сортировки). */
function considerLod(i: number, diamPx: number, k: number): void {
  let worst = 0
  for (let j = 1; j < k; j++) {
    if (_lodPx[j]! < _lodPx[worst]!) worst = j
  }
  if (_lodIdx[worst]! < 0 || diamPx > _lodPx[worst]!) {
    _lodIdx[worst] = i
    _lodPx[worst] = diamPx
  }
}

export function GalaxyLayer() {
  const session = useSession()
  const groupRef = useRef<Group>(null)
  const pointsRef = useRef<Points>(null)
  const discRef = useRef<InstancedMesh>(null)
  const shellRef = useRef<InstancedMesh>(null)
  const texMeshRefs = useRef<(Mesh | null)[]>([])

  const [awake, setAwake] = useState(false)
  const anchorTrue = useRef(new Vector3())
  const starData = useRef<StarBuffers | null>(null)
  const sizeKey = useRef(0)

  useEffect(() => {
    if (awake) preloadStarSurfaces()
  }, [awake])

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
    const colorHex = new Uint32Array(count)
    const sizes = new Float32Array(count)
    const radiusUnits = new Float32Array(count)
    const boost = new Float32Array(count)
    const lod = new Float32Array(count)

    const pair = homePair(world.bodies)
    const homePrimary = pair[0] ?? null
    let homeCompanionIndex = -1
    let write = systemCount

    for (let i = 0; i < systemCount; i++) {
      const s = galaxy[i]!
      positions[i * 3] = s.x - origin.x
      positions[i * 3 + 1] = s.z - origin.z
      positions[i * 3 + 2] = s.y - origin.y
      const primaryColor =
        i === world.systemIndex && homePrimary ? homePrimary.color : s.star.color
      _colour.setHex(primaryColor)
      colors[i * 3] = _colour.r
      colors[i * 3 + 1] = _colour.g
      colors[i * 3 + 2] = _colour.b
      colorHex[i] = primaryColor
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
      const companionColor =
        i === world.systemIndex && pair[1] ? pair[1].color : s.companion.color
      _colour.setHex(companionColor)
      colors[b] = _colour.r
      colors[b + 1] = _colour.g
      colors[b + 2] = _colour.b
      colorHex[write] = companionColor
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
    g.setAttribute('lod', new BufferAttribute(lod, 1))
    starData.current = {
      positions,
      colors,
      colorHex,
      radiusUnits,
      boost,
      lod,
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
          uGlowPaddingPx: { value: GALAXY_LAYER.GLOW_PADDING_PX },
          uActiveSize: { value: GALAXY_LAYER.ACTIVE_SIZE_MUL },
          uCalmSize: { value: GALAXY_LAYER.CALM_SIZE_MUL },
          uActiveBright: { value: GALAXY_LAYER.ACTIVE_BRIGHT },
          uCalmBright: { value: GALAXY_LAYER.CALM_BRIGHT },
          uActiveTwinkle: { value: GALAXY_LAYER.ACTIVE_TWINKLE },
          uCalmTwinkle: { value: GALAXY_LAYER.CALM_TWINKLE },
          uHaloGain: { value: GALAXY_LAYER.POINT_HALO_GAIN },
          uHaloAlpha: { value: GALAXY_LAYER.POINT_HALO_ALPHA },
          uBackgroundGlow: { value: 0 },
          uBackgroundAlpha: { value: 0 },
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

  const backgroundGlowMaterial = useMemo(() => {
    const glow = material.clone()
    glow.depthTest = true
    glow.uniforms.uSpeckPx!.value = 1
    glow.uniforms.uMaxPx!.value = GALAXY_LAYER.BACKGROUND_GLOW_MAX_PX
    glow.uniforms.uGlowPaddingPx!.value = GALAXY_LAYER.BACKGROUND_GLOW_PADDING_PX
    glow.uniforms.uBackgroundGlow!.value = 1
    glow.uniforms.uBackgroundAlpha!.value = GALAXY_LAYER.BACKGROUND_GLOW_ALPHA
    return glow
  }, [material])
  useEffect(() => () => backgroundGlowMaterial.dispose(), [backgroundGlowMaterial])

  const discMat = useMemo(() => createGalaxyStarDiscMaterial(), [])
  const shellMat = useMemo(() => createGalaxyStarShellMaterial(), [])
  useEffect(() => () => {
    discMat.dispose()
    shellMat.dispose()
  }, [discMat, shellMat])

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
    const group = groupRef.current
    const points = pointsRef.current
    const disc = discRef.current
    const shell = shellRef.current
    const data = starData.current
    if (!group || !points || !data) return
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
    group.position.copy(_bary)
    anchorTrue.current.copy(_bary).add(world.originOffset)
    world.galaxyAnchorTrue = anchorTrue.current

    const effScale = Math.min(scale, GALAXY_LAYER.LOCK_SCALE)
    const layerScale = GALAXY_LAYER.LY_TO_M / effScale
    group.scale.setScalar(layerScale)
    material.uniforms.uLayerScale!.value = layerScale
    backgroundGlowMaterial.uniforms.uLayerScale!.value = layerScale

    // Своя пара: на малом × совмещаем точку слоя с телом (шов). На миллионах
    // (pos−bary)/layerScale раздувается до сотен св.г — откатываем в каталог.
    const home = world.systemIndex
    if (pair[0] && layerScale > 0) {
      const posAttr = points.geometry.getAttribute('position') as BufferAttribute
      const pos = posAttr.array as Float32Array
      const seamMax = GALAXY_LAYER.HOME_SEAM_MAX_LY
      _tmp.copy(pair[0].pos).sub(_bary).divideScalar(layerScale)
      const seamOk = _tmp.lengthSq() <= seamMax * seamMax
      if (seamOk) {
        pos[home * 3] = _tmp.x
        pos[home * 3 + 1] = _tmp.y
        pos[home * 3 + 2] = _tmp.z
      } else {
        pos[home * 3] = 0
        pos[home * 3 + 1] = 0
        pos[home * 3 + 2] = 0
      }
      if (data.homeCompanionIndex >= 0) {
        const c = data.homeCompanionIndex
        if (seamOk && pair[1]) {
          _tmp.copy(pair[1].pos).sub(_bary).divideScalar(layerScale)
          if (_tmp.lengthSq() <= seamMax * seamMax) {
            pos[c * 3] = _tmp.x
            pos[c * 3 + 1] = _tmp.y
            pos[c * 3 + 2] = _tmp.z
          } else {
            binaryDir(home, _tmp)
            const sep = GALAXY_LAYER.BINARY_SEP_LY
            pos[c * 3] = sep * _tmp.x
            pos[c * 3 + 1] = sep * _tmp.y
            pos[c * 3 + 2] = sep * _tmp.z
          }
        } else {
          binaryDir(home, _tmp)
          const sep = GALAXY_LAYER.BINARY_SEP_LY
          pos[c * 3] = sep * _tmp.x
          pos[c * 3 + 1] = sep * _tmp.y
          pos[c * 3 + 2] = sep * _tmp.z
        }
      }
      posAttr.needsUpdate = true
    }

    const sk =
      GALAXY_LAYER.STAR_INFLATE
      + GALAXY_LAYER.SPECK_PX
      + GALAXY_LAYER.MAX_PIXELS
      + GALAXY_LAYER.GLOW_PADDING_PX
      + GALAXY_LAYER.BACKGROUND_GLOW_PADDING_PX
      + GALAXY_LAYER.BACKGROUND_GLOW_MAX_PX
      + GALAXY_LAYER.BACKGROUND_GLOW_ALPHA
      + GALAXY_LAYER.ACTIVE_SIZE_MUL
      + GALAXY_LAYER.CALM_SIZE_MUL
      + GALAXY_LAYER.MESH_PX
      + GALAXY_LAYER.MESH_MAX
      + GALAXY_LAYER.TEXTURE_PX
      + GALAXY_LAYER.TEXTURE_MAX
    if (sk !== sizeKey.current) {
      sizeKey.current = sk
      const sizeAttr = points.geometry.getAttribute('size') as BufferAttribute
      const sizes = sizeAttr.array as Float32Array
      for (let i = 0; i < data.count; i++) sizes[i] = sizeLy(data.radiusUnits[i]!)
      sizeAttr.needsUpdate = true
      material.uniforms.uSpeckPx!.value = GALAXY_LAYER.SPECK_PX
      material.uniforms.uMaxPx!.value = GALAXY_LAYER.MAX_PIXELS
      material.uniforms.uGlowPaddingPx!.value = GALAXY_LAYER.GLOW_PADDING_PX
      material.uniforms.uActiveSize!.value = GALAXY_LAYER.ACTIVE_SIZE_MUL
      material.uniforms.uCalmSize!.value = GALAXY_LAYER.CALM_SIZE_MUL
      material.uniforms.uActiveBright!.value = GALAXY_LAYER.ACTIVE_BRIGHT
      material.uniforms.uCalmBright!.value = GALAXY_LAYER.CALM_BRIGHT
      material.uniforms.uActiveTwinkle!.value = GALAXY_LAYER.ACTIVE_TWINKLE
      material.uniforms.uCalmTwinkle!.value = GALAXY_LAYER.CALM_TWINKLE
      backgroundGlowMaterial.uniforms.uMaxPx!.value = GALAXY_LAYER.BACKGROUND_GLOW_MAX_PX
      backgroundGlowMaterial.uniforms.uGlowPaddingPx!.value = GALAXY_LAYER.BACKGROUND_GLOW_PADDING_PX
      backgroundGlowMaterial.uniforms.uBackgroundAlpha!.value = GALAXY_LAYER.BACKGROUND_GLOW_ALPHA
    }

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
    const uProj = state.gl.domElement.height / Math.tan((cam.fov * DEG2RAD) / 2)
    material.uniforms.uProj!.value = uProj
    material.uniforms.uTime!.value = world.time
    backgroundGlowMaterial.uniforms.uProj!.value = uProj
    discMat.uniforms.uTime!.value = world.time
    tickStarSurfaceTime(world.time)

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
    backgroundGlowMaterial.uniforms.uRadius!.value = radiusM
    backgroundGlowMaterial.uniforms.uEdge!.value = edgeM
    ;(backgroundGlowMaterial.uniforms.uPlayer!.value as Vector3).copy(world.player.state.pos)

    const locatorLy =
      GALAXY_LAYER.LOCATOR_RANGE_LY_START
      + (GALAXY_LAYER.LOCATOR_RANGE_LY_END - GALAXY_LAYER.LOCATOR_RANGE_LY_START) * u
    const locatorRadiusM = locatorLy * layerScale

    const on = scale >= GALAXY_LAYER.FADE_IN_START
    group.visible = on

    // LOD: крупные → сфера+корона; самые крупные с картой класса — отдельный пул.
    const meshMax = Math.min(GALAXY_LAYER.MESH_MAX, _lodIdx.length)
    const texMax = Math.min(GALAXY_LAYER.TEXTURE_MAX, texMeshRefs.current.length)
    for (let j = 0; j < meshMax; j++) {
      _lodIdx[j] = -1
      _lodPx[j] = -1
      _texTaken[j] = 0
    }
    data.lod.fill(0)
    for (let t = 0; t < texMax; t++) {
      const tm = texMeshRefs.current[t]
      if (tm) tm.visible = false
    }
    const posArr = data.positions
    const player = world.player.state.pos
    const meshPx = GALAXY_LAYER.MESH_PX
    if (on && disc && shell) {
      for (let i = 0; i < data.count; i++) {
        const lx = posArr[i * 3]!
        const ly = posArr[i * 3 + 1]!
        const lz = posArr[i * 3 + 2]!
        const wx = _bary.x + lx * layerScale
        const wy = _bary.y + ly * layerScale
        const wz = _bary.z + lz * layerScale
        const dist = Math.hypot(wx - player.x, wy - player.y, wz - player.z)
        const edgeT = (radiusM - dist) / Math.max(edgeM, 1)
        if (edgeT <= 0) continue

        const rLy = sizeLy(data.radiusUnits[i]!)
        const rRender = rLy * layerScale
        const camDist = Math.hypot(wx - cam.position.x, wy - cam.position.y, wz - cam.position.z)
        const sizeMul = data.boost[i]! > 0.5 ? GALAXY_LAYER.ACTIVE_SIZE_MUL : GALAXY_LAYER.CALM_SIZE_MUL
        const diamPx = (2 * uProj * rRender * sizeMul) / Math.max(camDist, 1)
        if (diamPx < meshPx) continue
        considerLod(i, diamPx, meshMax)
      }

      // Убывающий порядок по diamPx — текстуру забирают самые ближние.
      let cand = 0
      for (let j = 0; j < meshMax; j++) {
        if (_lodIdx[j]! < 0) continue
        _lodOrder[cand++] = j
      }
      for (let a = 1; a < cand; a++) {
        const key = _lodOrder[a]!
        const keyPx = _lodPx[key]!
        let b = a - 1
        while (b >= 0 && _lodPx[_lodOrder[b]!]! < keyPx) {
          _lodOrder[b + 1] = _lodOrder[b]!
          b--
        }
        _lodOrder[b + 1] = key
      }

      let texUsed = 0
      for (let o = 0; o < cand && texUsed < texMax; o++) {
        const slot = _lodOrder[o]!
        const i = _lodIdx[slot]!
        if (_lodPx[slot]! < GALAXY_LAYER.TEXTURE_PX) break
        const hex = data.colorHex[i]!
        if (!starSurfaceTexture(hex)) continue
        const mat = starSurfaceMaterial(hex)
        const tm = texMeshRefs.current[texUsed]
        if (!mat || !tm) continue
        const rLy = sizeLy(data.radiusUnits[i]!)
        const sizeMul = data.boost[i]! > 0.5
          ? GALAXY_LAYER.ACTIVE_SIZE_MUL
          : GALAXY_LAYER.CALM_SIZE_MUL
        tm.position.set(posArr[i * 3]!, posArr[i * 3 + 1]!, posArr[i * 3 + 2]!)
        tm.scale.setScalar(rLy * sizeMul)
        tm.quaternion.identity()
        tm.material = mat
        tm.visible = true
        _texTaken[slot] = 1
        texUsed++
      }

      let shellCount = 0
      let discCount = 0
      for (let j = 0; j < meshMax; j++) {
        const i = _lodIdx[j]!
        if (i < 0) continue
        data.lod[i] = 1
        const rLy = sizeLy(data.radiusUnits[i]!)
        const sizeMul = data.boost[i]! > 0.5
          ? GALAXY_LAYER.ACTIVE_SIZE_MUL
          : GALAXY_LAYER.CALM_SIZE_MUL
        const visualRadiusLy = rLy * sizeMul
        const diamPx = _lodPx[j]!
        // Радиус короны = радиус диска + постоянный экранный запас. Поэтому она
        // масштабируется, но медленнее диска и не схлопывается на дальнем LOD.
        const shellMul = 1 + (2 * GALAXY_LAYER.GLOW_PADDING_PX) / Math.max(diamPx, 1)
        const px = posArr[i * 3]!
        const py = posArr[i * 3 + 1]!
        const pz = posArr[i * 3 + 2]!
        _colour.setRGB(data.colors[i * 3]!, data.colors[i * 3 + 1]!, data.colors[i * 3 + 2]!)

        // Текстурный диск — отдельный меш; процедурную сферу не дублируем.
        if (_texTaken[j] === 0) {
          _obj.position.set(px, py, pz)
          _obj.scale.setScalar(visualRadiusLy)
          _obj.quaternion.identity()
          _obj.updateMatrix()
          disc.setMatrixAt(discCount, _obj.matrix)
          disc.setColorAt(discCount, _colour)
          discCount++
        }

        _obj.position.set(px, py, pz)
        _obj.scale.setScalar(visualRadiusLy * shellMul)
        _obj.quaternion.identity()
        _obj.updateMatrix()
        shell.setMatrixAt(shellCount, _obj.matrix)
        shell.setColorAt(shellCount, _colour)
        shellCount++
      }

      disc.count = discCount
      shell.count = shellCount
      disc.instanceMatrix.needsUpdate = true
      shell.instanceMatrix.needsUpdate = true
      if (disc.instanceColor) disc.instanceColor.needsUpdate = true
      if (shell.instanceColor) shell.instanceColor.needsUpdate = true
      disc.visible = discCount > 0
      shell.visible = shellCount > 0
    } else if (disc && shell) {
      disc.count = 0
      shell.count = 0
      disc.visible = false
      shell.visible = false
    }

    const lodAttr = points.geometry.getAttribute('lod') as BufferAttribute
    lodAttr.needsUpdate = true

    const gr = galaxyRadar()
    gr.active = on
    gr.anchor.copy(group.position)
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
    <group ref={groupRef} frustumCulled={false} visible={false}>
      <points
        geometry={geometry}
        material={backgroundGlowMaterial}
        frustumCulled={false}
        renderOrder={-2}
      />
      <points
        ref={pointsRef}
        geometry={geometry}
        material={material}
        frustumCulled={false}
        renderOrder={-1}
      />
      <instancedMesh
        ref={discRef}
        args={[galaxyStarDiscGeometry(), discMat, GALAXY_LAYER.MESH_MAX]}
        frustumCulled={false}
        renderOrder={-1}
        visible={false}
      />
      <instancedMesh
        ref={shellRef}
        args={[galaxyStarShellGeometry(), shellMat, GALAXY_LAYER.MESH_MAX]}
        frustumCulled={false}
        renderOrder={-1}
        visible={false}
      />
      {Array.from({ length: GALAXY_LAYER.TEXTURE_MAX }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            texMeshRefs.current[i] = el
          }}
          geometry={galaxyStarDiscGeometry()}
          frustumCulled={false}
          renderOrder={-1}
          visible={false}
        />
      ))}
    </group>
  )
}
