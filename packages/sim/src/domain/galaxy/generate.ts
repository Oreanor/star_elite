import {
  CORE_INDEX,
  GALAXY,
  GOVERNMENTS,
  HUMAN_SPECIES,
  PLANET_TYPES,
  SECURITY_LEVELS,
  SPECIES,
  STAR_CLASSES,
  type Economy,
  type Government,
  type PlanetType,
  type SecurityLevel,
  type StationType,
} from '../../config/galaxy'
import { DYSON, type DysonSpec } from '../../config/dyson'
import { WORLD } from '../../config/world'
import { clamp, makeRng, type Rng } from '../../core/math'
import { homeSystem } from './home'
import { moonName, planetName, systemName } from './names'
import { placeSystem } from './shape'
import type { Moon, Planet, SettledPlanet, Settlement, Star, StarSystem, Station } from './types'
import { capitalOf } from './types'

/** Единственная чёрная дыра галактики. Ищется по классу, а не пишется числами дважды. */
const BLACK_HOLE: Star = (() => {
  const c = STAR_CLASSES.find((s) => s.id === 'H')
  if (!c) throw new Error('в каталоге светил нет чёрной дыры')
  return { class: c.id, className: c.name, color: c.color, radius: c.radius, scoopable: false }
})()

/**
 * Статический генератор галактики: одно зерно → всегда одни и те же 2500 систем.
 * Ничего не сохраняется, всё выводится.
 *
 * Главный приём — КОРРЕЛЯЦИЯ. Если бросать характеристики независимо, получится
 * анархия с 15-м тех-уровнем и населением в 12 миллиардов. Это не разнообразие,
 * а шум. Поэтому сначала бросается строй, а тех-уровень, экономика, станция
 * и безопасность выводятся из него с наклоном.
 *
 * Обитаемость — свойство ПЛАНЕТЫ. Система лишь наследует охрану пространства
 * от самого населённого своего мира.
 */

function pick<T>(rng: Rng, table: readonly T[], fallback: T): T {
  return table[Math.floor(rng() * table.length)] ?? fallback
}

/**
 * Взвешенный выбор. Природа неравномерна: красных карликов много,
 * голубых гигантов почти нет, землеподобных планет — единицы.
 */
function weightedPick<T extends { readonly weight: number }>(rng: Rng, table: readonly T[]): T {
  let total = 0
  for (const item of table) total += item.weight
  let roll = rng() * total
  for (const item of table) {
    roll -= item.weight
    if (roll <= 0) return item
  }
  return table[table.length - 1]!
}

const pickStarClass = (rng: Rng) => weightedPick(rng, STAR_CLASSES)

function makeStar(rng: Rng): Star {
  const c = pickStarClass(rng)
  return {
    class: c.id,
    className: c.name,
    color: c.color,
    // Разброс ±15%: две звезды класса G не обязаны быть близнецами.
    radius: Math.round(c.radius * (0.85 + rng() * 0.3)),
    scoopable: c.scoopable,
  }
}

/**
 * Спутники: до шести у газового гиганта и ледяного мира, до двух у скалы.
 * Так и в природе — у Юпитера свита, у Марса два камня, у Венеры ничего.
 *
 * Опасение, что каждая луна утяжелит крейсерский ход, оказалось ложным, и это
 * не мнение, а замер (`scratch/moonload.ts`): потолок множителя берётся у
 * БЛИЖАЙШЕГО тела, поэтому луна режет скорость лишь внутри пузыря, где она
 * ближе своей планеты, — а пузырь целиком лежит внутри пузыря планеты. Полёт
 * к звезде с лунами занял 253 секунды против 250 без них.
 *
 * Орбита в РАДИУСАХ планеты. Ближе четырёх — предел Роша и кольца вместо луны,
 * дальше — каждая следующая отодвигается, иначе шесть лун слипаются в одну.
 *
 * Размеры двугорбые, и это не украшение распределения. Рендер рисует мелкие
 * луны роем одинаковых шариков, а крупные — как планеты, со складками и картой
 * поверхности; порог обязан лежать в ПРОВАЛЕ между горбами, иначе он режет по
 * живому и «крупность» решает третий знак радиуса. Природа так и устроена:
 * Ганимед и Титан — 2634 и 2575 км, они больше Меркурия; Фобос — двадцать два.
 * Либо мир, либо камень.
 */
const MOON_MAJOR_CHANCE = 0.12

function makeMoons(rng: Rng, planet: string, type: PlanetType): Moon[] {
  const many = type === 'Газовый гигант' || type === 'Ледяная'
  const count = Math.floor(rng() * (many ? 7 : 3))
  return Array.from({ length: count }, (_, i) => {
    // Каждая восьмая — свой Ганимед. Радиусы в единицах карты: единица — 10 км.
    const major = rng() < MOON_MAJOR_CHANCE
    return {
      name: moonName(planet, i),
      radius: Math.round(major ? 220 + rng() * 80 : 40 + rng() * 160),
      orbit: 4 + rng() * 10 + i * 6,
    }
  })
}

/**
 * Вторая звезда пары — или её отсутствие. Примерно каждая пятая система двойная.
 *
 * Пары бывают трёх сортов, и все три настоящие:
 *
 *  • БЛИЗНЕЦЫ — та же спектральная звезда, размер сопоставимый. Два солнца в небе.
 *  • ГЛАВНАЯ И МЕЛКИЙ СПУТНИК — горячий гигант с холодным карликом при нём.
 *    Так в природе чаще всего: компаньон обычно легче, а лёгкая звезда холоднее,
 *    краснее и меньше. Оттого цвет у пары РАЗНЫЙ — это не небрежность генератора.
 *  • ПАРА КРАСНЫХ КАРЛИКОВ — выходит сама, когда близнец достаётся звезде M:
 *    красных карликов в галактике большинство, и парами они ходят чаще всех.
 *
 * Чего НЕ бывает: спутник крупнее главной. Главной зовут более массивную —
 * значит и более крупную; поэтому радиус компаньона всегда зажат ниже её.
 * Экзотику (коричневый, нейтронную, чёрную дыру) в компаньоны не берём: это
 * уже не «двойное солнце», а другой разговор.
 */
const BINARY_CHANCE = 0.2

/** Звёзды главной последовательности, от горячей к холодной: из них и пары. */
const MAIN_SEQUENCE = STAR_CLASSES.filter((c) => c.scoopable)

function makeCompanion(rng: Rng, primary: Star): Star | null {
  const pi = MAIN_SEQUENCE.findIndex((c) => c.id === primary.class)
  if (pi < 0) return null // не главная последовательность — пары не заводит
  if (rng() >= BINARY_CHANCE) return null

  // Близнец того же класса — или спутник ХОЛОДНЕЕ (дальше по списку). У самого
  // красного карлика холоднее уже некуда, поэтому ему достаётся только близнец —
  // и выходит пара красных карликов.
  const coolerAvailable = pi < MAIN_SEQUENCE.length - 1
  const twin = !coolerAvailable || rng() < 0.4
  const cls = twin
    ? MAIN_SEQUENCE[pi]!
    : MAIN_SEQUENCE[pi + 1 + Math.floor(rng() * (MAIN_SEQUENCE.length - 1 - pi))]!

  // Радиус — от каталожного его класса с разбросом, но никогда не крупнее главной.
  const spread = twin ? 0.78 + rng() * 0.2 : 0.85 + rng() * 0.25
  const radius = Math.min(Math.round(cls.radius * spread), Math.round(primary.radius * 0.98))

  return { class: cls.id, className: cls.name, color: cls.color, radius, scoopable: cls.scoopable }
}

/** Кем населён мир: чаще люди, иначе — один из инопланетных гуманоидов. */
function makeSpecies(rng: Rng): string {
  // Больше половины галактики колонизировано людьми — иначе экзотика перестаёт быть экзотикой.
  if (rng() < 0.55) return HUMAN_SPECIES
  return pick(rng, SPECIES, SPECIES[0]!).name
}

/** Экономика следует за тех-уровнем: аграрии внизу, высокие технологии наверху. */
function economyFor(rng: Rng, techLevel: number): Economy {
  if (techLevel >= 12) return rng() < 0.7 ? 'Высокие технологии' : 'Сервисная'
  if (techLevel >= 9) return pick(rng, ['Промышленная', 'Высокие технологии', 'Сервисная'] as const, 'Промышленная')
  if (techLevel >= 6) return pick(rng, ['Промышленная', 'Перерабатывающая', 'Туризм'] as const, 'Промышленная')
  if (techLevel >= 3) return pick(rng, ['Добывающая', 'Перерабатывающая', 'Аграрная'] as const, 'Добывающая')
  return rng() < 0.6 ? 'Аграрная' : 'Добывающая'
}

/**
 * Безопасность — производная строя. Индекс правительства растёт от анархии
 * к корпорации, вместе с ним и полиция. Шум добавлен, но шкалу не переворачивает.
 */
function securityFor(rng: Rng, govIndex: number): SecurityLevel {
  const score = govIndex / (GOVERNMENTS.length - 1) + (rng() - 0.5) * 0.25
  if (score < 0.15) return 'Нет'
  if (score < 0.45) return 'Низкая'
  if (score < 0.75) return 'Средняя'
  return 'Высокая'
}

function stationTypeFor(rng: Rng, population: number, techLevel: number): StationType {
  if (population < 0.05) return rng() < 0.35 ? 'Аванпост' : 'Нет'
  if (population < 2) return rng() < 0.7 ? 'Аванпост' : 'Кориолис'
  if (techLevel >= 11 && population > 6) return 'Орбис'
  return rng() < 0.75 ? 'Кориолис' : 'Орбис'
}

function makeStation(rng: Rng, s: Settlement): Station | null {
  const type = stationTypeFor(rng, s.population, s.techLevel)
  if (type === 'Нет') return null
  return {
    name: `${type} «${systemName(rng)}»`,
    // Орбис огромен и висит выше; аванпост жмётся к поверхности.
    orbit: Math.round((type === 'Аванпост' ? 260 : type === 'Кориолис' ? 500 : 900) * (0.8 + rng() * 0.4)),
    type,
  }
}

/**
 * Поселение одного мира.
 * @param prominence 1 для главного мира, <1 для вторичной колонии: она беднее и малолюднее.
 */
function makeSettlement(rng: Rng, prominence: number): Settlement {
  const govIndex = Math.floor(rng() * GOVERNMENTS.length)
  const government: Government = GOVERNMENTS[govIndex] ?? 'Анархия'

  // Тех-уровень тянется за строем, но не определяется им жёстко:
  // бывает и высокотехнологичная диктатура, и отсталая демократия.
  const techLevel = Math.round(clamp(1 + govIndex * 0.8 + rng() * 7, 1, 15) * prominence) || 1

  // Население растёт с тех-уровнем нелинейно: развитый мир тянет к себе людей.
  const population =
    Math.round(clamp((techLevel / 15) ** 2.2 * 12 * (0.3 + rng() * 1.4) * prominence, 0.01, 14) * 100) / 100

  return {
    economy: economyFor(rng, techLevel),
    government,
    techLevel,
    population,
    species: makeSpecies(rng),
  }
}

/**
 * Шанс, что конкретный мир заселён. Землеподобный — почти наверняка;
 * на газовом гиганте живут разве что на орбитальной платформе.
 */
function settlementChance(type: PlanetType): number {
  switch (type) {
    case 'Земного типа': return 0.9
    case 'Океаническая': return 0.3
    case 'Скалистая': return 0.12
    case 'Ледяная': return 0.06
    case 'Газовый гигант': return 0.03
  }
}

function makePlanets(rng: Rng, system: string, habitable: boolean): Planet[] {
  // Обитаемая система обязана иметь хотя бы один мир: иначе население есть,
  // а жить ему негде — и станции негде висеть.
  const count = habitable ? 1 + Math.floor(rng() * 7) : Math.floor(rng() * 8)
  if (count === 0) return []

  // В обитаемой системе один мир назначается землеподобным: у колонизации
  // должна быть причина. Остальные заселяются по своему типу и часто беднее.
  const seat = habitable ? Math.floor(rng() * count) : -1

  const planets: Planet[] = []
  for (let i = 0; i < count; i++) {
    const type: PlanetType = i === seat ? 'Земного типа' : weightedPick(rng, PLANET_TYPES).id

    const settled = habitable && rng() < settlementChance(type)
    const settlement = settled ? makeSettlement(rng, i === seat ? 1 : 0.55) : null

    // Мир, на котором живут, называют, а не нумеруют.
    const name = settled ? systemName(rng) : planetName(system, i)

    planets.push({
      name,
      type,
      radius: Math.round(type === 'Газовый гигант' ? 1800 + rng() * 2600 : 380 + rng() * 900),
      moons: makeMoons(rng, name, type),
      // Орбиты расходятся геометрически — как в настоящих системах.
      orbit: Math.round(6000 * 1.7 ** i * (0.85 + rng() * 0.3)),
      settlement,
      // Причал ставит только РАЗВИТАЯ раса: примитивная жизнь (тех ≤ 4, уровень
      // `systemLife` 'primitive') станций не строит — ей ещё нечем. Так «обитаемый»
      // и «есть куда причалить» перестают быть одним и тем же: мир с дикарями видно
      // на карте как жизнь, но прыгать к нему незачем.
      station: settlement && settlement.techLevel > 4 ? makeStation(rng, settlement) : null,
    })
  }
  return planets
}

/** Обитаемость системы зависит от звезды: у нейтронной никто не живёт. */
function habitationChance(scoopable: boolean, starClass: string): number {
  if (!scoopable) return 0.04
  if (starClass === 'O' || starClass === 'B') return 0.18 // слишком яркие и короткоживущие
  if (starClass === 'M') return 0.42
  return 0.68 // F, G, K — золотая середина
}

/**
 * Одна система из индекса. Зерно берётся из индекса, поэтому систему можно
 * сгенерировать по требованию, не строя всю галактику. Это пригодится,
 * когда 2500 превратятся в 250 000.
 */
export function generateSystem(index: number, seed: number = GALAXY.SEED): StarSystem {
  const rng = makeRng(seed ^ Math.imul(index, 0x9e3779b1))
  const { x, y, z } = placeSystem(index, seed)

  // Центр галактики. Чёрная дыра не звезда: у неё нет ни планет, ни закона,
  // ни имени по общему словарю — это дверь, а не место жительства.
  if (index === CORE_INDEX) {
    return { index, name: 'Ядро', x, y, z, star: BLACK_HOLE, companion: null, dyson: null, planets: [], security: SECURITY_LEVELS[0] }
  }

  // Родная система задана руками — но только в СВОЕЙ галактике. В любой другой
  // под этим индексом стоит обычная звезда: Тиррион существует в одном экземпляре.
  if (index === WORLD.HOME_INDEX && seed === GALAXY.SEED) return homeSystem(index, x, y, z)

  const name = systemName(rng)
  const star = makeStar(rng)
  // Спутник бросается СРАЗУ после главной звезды: порядок бросков — часть зерна,
  // и вставить его позже значило бы сдвинуть все последующие свойства системы.
  const companion = makeCompanion(rng, star)

  const habitable = rng() < habitationChance(star.scoopable, star.class)
  const planets = makePlanets(rng, name, habitable)

  // Охрану пространства наводит тот, у кого флот, — самый населённый мир.
  const draft: StarSystem = { index, name, x, y, z, star, companion, dyson: null, planets, security: SECURITY_LEVELS[0] }
  const capital = capitalOf(draft)
  const security = capital
    ? securityFor(rng, GOVERNMENTS.indexOf(capital.settlement.government))
    : SECURITY_LEVELS[0]

  return { ...draft, dyson: makeDyson(rng, capital), security }
}

/**
 * Сфера Дайсона — или её останки, или ничего.
 *
 * ЦЕЛУЮ строят лишь на вершине прогресса: столица с высшим тех-уровнем. Оттого
 * она редка и осмысленна — метит самые развитые системы. РУИНЫ достаются
 * скромным обитаемым мирам: жизнь там есть, но невысокая, а над ней висят
 * останки цивилизации, что однажды поднялась до звёзд и пала. Пустой роли у
 * структуры нет: она либо чей-то триумф, либо чья-то могила.
 */
function makeDyson(rng: Rng, capital: SettledPlanet | null): DysonSpec | null {
  const tech = capital?.settlement.techLevel ?? 0
  const variant = () => Math.floor(rng() * DYSON.VARIANTS)

  if (tech >= DYSON.MIN_TECH && rng() < DYSON.CHANCE) return { variant: variant(), ruined: false }
  // Останки — только там, где ещё теплится жизнь, но до звёзд ей уже далеко.
  if (tech > 0 && tech < DYSON.MIN_TECH && rng() < DYSON.RUINED_CHANCE) {
    return { variant: variant(), ruined: true }
  }
  return null
}

/**
 * Поселение-столица системы по её индексу — или ничего, если система необитаема.
 *
 * Выводится из зерна, не хранится: у любого, кто зашёл в ту же систему того же
 * зерна, столица (а с ней тех-уровень и строй) выйдет та же. На этом и держится
 * сетевая синхронизация цен — их не нужно пересылать, они считаются одинаково.
 */
export function settlementAt(index: number, seed: number = GALAXY.SEED): Settlement | null {
  return capitalOf(generateSystem(index, seed))?.settlement ?? null
}

/**
 * Вся галактика. 2500 систем строятся за миллисекунды — ни кэша, ни индексов не нужно.
 *
 * Единственное, что нельзя вывести из одного индекса, — уникальность имён:
 * коллизия видна только на фоне остальных. Поэтому имена разводятся здесь.
 */
export function generateGalaxy(seed: number = GALAXY.SEED): StarSystem[] {
  const count = GALAXY.COUNT
  const systems: StarSystem[] = []
  const taken = new Set<string>()

  // Имена «Ядро» и «Тиррион» заняты до первого броска: их дали руками, и
  // переименовать их разведение коллизий не вправе. Иначе случайный сосед с тем
  // же именем, стоящий по индексу раньше, вытеснил бы родную систему из её имени.
  // Чёрная дыра есть у каждой галактики, Тиррион — только у родной.
  const fixed = new Set(seed === GALAXY.SEED ? [CORE_INDEX, WORLD.HOME_INDEX] : [CORE_INDEX])
  for (const i of fixed) taken.add(generateSystem(i, seed).name)

  for (let i = 0; i < count; i++) {
    const system = generateSystem(i, seed)

    let name = system.name
    if (taken.has(name) && !fixed.has(i)) {
      // Переброс из отдельного потока: сдвигать основной нельзя,
      // иначе изменится вся система, а не только её имя.
      const retry = makeRng(seed ^ Math.imul(i + 1, 0x85ebca6b))
      for (let a = 0; a < 12 && taken.has(name); a++) name = systemName(retry)
      if (taken.has(name)) name = `${name} II`
    }
    taken.add(name)

    systems.push(name === system.name ? system : { ...system, name })
  }
  return systems
}
