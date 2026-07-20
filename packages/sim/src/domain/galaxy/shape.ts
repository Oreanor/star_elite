import {
  CORE_INDEX,
  GALAXY,
  GALAXY_SHAPES,
  HOME_SHAPE,
  SHAPE,
  type GalaxyShapeId,
  type StarClassId,
} from '../../config/galaxy'
import { WORLD } from '../../config/world'
import { makeRng, type Rng } from '../../core/math'
import { primaryClassId, voidLyOf } from './starClass'

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
 * Точка рукава — ЛОГАРИФМИЧЕСКАЯ спираль. Плотность равномерна по площади (`r = √t`),
 * поэтому центр не оказывается пустым, а край — переполненным.
 *
 * ПОЧЕМУ ЛОГАРИФМИЧЕСКАЯ, а не архимедова (θ ∝ r), как было раньше.
 *
 * У архимедовой спирали `dθ/dr` постоянна, значит у основания тангенциальная составляющая шага
 * (`r·dθ`) исчезающе мала против радиальной: рукав выходит из ядра СПИЦЕЙ, радиально. Именно это
 * и было видно на карте. У логарифмической `θ ∝ ln r`, поэтому `r·dθ/dr` постоянно — угол между
 * рукавом и радиусом (pitch) ОДИН И ТОТ ЖЕ на любом радиусе. Оттого ветвь отходит от ядра по
 * касательной и вьётся с неизменным наклоном — так и устроены настоящие спирали.
 *
 * Полный размах (`sweep`) остаётся тем же числом из конфига: из него выводится наклон, а не
 * наоборот, — `θ(1) − θ(inner) = sweep` по построению. Крутизну правят прежней ручкой.
 *
 * @param inner Откуда рукав начинается (у перемычки — с её конца, не из центра).
 */
function arm(rng: Rng, t: number, arms: number, sweep: number, inner: number): Spot {
  const r = inner + (1 - inner) * Math.sqrt(t)
  const which = Math.floor(rng() * arms)
  // ln(r/inner)/ln(1/inner) — доля намотки: 0 у основания, 1 у края. Наклон постоянен.
  const wind = Math.log(r / inner) / Math.log(1 / inner)
  const theta = (which * Math.PI * 2) / arms + sweep * wind

  /**
   * Рукав РАСШИРЯЕТСЯ и РАССЕИВАЕТСЯ к краю: у основания туго свит, на периферии рвётся и тает
   * в диске. Ширина растёт линейно, а разброс ПО УГЛУ — квадратично: именно он съедает рисунок
   * ветви, превращая её из чёткой дуги в поток. Без него рукав дугой доходил до самого обода.
   */
  const grown = (r - inner) / (1 - inner)
  const widen = 0.25 + 1.5 * grown
  const spread = SHAPE.SPIRAL_SPREAD * widen
  const th = theta + gauss(rng) * SHAPE.SPIRAL_SMEAR * widen * widen

  return {
    x: r * Math.cos(th) + gauss(rng) * spread,
    y: r * Math.sin(th) + gauss(rng) * spread,
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
export function galaxyShape(seed: number): (typeof GALAXY_SHAPES)[number] {
  /**
   * Форма ДОМАШНЕЙ галактики — решение, а не бросок (см. `HOME_SHAPE`). Override держим ровно
   * на зерне по умолчанию: чужая галактика (куст, когда до него дойдёт) обязана бросать СВОЮ
   * форму из таблицы. Иначе лотерея выродилась бы во всех, и весь куст стал бы спиральным.
   */
  if (HOME_SHAPE && seed === GALAXY.SEED) {
    const forced = GALAXY_SHAPES.find((s) => s.id === HOME_SHAPE)
    if (forced) return forced
  }
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
 * Базовое место по форме диска — БЕЗ пустот гигантов. Поток бросков СВОЙ, не общий
 * с `generateSystem`: иначе рукава расцветились бы по спектру самой звезды.
 * Гиганты остаются здесь; соседей сдвигает `placeSystem`.
 */
export function placeSystemRaw(index: number, seed: number): Spot3 {
  // Чёрная дыра сидит ровно в центре. Это не звезда, ей не нужен бросок кости.
  if (index === CORE_INDEX) return { x: 0, y: 0, z: 0 }

  const rng = makeRng(seed ^ Math.imul(index, 0x9e3779b1) ^ 0x7f4a7c15)
  const place = placerFor(galaxyShape(seed).id, seed)

  // Доля вдоль «очереди» систем. Формы читают её как радиальную координату:
  // первые индексы садятся в ядро, последние — на периферию.
  const u = (index + 0.5) / GALAXY.COUNT
  const spot = place(u, rng)

  const R = GALAXY.RADIUS_LY
  return { x: spot.x * R, y: spot.y * R, z: spot.z * R }
}

/** Кэш вытеснения: одно зерно — один проход по 2500 систем. */
let _voidCache: { seed: number; pos: Spot3[] } | null = null

/**
 * Положение после вырезания пустот вокруг O/B. Прыжки, карта и слой галактики
 * читают одно и то же — иначе аим уедет от точки на локаторе.
 */
function carvedPositions(seed: number): Spot3[] {
  if (_voidCache?.seed === seed) return _voidCache.pos

  const count = GALAXY.COUNT
  const pos: Spot3[] = new Array(count)
  for (let i = 0; i < count; i++) pos[i] = placeSystemRaw(i, seed)

  const giants: { i: number; voidLy: number }[] = []
  for (let i = 0; i < count; i++) {
    const voidLy = voidLyOf(primaryClassId(i, seed))
    if (voidLy > 0) giants.push({ i, voidLy })
  }

  // Не двигаем: ядро, общий спавн и сами гиганты (иначе пузыри поползут друг в друга).
  const fixed = new Set<number>([CORE_INDEX, ...giants.map((g) => g.i)])
  if (seed === GALAXY.SEED) fixed.add(WORLD.SHARED_START_INDEX)

  // Несколько проходов: вытолкнутый из одного пузыря может оказаться в другом.
  for (let pass = 0; pass < 5; pass++) {
    for (const g of giants) {
      const gp = pos[g.i]!
      for (let j = 0; j < count; j++) {
        if (fixed.has(j)) continue
        const p = pos[j]!
        let dx = p.x - gp.x
        let dy = p.y - gp.y
        let dz = p.z - gp.z
        let d = Math.hypot(dx, dy, dz)
        if (d >= g.voidLy) continue
        if (d < 1e-12) {
          // Совпали в точке — толкаем по оси, детерминированно.
          dx = 1
          dy = 0
          dz = 0
          d = 1
        }
        const s = g.voidLy / d
        pos[j] = { x: gp.x + dx * s, y: gp.y + dy * s, z: gp.z + dz * s }
      }
    }
  }

  _voidCache = { seed, pos }
  return pos
}

/**
 * Положение системы по индексу: форма диска + пустоты вокруг гигантов (voidLy в
 * STAR_CLASSES). Выводимо из зерна — generateSystem / прыжок / карта совпадают.
 */
export function placeSystem(index: number, seed: number): Spot3 {
  if (index === CORE_INDEX) return { x: 0, y: 0, z: 0 }
  return carvedPositions(seed)[index]!
}

/** Есть ли у класса пустота (для тестов и UI). */
export function hasGiantVoid(classId: StarClassId): boolean {
  return voidLyOf(classId) > 0
}

/** Евклидово расстояние, св. годы. Диск не заворачивается — метрика прямая. */
export function distanceLy(a: Spot3, b: Spot3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}
