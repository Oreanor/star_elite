import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  Vector3,
} from 'three'
import { COSMIC, renderTime, type Cataclysm } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { CATACLYSM } from '../config'
import { starWorldShrink, worldShrink } from '../worldShrink'
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

/** Направления и скорости искр слота — из хеша номера: одно облако не похоже на соседнее. */
function sparkGeometry(slot: number): BufferGeometry {
  const n = CATACLYSM.SPARKS
  const dir = new Float32Array(n * 3)
  const speed = new Float32Array(n)
  const tint = new Float32Array(n)
  let s = (slot + 1) * 0x9e3779b1
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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

function Slot({ index }: { index: number }) {
  const session = useSession()
  const group = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const corona = useRef<Mesh>(null)
  const veil = useRef<Mesh>(null)
  const flash = useRef<Mesh>(null)
  const ring = useRef<Mesh>(null)
  const sparks = useRef<Points>(null)
  const mats = useMemo(
    () => ({ core: coreMaterial(), corona: coronaMaterial(), veil: veilMaterial(), flash: flashMaterial(), ring: ringMaterial(), sparks: sparkMaterial() }),
    [],
  )
  const sparkGeo = useMemo(() => sparkGeometry(index), [index])
  useEffect(
    () => () => {
      sparkGeo.dispose()
      for (const m of Object.values(mats)) m.dispose()
    },
    [mats, sparkGeo],
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
    const t = age - look.implode
    const R = c.radius * shrink

    g.position.copy(_pos.copy(c.at).sub(world.originOffset))

    // ── Ядро: раскаляется и сжимается до разрыва, после — гаснет за полсекунды. ──
    const coreM = mats.core.uniforms
    const coreMesh = core.current!
    if (c.kind !== 'seed' && t < 0.5) {
      const pre = look.implode > 0 ? Math.min(1, age / look.implode) : 1
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
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={corona} geometry={sphere} material={mats.corona} frustumCulled={false} />
      <mesh ref={core} geometry={sphere} material={mats.core} frustumCulled={false} />
      <mesh ref={veil} geometry={sphere} material={mats.veil} frustumCulled={false} />
      <mesh ref={ring} geometry={plane} material={mats.ring} frustumCulled={false} />
      <mesh ref={flash} geometry={plane} material={mats.flash} frustumCulled={false} renderOrder={2} />
      <points ref={sparks} geometry={sparkGeo} material={mats.sparks} frustumCulled={false} />
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
