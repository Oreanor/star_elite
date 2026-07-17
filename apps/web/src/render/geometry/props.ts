import { BoxGeometry, CylinderGeometry, TorusGeometry, type BufferGeometry } from 'three'
import { CORRIDOR, PALETTE } from '../config'
import { buildGeometry, quad, tri, type Triangle, type Vec3 } from './build'

/**
 * Мелкий реквизит: станция и грузовой контейнер.
 * Геометрия единичного масштаба там, где её растягивает матрица инстанса.
 */

// ─── Станция: обитаемый тор со ступицей ──────────────────────────────────────
// Геометрия в единичном радиусе; настоящий размер задаёт масштаб меша.

const { STATION, STATION_DARK, STATION_TRIM, STATION_LIT } = PALETTE

/**
 * Тор, а не многогранник.
 *
 * Форма здесь следует из физики, а не из вкуса. Станция вращается вокруг своей
 * оси (домен задаёт ей `spinAxis = Z`), и на ободе радиусом 400 м при обороте
 * за 78 секунд получается 0.26 g — то самое центробежное «притяжение», ради
 * которого настоящие проекты орбитальных станций и делают кольцевыми. Люди
 * живут в ободе, ногами наружу; невесомая ступица в центре — там причал,
 * потому что стыковаться к вращающемуся ободу невозможно.
 *
 * Кольцо лежит в плоскости XY: ось вращения Z проходит сквозь причальный зев.
 */
const RING_RADIUS = 0.8 // радиус осевой линии обода
const TUBE_RADIUS = 0.17 // полутолщина трубы обода
const HUB_RADIUS = 0.2
const HUB_HALF = 0.34 // полудлина ступицы по Z

/** Радиус внешнего экватора обода — по нему рендер расставляет мигающие маяки. */
export const STATION_RIM_RADIUS = RING_RADIUS + TUBE_RADIUS

function torus(major: number, minor: number, majorSegments: number, minorSegments: number): Triangle[] {
  const out: Triangle[] = []

  const at = (u: number, v: number): Vec3 => {
    const ring = major + minor * Math.cos(v)
    return [ring * Math.cos(u), ring * Math.sin(u), minor * Math.sin(v)]
  }

  for (let i = 0; i < majorSegments; i++) {
    const u0 = (i / majorSegments) * Math.PI * 2
    const u1 = ((i + 1) / majorSegments) * Math.PI * 2

    for (let j = 0; j < minorSegments; j++) {
      const v0 = (j / minorSegments) * Math.PI * 2
      const v1 = ((j + 1) / minorSegments) * Math.PI * 2

      // Иллюминаторы смотрят НАРУЖУ обода: там, где центробежная сила зовётся «низом»,
      // окно в потолке показывало бы звёзды, а окно в полу — планету. Выбран пол.
      const outward = Math.cos((v0 + v1) / 2) > 0.7
      const lit = outward && i % 3 === 0
      const plate = j % 2 === 0 ? STATION : STATION_DARK

      out.push(...quad(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), lit ? STATION_LIT : plate))
    }
  }
  return out
}

/** Радиусы, между которыми натянута спица: от ступицы до внутренней кромки обода. */
const SPOKE_HUB = HUB_RADIUS * 0.9
const SPOKE_RIM = RING_RADIUS - TUBE_RADIUS * 0.4

/**
 * Балка от ступицы к ободу — одна «спица» рисунка колеса. Обобщена до автомобильного
 * диска: ширина у ступицы (`hw0`) и у обода (`hw1`) РАЗНАЯ, поэтому спица бывает
 * клиновидной; `lean` сдвигает конец у обода по касательной, давая наклон крыльчатки
 * или расхождение раздвоенной спицы. Прямоугольное сечение развёрнуто на `angle` в XY.
 */
function arm(angle: number, hw0: number, hw1: number, halfThick: number, lean = 0): Triangle[] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // Радиальная ось наружу, поперечная — по касательной, третья — вдоль Z.
  const at = (r: number, across: number, z: number): Vec3 => [c * r - s * across, s * r + c * across, z]
  const r0 = SPOKE_HUB
  const r1 = SPOKE_RIM

  const v: Vec3[] = [
    at(r0, -hw0, -halfThick), at(r0, hw0, -halfThick), at(r0, hw0, halfThick), at(r0, -hw0, halfThick),
    at(r1, lean - hw1, -halfThick), at(r1, lean + hw1, -halfThick), at(r1, lean + hw1, halfThick), at(r1, lean - hw1, halfThick),
  ]
  const p = (i: number): Vec3 => v[i]!

  return [
    ...quad(p(0), p(1), p(2), p(3), STATION_TRIM), // у ступицы
    ...quad(p(5), p(4), p(7), p(6), STATION_TRIM), // у обода
    ...quad(p(4), p(0), p(3), p(7), STATION_TRIM),
    ...quad(p(1), p(5), p(6), p(2), STATION_TRIM),
    ...quad(p(3), p(2), p(6), p(7), STATION),
    ...quad(p(4), p(5), p(1), p(0), STATION_DARK),
  ]
}

/**
 * Вариант станции: тор, ступица и иллюминаторы у всех общие — узнаётся как кориолис, —
 * а РАЗЛИЧАЕТСЯ рисунком спиц (число и форма, как у литых дисков) и числом мигающих
 * маяков по ободу (4–8). `arm` рисует ОДНУ спицу на базовом угле; вариант «сплит»
 * возвращает пару. Данные, а не ветвления: новый диск — новая запись, не правка кода.
 */
export interface StationVariant {
  readonly spokes: number
  readonly lights: number
  readonly arm: (angle: number) => Triangle[]
}

export const STATION_VARIANTS: readonly StationVariant[] = [
  // 0 — «Классик»: шесть прямых балок, как в оригинале.
  { spokes: 6, lights: 6, arm: (a) => arm(a, 0.035, 0.035, 0.03) },
  // 1 — «Спорт-5»: пять клиновидных лучей, широких у ступицы — 5-спицевый литой диск.
  { spokes: 5, lights: 5, arm: (a) => arm(a, 0.085, 0.028, 0.032) },
  // 2 — «Сплит»: пять раздвоенных спиц — тонкая пара, расходящаяся к ободу (split-spoke).
  {
    spokes: 5,
    lights: 8,
    arm: (a) => [...arm(a, 0.02, 0.022, 0.028, 0.1), ...arm(a, 0.02, 0.022, 0.028, -0.1)],
  },
  // 3 — «Турбина»: восемь тонких лопастей с наклоном к ободу — колесо-крыльчатка.
  { spokes: 8, lights: 7, arm: (a) => arm(a, 0.024, 0.055, 0.022, 0.17) },
]

/** Ступица: восьмигранная призма вдоль оси вращения. В переднем торце — причал. */
function hub(): Triangle[] {
  const out: Triangle[] = []
  const sides = 8
  const mouth = 0.11 // радиус причального зева
  const throat = -HUB_HALF + 0.14 // насколько зев утоплен внутрь

  const ring = (radius: number, z: number): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides
      return [Math.cos(a) * radius, Math.sin(a) * radius, z] as Vec3
    })

  const front = ring(HUB_RADIUS, -HUB_HALF)
  const back = ring(HUB_RADIUS, HUB_HALF)
  const lip = ring(mouth, -HUB_HALF)
  const floor = ring(mouth, throat)
  const centreBack: Vec3 = [0, 0, HUB_HALF]
  const centreFloor: Vec3 = [0, 0, throat]

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    out.push(...quad(front[i]!, front[j]!, back[j]!, back[i]!, i % 2 ? STATION : STATION_TRIM))

    // Передний торец — кольцо вокруг зева, а не сплошной диск.
    out.push(...quad(lip[i]!, lip[j]!, front[j]!, front[i]!, STATION_DARK))
    // Горловина причала и его светящееся дно: корабль влетает точно по оси.
    out.push(...quad(floor[i]!, floor[j]!, lip[j]!, lip[i]!, STATION_TRIM))
    out.push(tri(centreFloor, floor[j]!, floor[i]!, STATION_LIT))

    out.push(tri(centreBack, back[i]!, back[j]!, STATION_TRIM))
  }
  return out
}

/**
 * Иллюминаторы: шесть светящихся окошек по внешнему экватору обода.
 *
 * Обод и так вращается, поэтому огоньки, разнесённые по кругу, читаются как
 * «станция жилая», а не мёртвая болванка. Приподняты над трубой на малую долю,
 * иначе делят грань с обшивкой и мерцают в буфере глубины. Сдвинуты по фазе от
 * спиц, чтобы окно не приходилось ровно на балку.
 */
function portholes(): Triangle[] {
  const out: Triangle[] = []
  const count = 6
  const uHalf = 0.06 // полуширина окна по большому кругу, рад
  const vHalf = 0.2 // полувысота по малому кругу, рад
  const lift = TUBE_RADIUS + 0.006 // на экваторе (v=0) — наружу обода

  for (let k = 0; k < count; k++) {
    const u = (k / count) * Math.PI * 2 + Math.PI / count // между спицами
    const at = (du: number, dv: number): Vec3 => {
      const ring = RING_RADIUS + lift * Math.cos(dv)
      return [ring * Math.cos(u + du), ring * Math.sin(u + du), lift * Math.sin(dv)]
    }
    out.push(...quad(at(-uHalf, -vHalf), at(uHalf, -vHalf), at(uHalf, vHalf), at(-uHalf, vHalf), STATION_LIT))
  }
  return out
}

function station(variant: StationVariant): Triangle[] {
  const out: Triangle[] = [...torus(RING_RADIUS, TUBE_RADIUS, 24, 8), ...hub(), ...portholes()]

  for (let i = 0; i < variant.spokes; i++) {
    out.push(...variant.arm((i / variant.spokes) * Math.PI * 2))
  }
  return out
}

const stationCache: (BufferGeometry | undefined)[] = []

/** Геометрия станции выбранного варианта (0 — классическая шестиспицевая). Кэш по варианту. */
export function stationGeometry(variant = 0): BufferGeometry {
  const def = STATION_VARIANTS[variant] ?? STATION_VARIANTS[0]!
  return (stationCache[variant] ??= buildGeometry(station(def)))
}

// ─── Станция «Солнечный веер»: восьмигранная бочка + 8 лучей-панелей ──────────
// Другой силуэт, не тор: восьмигранный барабан по центру, от него 8 длинных плоских
// солнечных панелей веером. Детализация на уровне кориолиса (гранёно, покраска по
// вершинам). Ось барабана и вращения — Z, панели лежат в XY: крутится пропеллером,
// а с оси (откуда и прибываешь) виден весь веер — как на референсе.

/** Восьмигранный барабан в три пояса: тёмный низ, светящаяся полоса окон, гранёный купол. */
function solarDrum(): Triangle[] {
  const out: Triangle[] = []
  const sides = 8
  const R = 0.34
  const rCap = 0.2
  const zBot = -0.16
  const zA = -0.02 // верх нижнего пояса
  const zB = 0.08 // верх полосы окон = основание купола
  const zCap = 0.22
  const oct = (radius: number, z: number): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides
      return [Math.cos(a) * radius, Math.sin(a) * radius, z] as Vec3
    })
  const bot = oct(R, zBot)
  const a = oct(R, zA)
  const b = oct(R, zB)
  const cap = oct(rCap, zCap)
  const apex: Vec3 = [0, 0, zCap + 0.03]
  const floor: Vec3 = [0, 0, zBot - 0.03]

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    out.push(...quad(bot[i]!, bot[j]!, a[j]!, a[i]!, i % 2 ? STATION : STATION_DARK)) // нижний пояс
    out.push(...quad(a[i]!, a[j]!, b[j]!, b[i]!, i % 2 === 0 ? STATION_LIT : STATION_TRIM)) // окна
    out.push(...quad(b[i]!, b[j]!, cap[j]!, cap[i]!, STATION_TRIM)) // купол
    out.push(tri(apex, cap[i]!, cap[j]!, STATION)) // крышка купола
    out.push(tri(floor, bot[j]!, bot[i]!, STATION_DARK)) // дно
  }
  return out
}

/** Один луч-панель: плоская солнечная панель + рама + законцовка + ферма-спина снизу. */
function solarArm(angle: number): Triangle[] {
  const out: Triangle[] = []
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const at = (r: number, across: number, z: number): Vec3 => [c * r - s * across, s * r + c * across, z]
  const r0 = 0.3
  const r1 = 1.0
  const hw = 0.1 // полуширина панели
  const ht = 0.012 // полутолщина

  const panel: Vec3[] = [
    at(r0, -hw, -ht), at(r0, hw, -ht), at(r0, hw, ht), at(r0, -hw, ht),
    at(r1, -hw, -ht), at(r1, hw, -ht), at(r1, hw, ht), at(r1, -hw, ht),
  ]
  const p = (i: number): Vec3 => panel[i]!
  out.push(
    ...quad(p(3), p(2), p(6), p(7), STATION_DARK), // лицо панели (ячейки)
    ...quad(p(0), p(1), p(5), p(4), STATION_DARK), // тыл панели
    ...quad(p(0), p(1), p(2), p(3), STATION_TRIM), // рама у корня
    ...quad(p(4), p(5), p(6), p(7), STATION_TRIM), // рама у конца
    ...quad(p(0), p(4), p(7), p(3), STATION_TRIM), // рама-ребро
    ...quad(p(1), p(5), p(6), p(2), STATION_TRIM), // рама-ребро
  )

  // Законцовка — светлый брусок на конце (как на референсе).
  const cw = hw * 1.15
  const cz = ht * 2.4
  const end: Vec3[] = [
    at(r1, -cw, -cz), at(r1, cw, -cz), at(r1, cw, cz), at(r1, -cw, cz),
    at(r1 + 0.06, -cw, -cz), at(r1 + 0.06, cw, -cz), at(r1 + 0.06, cw, cz), at(r1 + 0.06, -cw, cz),
  ]
  const e = (i: number): Vec3 => end[i]!
  out.push(
    ...quad(e(4), e(5), e(6), e(7), STATION), // торец
    ...quad(e(3), e(2), e(6), e(7), STATION), // верх
    ...quad(e(0), e(1), e(5), e(4), STATION), // низ
    ...quad(e(0), e(4), e(7), e(3), STATION_TRIM),
    ...quad(e(1), e(5), e(6), e(2), STATION_TRIM),
  )

  // Ферма-спина под панелью: тонкий брус вдоль радиуса — структура, как в референсе.
  const tw = 0.02
  const spine: Vec3[] = [
    at(r0, -tw, -ht), at(r0, tw, -ht), at(r0, tw, -ht - 0.05), at(r0, -tw, -ht - 0.05),
    at(r1, -tw, -ht), at(r1, tw, -ht), at(r1, tw, -ht - 0.05), at(r1, -tw, -ht - 0.05),
  ]
  const u = (i: number): Vec3 => spine[i]!
  out.push(
    ...quad(u(0), u(4), u(7), u(3), STATION_DARK),
    ...quad(u(1), u(5), u(6), u(2), STATION_DARK),
    ...quad(u(3), u(7), u(6), u(2), STATION_TRIM),
  )
  return out
}

let solarCache: BufferGeometry | null = null

/** Станция «Солнечный веер»: восьмигранная бочка и 8 лучей-панелей. Кэш — один раз. */
export function solarStationGeometry(): BufferGeometry {
  if (!solarCache) {
    const tris = [...solarDrum()]
    for (let i = 0; i < 8; i++) tris.push(...solarArm((i / 8) * Math.PI * 2))
    solarCache = buildGeometry(tris)
  }
  return solarCache
}

// ─── Станция «Крест»: трёхмерный крест из балок ──────────────────────────────
// Высокий вертикальный шпиль (ось Z, длиннее книзу) и горизонтальные балки крестом
// в XY. Гранёные боксы, покраска по вершинам — детализация как у прочих станций.

/** Прямоугольный брус из центра и полуразмеров. DoubleSide, поэтому обход не важен. */
function box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, face: number, trim: number): Triangle[] {
  const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz
  const v: Vec3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  const g = (i: number): Vec3 => v[i]!
  return [
    ...quad(g(4), g(5), g(6), g(7), face), // +z
    ...quad(g(0), g(1), g(2), g(3), face), // −z
    ...quad(g(0), g(1), g(5), g(4), trim), // −y
    ...quad(g(3), g(2), g(6), g(7), trim), // +y
    ...quad(g(0), g(4), g(7), g(3), face), // −x
    ...quad(g(1), g(5), g(6), g(2), face), // +x
  ]
}

/**
 * Цвет луча: гаснет к концу (t→1) и к нулю по яркости `mul`; `white` уводит к белу.
 * ГОЛУБОЙ: синий во всю, зелёный средний, красный низкий — холодное плотное свечение.
 * Аддитив — чёрный ничего не прибавляет, поэтому таящий к 0 конец растворяется в пустоте.
 */
function beamHex(t: number, mul: number, white: number): number {
  const f = Math.max(0, 1 - t) * mul
  const r = Math.min(255, Math.round((0x28 + (0xff - 0x28) * white) * f))
  const g = Math.min(255, Math.round((0xa8 + (0xff - 0xa8) * white) * f))
  const b = Math.min(255, Math.round(0xff * f))
  return (r << 16) | (g << 8) | b
}

/** Одна плоская лента-слой шафта (две перпендикулярные грани), сужается к концу. */
function shaftLayer(tip: Vec3, a: Vec3, b: Vec3, dir: Vec3, len: number, hw: number, mul: number, white: number): Triangle[] {
  const out: Triangle[] = []
  const at = (t: number, ax: Vec3, w: number): Vec3 => [
    tip[0] + dir[0] * len * t + ax[0] * w,
    tip[1] + dir[1] * len * t + ax[1] * w,
    tip[2] + dir[2] * len * t + ax[2] * w,
  ]
  const SEG = 6
  for (let s = 0; s < SEG; s++) {
    const t0 = s / SEG
    const t1 = (s + 1) / SEG
    const w0 = hw * (1 - t0)
    const w1 = hw * (1 - t1)
    const col = beamHex((t0 + t1) / 2, mul, white)
    for (const ax of [a, b]) {
      out.push(...quad(at(t0, ax, -w0), at(t0, ax, w0), at(t1, ax, w1), at(t1, ax, -w1), col))
    }
  }
  return out
}

/**
 * ЛУЧ СВЕТА из конца креста — не сплошной кол, а свечение. Плоский цвет на аддитивной ленте
 * даёт равномерно яркую полосу с жёсткими краями (та самая «свая»); поэтому шафт собран из
 * ВЛОЖЕННЫХ слоёв: тонкий добела раскалённый КЕРН, пошире тусклее ТЕЛО и широкий еле заметный
 * ОРЕОЛ. Аддитивно они складываются в горячую нить с мягко тающими к бокам флангами — луч
 * света, а не брус. Все три сужаются к концу и гаснут к нулю: кончик растворяется.
 */
function crossRay(tip: Vec3, dir: Vec3, len: number, hw: number): Triangle[] {
  const d = dir
  // Две оси, перпендикулярные лучу (крест-сечение шафта — виден с любого угла).
  const ref: Vec3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
  const cross3 = (u: Vec3, v: Vec3): Vec3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const nrm = (v: Vec3): Vec3 => {
    const m = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / m, v[1] / m, v[2] / m]
  }
  const a = nrm(cross3(d, ref))
  const b = nrm(cross3(d, a))
  // ПЛОТНО, не рассеянно: узкий ореол и яркие тело/керн — тугой голубой пучок, не облако.
  return [
    ...shaftLayer(tip, a, b, d, len, hw * 0.6, 0.5, 0.0), // ореол: узкий, поярче
    ...shaftLayer(tip, a, b, d, len, hw * 0.3, 0.85, 0.25), // тело: плотное, насыщенное
    ...shaftLayer(tip, a, b, d, len, hw * 0.11, 1.0, 0.85), // керн: тонкий, добела-голубой
  ]
}

let raysCache: BufferGeometry | null = null

/** Лучи из ШЕСТИ концов креста наружу, симметрично по осям. Аддитивный crossRayMaterial их зажигает. */
export function crossRaysGeometry(): BufferGeometry {
  if (!raysCache) {
    const end = 0.9 // конец балки (= L в crossStationGeometry): луч стартует ровно из иллюминатора
    const L = 3.4 // длина луча — уходит ДАЛЕКО от станции
    const HW = 0.1 // потолще — жирный пучок из каждого конца
    const tris: Triangle[] = [
      ...crossRay([0, 0, end], [0, 0, 1], L, HW),
      ...crossRay([0, 0, -end], [0, 0, -1], L, HW),
      ...crossRay([end, 0, 0], [1, 0, 0], L, HW),
      ...crossRay([-end, 0, 0], [-1, 0, 0], L, HW),
      ...crossRay([0, end, 0], [0, 1, 0], L, HW),
      ...crossRay([0, -end, 0], [0, -1, 0], L, HW),
    ]
    raysCache = buildGeometry(tris)
  }
  return raysCache
}

let crossCache: BufferGeometry | null = null

/**
 * Станция-крест «Вечность»: ТРЁХМЕРНЫЙ крест — три ОДИНАКОВЫЕ балки вдоль X, Y и Z,
 * пересечённые в центре под прямым углом. Не плоский четырёхлопастный крест, а объёмная
 * звезда-ось: шесть равных концов, симметрия по всем трём осям. Узел на пересечении —
 * утолщённый куб, на каждом конце — светящийся иллюминатор.
 */
export function crossStationGeometry(): BufferGeometry {
  if (!crossCache) {
    const L = 0.9 // полудлина балки от центра до конца
    const hw = 0.08 // полутолщина балки (квадратное сечение)
    const lit = 0.05 // полуразмер иллюминатора на конце
    const tris: Triangle[] = [
      // Три взаимно перпендикулярные балки одной длины и сечения — крест по осям X/Y/Z.
      ...box(0, 0, 0, L, hw, hw, STATION, STATION_TRIM),
      ...box(0, 0, 0, hw, L, hw, STATION, STATION_TRIM),
      ...box(0, 0, 0, hw, hw, L, STATION, STATION_TRIM),
      // Центральный КУБ, в который воткнуты все три балки — заметный узел на пересечении.
      ...box(0, 0, 0, 0.18, 0.18, 0.18, STATION_DARK, STATION_TRIM),
      // Светящийся иллюминатор на каждом из шести концов.
      ...box(L, 0, 0, 0.03, lit, lit, STATION_LIT, STATION_LIT),
      ...box(-L, 0, 0, 0.03, lit, lit, STATION_LIT, STATION_LIT),
      ...box(0, L, 0, lit, 0.03, lit, STATION_LIT, STATION_LIT),
      ...box(0, -L, 0, lit, 0.03, lit, STATION_LIT, STATION_LIT),
      ...box(0, 0, L, lit, lit, 0.03, STATION_LIT, STATION_LIT),
      ...box(0, 0, -L, lit, lit, 0.03, STATION_LIT, STATION_LIT),
    ]
    crossCache = buildGeometry(tris)
  }
  return crossCache
}

// ─── Грузовой контейнер ──────────────────────────────────────────────────────

let podCache: BufferGeometry | null = null

/** Обычный ящик: он и должен читаться как ящик. */
export function podGeometry(): BufferGeometry {
  podCache ??= new BoxGeometry(2.4, 2.4, 3.4)
  return podCache
}


let boltCache: BufferGeometry | null = null

/**
 * Болт лазера: цилиндр единичной длины, лежащий вдоль −Z, без крышек.
 *
 * Единичный — потому что длину задаёт масштаб инстанса: трасса каждый кадр разной
 * длины, а геометрия обязана создаваться один раз. Шесть граней: болт тонкий,
 * круглым он не выглядит ни при каком числе сегментов.
 */
export function boltGeometry(): BufferGeometry {
  boltCache ??= new CylinderGeometry(1, 1, 1, 6, 1, true).rotateX(Math.PI / 2)
  return boltCache
}

let ringCache: BufferGeometry | null = null

/**
 * Направляющее кольцо стыковочного коридора: тор единичного радиуса, ось +Z.
 *
 * Обод гранёный намеренно (четыре сегмента трубы): вблизи он читается как
 * металлический профиль, а не как резиновый шланг, и стоит вчетверо дешевле.
 */
export function corridorRingGeometry(): BufferGeometry {
  ringCache ??= new TorusGeometry(1, CORRIDOR.TUBE, 4, 24)
  return ringCache
}
