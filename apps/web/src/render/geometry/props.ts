import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  EdgesGeometry,
  TorusGeometry,
} from 'three'
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

let crossWireCache: BufferGeometry | null = null

/**
 * Каркас креста: рёбра объёмной геометрии. Рендер — LineSegments + аддитивный голубой.
 * Порог угла отсекает швы внутри одной грани, оставляя силуэт балок.
 */
export function crossWireGeometry(): BufferGeometry {
  crossWireCache ??= new EdgesGeometry(crossStationGeometry(), 20)
  return crossWireCache
}

let crossPortalPanelsCache: BufferGeometry | null = null

/**
 * Окна-маски Крестов: плоские панели на гранях балок, чуть ВЫНЕСЕННЫЕ наружу
 * (чтобы не z-fight'ить с чёрным корпусом при лог-глубине) и чуть УЖАТЫЕ от рёбер
 * (неон читается рамкой). Сюда кладётся шейдер чужого скайбокса.
 */
export function crossPortalPanelsGeometry(): BufferGeometry {
  if (crossPortalPanelsCache) return crossPortalPanelsCache
  const L = 0.9
  const hw = 0.08
  const o = 0.006 // вынос наружу
  const inset = 0.014 // поле под неоновую «рамку»
  const C = 0xffffff
  const tris: Triangle[] = []

  // Балка X: длинные грани ±Y / ±Z и торцы ±X.
  {
    const x0 = -L + inset
    const x1 = L - inset
    const y = hw + o
    const zs = hw - inset
    tris.push(
      ...quad([x0, y, -zs], [x1, y, -zs], [x1, y, zs], [x0, y, zs], C),
      ...quad([x0, -y, zs], [x1, -y, zs], [x1, -y, -zs], [x0, -y, -zs], C),
    )
    const z = hw + o
    const ys = hw - inset
    tris.push(
      ...quad([x0, -ys, z], [x1, -ys, z], [x1, ys, z], [x0, ys, z], C),
      ...quad([x0, ys, -z], [x1, ys, -z], [x1, -ys, -z], [x0, -ys, -z], C),
    )
    const e = L + o
    const s = hw - inset
    tris.push(
      ...quad([e, -s, -s], [e, s, -s], [e, s, s], [e, -s, s], C),
      ...quad([-e, -s, s], [-e, s, s], [-e, s, -s], [-e, -s, -s], C),
    )
  }

  // Балка Y: длинные ±X / ±Z и торцы ±Y.
  {
    const y0 = -L + inset
    const y1 = L - inset
    const x = hw + o
    const zs = hw - inset
    tris.push(
      ...quad([x, y0, zs], [x, y1, zs], [x, y1, -zs], [x, y0, -zs], C),
      ...quad([-x, y0, -zs], [-x, y1, -zs], [-x, y1, zs], [-x, y0, zs], C),
    )
    const z = hw + o
    const xs = hw - inset
    tris.push(
      ...quad([-xs, y0, z], [xs, y0, z], [xs, y1, z], [-xs, y1, z], C),
      ...quad([xs, y0, -z], [-xs, y0, -z], [-xs, y1, -z], [xs, y1, -z], C),
    )
    const e = L + o
    const s = hw - inset
    tris.push(
      ...quad([-s, e, -s], [-s, e, s], [s, e, s], [s, e, -s], C),
      ...quad([-s, -e, s], [-s, -e, -s], [s, -e, -s], [s, -e, s], C),
    )
  }

  // Балка Z: длинные ±X / ±Y и торцы ±Z.
  {
    const z0 = -L + inset
    const z1 = L - inset
    const x = hw + o
    const ys = hw - inset
    tris.push(
      ...quad([x, -ys, z0], [x, ys, z0], [x, ys, z1], [x, -ys, z1], C),
      ...quad([-x, ys, z0], [-x, -ys, z0], [-x, -ys, z1], [-x, ys, z1], C),
    )
    const y = hw + o
    const xs = hw - inset
    tris.push(
      ...quad([-xs, y, z0], [xs, y, z0], [xs, y, z1], [-xs, y, z1], C),
      ...quad([xs, -y, z0], [-xs, -y, z0], [-xs, -y, z1], [xs, -y, z1], C),
    )
    const e = L + o
    const s = hw - inset
    tris.push(
      ...quad([-s, -s, e], [s, -s, e], [s, s, e], [-s, s, e], C),
      ...quad([s, -s, -e], [-s, -s, -e], [-s, s, -e], [s, s, -e], C),
    )
  }

  crossPortalPanelsCache = buildGeometry(tris)
  return crossPortalPanelsCache
}

let crossNeonTubesCache: BufferGeometry | null = null

/**
 * Неоновые лампы по рёбрам: тонкие ленты с UV (x = поперёк −1..1, y = вдоль 0..1).
 * Аддитивный шейдер гасит к краю — светят линии, не грани.
 */
export function crossNeonTubesGeometry(): BufferGeometry {
  if (crossNeonTubesCache) return crossNeonTubesCache
  const edges = crossWireGeometry()
  const ep = edges.getAttribute('position')
  const hw = 0.014 // полуширина лампы в единичной геометрии
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let v = 0
  for (let i = 0; i + 1 < ep.count; i += 2) {
    const ax = ep.getX(i)
    const ay = ep.getY(i)
    const az = ep.getZ(i)
    const bx = ep.getX(i + 1)
    const by = ep.getY(i + 1)
    const bz = ep.getZ(i + 1)
    const dx = bx - ax
    const dy = by - ay
    const dz = bz - az
    const len = Math.hypot(dx, dy, dz) || 1
    // Две оси, перпендикулярные ребру — лента видна с любого ракурса.
    let rx = 0
    let ry = 1
    let rz = 0
    if (Math.abs(dy / len) > 0.9) {
      rx = 1
      ry = 0
    }
    let px = ry * dz - rz * dy
    let py = rz * dx - rx * dz
    let pz = rx * dy - ry * dx
    let pl = Math.hypot(px, py, pz) || 1
    px = (px / pl) * hw
    py = (py / pl) * hw
    pz = (pz / pl) * hw
    let qx = dy * pz - dz * py
    let qy = dz * px - dx * pz
    let qz = dx * py - dy * px
    const ql = Math.hypot(qx, qy, qz) || 1
    qx = (qx / ql) * hw
    qy = (qy / ql) * hw
    qz = (qz / ql) * hw

    // Две перекрёстные ленты (как + в сечении) — лампа круглая с любого угла.
    for (const [ox, oy, oz] of [
      [px, py, pz],
      [qx, qy, qz],
    ] as const) {
      const base = v
      positions.push(
        ax - ox, ay - oy, az - oz,
        ax + ox, ay + oy, az + oz,
        bx + ox, by + oy, bz + oz,
        bx - ox, by - oy, bz - oz,
      )
      uvs.push(-1, 0, 1, 0, 1, 1, -1, 1)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      v += 4
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  g.setIndex(indices)
  g.computeBoundingSphere()
  crossNeonTubesCache = g
  return g
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
