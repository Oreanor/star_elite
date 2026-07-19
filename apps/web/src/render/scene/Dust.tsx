import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, LineSegments, Mesh, Vector3 } from 'three'
import { makeRng } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { DUST, GIANT_RENDER_CAP } from '../config'
import { dustLaserMaterial, dustMaterial, dustNeonMaterial } from '../materials/materials'
import { nearestStar, starTintHex } from '../starLight'
import { dustExtents, wrapUnit } from './dustMath'

/**
 * Ближняя пыль — единственный источник ощущения скорости в пустоте:
 * далёкие звёзды не смещаются, а больше зацепиться не за что.
 *
 * Частицы — отрезки, а не точки. На малой скорости отрезок короче пикселя
 * и читается как точка; на крейсерском ходу вытягивается в штрих.
 * Отдельного «режима гипердрайва» для этого не нужно.
 *
 * На глубоком форсаже (лазерный ход) штрих ещё и УТОЛЩАЕТСЯ: линии толщины в WebGL нет,
 * поэтому поверх яркой линии-керна кладётся камеро-ориентированная ЛЕНТА-квад — и мимо
 * несутся жирные светящиеся трубки, а не иголки. Ниже порога накала лента не рисуется.
 *
 * Частицы неподвижны в мире, но ОБОРАЧИВАЮТСЯ вокруг камеры: улетевшая назад
 * появляется впереди. Поэтому их всегда ровно DUST.COUNT.
 *
 * Хранятся они не в метрах, а в ДОЛЯХ куба, −0.5..0.5 от его центра.
 *
 * Темп проноса считается только по ЛОКАЛЬНОЙ скорости корабля. Орбитальный перенос
 * системы отсчёта и движение камеры не являются полётом сквозь пыль.
 */

const _delta = new Vector3()
const _streak = new Vector3()
const _view = new Vector3()
const _wax = new Vector3()

export function Dust() {
  const session = useSession()
  const ref = useRef<LineSegments>(null)
  const ribbonRef = useRef<Mesh>(null)

  const { geometry, ribbonGeometry, offsets } = useMemo(() => {
    const rng = makeRng(0x9dc51)
    const offsets = new Float32Array(DUST.COUNT * 3)
    for (let i = 0; i < DUST.COUNT * 3; i++) offsets[i] = rng() - 0.5

    // Два конца на отрезок: заранее выделено, в кадре только переписывается.
    const positions = new Float32Array(DUST.COUNT * 6)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))

    // ЛЕНТА (неон): шесть вершин на частицу (два треугольника квада). Тоже заранее.
    const ribbon = new Float32Array(DUST.COUNT * 18)
    const rg = new BufferGeometry()
    rg.setAttribute('position', new BufferAttribute(ribbon, 3))
    // UV ленты постоянны: x поперёк (−1..1, гаусс по краям в шейдере), y вдоль (0 голова→1 хвост).
    // Углы совпадают с раскладкой позиций ниже: c0(+w,гол) c1(−w,гол) c2(−w,хв) c0 c2 c3(+w,хв).
    const uv = new Float32Array(DUST.COUNT * 12)
    for (let i = 0; i < DUST.COUNT; i++) {
      const u = i * 12
      uv[u] = 1; uv[u + 1] = 0 // c0
      uv[u + 2] = -1; uv[u + 3] = 0 // c1
      uv[u + 4] = -1; uv[u + 5] = 1 // c2
      uv[u + 6] = 1; uv[u + 7] = 0 // c0
      uv[u + 8] = -1; uv[u + 9] = 1 // c2
      uv[u + 10] = 1; uv[u + 11] = 1 // c3
    }
    rg.setAttribute('uv', new BufferAttribute(uv, 2))
    return { geometry: g, ribbonGeometry: rg, offsets }
  }, [])

  useFrame((state, dt) => {
    const camera = state.camera
    const mesh = ref.current
    const ribbon = ribbonRef.current
    if (!mesh || !ribbon) return

    const world = session.world
    const player = world.player

    // Гаснем вместе с гигант-скрытием борта — раньше на CAP (4000) пыль пропадала слишком рано.
    const dead = player.state.scale >= DUST.HIDE_SCALE
    mesh.visible = !dead
    if (dead) {
      ribbon.visible = false
      return
    }

    // Поле окружает ГЛАЗ (камеру), а не центр корабля: у камеры упреждение и кинотраектория.
    const origin = camera.position
    const velocity = player.state.vel
    const speed = velocity.length()

    // Камера и меш зажаты GIANT_RENDER_CAP, а скорость ∝ полному scale. Куб пыли считаем
    // в «экранных» единицах (как будто рост = cap): иначе за потолком отвода куб раздувается
    // от истинной скорости×scale и пустеет — коробка «уходит», частиц рядом с глазом нет.
    const visualScale = Math.min(player.state.scale, GIANT_RENDER_CAP)
    const visualSpeed = speed * (visualScale / Math.max(player.state.scale, 1e-9))
    const { box, tail, rate } = dustExtents(visualSpeed, dt, visualScale)

    // Спектр ближайшей звезды слегка красит пыль: у красного карлика след теплее.
    const star = nearestStar(world, player.state.pos)
    const starHex = star?.color ?? 0xffffff
    const dustTint = starTintHex(DUST.COLOR, starHex, DUST.STAR_TINT)
    const glowTint = starTintHex(DUST.GLOW_COLOR, starHex, DUST.STAR_TINT)

    // ЛАЗЕРНЫЙ ход: на глубоком крейсере пыль загорается. Накал 0..1 от GLOW_START к GLOW_FULL.
    const glow = Math.max(0, Math.min(1, (player.cruise.factor - DUST.GLOW_START) / (DUST.GLOW_FULL - DUST.GLOW_START)))
    if (glow > 0) {
      const laser = dustLaserMaterial()
      laser.color.setHex(glowTint)
      laser.opacity = 0.4 + 0.5 * glow
      mesh.material = laser
    } else {
      const dust = dustMaterial()
      dust.color.setHex(dustTint)
      mesh.material = dust
    }
    // Штрих удлиняем по накалу: линия тянется в лазерный след, а не в короткую искру.
    const tailGlow = tail * (1 + glow * DUST.GLOW_STREAK_BOOST)

    // Неоновая лента толще с накалом — полуширина как доля длины штриха. Ниже порога не рисуем.
    const neon = glow > 0
    // УТОЛЩЕНИЕ замирает за NEON_FATTEN_MAX_FACTOR: лента жирнеет и от накала (ширина ∝ glowW),
    // и от длины штриха (∝ скорость). За порогом гоним ширину по «зажатому» накалу glowW, а вклад
    // длины давим множителем fatten = cap/factor — произведение выходит ∝ min(factor, cap), и
    // труба перестаёт раздуваться на весь экран. Яркость и ДЛИНУ штриха это не трогает.
    const fatFactor = Math.min(player.cruise.factor, DUST.NEON_FATTEN_MAX_FACTOR)
    const glowW = Math.max(0, Math.min(1, (fatFactor - DUST.GLOW_START) / (DUST.GLOW_FULL - DUST.GLOW_START)))
    const fatten = Math.min(1, DUST.NEON_FATTEN_MAX_FACTOR / Math.max(player.cruise.factor, 1))
    const halfWidthFrac = DUST.NEON_HALF_WIDTH * glowW
    const neonMat = dustNeonMaterial()
    neonMat.uniforms.uColor!.value.setHex(glowTint)
    neonMat.uniforms.uOpacity!.value = 0.25 + 0.6 * glow
    neonMat.uniforms.uTime!.value = state.clock.elapsedTime
    ribbon.material = neonMat
    ribbon.visible = neon

    // Двигаем узор только фактической скоростью борта (орбита систему сдвигает, но это не полёт).
    _delta.copy(velocity).multiplyScalar(dt / rate)

    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute
    const array = attribute.array as Float32Array
    const ribArr = ribbon.geometry.getAttribute('position').array as Float32Array

    for (let i = 0; i < DUST.COUNT; i++) {
      const p = i * 3

      // Частица стоит в мире — уезжает корабль. Значит вычитаем его смещение.
      const ux = wrapUnit((offsets[p] ?? 0) - _delta.x)
      const uy = wrapUnit((offsets[p + 1] ?? 0) - _delta.y)
      const uz = wrapUnit((offsets[p + 2] ?? 0) - _delta.z)
      offsets[p] = ux
      offsets[p + 1] = uy
      offsets[p + 2] = uz

      const hx = origin.x + ux * box
      const hy = origin.y + uy * box
      const hz = origin.z + uz * box
      // Хвост тянется ПРОТИВ вектора скорости — как след на длинной выдержке.
      const tx = hx - velocity.x * tailGlow
      const ty = hy - velocity.y * tailGlow
      const tz = hz - velocity.z * tailGlow

      const o = i * 6
      array[o] = hx
      array[o + 1] = hy
      array[o + 2] = hz
      array[o + 3] = tx
      array[o + 4] = ty
      array[o + 5] = tz

      if (!neon) continue
      // Ширина ленты — поперёк штриха и К КАМЕРЕ: ось = normalize(streak × view). Так лента
      // всегда развёрнута плоскостью к глазу и читается трубкой, а не исчезает ребром.
      _streak.set(hx - tx, hy - ty, hz - tz)
      _view.set(hx - origin.x, hy - origin.y, hz - origin.z)
      _wax.crossVectors(_streak, _view)
      const wl = _wax.length()
      if (wl < 1e-6) {
        // Штрих смотрит прямо в глаз — ленты нет, сложим квад в точку (не мельтешит).
        for (let k = 0; k < 18; k++) ribArr[i * 18 + k] = hx
        continue
      }
      const halfW = (_streak.length() * halfWidthFrac * fatten) / wl
      const wxx = _wax.x * halfW
      const wyy = _wax.y * halfW
      const wzz = _wax.z * halfW

      // Четыре угла: голова±ширина, хвост±ширина → два треугольника (c0,c1,c2)(c0,c2,c3).
      const r = i * 18
      // c0 = head + w
      ribArr[r] = hx + wxx; ribArr[r + 1] = hy + wyy; ribArr[r + 2] = hz + wzz
      // c1 = head - w
      ribArr[r + 3] = hx - wxx; ribArr[r + 4] = hy - wyy; ribArr[r + 5] = hz - wzz
      // c2 = tail - w
      ribArr[r + 6] = tx - wxx; ribArr[r + 7] = ty - wyy; ribArr[r + 8] = tz - wzz
      // c0 again
      ribArr[r + 9] = hx + wxx; ribArr[r + 10] = hy + wyy; ribArr[r + 11] = hz + wzz
      // c2 again
      ribArr[r + 12] = tx - wxx; ribArr[r + 13] = ty - wyy; ribArr[r + 14] = tz - wzz
      // c3 = tail + w
      ribArr[r + 15] = tx + wxx; ribArr[r + 16] = ty + wyy; ribArr[r + 17] = tz + wzz
    }

    attribute.needsUpdate = true
    if (neon) (ribbon.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
  })

  return (
    <>
      <lineSegments ref={ref} geometry={geometry} material={dustMaterial()} frustumCulled={false} />
      <mesh ref={ribbonRef} geometry={ribbonGeometry} material={dustNeonMaterial()} frustumCulled={false} visible={false} />
    </>
  )
}
