import { BoxGeometry, CylinderGeometry, TorusGeometry, type BufferGeometry } from 'three'
import { CORRIDOR, PALETTE } from '../config'
import { buildGeometry, quad, symmetric, tri, type Triangle, type Vec3 } from './build'

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
const SPOKES = 6

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

/** Балка от ступицы к ободу. Прямоугольное сечение, развёрнутое на `angle` в XY. */
function spoke(angle: number, r0: number, r1: number, halfWidth: number, halfThick: number): Triangle[] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // Радиальная ось наружу, поперечная — по касательной, третья — вдоль Z.
  const at = (r: number, across: number, z: number): Vec3 => [c * r - s * across, s * r + c * across, z]

  const v: Vec3[] = [
    at(r0, -halfWidth, -halfThick), at(r0, halfWidth, -halfThick), at(r0, halfWidth, halfThick), at(r0, -halfWidth, halfThick),
    at(r1, -halfWidth, -halfThick), at(r1, halfWidth, -halfThick), at(r1, halfWidth, halfThick), at(r1, -halfWidth, halfThick),
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

function station(): Triangle[] {
  const out: Triangle[] = [...torus(RING_RADIUS, TUBE_RADIUS, 24, 8), ...hub()]

  for (let i = 0; i < SPOKES; i++) {
    const angle = (i / SPOKES) * Math.PI * 2
    out.push(...spoke(angle, HUB_RADIUS * 0.9, RING_RADIUS - TUBE_RADIUS * 0.4, 0.035, 0.03))
  }
  return out
}

let stationCache: BufferGeometry | null = null

export function stationGeometry(): BufferGeometry {
  stationCache ??= buildGeometry(station())
  return stationCache
}

// ─── Грузовой контейнер ──────────────────────────────────────────────────────

let podCache: BufferGeometry | null = null

/** Обычный ящик: он и должен читаться как ящик. */
export function podGeometry(): BufferGeometry {
  podCache ??= new BoxGeometry(2.4, 2.4, 3.4)
  return podCache
}

// ─── Рамка кабины ────────────────────────────────────────────────────────────

const FRAME = 0x1b2028

/** Только правый борт: `symmetric` достроит левый. */
const canopyHalf: Triangle[] = [
  ...quad([0.85, 0.75, -2.6], [1.15, 0.15, -2.2], [1.15, 0.15, 0.4], [0.85, 0.75, 0.2], FRAME),
]

/**
 * Детали по осевой линии зеркалить НЕЛЬЗЯ: они пересекают X=0, и отражение
 * ляжет поверх оригинала. Две совпадающие грани мерцают (z-fighting).
 */
const canopyCentre: Triangle[] = [
  // Нижняя панель приборов: перекрывает низ экрана, как настоящий козырёк.
  ...quad([-1.6, -0.62, -1.4], [1.6, -0.62, -1.4], [1.6, -0.35, 0.6], [-1.6, -0.35, 0.6], FRAME),
  // Верхняя перемычка.
  ...quad([-1.0, 0.86, -2.4], [1.0, 0.86, -2.4], [1.0, 0.78, -1.9], [-1.0, 0.78, -1.9], FRAME),
]

let cockpitCache: BufferGeometry | null = null

/**
 * Геометрия кабины, а не картинка: стойки честно закрывают обзор и смещаются
 * при вираже вместе с кораблём. Нарисованная рамка так не умеет.
 */
export function cockpitGeometry(): BufferGeometry {
  cockpitCache ??= buildGeometry([...symmetric(canopyHalf), ...canopyCentre])
  return cockpitCache
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
