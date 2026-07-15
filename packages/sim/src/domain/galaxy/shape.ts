import {
  CORE_INDEX,
  GALAXY,
  GALAXY_SHAPES,
  LUCIFER,
  SHAPE,
  type GalaxyShapeId,
} from '../../config/galaxy'
import { makeRng, type Rng } from '../../core/math'

/**
 * Где стоит звезда. Форма галактики — ДАННЫЕ: каждая запись знает только,
 * как разложить долю `u` (0..1) по диску. Новая форма — новая запись в таблице,
 * а не ветвление в генераторе.
 *
 * Координаты возвращаются в ДОЛЯХ радиуса диска, центр в нуле. Масштаб и толщину
 * накладывает `placeSystem`: иначе каждая форма считала бы световые годы заново.
 *
 * Диск объёмный, но плоский по существу: полутолщина у края вчетверо меньше
 * рукава, а ядро вспухает (`BULGE_PUFF`). Настоящие галактики — блины,
 * и карта обязана это показывать при повороте.
 */

/** Нормальное распределение из равномерного (Бокс–Мюллер). Съедает два броска. */
function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** Точка в ДОЛЯХ радиуса диска, все три координаты. Центр — чёрная дыра. */
interface Spot {
  x: number
  y: number
  z: number
}

/** Полутолщина диска в долях радиуса. Отношение 1:25 — примерно как у настоящих. */
const T = GALAXY.THICKNESS_LY / GALAXY.RADIUS_LY

/**
 * Толщина диска. Звезда отклоняется от плоскости нормально, а не равномерно:
 * у настоящего диска нет резкой границы, есть падение плотности.
 */
function discZ(rng: Rng, puff = 1): number {
  return gauss(rng) * T * puff
}

/** Равномерное направление на сфере. Иначе полюса «шара» окажутся плотнее экватора. */
function onSphere(rng: Rng): Spot {
  const z = rng() * 2 - 1
  const a = rng() * Math.PI * 2
  const s = Math.sqrt(1 - z * z)
  return { x: s * Math.cos(a), y: s * Math.sin(a), z }
}

/** Ядро: шаровое скопление. Куб. корень даёт равномерность ПО ОБЪЁМУ, а не по радиусу. */
function bulge(rng: Rng, radius: number = SHAPE.BULGE_RADIUS): Spot {
  const r = radius * Math.cbrt(rng())
  const d = onSphere(rng)
  // Слегка приплюснуто: ядро вращается вместе с диском.
  return { x: r * d.x, y: r * d.y, z: r * d.z * SHAPE.BULGE_SQUASH }
}

/**
 * Точка рукава. Плотность равномерна по площади (`r = √t`), поэтому центр
 * не оказывается пустым, а край — переполненным.
 *
 * @param inner Откуда рукав начинается (у перемычки — с её конца, не из центра).
 */
function arm(rng: Rng, t: number, arms: number, sweep: number, inner: number): Spot {
  const r = inner + (1 - inner) * Math.sqrt(t)
  const which = Math.floor(rng() * arms)
  const theta = (which * Math.PI * 2) / arms + sweep * ((r - inner) / (1 - inner))

  // Рукав распушается к краю: у основания он туго свит, на периферии рвётся.
  const spread = SHAPE.SPIRAL_SPREAD * (0.35 + 0.65 * r)
  return {
    x: r * Math.cos(theta) + gauss(rng) * spread,
    y: r * Math.sin(theta) + gauss(rng) * spread,
    z: discZ(rng),
  }
}

function spiral(u: number, rng: Rng): Spot {
  if (u < SHAPE.BULGE_FRACTION) return bulge(rng)
  const t = (u - SHAPE.BULGE_FRACTION) / (1 - SHAPE.BULGE_FRACTION)
  return arm(rng, t, SHAPE.SPIRAL_ARMS, SHAPE.SPIRAL_SWEEP, 0.04)
}

/**
 * Спираль с перемычкой. Рукавов два, и растут они не из центра, а с концов бара —
 * потому и закручены круче. Такова наша Галактика.
 */
function barred(u: number, rng: Rng): Spot {
  if (u < SHAPE.BAR_FRACTION) {
    const along = (rng() * 2 - 1) * SHAPE.BAR_LENGTH
    return { x: along, y: gauss(rng) * SHAPE.BAR_WIDTH, z: discZ(rng, 1.8) }
  }
  if (u < SHAPE.BAR_FRACTION + SHAPE.BULGE_FRACTION) return bulge(rng)

  const t = (u - SHAPE.BAR_FRACTION - SHAPE.BULGE_FRACTION) / (1 - SHAPE.BAR_FRACTION - SHAPE.BULGE_FRACTION)
  return arm(rng, t, SHAPE.BARRED_ARMS, SHAPE.BARRED_SWEEP, SHAPE.BAR_LENGTH)
}

/**
 * Эллиптическая: гладкий сфероид, рукавов нет, звёзды старые.
 *
 * Это НЕ диск: толщина сравнима с шириной, поэтому `z` берётся из того же
 * радиуса, что `x` и `y`, а не из толщины диска. Сплюснутость — по оси z (E4).
 */
function elliptical(_u: number, rng: Rng): Spot {
  const r = Math.pow(rng(), 1 / SHAPE.ELLIPTIC_CONCENTRATION)
  const d = onSphere(rng)
  return { x: r * d.x, y: r * d.y * SHAPE.ELLIPTIC_MID, z: r * d.z * SHAPE.ELLIPTIC_FLATTEN }
}

/** Линзовидная: диск есть, рукава уже рассосались. Плотность падает экспоненциально. */
function lenticular(u: number, rng: Rng): Spot {
  if (u < SHAPE.BULGE_FRACTION) return bulge(rng)
  const r = Math.min(1, -Math.log(Math.max(rng(), 1e-9)) * SHAPE.LENTICULAR_FALLOFF)
  const a = rng() * Math.PI * 2
  return { x: r * Math.cos(a), y: r * Math.sin(a), z: discZ(rng) }
}

/** Кольцевая (галактика Хога): ядро и кольцо, а между ними пустота. */
function ring(u: number, rng: Rng): Spot {
  if (u < SHAPE.RING_CORE_FRACTION) return bulge(rng, SHAPE.BULGE_RADIUS * 0.7)
  const r = SHAPE.RING_RADIUS + gauss(rng) * SHAPE.RING_WIDTH
  const a = rng() * Math.PI * 2
  return { x: r * Math.cos(a), y: r * Math.sin(a), z: discZ(rng, 1.5) }
}

/**
 * Неправильная: клочья без симметрии, как Магеллановы Облака.
 *
 * Центры клочьев обязаны быть общими для всей галактики, а `rng` здесь —
 * персональный для одной системы. Поэтому они выводятся из зерна ГАЛАКТИКИ.
 */
function irregular(seed: number) {
  const clumpRng = makeRng(seed ^ 0x51ed270b)
  const clumps = Array.from({ length: SHAPE.IRREGULAR_CLUMPS }, () => {
    const r = 0.75 * Math.sqrt(clumpRng())
    const a = clumpRng() * Math.PI * 2
    return { x: r * Math.cos(a), y: r * Math.sin(a) }
  })

  return (_u: number, rng: Rng): Spot => {
    const c = clumps[Math.floor(rng() * clumps.length)] ?? { x: 0, y: 0 }
    return {
      x: c.x + gauss(rng) * SHAPE.IRREGULAR_SPREAD,
      y: c.y + gauss(rng) * SHAPE.IRREGULAR_SPREAD,
      // Клочковатая: плоскости у неё толком нет, но и шаром она не стала.
      z: gauss(rng) * SHAPE.IRREGULAR_SPREAD * 0.45,
    }
  }
}

type Placer = (u: number, rng: Rng) => Spot

function placerFor(id: GalaxyShapeId, seed: number): Placer {
  switch (id) {
    case 'spiral': return spiral
    case 'barred': return barred
    case 'elliptical': return elliptical
    case 'lenticular': return lenticular
    case 'ring': return ring
    case 'irregular': return irregular(seed)
  }
}

/** Форма галактики выводится из её зерна. Другое зерно — другая галактика по Хабблу. */
export function galaxyShape(seed: number = GALAXY.SEED): (typeof GALAXY_SHAPES)[number] {
  const rng = makeRng(seed ^ 0x2545f491)
  let total = 0
  for (const s of GALAXY_SHAPES) total += s.weight
  let roll = rng() * total
  for (const s of GALAXY_SHAPES) {
    roll -= s.weight
    if (roll <= 0) return s
  }
  return GALAXY_SHAPES[0]
}

export interface Spot3 {
  /** Световые годы от центра галактики. Центр — чёрная дыра. */
  x: number
  y: number
  z: number
}

/**
 * Положение системы по её индексу. Зерно системы то же, что у `generateSystem`:
 * координаты и содержимое обязаны быть выводимы из одного индекса, иначе
 * галактику нельзя будет строить по требованию.
 */
export function placeSystem(index: number, seed: number = GALAXY.SEED): Spot3 {
  // Чёрная дыра сидит ровно в центре. Это не звезда, ей не нужен бросок кости.
  if (index === CORE_INDEX) return { x: 0, y: 0, z: 0 }
  // Люцифер висит в пустоте над диском, руками — не по броску (см. LUCIFER.POS).
  if (index === LUCIFER.INDEX) return { x: LUCIFER.POS[0], y: LUCIFER.POS[1], z: LUCIFER.POS[2] }

  // Поток бросков СВОЙ, не общий с `generateSystem`. Общий связал бы место звезды
  // с её классом: рукава расцветились бы по спектру, и это было бы видно.
  const rng = makeRng(seed ^ Math.imul(index, 0x9e3779b1) ^ 0x7f4a7c15)
  const place = placerFor(galaxyShape(seed).id, seed)

  // Доля вдоль «очереди» систем. Формы читают её как радиальную координату:
  // первые индексы садятся в ядро, последние — на периферию.
  const u = (index + 0.5) / GALAXY.COUNT
  const spot = place(u, rng)

  const R = GALAXY.RADIUS_LY
  return { x: spot.x * R, y: spot.y * R, z: spot.z * R }
}

/** Евклидово расстояние, св. годы. Диск не заворачивается — метрика прямая. */
export function distanceLy(a: Spot3, b: Spot3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}
