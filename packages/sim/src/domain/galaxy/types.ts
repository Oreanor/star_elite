import type { DysonSpec } from '../../config/dyson'
import type {
  Economy,
  Government,
  PlanetType,
  SecurityLevel,
  StarClassId,
  StationType,
} from '../../config/galaxy'

/**
 * ВСЁ здесь — статические факты, выводимые из зерна. Одинаковы при каждом запуске,
 * не нуждаются в сохранении. Поэтому `readonly`.
 *
 * Изменяемое — цены, репутация, войны, кто кого убил — живёт в состоянии игры.
 * Смешаешь одно с другим, и генератор перестанет быть статичным.
 */

export interface Star {
  readonly class: StarClassId
  /** Человекочитаемый класс: «Жёлтый карлик». Не имя — имя у звезды общее с системой. */
  readonly className: string
  readonly color: number
  /** Радиус в игровых метрах — для 3D-сцены системы. */
  readonly radius: number
  /** Можно ли зачерпнуть топливо. Это и есть настоящая цена маршрута. */
  readonly scoopable: boolean
}

export interface Moon {
  readonly name: string
  readonly radius: number
  /** Радиус орбиты в РАДИУСАХ своей планеты. У настоящей Луны — около шестидесяти. */
  readonly orbit: number
}

/**
 * Кто и как живёт. Это свойство ПЛАНЕТЫ, а не системы: в одной системе
 * уживаются корпоративная столица и анархистская колония на ледяной луне,
 * и у каждой свой строй, своя экономика и своё население.
 */
export interface Settlement {
  readonly economy: Economy
  readonly government: Government
  /** 1..15. Определяет, какие модули продаются на здешней станции. */
  readonly techLevel: number
  /** Миллионы жителей. Задаёт глубину рынка. */
  readonly population: number
  /** Кто живёт: «Люди (колония)» или описание расы. */
  readonly species: string
}

/**
 * Станция висит на орбите ПЛАНЕТЫ, а не «в системе».
 * Подлетаешь ты всегда к миру, а не к абстрактной точке.
 */
export interface Station {
  readonly name: string
  readonly type: Exclude<StationType, 'Нет'>
  /** Высота орбиты над поверхностью, игровые метры. */
  readonly orbit: number
}

export interface Planet {
  readonly name: string
  readonly type: PlanetType
  readonly radius: number
  readonly moons: readonly Moon[]
  /** Радиус орбиты вокруг звезды, игровые метры. */
  readonly orbit: number

  /** null — мир необитаем. */
  readonly settlement: Settlement | null
  /** Где можно сесть. Пока — только у обитаемых миров. */
  readonly station: Station | null
}

export interface StarSystem {
  /** Индекс в сетке. Он же вход генератора: одно число задаёт систему целиком. */
  readonly index: number
  readonly name: string
  /**
   * Положение в галактике, световые годы. Начало координат — чёрная дыра в центре.
   * Диск объёмный: `z` мала против `x` и `y`, но не ноль.
   */
  readonly x: number
  readonly y: number
  readonly z: number

  readonly star: Star
  /**
   * Вторая звезда двойной, или `null` у одиночной. Бывает близнецом главной либо
   * спутником холоднее и мельче её (см. `makeCompanion`), но никогда не крупнее.
   * Позиции нет — обе кружат вокруг барицентра, и место каждой даёт время.
   */
  readonly companion: Star | null
  /**
   * Сфера Дайсона вокруг светила, или `null`, если её нет. Целую строят только на
   * вершине прогресса — знак высокой технологии; руины остаются от павшей.
   */
  readonly dyson: DysonSpec | null
  readonly planets: readonly Planet[]

  /**
   * Кого встретишь в космосе этой системы. Свойство пространства, а не мира:
   * порядок наводит тот, у кого флот, — то есть самое населённое поселение.
   * Шов между картой и боевым симулятором.
   */
  readonly security: SecurityLevel
}

// ─── Запросы ─────────────────────────────────────────────────────────────────

export type SettledPlanet = Planet & { settlement: Settlement }

export function isSettled(p: Planet): p is SettledPlanet {
  return p.settlement !== null
}

export function settledPlanets(s: StarSystem): SettledPlanet[] {
  return s.planets.filter(isSettled)
}

export function isInhabited(s: StarSystem): boolean {
  return s.planets.some(isSettled)
}

/** Главный мир системы — самый населённый. Он же задаёт её характер. */
export function capitalOf(s: StarSystem): SettledPlanet | null {
  let best: SettledPlanet | null = null
  for (const p of settledPlanets(s)) {
    if (!best || p.settlement.population > best.settlement.population) best = p
  }
  return best
}

export function totalPopulation(s: StarSystem): number {
  let total = 0
  for (const p of settledPlanets(s)) total += p.settlement.population
  return Math.round(total * 100) / 100
}

/**
 * Ступень жизни в системе — по САМОМУ развитому её миру. На карте важно не «сколько
 * тут людей», а «до чего они дошли»: анклав рудокопов и звёздная метрополия — разные
 * встречи. Отдельной оси «жизни» в домене нет и выдумывать её нечестно: обитаемость
 * задаёт поселение, а его глубину — тех-уровень (1..15). Пороги здесь, а не в UI, —
 * это правило мира, которое переживёт перебалансировку названий.
 */
export type LifeLevel = 'none' | 'primitive' | 'developed' | 'advanced'

export function systemLife(s: StarSystem): LifeLevel {
  let tech = 0
  for (const p of settledPlanets(s)) tech = Math.max(tech, p.settlement.techLevel)
  if (tech === 0) return 'none' // ни одного обитаемого мира
  if (tech <= 4) return 'primitive'
  if (tech <= 9) return 'developed'
  return 'advanced'
}

/** Все причалы системы. У каждого свой тех-уровень — свой ассортимент. */
export function stationsOf(s: StarSystem): { planet: Planet; station: Station }[] {
  const out: { planet: Planet; station: Station }[] = []
  for (const planet of s.planets) {
    if (planet.station) out.push({ planet, station: planet.station })
  }
  return out
}

export function canDock(s: StarSystem): boolean {
  return s.planets.some((p) => p.station !== null)
}

/** Где можно дозаправиться. Система без заправки — ловушка на маршруте. */
export function canRefuel(s: StarSystem): boolean {
  return s.star.scoopable || canDock(s)
}

/**
 * Что продаётся на станции этой планеты. Так карта питает прокачку:
 * лучшее железо есть только там, где высокие технологии.
 */
export function moduleClassAvailable(p: Planet): number {
  if (!p.station || !p.settlement) return 0
  const tl = p.settlement.techLevel
  if (tl >= 13) return 4
  if (tl >= 10) return 3
  if (tl >= 6) return 2
  return 1
}
