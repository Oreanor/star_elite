import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Mesh,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  Vector3,
} from 'three'
import { COSMIC, renderTime, type Cataclysm } from '@elite/sim'
import type { Texture } from 'three'
import { useSession } from '../../session/GameContext'
import { BODY_SEGMENTS, CATACLYSM } from '../config'
import { planetGeometry } from '../geometry/bodies'
import { loadRockTexture, rockTextureOf } from '../materials/rockTextures'
import { loadPlanetTexture, planetLook, planetSeed, planetVariant } from '../sky/planets'
import { starWorldShrink, worldShrink } from '../worldShrink'
import { asteroidShapes } from '../geometry/rocks'
import { lavaChunkMaterial, lavaPlanetMaterial } from '../materials/lava'
import { coreMaterial, coronaMaterial, flashMaterial, ringMaterial, sparkMaterial, veilMaterial } from '../materials/cataclysm'

/**
 * ГИБЕЛЬ МИРА — зрелище по `world.cataclysms`. Каждое событие играет один слот пула:
 * ядро (раскалённый призрак тела схлопывается), вспышка, вуаль (у газового гиганта — его
 * собственные полосы, срывающиеся покрывалом), ударное кольцо по экватору и облако искр.
 *
 * Пул фиксирован (`CATACLYSM.MAX`), меши и материалы живут с монтажа: в кадре меняются
 * только позиции, масштабы и униформы. Итог (исчезнувшее тело, пояс) домен уже применил —
 * здесь лишь то, как это выглядело.
 */

const _pos = new Vector3()
const _q = new Quaternion()
const Z = new Vector3(0, 0, 1)
const _c = new Color()
const _toCam = new Vector3()
const _ringAxis = new Vector3()
/** Насколько ось кольца довёрнута от оси тела к камере: 0 — строго экватор, 1 — лицом. */
const RING_FACE_CAMERA = 0.3

const _dummy = new Object3D()
const _tilt = new Quaternion()
const _spin = new Quaternion()
/** Полюс сферы тела в покое — как у `Bodies`: на него ложится ось вращения. */
const REST_POLE = new Vector3(0, 1, 0)
const _axis = new Vector3()

/** Хеш-генератор слота: одно и то же облако на одном слоте, разное — на соседних. */
function slotRng(slot: number, salt: number): () => number {
  let s = ((slot + 1) * 0x9e3779b1 + salt) >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Глыбы слота: направление, старт внутри тела, скорость, размер (неравный по осям — не
 * шары), ось и темп вращения. По 12 чисел на кусок; считаются раз, в кадре только читаются.
 */
const CHUNK_STRIDE = 12
function chunkParams(slot: number): Float32Array {
  const K = CATACLYSM.CHUNKS
  const out = new Float32Array(K.COUNT * CHUNK_STRIDE)
  const rnd = slotRng(slot, 0x51ed)
  for (let i = 0; i < K.COUNT; i++) {
    const o = i * CHUNK_STRIDE
    const z = rnd() * 2 - 1
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    out[o] = r * Math.cos(a)
    out[o + 1] = z
    out[o + 2] = r * Math.sin(a)
    // Квадрат — мало огромных и много средних, как у настоящего дробления.
    const big = rnd() ** 2
    out[o + 3] = K.SIZE_MIN + (K.SIZE_MAX - K.SIZE_MIN) * big
    // Крупные тяжелее и летят медленнее; разброс, чтобы не шли ровной скорлупой.
    out[o + 4] = (K.SPEED_MAX - (K.SPEED_MAX - K.SPEED_MIN) * big) * (0.65 + 0.35 * rnd())
    // Старт — из толщи тела, а не с поверхности: куски выходят из облака.
    out[o + 5] = 0.3 + 0.6 * rnd()
    out[o + 6] = 0.6 + 0.7 * rnd()
    out[o + 7] = 0.6 + 0.7 * rnd()
    out[o + 8] = 0.6 + 0.7 * rnd()
    const az = rnd() * 2 - 1
    const aa = rnd() * Math.PI * 2
    const ar = Math.sqrt(1 - az * az)
    out[o + 9] = Math.atan2(az, ar * Math.cos(aa))
    out[o + 10] = aa
    out[o + 11] = (rnd() * 2 - 1) * K.SPIN_MAX
  }
  return out
}

/**
 * Капли магмы слота: направление, старт, скорость, толщина, время остывания — по 7 чисел.
 * Как и глыбы, считаются раз; в кадре только читаются.
 */
const MAGMA_STRIDE = 7
function magmaParams(slot: number): Float32Array {
  const M = CATACLYSM.MAGMA
  const out = new Float32Array(M.COUNT * MAGMA_STRIDE)
  const rnd = slotRng(slot, 0xa61a)
  for (let i = 0; i < M.COUNT; i++) {
    const o = i * MAGMA_STRIDE
    const z = rnd() * 2 - 1
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    out[o] = r * Math.cos(a)
    out[o + 1] = z
    out[o + 2] = r * Math.sin(a)
    out[o + 3] = 0.75 + 0.25 * rnd()
    // Быстрых меньше: квадрат тянет к медленным, и облако брызг густое у тела, рваное снаружи.
    out[o + 4] = M.SPEED_MIN + (M.SPEED_MAX - M.SPEED_MIN) * rnd() ** 2
    out[o + 5] = M.SIZE_MIN + (M.SIZE_MAX - M.SIZE_MIN) * rnd() ** 1.5
    out[o + 6] = M.COOL_MIN + (M.COOL_MAX - M.COOL_MIN) * rnd()
  }
  return out
}

/** Капля — грубый шарик, вытягиваемый масштабом вдоль Z (по полёту). Одна на все слоты. */
const dropGeometry = new IcosahedronGeometry(1, 1)
const MAGMA_WHITE = new Color(1, 0.92, 0.6)
const MAGMA_YELLOW = new Color(1, 0.72, 0.15)
const MAGMA_ORANGE = new Color(1, 0.32, 0.04)
const MAGMA_CHERRY = new Color(0.4, 0.04, 0.02)

/** Цвет остывающей магмы по жару 1 → 0, без аллокаций (в `out`). */
function magmaColor(heat: number, out: Color): Color {
  if (heat > 0.75) return out.copy(MAGMA_YELLOW).lerp(MAGMA_WHITE, (heat - 0.75) * 4)
  if (heat > 0.4) return out.copy(MAGMA_ORANGE).lerp(MAGMA_YELLOW, (heat - 0.4) / 0.35)
  return out.copy(MAGMA_CHERRY).lerp(MAGMA_ORANGE, heat / 0.4)
}

/** Направления и скорости искр слота — из хеша номера: одно облако не похоже на соседнее. */
function sparkGeometry(slot: number): BufferGeometry {
  const n = CATACLYSM.SPARKS
  const dir = new Float32Array(n * 3)
  const speed = new Float32Array(n)
  const tint = new Float32Array(n)
  const rnd = slotRng(slot, 0)
  for (let i = 0; i < n; i++) {
    // Равномерно по сфере, но гуще к экватору: разлёт тела сплющен его вращением.
    const z = (rnd() * 2 - 1) * (0.35 + 0.65 * rnd())
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    dir[i * 3] = r * Math.cos(a)
    dir[i * 3 + 1] = z
    dir[i * 3 + 2] = r * Math.sin(a)
    speed[i] = 0.25 + rnd() ** 0.7 * 0.75
    tint[i] = rnd() < 0.3 ? 1 : rnd() * 0.4
  }
  const g = new BufferGeometry()
  // Позиция — заглушка: место точки целиком считает шейдер, но three требует атрибут.
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aDir', new BufferAttribute(dir, 3))
  g.setAttribute('aSpeed', new BufferAttribute(speed, 1))
  g.setAttribute('aTint', new BufferAttribute(tint, 1))
  return g
}

/** Сфера ядра и вуали — одна на все слоты; искры и материалы — на слот (свои униформы). */
const sphere = new IcosahedronGeometry(1, 5)
const plane = new PlaneGeometry(2, 2)

/** Ход от 0 к 1 за τ: быстро вначале, медленно к концу — как разлёт с торможением. */
const ease = (t: number, tau: number) => 1 - Math.exp(-Math.max(0, t) / tau)

/**
 * Одевает закипающее тело в облик погибшего: его сетку (с вершинными цветами — запасной вид)
 * и его карту — планетную или, у луны, каменную, как в `Bodies`. Карта почти всегда уже в
 * кеше (тело только что рисовалось), и приходит синхронно.
 */
function dressLava(
  mesh: Mesh,
  mat: ReturnType<typeof lavaPlanetMaterial>,
  c: Cataclysm,
  prev: { cancel: () => void } | null,
): { born: number; cancel: () => void } {
  prev?.cancel()
  const face = c.face
  const look = planetLook(face.surface)
  mesh.geometry = planetGeometry(look, planetSeed(face.id), BODY_SEGMENTS[face.kind])
  const wear = (map: Texture | null) => {
    mat.map = map
    mat.vertexColors = map === null
    mat.needsUpdate = true
  }
  wear(null)
  const cancel = face.kind === 'moon'
    ? loadRockTexture(rockTextureOf(face.id), wear)
    : loadPlanetTexture(look, planetVariant(face), wear)
  return { born: c.born, cancel }
}

function Slot({ index }: { index: number }) {
  const session = useSession()
  const group = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const corona = useRef<Mesh>(null)
  const veil = useRef<Mesh>(null)
  const flash = useRef<Mesh>(null)
  const ring = useRef<Mesh>(null)
  const sparks = useRef<Points>(null)
  const chunks = useRef<InstancedMesh>(null)
  // Свой материал на слот: накал (emissive) у всех кусков одного взрыва общий — они родились разом.
  const chunkMat = useMemo(lavaChunkMaterial, [])
  const chunkData = useMemo(() => chunkParams(index), [index])
  const lava = useRef<Mesh>(null)
  const magma = useRef<InstancedMesh>(null)
  const impact = useRef<Mesh>(null)
  // Сквозь тело: вспышка сидит на поверхности, и сфера тела срезала бы её половину.
  const impactMat = useMemo(() => {
    const m = flashMaterial()
    m.depthTest = false
    return m
  }, [])
  // Светится сама и мимо тонмаппинга: жёлтая капля не должна сереть в тени планеты.
  const magmaMat = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), [])
  const magmaData = useMemo(() => magmaParams(index), [index])
  // Буфер цветов — заранее, до первой отрисовки: появись он позже, шейдер собрался бы без него.
  useEffect(() => magma.current?.setColorAt(0, MAGMA_WHITE), [])
  const lavaMat = useMemo(lavaPlanetMaterial, [])
  // Чей облик сейчас на закипающем теле (по мигу гибели) и как отменить ещё не пришедшую карту.
  const lavaFace = useRef<{ born: number; cancel: () => void } | null>(null)
  const mats = useMemo(
    () => ({ core: coreMaterial(), corona: coronaMaterial(), veil: veilMaterial(), flash: flashMaterial(), ring: ringMaterial(), sparks: sparkMaterial() }),
    [],
  )
  const sparkGeo = useMemo(() => sparkGeometry(index), [index])
  useEffect(
    () => () => {
      sparkGeo.dispose()
      for (const m of Object.values(mats)) m.dispose()
      chunkMat.dispose()
      lavaMat.dispose()
      magmaMat.dispose()
      impactMat.dispose()
      lavaFace.current?.cancel()
    },
    [mats, sparkGeo, chunkMat, lavaMat, magmaMat, impactMat],
  )

  useFrame(({ camera }) => {
    const world = session.world
    const g = group.current
    const c: Cataclysm | undefined = world.cataclysms[index]
    if (!g) return
    // Гигант видит мир ужатым (закон зума) — и гибель тела тем же множителем, что само тело.
    const scale = world.player.state.scale
    const shrink = c ? (c.kind === 'star' ? starWorldShrink(scale) : worldShrink(scale)) : 0
    if (!c || shrink <= 0) {
      g.visible = false
      return
    }
    g.visible = true
    const look = CATACLYSM.LOOK[c.kind]
    const life = COSMIC.LIFE[c.kind] ?? 10
    const age = renderTime(world) - c.born
    const u = Math.min(1, Math.max(0, age / life))
    const fade = (1 - u) ** 1.5
    // После разрыва — свои часы: всё разлетается от мига вспышки, а не от выстрела.
    const burstAt = COSMIC.BURST[c.kind] ?? 0
    const t = age - burstAt
    const R = c.radius * shrink

    g.position.copy(_pos.copy(c.at).sub(world.originOffset))

    // ── Вспышка попадания: первое, что видно, — потом уже закипание и разрыв. ──
    const impactMesh = impact.current!
    const I = CATACLYSM.IMPACT
    if (c.kind !== 'seed' && age < I.LIFE) {
      impactMesh.visible = true
      // Точка удара — у стрелявшего; у остальных — сторона тела, обращённая к их камере.
      if (c.hit) _toCam.copy(c.hit)
      else _toCam.copy(camera.position).sub(g.position).normalize()
      impactMesh.position.copy(_toCam).multiplyScalar(R * 1.02)
      impactMesh.quaternion.copy(camera.quaternion)
      impactMesh.scale.setScalar(R * I.SIZE * (0.35 + 0.65 * ease(age, 0.07)))
      impactMat.uniforms.uColor!.value.setHex(I.COLOR)
      impactMat.uniforms.uAlpha!.value = 2.4 * Math.exp(-age / I.TAU)
    } else impactMesh.visible = false

    // ── Каменное тело до разрыва: само тело (его цвет, свет звезды), закипающее лавой. Призрак
    //    ядра у камня не нужен — раскалённым шаром он заслонял бы, что это ещё планета. ──
    const lavaMesh = lava.current!
    if (c.kind === 'rock' && t < 0) {
      // Облик меняется раз на событие, не в кадре: та же сетка и та же карта, что были у тела.
      if (lavaFace.current?.born !== c.born) lavaFace.current = dressLava(lavaMesh, lavaMat, c, lavaFace.current)
      const pre = Math.min(1, age / burstAt)
      lavaMesh.visible = true
      // К самому концу вспухает на несколько процентов — давление изнутри.
      lavaMesh.scale.setScalar(R * (1 + 0.05 * pre ** 6))
      // Крутится, как крутилось тело: тот же поворот, что в `Bodies.place`, — без скачка в миг удара.
      _tilt.setFromUnitVectors(REST_POLE, c.axis)
      _spin.setFromAxisAngle(c.axis, c.face.spin * renderTime(world))
      lavaMesh.quaternion.copy(_spin).multiply(_tilt)
      lavaMat.userData.progress.value = pre
      lavaMat.userData.time.value = age
      lavaMat.userData.seed.value = index * 5.1 + (c.born % 17)
    } else lavaMesh.visible = false

    // ── Ядро: раскаляется и сжимается до разрыва, после — гаснет за полсекунды. ──
    const coreM = mats.core.uniforms
    const coreMesh = core.current!
    if (c.kind !== 'seed' && t < 0.5 && (c.kind !== 'rock' || t >= 0)) {
      const pre = burstAt > 0 ? Math.min(1, age / burstAt) : 1
      // Сжатие от медленного к быстрому: ход pre^curve (у звезды — третья степень).
      const shrink = t < 0 ? 1 - look.shrink * pre ** look.curve : (1 - look.shrink) * (1 - t / 0.5)
      coreMesh.visible = true
      coreMesh.scale.setScalar(R * Math.max(0.01, shrink) * 1.002)
      coreM.uColor!.value.setHex(c.color)
      coreM.uHot!.value.setHex(look.hot)
      // Раскаляется к самому концу (pre³): почти всё сжатие видно, что это ЕЩЁ планета.
      coreM.uHeat!.value = Math.min(1, pre ** 3 * 0.9 + (t > 0 ? 1 : 0))
      coreM.uAlpha!.value = 0.5 + pre ** 2 * 0.9
      coreM.uTime!.value = age
    } else coreMesh.visible = false

    // ── Корона звезды: вокруг сжимающегося ядра, раскаляется с ним и гаснет с разрывом. ──
    const coronaMesh = corona.current!
    if (c.kind === 'star' && t < 0.5) {
      coronaMesh.visible = true
      coronaMesh.scale.copy(coreMesh.scale).multiplyScalar(mats.corona.uniforms.uGrow!.value as number)
      const cu = mats.corona.uniforms
      cu.uColor!.value.setHex(c.color)
      cu.uHot!.value.setHex(look.hot)
      cu.uHeat!.value = coreM.uHeat!.value
      cu.uAlpha!.value = (coreM.uAlpha!.value as number) * (t < 0 ? 1 : 1 - t / 0.5)
      cu.uTime!.value = age
    } else coronaMesh.visible = false

    const burst = t >= 0

    // ── Вспышка: билборд лицом к камере, пик в миг разрыва. ──
    const flashMesh = flash.current!
    if (burst && look.flash > 0) {
      flashMesh.visible = true
      flashMesh.quaternion.copy(camera.quaternion)
      flashMesh.scale.setScalar(R * look.flash * (0.5 + 0.5 * ease(t, look.flashTau * 0.5)))
      mats.flash.uniforms.uColor!.value.setHex(look.hot)
      mats.flash.uniforms.uAlpha!.value = 1.6 * Math.exp(-t / look.flashTau)
    } else flashMesh.visible = false

    // ── Вуаль. Цвет A у газа и звезды — свой цвет тела; B у газа — его светлая полоса. ──
    const veilMesh = veil.current!
    if (burst) {
      veilMesh.visible = true
      const vu = mats.veil.uniforms
      veilMesh.scale.setScalar(R * (1 + look.veil * ease(t, look.veilTau)))
      vu.uColorA!.value.setHex(look.colorA < 0 ? c.color : look.colorA)
      if (look.colorB < 0) vu.uColorB!.value.setHex(c.color).offsetHSL(0.03, 0.1, 0.18)
      else vu.uColorB!.value.setHex(look.colorB)
      vu.uHot!.value.setHex(look.hot)
      vu.uHeat!.value = Math.exp(-t / Math.max(0.5, look.veilTau * 0.25))
      vu.uBands!.value = look.bands
      vu.uTime!.value = age
      vu.uSeed!.value = index * 7.3 + (c.born % 13)
      // Засев не гаснет к нулю резко: тихо дышит и уходит.
      const breathe = c.kind === 'seed' ? 0.6 + 0.4 * Math.sin(age * 3) : 1
      vu.uAlpha!.value = look.veilAlpha * fade * breathe * Math.min(1, t * 4)
    } else veilMesh.visible = false

    // ── Кольцо по экватору тела, ДОВЁРНУТОЕ к камере. Ровно по экватору его почти всегда видно
    //    ребром: пилот летает в плоскости эклиптики, и ударная волна читалась тонкой чертой. ──
    const ringMesh = ring.current!
    if (burst && look.ring > 0) {
      ringMesh.visible = true
      _toCam.copy(camera.position).sub(g.position).normalize()
      // Ось к камере той же стороной, что и ось тела: иначе кольцо перевернулось бы рывком.
      if (_toCam.dot(c.axis) < 0) _toCam.negate()
      _ringAxis.copy(c.axis).lerp(_toCam, RING_FACE_CAMERA).normalize()
      ringMesh.quaternion.copy(_q.setFromUnitVectors(Z, _ringAxis))
      const k = ease(t, look.ringTau)
      ringMesh.scale.setScalar(R * (1 + look.ring * k))
      const ru = mats.ring.uniforms
      ru.uColor!.value.setHex(look.ringColor)
      // Гаснет быстрее, чем тормозит: волна пропадает на лету, а не застывает на краю.
      ru.uAlpha!.value = look.ringAlpha * Math.exp(-t / (look.ringTau * 0.8)) * fade
      ru.uWidth!.value = 0.04 + 0.1 * (1 - k)
      ru.uTime!.value = age
    } else ringMesh.visible = false

    // ── Искры: путь в шейдере, отсюда — только фаза. ──
    const sparkPts = sparks.current!
    if (burst || c.kind === 'seed') {
      sparkPts.visible = true
      const su = mats.sparks.uniforms
      su.uRadius!.value = R
      su.uReach!.value = look.sparks
      su.uAge!.value = Math.max(0, t)
      su.uTau!.value = look.sparksTau
      su.uSize!.value = look.sparkSize
      su.uColor!.value.copy(_c.setHex(look.colorA < 0 ? c.color : look.colorA))
      su.uHot!.value.setHex(look.hot)
      su.uAlpha!.value = fade * (c.kind === 'seed' ? 0.5 : 1.2)
    } else sparkPts.visible = false

    // ── Глыбы: только у каменного тела. Летят быстрее облака, кувыркаются, остывают. ──
    const chunkMesh = chunks.current!
    if (burst && c.kind === 'rock') {
      const K = CATACLYSM.CHUNKS
      chunkMesh.visible = true
      // Тают в конце жизни уменьшением, а не прозрачностью: камень непрозрачен.
      const melt = Math.min(1, (1 - u) / K.FADE)
      const travel = K.DRAG_TAU * (1 - Math.exp(-t / K.DRAG_TAU))
      for (let i = 0; i < K.COUNT; i++) {
        const o = i * CHUNK_STRIDE
        const d = R * (chunkData[o + 5]! + chunkData[o + 4]! * travel)
        _dummy.position.set(chunkData[o]! * d, chunkData[o + 1]! * d, chunkData[o + 2]! * d)
        const el = chunkData[o + 9]!
        const az = chunkData[o + 10]!
        _axis.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))
        _dummy.quaternion.setFromAxisAngle(_axis, az + chunkData[o + 11]! * t)
        const size = R * chunkData[o + 3]! * melt
        _dummy.scale.set(size * chunkData[o + 6]!, size * chunkData[o + 7]!, size * chunkData[o + 8]!)
        _dummy.updateMatrix()
        chunkMesh.setMatrixAt(i, _dummy.matrix)
      }
      chunkMesh.instanceMatrix.needsUpdate = true
      // Корка — в тон погибшей планеты, но тёмная: обгорелый камень, а не её светлая окраска.
      chunkMat.color.setHex(c.color).lerp(_c.setHex(0x3e3732), 0.7)
      // Накал общий на взрыв — все куски родились разом; рисунок трещин свой у каждого слота.
      chunkMat.userData.heat.value = Math.exp(-t / K.COOL_TAU)
      chunkMat.userData.seed.value = index * 3.7
    } else chunkMesh.visible = false

    // ── Капли магмы: вытянуты по полёту, пока летят быстро; остывают и тают каждая в своё время. ──
    const magmaMesh = magma.current!
    if (burst && c.kind === 'rock') {
      const M = CATACLYSM.MAGMA
      magmaMesh.visible = true
      const slow = Math.exp(-t / M.DRAG_TAU)
      const travel = M.DRAG_TAU * (1 - slow)
      for (let i = 0; i < M.COUNT; i++) {
        const o = i * MAGMA_STRIDE
        _axis.set(magmaData[o]!, magmaData[o + 1]!, magmaData[o + 2]!)
        const speed = magmaData[o + 4]!
        _dummy.position.copy(_axis).multiplyScalar(R * (magmaData[o + 3]! + speed * travel))
        _dummy.quaternion.setFromUnitVectors(Z, _axis)
        const heat = Math.exp(-t / magmaData[o + 6]!)
        // Остыв до вишнёвого, капля тает: тёмная магма в космосе не видна, ей незачем висеть.
        const melt = Math.min(1, heat * 4)
        const thick = R * magmaData[o + 5]! * melt
        const stretch = 1 + (M.STRETCH - 1) * Math.min(1, (speed * slow) / M.SPEED_MAX * 2)
        _dummy.scale.set(thick, thick, thick * stretch)
        _dummy.updateMatrix()
        magmaMesh.setMatrixAt(i, _dummy.matrix)
        magmaMesh.setColorAt(i, magmaColor(heat, _c))
      }
      magmaMesh.instanceMatrix.needsUpdate = true
      if (magmaMesh.instanceColor) magmaMesh.instanceColor.needsUpdate = true
    } else magmaMesh.visible = false
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={lava} geometry={sphere} material={lavaMat} frustumCulled={false} />
      <mesh ref={corona} geometry={sphere} material={mats.corona} frustumCulled={false} />
      <mesh ref={core} geometry={sphere} material={mats.core} frustumCulled={false} />
      <mesh ref={veil} geometry={sphere} material={mats.veil} frustumCulled={false} />
      <mesh ref={ring} geometry={plane} material={mats.ring} frustumCulled={false} />
      <mesh ref={impact} geometry={plane} material={impactMat} frustumCulled={false} renderOrder={3} />
      <mesh ref={flash} geometry={plane} material={mats.flash} frustumCulled={false} renderOrder={2} />
      <points ref={sparks} geometry={sparkGeo} material={mats.sparks} frustumCulled={false} />
      <instancedMesh ref={magma} args={[dropGeometry, magmaMat, CATACLYSM.MAGMA.COUNT]} frustumCulled={false} />
      <instancedMesh
        ref={chunks}
        args={[asteroidShapes()[index % asteroidShapes().length], chunkMat, CATACLYSM.CHUNKS.COUNT]}
        frustumCulled={false}
      />
    </group>
  )
}

export function Cataclysms() {
  return (
    <>
      {Array.from({ length: CATACLYSM.MAX }, (_, i) => (
        <Slot key={i} index={i} />
      ))}
    </>
  )
}
