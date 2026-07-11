import {
  capitalOf,
  commandableByPlayer,
  commodityBuyPrice,
  commoditySellPrice,
  commodityStock,
  distanceLy,
  freeCapacity,
  generateGalaxy,
  itemName,
  localSettlement,
  moodTo,
  shipWhereabouts,
  type Mood,
  type Persona,
  type Relationship,
  type AIOrder,
  type ShipEntity,
  type Social,
  type StarSystem,
  type Topic,
  type Transfer,
  type World,
} from '@elite/sim'
import { chassisName, economyName, governmentName, properName, speciesName } from '../i18n/dataNames'

/**
 * СНИМОК МИРА для разговора. Чтобы собеседник не сочинял вселенную из воздуха,
 * ему дают факты: где он, что вокруг, что в трюмах, опасно ли место. Это не сам
 * промпт — это структура; в слова её разворачивает сетевой слой (`negotiator`).
 *
 * Живёт в ui, потому что читает домен и локализует имена (строй, экономика, товар).
 * Ниже по зависимостям сеть не спускаем: `negotiator` в app лишь ПОЛУЧАЕТ этот
 * контекст и историю, а App прокидывает функцию в окно — иначе ui звало бы app.
 */

export interface WorldSnapshot {
  systemName: string
  government: string
  economy: string
  techLevel: number
  species: string
  /** Сколько чего в системе: пилоту-собеседнику это знать положено. */
  planets: number
  moons: number
  stations: number
  bodyNames: string[]
  /** Оценка места одной фразой: спокойно / анархия / рядом стычка. */
  danger: string
  /** Обитаемые миры системы, каждый со СВОИМ строем/экономикой/расой (per-planet). */
  worlds: { name: string; type: string; economy: string; government: string; species: string; populationM: number }[]
}

export interface PartySnapshot {
  name: string
  /** Модель корпуса словом, а не id. */
  ship: string
  persona: Persona
  hullPct: number
  shieldPct: number
  /** Трюм словами: «Руда ×20, Металлы ×10» или «пусто». */
  cargo: string
  /** Трюм машиночитаемо: чтобы модель могла указать товар в сделке по id. */
  cargoList: { id: string; name: string; units: number }[]
  /** Свободный трюм, т: сколько ещё влезет. Бот не обещает больше, чем поместится. */
  freeHold: number
  /** Роль/намерение: пират, торговец, нанятый эскорт. */
  role: string
}

/**
 * Игрок глазами собеседника: ровно то, что видно снаружи. Симметрично тому, что сам
 * игрок видит о встречном — имя, род занятий, вид, борт. Скрытое (характер, кошелёк,
 * груз, курс) сюда НЕ входит: узнаётся только со слов игрока.
 */
export interface SeenParty {
  name: string
  /** Род занятий — серый по умолчанию, ни к чему не обязывает и ничего не выдаёт. */
  role: string
  /** Разумный вид (землянин/гуманоид/синтет) — виден. */
  species: string
  /** Модель корпуса — видна снаружи. */
  ship: string
}

/** Род занятий игрока по умолчанию: намеренно СЕРЫЙ — вольный делец, а не пират/торговец. */
const PLAYER_ROLE = 'вольный делец'

/**
 * Ближний борт в поле зрения на момент разговора. Нужен, чтобы собеседник понимал
 * обстановку и разбирал приказы вроде «атакуй вот этого» или «прикрой того»: у каждого
 * есть имя, сторона и дистанция, а `locked` метит того, кого игрок захватил прямо сейчас
 * — это и есть «вот этот». Эфемерная выжимка мира, не память: пересобирается на разговор.
 */
export interface NearbyShip {
  id: number
  name: string
  /** Сторона их словом: враг / мирный / свой. */
  standing: string
  distanceM: number
  /** Захвачен игроком прямо сейчас — «вот этот». */
  locked: boolean
}

export interface NegotiationContext {
  world: WorldSnapshot
  /** Собеседник (он сам — знает о себе всё). */
  them: PartySnapshot
  /**
   * Игрок ГЛАЗАМИ собеседника — только наблюдаемое: имя, род занятий, вид, борт.
   * Ни характера, ни статов, ни груза, ни денег, ни планов: скрытое собеседник
   * узнаёт, ТОЛЬКО если игрок сам расскажет (это придёт лентой реплик). Иначе NPC
   * ловил бы несоответствие «поведение против статов» — а он их знать не должен.
   */
  you: SeenParty
  /** Где сам собеседник — с точностью до системы и приметного места (док станции, у планеты). */
  theirLocation: string
  distanceM: number
  /** Кто ещё рядом на момент разговора: обстановка для приказов «атакуй вот того». */
  nearby: NearbyShip[]
  /** Местные цены на заметные товары — РЕАЛЬНЫЕ из домена, чтобы пилот не выдумывал числа. */
  localMarket: MarketQuote[]
  /** Ближайшие обитаемые системы: куда сходить за выгодой. Экономика/тех — настоящие. */
  neighbours: NeighbourWorld[]
  /**
   * Подчиняется ли собеседник игроку (это его нанятый эскорт/автобот). Тогда он не
   * торгуется, а ИСПОЛНЯЕТ приказы послушания — и распознавать надо их, а не уговоры.
   */
  theyObeyYou: boolean
  /** Текущее отношение собеседника к игроку — итог прошлых бесед, если были. */
  stance: Relationship
  /**
   * Настроение собеседника ПРЯМО СЕЙЧАС (его считает домен, `moodTo`): в этом тоне
   * модель и обязана говорить. Отношением рулит движок, а не настроение модели —
   * потому тон приходит готовым, а не выбирается ею.
   */
  mood: Mood
  /** Что механически можно у него попросить прямо сейчас (незаблокированное). */
  allowedIntents: Topic[]
  /**
   * Встречались ли раньше. Пока всегда false: корабли трафика случайны и мир их
   * не помнит. Поле — задел под будущую память знакомств (репутация, старые долги).
   */
  metBefore: boolean
}

/** Местная цена товара: пилот знает цифры и может их назвать, не выдумывая. */
export interface MarketQuote {
  name: string
  buy: number
  sell: number
}

/** Соседняя обитаемая система: экономика/строй/тех и путь в световых годах. */
export interface NeighbourWorld {
  name: string
  economy: string
  government: string
  techLevel: number
  ly: number
}

/** Одна реплика ленты. */
export interface ChatTurn {
  who: 'you' | 'them' | 'system'
  text: string
}

/**
 * Ответ переговорщика. Модель тут — РАСПОЗНАВАТЕЛЬ и ГОЛОС, а не судья: она даёт
 * слова и ловит, какое действие озвучил игрок (`intent` — триггер). РЕШАЕТ исход
 * домен (`say` по триггеру): согласие и смену отношения модель не диктует — иначе
 * выходит «послал → чистого неба». Пустой триггер — просто болтовня (погода, цены).
 */
export interface NegotiatorReply {
  text: string
  /** Триггер: какое из доступных действий озвучил игрок. null — просто разговор. */
  intent: Topic | null
  /** Соц-тон реплики игрока (нахамил/польстил). Следствие считает домен. null — нейтрально. */
  social: Social | null
  /** Приказ послушания СВОЕМУ эскорту, если игрок его отдал. null — не приказ. */
  command: AIOrder | null
  /** Кого атаковать по приказу `command:"attack"` — id ближнего борта. null — не задан. */
  commandTarget: number | null
  /** Скрытая команда на передачу товара/денег, если по разговору добро сменит хозяина. */
  transfer: Transfer | null
  /** Собеседник кладёт трубку: договорено, надоело или психанул. */
  hangup: boolean
  /** Откуда реплика: живая модель или локальный запас на случай обрыва связи. */
  source: 'model' | 'fallback'
}

const pct = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 100) : 0)

/** Трюм в короткую строку. Больше шести позиций собеседнику ни к чему. */
function holdSummary(ship: ShipEntity): string {
  const items = ship.hold.items
  if (items.length === 0) return 'пусто'
  const shown = items.slice(0, 6).map(itemName)
  return items.length > 6 ? `${shown.join(', ')}…` : shown.join(', ')
}

/**
 * Род занятий собеседника по ТИПУ ВСТРЕЧИ (`originKind`) — то, кем он себя знает.
 * Это его собственная правда о себе, отдельная от того, враждебен ли он ПРЯМО СЕЙЧАС.
 */
const OCCUPATION_SELF: Record<string, string> = {
  trader: 'торговец', convoy: 'торговец', pirate: 'пират', gang: 'пират',
  raider: 'налётчик', police: 'патрульный', freighter: 'дальнобойщик', platform: 'пират',
}
function occupationSelf(other: ShipEntity): string {
  return (other.originKind && OCCUPATION_SELF[other.originKind]) || 'вольный пилот'
}

/**
 * Роль собеседника — чем он занят и как относится к игроку. Главное: он ЗНАЕТ, кто он
 * на самом деле (род занятий — из `originKind`), даже когда прямо сейчас враждебен.
 * Пират — разбойник по ремеслу; а вот торговец, что озлобился и вышел грабить, про
 * себя помнит, что он торговец. Пусть блефует «я матёрый пират», если хочет, — но
 * правду о себе держит, а не получает её подменённой на «пират» самой игрой.
 */
function roleOf(other: ShipEntity, playerId: number): string {
  const occ = occupationSelf(other)
  if (other.ai?.escortOf === playerId) return `${occ}, сейчас нанят игроком в сопровождение`
  if (other.faction === 'hostile') {
    return occ === 'пират'
      ? 'пират, вышел на разбой'
      : `по ремеслу ${occ}, но сейчас враждебен и идёшь на разбой (себя-то ты знаешь)`
  }
  return `${occ}, мирный рейс`
}

function cargoList(ship: ShipEntity): { id: string; name: string; units: number }[] {
  const out: { id: string; name: string; units: number }[] = []
  for (const it of ship.hold.items) {
    if (it.kind === 'commodity') out.push({ id: it.commodity.id, name: it.commodity.name, units: it.units })
  }
  return out
}

function party(ship: ShipEntity, role: string): PartySnapshot {
  return {
    name: ship.name,
    ship: chassisName(ship.loadout.chassis.name),
    persona: ship.persona,
    hullPct: pct(ship.hull, ship.spec.hull.hull),
    shieldPct: pct(ship.shield, ship.spec.hull.shield),
    cargo: holdSummary(ship),
    cargoList: cargoList(ship),
    freeHold: Math.floor(freeCapacity(ship.hold)),
    role,
  }
}

/** Дальше этого борт в разговоре не поминают, м: обстановка — это ближний круг, не вся система. */
const NEARBY_RANGE = 6000

/** Сколько заметных товаров и сколько соседних систем даём пилоту на память. */
const MARKET_ITEMS = 6
const NEIGHBOUR_COUNT = 4

/**
 * Галактику генерим лениво и КЭШИРУЕМ по зерну. 2500 систем строятся за миллисекунды,
 * но дёргать это на каждую реплику незачем — разговор редкое событие, кэш живёт сессию.
 */
let galaxyCache: { seed: number; systems: StarSystem[] } | null = null
function galaxyFor(seed: number): StarSystem[] {
  if (!galaxyCache || galaxyCache.seed !== seed) galaxyCache = { seed, systems: generateGalaxy(seed) }
  return galaxyCache.systems
}

/**
 * Местные цены на заметные легальные товары — РЕАЛЬНЫЕ из домена (`commodityBuyPrice`/
 * `commoditySellPrice`). Пилот эти цифры знает и может назвать; модель их лишь озвучивает,
 * а не сочиняет. Контрабанду в прайс не суём: о ней разговор особый.
 */
function localMarket(world: World): MarketQuote[] {
  return commodityStock()
    .filter((c) => !c.contraband)
    .slice(0, MARKET_ITEMS)
    .map((c) => ({ name: c.name, buy: commodityBuyPrice(world, c), sell: commoditySellPrice(world, c) }))
}

/**
 * Ближайшие ОБИТАЕМЫЕ системы — КЭШ по (зерно, текущая система): список не меняется,
 * пока ты в этой системе, а `capitalOf` на 2500 систем считать на каждую реплику ни к
 * чему. Прыгнул в другую систему — пересчитается. Живёт сессию, как и кэш галактики.
 */
let neighbourCache: { seed: number; index: number; list: NeighbourWorld[] } | null = null
function neighbours(world: World): NeighbourWorld[] {
  if (neighbourCache && neighbourCache.seed === world.galaxySeed && neighbourCache.index === world.systemIndex) {
    return neighbourCache.list
  }
  const list = computeNeighbours(world)
  neighbourCache = { seed: world.galaxySeed, index: world.systemIndex, list }
  return list
}

/**
 * Экономика, строй, тех-уровень и путь в св. годах — всё настоящее, из генерации
 * галактики. По ним бывалый пилот подскажет, куда сходить за выгодой («электроника
 * тут дорога — в промышленной system X дешевле»). Числа честные.
 */
function computeNeighbours(world: World): NeighbourWorld[] {
  const systems = galaxyFor(world.galaxySeed)
  const here = systems[world.systemIndex]
  if (!here) return []
  return systems
    .filter((s) => s.index !== world.systemIndex)
    .map((s) => ({ s, cap: capitalOf(s) }))
    .filter((x): x is { s: StarSystem; cap: NonNullable<ReturnType<typeof capitalOf>> } => x.cap !== null)
    .map((x) => ({ ...x, ly: distanceLy(here, x.s) }))
    .sort((a, b) => a.ly - b.ly)
    .slice(0, NEIGHBOUR_COUNT)
    .map((x) => ({
      name: properName(x.s.name),
      economy: economyName(x.cap.settlement.economy),
      government: governmentName(x.cap.settlement.government),
      techLevel: x.cap.settlement.techLevel,
      ly: Math.round(x.ly),
    }))
}

/**
 * Собрать контекст переговоров из мира. `allowedIntents` считает домен
 * (`linesFor` минус заблокированное) и передаёт вызывающий: правило одно.
 */
export function buildContext(world: World, other: ShipEntity, allowedIntents: Topic[]): NegotiationContext {
  const set = localSettlement(world)
  const planets = world.bodies.filter((b) => b.kind === 'planet')
  const moons = world.bodies.filter((b) => b.kind === 'moon')
  const stations = world.bodies.filter((b) => b.kind === 'station')

  const hostiles = world.ships.filter((s) => s.alive && s.faction === 'hostile').length
  const anarchy = /анарх/i.test(set.government)
  const danger =
    hostiles > 0
      ? `неспокойно: рядом враждебных бортов — ${hostiles}`
      : anarchy
        ? 'анархия, закон тут не работает'
        : 'патрулируется, относительно спокойно'

  // Ближние борта: что реально маячит вокруг на момент разговора. Невидимок
  // (в маскировке) не показываем — их не знает ни локатор, ни собеседник. Себя и
  // самого собеседника исключаем, сортируем по близости и берём горсть — длинный
  // список пилоту ни к чему, а «вот этот» и «вон тот» разбираются и по трём меткам.
  const player = world.player
  const nearby: NearbyShip[] = world.ships
    .filter((s) => s.alive && !s.cloaked && s.id !== other.id && s.id !== player.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      standing: s.faction === 'hostile' ? 'враг' : s.faction === player.faction ? 'свой' : 'мирный',
      distanceM: Math.round(s.state.pos.distanceTo(player.state.pos)),
      locked: s.id === world.lockedTargetId,
    }))
    .filter((s) => s.distanceM < NEARBY_RANGE)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 8)

  const record = world.acquaintances.find((a) => a.id === other.acquaintanceId)

  // Где он сам: бот должен уметь ответить, где находится, — у планеты, в доке станции.
  const at = shipWhereabouts(world, other)
  const place = at.place ? properName(at.place) : null
  const theirLocation = place
    ? at.docked
      ? `в доке станции ${place} (система ${properName(at.systemName)})`
      : `у ${place} (система ${properName(at.systemName)})`
    : `в системе ${properName(at.systemName)}`

  return {
    world: {
      systemName: properName(world.systemName),
      government: governmentName(set.government),
      economy: economyName(set.economy),
      techLevel: set.techLevel,
      species: speciesName(set.species),
      planets: planets.length,
      moons: moons.length,
      stations: stations.length,
      bodyNames: [...planets, ...stations].slice(0, 6).map((b) => properName(b.name)),
      danger,
      // Обитаемые миры — каждый со своим поселением: в одной системе аграрная
      // колония и промышленная столица читаются по-разному, и бот это знает.
      worlds: world.bodies
        .filter((b) => b.settlement)
        .map((b) => ({
          name: properName(b.name),
          type: b.surface ?? '—',
          economy: economyName(b.settlement!.economy),
          government: governmentName(b.settlement!.government),
          species: speciesName(b.settlement!.species),
          populationM: Math.round(b.settlement!.population),
        })),
    },
    them: party(other, roleOf(other, world.player.id)),
    // Игрок — только наблюдаемое (имя/род занятий/вид/борт). Характер, груз, деньги
    // и планы собеседнику не отдаём: узнает, лишь если игрок сам скажет.
    you: {
      name: player.name,
      role: PLAYER_ROLE,
      species: speciesName(player.persona.species),
      ship: chassisName(player.loadout.chassis.name),
    },
    theirLocation,
    distanceM: Math.round(other.state.pos.distanceTo(world.player.state.pos)),
    nearby,
    localMarket: localMarket(world),
    neighbours: neighbours(world),
    theyObeyYou: commandableByPlayer(other, world.player.id),
    stance: record?.relationship ?? 'neutral',
    mood: moodTo(world, other),
    allowedIntents,
    // Узнаёт, только если виделись РАНЬШЕ: у записи больше одной встречи. В первый
    // разговор запись родится по ходу дела, но встреча всё ещё первая — не «узнаёт».
    metBefore: (record?.meetings ?? 0) > 1,
  }
}
