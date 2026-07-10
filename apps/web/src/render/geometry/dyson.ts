import { BufferAttribute, BufferGeometry, IcosahedronGeometry } from 'three'
import { DYSON } from '@elite/sim'

/**
 * Сферы Дайсона — мегаструктуры вокруг звезды. Три облика, три геометрии,
 * все строятся один раз на облик за игру. Единичный радиус: настоящий размер
 * задаёт множитель меша (несколько радиусов звезды, см. DYSON.SHELL_RADIUS).
 *
 * Геометрия ПРОСТА, потому что структура огромна и полупрозрачна: с расстояния,
 * с которого её видно, важен силуэт каркаса, а не число граней. Свет звезды
 * бьёт изнутри, поэтому рисуется она без освещения — как решётка на фоне короны.
 */

/** Облик 0: КАРКАСНАЯ СФЕРА — рёбра икосаэдра как балки клетки вокруг светила. */
function frameworkSphere(): BufferGeometry {
  // Икосаэдр даёт готовую сетку рёбер; берём её вершины и соединяем отрезками.
  const ico = new IcosahedronGeometry(1, 2)
  const pos = ico.getAttribute('position') as BufferAttribute
  const segments: number[] = []

  // Каждый треугольник геометрии — три ребра клетки. Дубли рёбер не страшны:
  // это линии без заливки, лишний отрезок поверх такого же незаметен.
  for (let i = 0; i < pos.count; i += 3) {
    const a = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    const b = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)]
    const c = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)]
    segments.push(...a, ...b, ...b, ...c, ...c, ...a)
  }
  ico.dispose()

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(segments), 3))
  return g
}

/** Облик 1: ОБОД-КОЛЬЦО — широкая экваториальная лента, как у Мира-Кольца Нивена. */
function ringBand(): BufferGeometry {
  const SEG = 96
  const inner = 1
  const width = 0.16 // полуширина ленты по оси вращения
  const positions: number[] = []

  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2
    const a1 = ((i + 1) / SEG) * Math.PI * 2
    const p = (a: number, y: number): number[] => [Math.cos(a) * inner, y, Math.sin(a) * inner]
    const A = p(a0, -width)
    const B = p(a1, -width)
    const C = p(a1, width)
    const D = p(a0, width)
    // Два треугольника на сегмент, обеими сторонами (материал DoubleSide).
    positions.push(...A, ...B, ...C, ...A, ...C, ...D)
  }

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.computeVertexNormals()
  return g
}

/** Облик 2: РОЙ ПАНЕЛЕЙ — множество плоских квадратов на сфере, как соты сборщиков. */
function panelSwarm(): BufferGeometry {
  const COUNT = 220
  const half = 0.055 // полусторона панели
  const positions: number[] = []

  // Точки равномерно по сфере — спираль Фибоначчи: панели не сбиваются в полюса.
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < COUNT; i++) {
    const y = 1 - (i / (COUNT - 1)) * 2 // от +1 до −1
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const a = i * golden
    const nx = Math.cos(a) * r
    const nz = Math.sin(a) * r
    const n = [nx, y, nz]

    // Локальный базис на сфере: два касательных вектора для сторон панели.
    const up = Math.abs(y) > 0.99 ? [1, 0, 0] : [0, 1, 0]
    const t1 = norm(cross(up, n))
    const t2 = norm(cross(n, t1))

    const corner = (s1: number, s2: number): number[] => [
      n[0]! + t1[0]! * s1 * half + t2[0]! * s2 * half,
      n[1]! + t1[1]! * s1 * half + t2[1]! * s2 * half,
      n[2]! + t1[2]! * s1 * half + t2[2]! * s2 * half,
    ]
    const A = corner(-1, -1)
    const B = corner(1, -1)
    const C = corner(1, 1)
    const D = corner(-1, 1)
    positions.push(...A, ...B, ...C, ...A, ...C, ...D)
  }

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.computeVertexNormals()
  return g
}

function cross(a: number[], b: number[]): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!]
}
function norm(v: number[]): number[] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1
  return [v[0]! / l, v[1]! / l, v[2]! / l]
}

const BUILDERS = [frameworkSphere, ringBand, panelSwarm]

/** Рисуется ли облик отрезками (каркас) или треугольниками (кольцо, рой). */
export const dysonIsLines = (variant: number): boolean => variant % BUILDERS.length === 0

const cache = new Map<number, BufferGeometry>()

export function dysonGeometry(variant: number): BufferGeometry {
  const key = variant % BUILDERS.length
  let geometry = cache.get(key)
  if (!geometry) {
    geometry = BUILDERS[key]!()
    cache.set(key, geometry)
  }
  return geometry
}

const ruinCache = new Map<number, BufferGeometry>()

/**
 * Останки сферы: та же геометрия, но выбита половина примитивов (DYSON.RUIN_SURVIVAL).
 * Каркас — по рёбрам (стрид 2 вершины), кольцо и рой — по треугольникам (стрид 3);
 * выбор «уцелел ли примитив» ДЕТЕРМИНИРОВАН по его индексу (хэш, не rng), поэтому
 * руина стабильна от кадра к кадру, а не мерцает. Проплешины в решётке и провалы
 * в рое читаются как «половина осыпалась», а не как редкая сетка.
 */
export function ruinGeometry(variant: number): BufferGeometry {
  const key = variant % BUILDERS.length
  const cached = ruinCache.get(key)
  if (cached) return cached

  const full = dysonGeometry(variant)
  const src = full.getAttribute('position') as BufferAttribute
  const vertsPerPrimitive = dysonIsLines(variant) ? 2 : 3
  const stride = vertsPerPrimitive * 3
  const primitives = src.count / vertsPerPrimitive

  const kept: number[] = []
  for (let p = 0; p < primitives; p++) {
    // Хэш индекса в [0,1): дешёвый детерминированный шум без Math.random.
    const h = ((Math.imul(p + 1, 0x9e3779b1) >>> 0) % 100000) / 100000
    if (h >= DYSON.RUIN_SURVIVAL) continue
    const base = p * stride
    for (let k = 0; k < stride; k++) kept.push(src.array[base + k]!)
  }

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(kept), 3))
  if (vertsPerPrimitive === 3) g.computeVertexNormals()
  ruinCache.set(key, g)
  return g
}
