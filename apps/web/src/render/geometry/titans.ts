import type { BufferGeometry } from 'three'
import { buildGeometry, quad, symmetric, tri, type Triangle, type Vec3 } from './build'

/**
 * Корабли поколений — киты. Города-крейсеры в километры длиной: вытянутый корпус
 * с ЗАОСТРЁННЫМ носом, центральная надстройка-рубка, а поверх — навешанная мелочь:
 * блоки-секции, антенны, плоские солнечные панели. Геометрия «наворочённая, но
 * простая»: много коробок и призм, собранных в силуэт. Плоский шейдинг делает из
 * этого гранёный мегаполис почти даром.
 *
 * Всё строится в ЕДИНИЧНОМ масштабе (габарит порядка 1), настоящий размер задаёт
 * множитель меша. Нос смотрит в +Z, корма с дюзами — в −Z.
 *
 * Три облика — три функции; новый вид это новая функция и строка в таблице, а не
 * ветка в существующей.
 */

// Палитра: корпус — холодный металл трёх оттенков, панели и днище темнее,
// окна и дюзы — тёплый и голубой акценты, солнечные крылья — синеватые.
const HULL_DARK = 0x3b414c
const HULL = 0x565d68
const HULL_LIGHT = 0x767d88
const PANEL = 0x2b3038
const SOLAR = 0x263a5c
const WINDOW = 0xffcf8a
const GLOW = 0x86c8ff

/** Прямоугольный короб от `(cx±hx, …)`. Шесть граней, обход наружу. */
function box(c: Vec3, h: Vec3, color: number): Triangle[] {
  const [x, y, z] = c
  const [hx, hy, hz] = h
  const p: Vec3[] = [
    [x - hx, y - hy, z - hz], [x + hx, y - hy, z - hz], [x + hx, y + hy, z - hz], [x - hx, y + hy, z - hz],
    [x - hx, y - hy, z + hz], [x + hx, y - hy, z + hz], [x + hx, y + hy, z + hz], [x - hx, y + hy, z + hz],
  ]
  return [
    ...quad(p[4]!, p[5]!, p[6]!, p[7]!, color), // +z
    ...quad(p[1]!, p[0]!, p[3]!, p[2]!, color), // −z
    ...quad(p[5]!, p[1]!, p[2]!, p[6]!, color), // +x
    ...quad(p[0]!, p[4]!, p[7]!, p[3]!, color), // −x
    ...quad(p[7]!, p[6]!, p[2]!, p[3]!, color), // +y
    ...quad(p[0]!, p[1]!, p[5]!, p[4]!, color), // −y
  ]
}

/**
 * Призма вдоль оси Z: `sides`-угольная труба от z0 до z1 с торцами.
 * Ось лежит на (0,0,z); в сечении — правильный многоугольник радиуса `r`.
 */
function prism(sides: number, r: number, z0: number, z1: number, side: number, cap: number): Triangle[] {
  const ring = (z: number): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2
      return [Math.cos(a) * r, Math.sin(a) * r, z] as Vec3
    })
  const a = ring(z0)
  const b = ring(z1)
  const out: Triangle[] = []
  const c0: Vec3 = [0, 0, z0]
  const c1: Vec3 = [0, 0, z1]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    out.push(...quad(a[i]!, a[j]!, b[j]!, b[i]!, side)) // боковая грань
    out.push(tri(a[j]!, a[i]!, c0, cap)) // торец z0
    out.push(tri(b[i]!, b[j]!, c1, cap)) // торец z1
  }
  return out
}

/** Сдвиг набора треугольников. Чистый перенос обход не переворачивает. */
function translate(tris: Triangle[], dx: number, dy: number, dz: number): Triangle[] {
  const m = (v: Vec3): Vec3 => [v[0] + dx, v[1] + dy, v[2] + dz]
  return tris.map((t) => tri(m(t.a), m(t.b), m(t.c), t.color))
}

/**
 * Заострённый нос: короб сечения (hx,hy) на zBase сходится к короткому
 * ВЕРТИКАЛЬНОМУ ребру (полувысотой tipHy) на zTip. Клин острый в плане и тупой в
 * профиль — так нос читается заострённым, оставаясь корпусом крейсера, а не иглой.
 */
function prow(zBase: number, zTip: number, hx: number, hy: number, tipHy: number, color: number): Triangle[] {
  const b0: Vec3 = [-hx, -hy, zBase]
  const b1: Vec3 = [hx, -hy, zBase]
  const b2: Vec3 = [hx, hy, zBase]
  const b3: Vec3 = [-hx, hy, zBase]
  const tTop: Vec3 = [0, tipHy, zTip]
  const tBot: Vec3 = [0, -tipHy, zTip]
  return [
    tri(b0, b1, tBot, color), // низ сходится к нижней точке ребра
    tri(b2, b3, tTop, color), // верх — к верхней
    ...quad(b1, b2, tTop, tBot, color), // +x борт
    ...quad(b3, b0, tBot, tTop, color), // −x борт
    ...quad(b0, b3, b2, b1, color), // задняя крышка (внутрь корпуса)
  ]
}

/** Тонкая антенна-мачта вдоль +Y с блочком-обтекателем на конце. */
function antenna(x: number, yBase: number, z: number, h: number): Triangle[] {
  return [
    ...box([x, yBase + h / 2, z], [0.005, h / 2, 0.005], HULL_LIGHT),
    ...box([x, yBase + h, z], [0.018, 0.018, 0.018], HULL),
  ]
}

/**
 * Солнечное крыло на правый борт: штанга от x0 наружу и плоская панель за ней.
 * Тонкая по Y — плита, а не брус. Через `symmetric` получаем и левое.
 */
function solarWing(x0: number, z: number, span: number, chord: number): Triangle[] {
  const armEnd = x0 + 0.1
  return [
    ...box([x0 + 0.05, 0, z], [0.05, 0.006, 0.008], HULL_LIGHT), // штанга
    ...box([armEnd + span / 2, 0, z], [span / 2, 0.004, chord / 2], SOLAR), // панель
    ...box([armEnd + span / 2, 0, z], [span / 2, 0.006, 0.006], HULL_DARK), // продольная жилка
  ]
}

/** Ряд «окон» — узкие светящиеся коробочки вдоль Z по борту. */
function windowStrip(x: number, y: number, z0: number, z1: number, count: number): Triangle[] {
  const out: Triangle[] = []
  for (let i = 0; i < count; i++) {
    const z = z0 + ((i + 0.5) / count) * (z1 - z0)
    out.push(...box([x, y, z], [0.006, 0.02, (z1 - z0) / count / 3.2], WINDOW))
  }
  return out
}

/** Четыре дюзы с голубым свечением на корме заданного блока. */
function nozzles(z: number, spread: number, r: number): Triangle[] {
  const out: Triangle[] = []
  for (const x of [-spread, spread]) {
    for (const y of [-spread * 0.7, spread * 0.7]) {
      out.push(...translate(prism(6, r, z - 0.06, z, PANEL, GLOW), x, y, 0))
    }
  }
  return out
}

/**
 * Облик 0: линейный крейсер. Вытянутый корпус с острым носом, ступенчатая рубка
 * ближе к корме, ряды бортовых секций-модулей, дюзовый блок и антенны.
 */
function battleCruiser(): Triangle[] {
  const out: Triangle[] = []
  // Основной корпус и киль.
  out.push(...box([0, 0, -0.05], [0.16, 0.13, 0.85], HULL))
  out.push(...box([0, -0.15, -0.1], [0.1, 0.05, 0.62], HULL_DARK))
  // Острый нос.
  out.push(...prow(0.8, 1.25, 0.16, 0.13, 0.03, HULL_LIGHT))
  // Кормовой блок с дюзами.
  out.push(...box([0, 0, -0.92], [0.15, 0.12, 0.1], HULL_DARK))
  out.push(...nozzles(-0.98, 0.07, 0.04))
  // Надстройка-рубка: ступенчатые блоки к корме на верхней палубе.
  out.push(...box([0, 0.15, -0.35], [0.1, 0.05, 0.28], HULL_LIGHT))
  out.push(...box([0, 0.24, -0.42], [0.07, 0.05, 0.16], HULL))
  out.push(...box([0, 0.32, -0.46], [0.04, 0.045, 0.09], HULL_LIGHT))
  out.push(...box([0, 0.38, -0.46], [0.025, 0.03, 0.03], WINDOW)) // фонарь мостика
  // Бортовые секции-модули чередующихся оттенков.
  const flank: Triangle[] = []
  for (let i = 0; i < 5; i++) {
    const z = 0.5 - i * 0.28
    flank.push(...box([0.17, 0.02, z], [0.03, 0.05, 0.09], i % 2 ? HULL_LIGHT : HULL_DARK))
  }
  out.push(...symmetric(flank))
  // Солнечные крылья у миделя и антенны на палубе.
  out.push(...symmetric(solarWing(0.16, 0.15, 0.28, 0.5)))
  out.push(...antenna(0.05, 0.2, 0.15, 0.18))
  out.push(...antenna(-0.06, 0.2, -0.15, 0.14))
  // Пояса окон по бортам.
  out.push(...windowStrip(0.161, 0.03, -0.68, 0.7, 20))
  out.push(...windowStrip(-0.161, 0.03, -0.68, 0.7, 20))
  return out
}

/**
 * Облик 1: ковчег-хребет. Центральная балка с острым командным носом, высокая
 * башня-рубка, гроздья жилых блоков по бортам, солнечные крылья и радиаторы.
 */
function spineArk(): Triangle[] {
  const out: Triangle[] = []
  // Хребет и нос.
  out.push(...box([0, 0, -0.05], [0.06, 0.08, 0.92], HULL))
  out.push(...prow(0.85, 1.2, 0.06, 0.08, 0.02, HULL_LIGHT))
  // Командная башня — ступенчатая, с фонарём.
  out.push(...box([0, 0.16, 0.5], [0.07, 0.1, 0.09], HULL_LIGHT))
  out.push(...box([0, 0.3, 0.5], [0.04, 0.07, 0.04], HULL))
  out.push(...box([0, 0.4, 0.5], [0.02, 0.04, 0.02], WINDOW))
  out.push(...antenna(0, 0.44, 0.5, 0.14))
  // Жилые блоки гроздьями по бортам — симметрично, разной длины.
  const blocks: Triangle[] = []
  for (let i = 0; i < 5; i++) {
    const z = 0.55 - i * 0.3
    const len = 0.09 + (i % 2) * 0.04
    blocks.push(...box([0.16, 0, z], [0.1, 0.14, len], i % 2 ? HULL_LIGHT : HULL))
    blocks.push(...box([0.28, 0, z], [0.02, 0.04, 0.04], WINDOW)) // фонарь на торце
  }
  out.push(...symmetric(blocks))
  // Солнечные крылья и радиаторные плавники у кормы.
  out.push(...symmetric(solarWing(0.06, 0.2, 0.34, 0.55)))
  const fins: Triangle[] = []
  for (const s of [-1, 1]) fins.push(...box([0, s * 0.3, -0.8], [0.005, 0.22, 0.2], PANEL))
  out.push(...fins)
  // Дюзовый блок сзади.
  out.push(...box([0, 0, -1.02], [0.1, 0.1, 0.08], HULL_DARK))
  out.push(...box([0, 0, -1.12], [0.05, 0.05, 0.03], GLOW))
  return out
}

/**
 * Облик 2: готический лайнер. Широкий корпус-плита, центральная мачта-шпиль и ряд
 * башен вдоль палубы, крупные солнечные панели по бортам, россыпь окон.
 */
function gothicLiner(): Triangle[] {
  const out: Triangle[] = []
  // Корпус-плита и подбрюшье.
  out.push(...box([0, 0, 0], [0.2, 0.09, 0.95], HULL_DARK))
  out.push(...box([0, -0.11, 0], [0.14, 0.05, 0.8], PANEL))
  // Тупой, но заострённый нос.
  out.push(...prow(0.9, 1.15, 0.2, 0.09, 0.04, HULL))
  // Центральная мачта-шпиль.
  out.push(...box([0, 0.12, 0.05], [0.05, 0.11, 0.06], HULL_LIGHT))
  out.push(...box([0, 0.27, 0.05], [0.025, 0.15, 0.03], HULL))
  out.push(...box([0, 0.45, 0.05], [0.012, 0.09, 0.012], HULL_LIGHT))
  // Ряд башен вдоль палубы — симметрично по бортам.
  const spires: Triangle[] = []
  for (const [x, z, h] of [[0.09, 0.5, 0.18], [0.12, -0.2, 0.24], [0.1, -0.62, 0.16], [0.06, 0.78, 0.12]] as const) {
    spires.push(...box([x, 0.09 + h / 2, z], [0.03, h / 2, 0.03], HULL))
    spires.push(...box([x, 0.09 + h, z], [0.012, 0.03, 0.012], WINDOW))
  }
  out.push(...symmetric(spires))
  // Крупные солнечные панели по бортам.
  out.push(...symmetric(solarWing(0.2, 0.4, 0.3, 0.6)))
  out.push(...symmetric(solarWing(0.2, -0.5, 0.26, 0.5)))
  // Дюзы.
  out.push(...box([0, 0, -1.0], [0.16, 0.08, 0.06], HULL_DARK))
  out.push(...nozzles(-1.0, 0.08, 0.045))
  // Россыпь окон по бортам плиты.
  out.push(...windowStrip(0.2, 0.02, -0.8, 0.85, 30))
  out.push(...windowStrip(-0.2, 0.02, -0.8, 0.85, 30))
  return out
}

const BUILDERS = [battleCruiser, spineArk, gothicLiner]

const cache = new Map<number, BufferGeometry>()

/** Геометрия кита данного облика. Строится один раз на облик за всю игру. */
export function titanGeometry(variant: number): BufferGeometry {
  const key = variant % BUILDERS.length
  let geometry = cache.get(key)
  if (!geometry) {
    geometry = buildGeometry(BUILDERS[key]!())
    cache.set(key, geometry)
  }
  return geometry
}
