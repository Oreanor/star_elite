import type { BufferGeometry } from 'three'
import { buildGeometry, quad, symmetric, tri, type Triangle, type Vec3 } from './build'

/**
 * Корабли поколений — киты. Города в километры длиной, поэтому и геометрия
 * «наворочённая, но простая»: много коробок и призм, собранных в силуэт, а не
 * гладких форм. Плоский шейдинг делает из этого гранёный мегаполис почти даром.
 *
 * Всё строится в ЕДИНИЧНОМ масштабе (габарит порядка 1), настоящий размер задаёт
 * множитель меша. Три облика — три функции; новый вид это новая функция и строка
 * в таблице, а не ветка в существующей.
 */

// Палитра: корпус — холодный металл трёх оттенков, окна и дюзы — тёплый акцент.
const HULL_DARK = 0x3b414c
const HULL = 0x565d68
const HULL_LIGHT = 0x767d88
const PANEL = 0x2b3038
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

/** Ряд «окон» — узкие светящиеся коробочки вдоль Z по обоим бортам. */
function windowStrip(x: number, y: number, z0: number, z1: number, count: number): Triangle[] {
  const out: Triangle[] = []
  for (let i = 0; i < count; i++) {
    const z = z0 + ((i + 0.5) / count) * (z1 - z0)
    out.push(...box([x, y, z], [0.006, 0.02, (z1 - z0) / count / 3.2], WINDOW))
  }
  return out
}

/** Облик 0: цилиндр О'Нила — восьмигранная труба с обручами и осевой антенной. */
function cylinderColony(): Triangle[] {
  const out: Triangle[] = []
  // Корпус.
  out.push(...prism(8, 0.3, -1, 1, HULL, HULL_DARK))
  // Три обруча-ребра: чуть шире корпуса, тонкие.
  for (const z of [-0.55, 0, 0.55]) out.push(...prism(8, 0.34, z - 0.03, z + 0.03, HULL_LIGHT, HULL_LIGHT))
  // Носовой и кормовой узлы.
  out.push(...prism(8, 0.16, 1, 1.18, HULL_LIGHT, HULL_DARK))
  out.push(...prism(8, 0.2, -1.14, -1, PANEL, HULL_DARK))
  // Осевая мачта с блоком связи.
  out.push(...box([0, 0, 1.18], [0.01, 0.01, 0.14], HULL_LIGHT))
  out.push(...box([0, 0, 1.34], [0.05, 0.05, 0.04], HULL))
  // Пояса окон вдоль верхней и нижней грани.
  out.push(...windowStrip(0, 0.3, -0.9, 0.9, 26))
  out.push(...windowStrip(0, -0.3, -0.9, 0.9, 26))
  return out
}

/** Облик 1: хребет-ковчег — центральная балка с блоками жилья и радиаторами. */
function spineArk(): Triangle[] {
  const out: Triangle[] = []
  // Хребет.
  out.push(...box([0, 0, 0], [0.06, 0.08, 1], HULL))
  // Командный узел спереди — ступенчатый.
  out.push(...box([0, 0, 1.02], [0.14, 0.12, 0.12], HULL_LIGHT))
  out.push(...box([0, 0.14, 1.02], [0.08, 0.05, 0.08], HULL))
  // Блоки жилья гроздьями по бортам — симметрично, разной длины.
  const blocks: Triangle[] = []
  for (let i = 0; i < 5; i++) {
    const z = 0.6 - i * 0.32
    const len = 0.1 + (i % 2) * 0.05
    blocks.push(...box([0.18, 0, z], [0.12, 0.16, len], i % 2 ? HULL_LIGHT : HULL))
    blocks.push(...box([0.32, 0, z], [0.03, 0.05, 0.05], WINDOW)) // фонарь на торце
  }
  out.push(...symmetric(blocks))
  // Радиаторные плавники у кормы — плоские крылья.
  const fins: Triangle[] = []
  for (const s of [-1, 1]) fins.push(...box([0, s * 0.34, -0.8], [0.005, 0.26, 0.22], PANEL))
  out.push(...fins)
  // Дюзовый блок сзади.
  out.push(...box([0, 0, -1.06], [0.1, 0.1, 0.08], HULL_DARK))
  out.push(...box([0, 0, -1.16], [0.05, 0.05, 0.03], GLOW))
  return out
}

/** Облик 2: город-плита — широкое основание с башнями-зиккуратами и куполами. */
function cityPlate(): Triangle[] {
  const out: Triangle[] = []
  // Плита-основание.
  out.push(...box([0, 0, 0], [0.5, 0.06, 1], HULL_DARK))
  out.push(...box([0, -0.1, 0], [0.4, 0.06, 0.85], PANEL)) // подбрюшье-ферма
  // Ряды башен-зиккуратов на верхней палубе.
  const towers: Triangle[] = []
  const spots: Array<[number, number]> = [
    [0.2, 0.55], [0.28, 0.05], [0.18, -0.5], [0.34, -0.72], [0.1, 0.78],
  ]
  for (const [x, z] of spots) {
    towers.push(...box([x, 0.12, z], [0.09, 0.06, 0.09], HULL))
    towers.push(...box([x, 0.22, z], [0.05, 0.06, 0.05], HULL_LIGHT))
    towers.push(...box([x, 0.3, z], [0.02, 0.05, 0.02], WINDOW))
  }
  out.push(...symmetric(towers))
  // Пара осевых куполов — низкие восьмигранники.
  for (const z of [0.4, -0.3]) {
    out.push(...prism(8, 0.16, 0.06, 0.2, HULL_LIGHT, HULL_LIGHT).map((t) => rotateXToZ(t, z)))
  }
  // Огни по кромке плиты.
  out.push(...windowStrip(0.5, 0.02, -0.9, 0.9, 22))
  out.push(...windowStrip(-0.5, 0.02, -0.9, 0.9, 22))
  return out
}

/**
 * Купол строится призмой вдоль Z; чтобы поставить его «шапкой» вверх на палубу,
 * меняем оси: локальная Z призмы становится мировой Y, а место — по (0,·,z).
 */
function rotateXToZ(t: Triangle, atZ: number): Triangle {
  const map = (v: Vec3): Vec3 => [v[0], v[2], v[1] + atZ]
  // Смена местами осей переворачивает обход — восстанавливаем, меняя b и c.
  return tri(map(t.a), map(t.c), map(t.b), t.color)
}

const BUILDERS = [cylinderColony, spineArk, cityPlate]

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
