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
