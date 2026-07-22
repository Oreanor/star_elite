import {
  type AcquaintanceEvent,
  capitalOf,
  type Command,
  commandableByPlayer,
  COMMODITIES,
  commodityBuyPrice,
  commoditySellPrice,
  commodityStock,
  distanceLy,
  freeCapacity,
  applyDelta,
  generateGalaxy,
  itemName,
  localSettlement,
  escortFee,
  masterClass,
  moodTo,
  shipWhereabouts,
  stationStock,
  stanceTo,
  collectsFigurines,
  figurineGiftOpenness,
  figurinePriceFactor,
  figurineTitleName,
  figurineTitlesInHold,
  type FigurineHobby,
  type Mood,
  type Persona,
  type Relationship,
  type ShipEntity,
  type StarSystem,
  TIME,
  type Topic,
  type World,
} from '@elite/sim'
import { chassisName, economyName, governmentName, moduleName, professionName, properName, speciesName } from '../i18n/dataNames'
import { formatGameDate } from '../i18n/date'

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
  cargoList: { id: string; name: string; units: number; specimenNames?: string[] }[]
  /** Свободный трюм, т: сколько ещё влезет. Бот не обещает больше, чем поместится. */
  freeHold: number
  /** Роль/намерение: пират, торговец, нанятый эскорт. */
  role: string
  /**
   * Статуэтки богов: знает ли, увлечённость, сколько в трюме, доля цены от потолка.
   * Для промпта — чтобы не врал «у меня нет», когда в cargoList уже есть figurine.
   */
  figurines: FigurineHobbySnapshot
}

/** Снимок хобби статуэток для переговоров. */
export interface FigurineHobbySnapshot {
  hobby: FigurineHobby | null
  collects: boolean
  /** Увлечённость 0..1 (у не-коллекционера 0). */
  zeal: number
  /** Сколько статуэток в трюме. */
  units: number
  /**
   * Имена экземпляров в трюме — ОТВЕЧАЙ ИМИ на «какие?».
   * Пустой список при units>0 — только счётчик (старый сейв); не выдумывай имён.
   */
  names: string[]
  /** Доля от потолка цены (0 — не ценит / не собирает). */
  priceFactor: number
  /** Охота дарить друзьям 0..1. */
  giftOpenness: number
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
  /** Собеседник — БОГ Слово: особый промпт (говорит как божество, не торговец/наёмник). */
  divine: boolean
  /**
   * Игрок ГЛАЗАМИ собеседника — только наблюдаемое: имя, род занятий, вид, борт.
   * Ни характера, ни статов, ни груза, ни денег, ни планов: скрытое собеседник
   * узнаёт, ТОЛЬКО если игрок сам расскажет (это придёт лентой реплик). Иначе NPC
   * ловил бы несоответствие «поведение против статов» — а он их знать не должен.
   */
  you: SeenParty
  /** Где сам собеседник — с точностью до системы и приметного места (док станции, у планеты). */
  theirLocation: string
  /** Пришвартован ли он к станции ПРЯМО СЕЙЧАС: тогда брифинг — про станцию, а не про полёт. */
  docked: boolean
  /** Родная планета и система персонажа — свой дом он знает всегда, умом не гейтится. */
  home: string
  /** Куда он сейчас направляется — по роли и делам: к станции, за нанимателем, по службе. */
  heading: string
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
  /** Текущее отношение собеседника к игроку — итог фракции, обиды и прошлых бесед. */
  stance: Relationship
  /** Открытая претензия (0 — нет). Мирный с обидой насторожен, даже если в журнале нейтрал. */
  grievanceLevel: number
  /** Сейчас враг по фракции — в бою или на разбое, не «просто недоволен». */
  combatEnemy: boolean
  /**
   * Настроение собеседника ПРЯМО СЕЙЧАС (его считает домен, `moodTo`): в этом тоне
   * модель обязана говорить. Пересчитывается перед каждой репликой — после извинений,
   * оскорблений, сделок и кнопок в том же разговоре расклад может измениться.
   */
  mood: Mood
  /** Что механически можно у него попросить прямо сейчас (незаблокированное). */
  allowedIntents: Topic[]
  /**
   * Встречались ли раньше — виделись повторно или в журнале уже есть дела. Бот помнит.
   */
  metBefore: boolean
  /**
   * ЛИЧНЫЙ журнал знакомого готовыми датированными фразами: «12 марта 3000 года — он
   * передал тебе 5000 кр», «14 марта — просил взять в эскорт, ты согласился». Старое
   * сверху. Бот обязан это помнить: без журнала он «забывал» только что данные деньги.
   */
  history: string[]
  /**
   * ЧТО ТЫ ЕМУ ДОВЕРИЛ и он ещё не вернул: «Руда ×6». Отдельно от журнала нарочно — журнал
   * показывается хвостом последних событий и уходит из окна, а обязательство обязано висеть
   * перед глазами, пока не закрыто. Без этой строки бот на станции честно не помнил, что
   * везёт твоё, и «продадим вместе» разваливалось на полпути.
   */
  entrusted: string[]
  /** Деньги и услуги — цифры из домена, чтобы не путать «кто кому платит». */
  economy: EconomySnapshot
  /** Станция системы: что можно у причала и кто сейчас у дока. */
  station: StationSnapshot
  /** Справочники с полным текстом в промпте (не больше MAX_ACTIVE_DIGESTS). */
  activeDigests: readonly ContextDigest[]
  /** Выпали из памяти разговора — снова lookup или переспрос. */
  forgottenDigests: readonly ContextDigest[]
  /** Подгружены суфлёром или lookup только на эту реплику. */
  freshDigests: readonly ContextDigest[]
}

/** Справочники, которые не тащим в каждый запрос — пилот «листает» их по просьбе. */
export type ContextDigest = 'market' | 'neighbours' | 'history' | 'worlds' | 'guide'

/** Сколько справочников держим в «памяти» одного разговора — старейший выпадает. */
export const MAX_ACTIVE_DIGESTS = 3

/** Память справочников на сеанс связи: активные (полные блоки) и забытые (только заглушки). */
export interface DigestMemory {
  active: ContextDigest[]
  forgotten: ContextDigest[]
}

export function createDigestMemory(): DigestMemory {
  return { active: [], forgotten: [] }
}

/** Открыть или освежить справочник; при переполнении самый давний забывается. */
export function rememberDigest(mem: DigestMemory, digest: ContextDigest): void {
  const i = mem.active.indexOf(digest)
  if (i >= 0) mem.active.splice(i, 1)
  const fi = mem.forgotten.indexOf(digest)
  if (fi >= 0) mem.forgotten.splice(fi, 1)
  mem.active.push(digest)
  while (mem.active.length > MAX_ACTIVE_DIGESTS) {
    const dropped = mem.active.shift()!
    if (!mem.forgotten.includes(dropped)) mem.forgotten.push(dropped)
  }
}

/** Снимок для торга: кошелёк командира и твои цены на услуги. */
export interface EconomySnapshot {
  commanderCredits: number
  /** Цена сопровождения, кр, или null — не наймёшься (враждебность/настороженность). */
  escortFee: number | null
  escortHired: boolean
  canAffordEscort: boolean
}

/** Что есть на станции и кто у причала — чтобы бот не обещал установку модулей в полёте. */
export interface StationSnapshot {
  present: boolean
  stationName: string | null
  /** Командир пришвартован — многие сделки с его кораблём только тогда. */
  commanderDocked: boolean
  /** Ты (NPC) у причала. */
  npcDocked: boolean
  techLevel: number
  /** Класс мастерской ремонта (1–3). */
  repairMasterClass: number
  /** Максимальный класс оснастки в продаже (1–4). */
  maxModuleClass: number
  /** Примеры модулей в витрине сейчас. */
  shopModuleSamples: string[]
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
  /**
   * Что игрок ВЕЛЕЛ/о чём договорились, распознанное моделью и собранное в команды
   * {action, payload}: `ask` (просьба-действие), `order` (приказ эскорту), `social`
   * (тон), `transfer` (передача добра), `note` (запомнить факт). Исполняет их домен
   * (`applyCommand`) — модель лишь ловит и раскладывает. Пусто — просто болтовня.
   */
  commands: Command[]
  /** Собеседник кладёт трубку: договорено, надоело или психанул. */
  hangup: boolean
  /** Откуда реплика: живая модель, локальный запас или обрыв от перегрузки канала. */
  source: 'model' | 'fallback' | 'overload'
  /** Модель просит подгрузить справочник — клиент догрузит и переспросит. */
  lookup?: ContextDigest | null
  /**
   * Переводчик/чужие понятия: бот не уверен в поручении и просит расклад по шагам.
   * Команды при этом пустые — домен ничего не исполняет.
   */
  clarify?: boolean
  /** Выражение лица, которое бог Слово ВЫЗВАЛ этой репликой (одно из 8). null — не задано. */
  emotion?: string | null
}

export function digestActive(mem: Pick<DigestMemory, 'active'>, digest: ContextDigest): boolean {
  return mem.active.includes(digest)
}

export function digestLoaded(ctx: NegotiationContext, digest: ContextDigest): boolean {
  return ctx.activeDigests.includes(digest)
}

/**
 * СУФЛЁР: по реплике командира угадываем, какие справочники нужны для ответа.
 * Клиент тихо подмешивает их в промпт ДО вызова модели — без «ща гляну» в ленте.
 */
export function sufflerDigestsFor(text: string): ContextDigest[] {
  const t = text.toLowerCase()
  const out = new Set<ContextDigest>()

  if (
    /лазер|оруж|модул|установ|оснаст|щит|привод|купи|купить|buy|laser|outfit|hardpoint|ствол/.test(
      t,
    )
  ) {
    out.add('market')
  }
  if (
    /цен|торг|куп|прод|товар|груз|контраб|кредит|сколько сто|прайс|котиров|выгодн|сбыть|закуп|руда|металл|прибыл/.test(
      t,
    )
  ) {
    out.add('market')
  }
  if (
    /сосед|систем[аыу]|свет\.?\s*лет|куда лет|маршрут|переход|прыж|галакт|скач|дальше|ближайш|соседн/.test(
      t,
    )
  ) {
    out.add('neighbours')
  }
  if (
    /помн|раньше|прошл|договор|обещ|журнал|вспомн|между нами|ты мне|я тебе|давали|передавал|должен|задолж|в прошлый/.test(
      t,
    )
  ) {
    out.add('history')
  }
  if (/планет|лун|мир[аеу]?|колон|населен|обитаем|поверхност|какой там|что за мир|расой|правлен|экономик/.test(t)) {
    out.add('worlds')
  }
  // «Куда сходить за …» — и маршрут, и цены.
  if (/куда сход|где дешев|где дорог|где взять|где продать/.test(t)) {
    out.add('market')
    out.add('neighbours')
  }

  return [...out]
}

const DIGEST_LABEL: Record<ContextDigest, string> = {
  market: 'местные цены',
  neighbours: 'соседние системы',
  history: 'журнал встреч',
  worlds: 'планеты системы',
  guide: 'устройство мира',
}

/** Подсказка промпту: какие блоки подмешал суфлёр на эту реплику. */
export function sufflerHint(
  fresh: readonly ContextDigest[],
  labels: Record<ContextDigest, string> = DIGEST_LABEL,
): string {
  if (fresh.length === 0) return ''
  return fresh.map((d) => labels[d]).join(', ')
}

/** Список справочников словами — для подсказок промпту. */
export function digestSummary(
  digests: readonly ContextDigest[],
  labels: Record<ContextDigest, string> = DIGEST_LABEL,
  empty = 'ничего',
): string {
  if (digests.length === 0) return empty
  return digests.map((d) => labels[d]).join(', ')
}

/** @deprecated — то же, что digestSummary */
export function loadedDigestSummary(loaded: readonly ContextDigest[]): string {
  return digestSummary(loaded)
}

export { DIGEST_LABEL }

/** @deprecated имя сохранено — то же, что sufflerDigestsFor */
export function detectDigests(text: string): ContextDigest[] {
  return sufflerDigestsFor(text)
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
  traveler: 'путешественник', explorer: 'учёный', businessman: 'бизнесмен', military: 'военный',
  god: 'бог',
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

function cargoList(
  ship: ShipEntity,
): { id: string; name: string; units: number; specimenNames?: string[] }[] {
  const out: { id: string; name: string; units: number; specimenNames?: string[] }[] = []
  for (const it of ship.hold.items) {
    if (it.kind !== 'commodity') continue
    if (it.commodity.id === 'figurine') {
      const specimenNames =
        it.specimens && it.specimens.length > 0
          ? it.specimens.map((s) => figurineTitleName(s.titleId))
          : undefined
      out.push({
        id: it.commodity.id,
        name: it.commodity.name,
        units: it.units,
        specimenNames,
      })
      continue
    }
    out.push({ id: it.commodity.id, name: it.commodity.name, units: it.units })
  }
  return out
}

function figurineSnapshot(ship: ShipEntity): FigurineHobbySnapshot {
  const hobby = ship.persona.figurineHobby ?? null
  const names = figurineTitlesInHold(ship)
  return {
    hobby,
    collects: collectsFigurines(hobby ?? undefined),
    zeal: hobby?.aware ? hobby.zeal : 0,
    units: names.length,
    names,
    priceFactor: figurinePriceFactor(hobby ?? undefined),
    giftOpenness: figurineGiftOpenness(hobby ?? undefined),
  }
}

/**
 * Личный журнал знакомого — готовыми ДАТИРОВАННЫМИ фразами ОТ ЛИЦА БОТА («ты»/«он»),
 * как их и читает системный промпт. Хронологически, старое сверху; берём хвост — длинную
 * летопись free-модель в промпте не удержит, а помнят обычно последнее и памятное.
 *
 * Дату выводим из `at` (общий `calendarTime`) тем же календарём, что HUD.
 */
const HISTORY_SHOWN = 8

const ASK_PAST_RU: Record<string, string> = {
  surrender: 'требовал сдаться',
  mercy: 'просил пощады',
  escort: 'звал к себе в эскорт',
  plunder: 'сдавался на разграбление',
}
const ORDER_PAST_RU: Record<string, string> = {
  attack: 'приказал атаковать цель',
  engageAll: 'приказал бить всех врагов',
  hold: 'приказал ждать на месте',
  standDown: 'приказал отбой',
  keepBack: 'приказал беречь себя',
  resume: 'отпустил вольно',
}

function transferPhrase(m: { toPlayer: boolean; credits: number; commodityName: string | null; units: number }): string {
  const parts: string[] = []
  if (m.commodityName && m.units > 0) parts.push(`${m.commodityName} ×${m.units}`)
  if (m.credits > 0) parts.push(`${m.credits} кр`)
  const what = parts.join(' и ')
  return m.toPlayer ? `ты передал ему ${what}` : `он передал тебе ${what}`
}

function eventPhrase(ev: AcquaintanceEvent): string {
  switch (ev.kind) {
    case 'met':
      return 'вы познакомились'
    case 'asked':
      return `${ASK_PAST_RU[ev.topic] ?? `просил (${ev.topic})`} — ты ${ev.agreed ? 'согласился' : 'отказал'}`
    case 'deal':
      return transferPhrase(ev)
    case 'order':
      return ORDER_PAST_RU[ev.order] ?? `отдал приказ (${ev.order})`
    case 'social':
      return ev.tone === 'insult' ? 'ты нахамил ему' : 'ты ему польстил'
    case 'note':
      return ev.text.startsWith('МЕТА:')
        ? `выучил смысл: ${ev.text.slice(5).trim()}`
        : `ты просил запомнить: ${ev.text}`
  }
}

/** Доверенное готовыми строками: «Руда ×6». Имя товара — из каталога, не из id. */
function entrustedLines(entrusted: readonly { commodityId: string; units: number }[]): string[] {
  return entrusted.map((e) => {
    const c = Object.values(COMMODITIES).find((x) => x.id === e.commodityId)
    return `${c?.name ?? e.commodityId} ×${e.units}`
  })
}

function historyLines(history: AcquaintanceEvent[]): string[] {
  return history.slice(-HISTORY_SHOWN).map((ev) => {
    const date = formatGameDate(TIME.EPOCH_MS + ev.at * 1000 * TIME.SCALE)
    return `${date} — ${eventPhrase(ev)}`
  })
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
    figurines: figurineSnapshot(ship),
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
let galaxyCache: { seed: number; epoch: number; systems: StarSystem[] } | null = null
function galaxyFor(world: World): StarSystem[] {
  const seed = world.galaxySeed
  const epoch = world.galaxyEpoch
  if (!galaxyCache || galaxyCache.seed !== seed || galaxyCache.epoch !== epoch) {
    // База из зерна + правки бога (дельта): диалог о соседях учитывает перекроенную карту.
    galaxyCache = { seed, epoch, systems: applyDelta(generateGalaxy(seed), world.galaxyDelta) }
  }
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
let neighbourCache: { seed: number; index: number; epoch: number; list: NeighbourWorld[] } | null = null
function neighbours(world: World): NeighbourWorld[] {
  if (
    neighbourCache &&
    neighbourCache.seed === world.galaxySeed &&
    neighbourCache.index === world.systemIndex &&
    neighbourCache.epoch === world.galaxyEpoch // правки бога сдвигают соседей — пересчитать
  ) {
    return neighbourCache.list
  }
  const list = computeNeighbours(world)
  neighbourCache = { seed: world.galaxySeed, index: world.systemIndex, epoch: world.galaxyEpoch, list }
  return list
}

/**
 * Экономика, строй, тех-уровень и путь в св. годах — всё настоящее, из генерации
 * галактики. По ним бывалый пилот подскажет, куда сходить за выгодой («электроника
 * тут дорога — в промышленной system X дешевле»). Числа честные.
 */
function computeNeighbours(world: World): NeighbourWorld[] {
  const systems = galaxyFor(world)
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
 * Родная планета и система персонажа — он их знает всегда. Стабильного «дома» пока не
 * храним (это дело будущего объекта Character); берём правдоподобный: обитаемый мир ЕГО
 * ВИДА в текущей системе, иначе — просто система. Транзитника это слегка упрощает.
 */
function homeOf(world: World, other: ShipEntity): string {
  const sys = properName(world.systemName)
  const match = world.bodies.find((b) => b.settlement && b.settlement.species === other.persona.species)
  return match ? `${properName(match.name)} (система ${sys})` : `система ${sys}`
}

/**
 * Куда он сейчас держит путь — по роли и делам. У нанятого — за нанимателем; у патрульного
 * «при исполнении» — по службе; у причала — стоит там; иначе мирный, скорее всего, к станции.
 */
/** Верхний класс оснастки по тех-уровню станции — как в `stationStock`. */
function maxModuleClassForTech(tech: number): number {
  if (tech >= 12) return 4
  if (tech >= 9) return 3
  if (tech >= 5) return 2
  return 1
}

function buildStationSnapshot(world: World, npcDocked: boolean): StationSnapshot {
  const stationBody = world.bodies.find((b) => b.kind === 'station')
  const set = localSettlement(world)
  return {
    present: stationBody != null,
    stationName: stationBody ? properName(stationBody.name) : null,
    commanderDocked: world.docked,
    npcDocked,
    techLevel: set.techLevel,
    repairMasterClass: masterClass(set),
    maxModuleClass: maxModuleClassForTech(set.techLevel),
    shopModuleSamples: stationStock(world).slice(0, 6).map((m) => moduleName(m)),
  }
}

/**
 * Что борт ИСПОЛНЯЕТ прямо сейчас, если ему дали поручение. Это не догадка, а факт из очереди
 * задач (`ai.tasks[0]`) — то самое, что домен и правда делает. Без этого бот не знал о собственном
 * приказе и на «подлети ко мне» отыгрывал словами («ну, я подлетела!»), никуда не летя.
 */
function taskHeading(world: World, other: ShipEntity): string | null {
  const task = other.ai?.tasks[0]
  if (!task) return null
  switch (task.kind) {
    case 'rendezvous':
      return 'ИДЁШЬ К КОМАНДИРУ — он просил подлететь, ты уже в пути'
    case 'approach-body': {
      const body = world.bodies.find((b) => b.id === task.bodyId)
      return body ? `идёшь к «${body.name}» — командир просил туда` : 'идёшь к указанной цели'
    }
    case 'goto':
      return 'идёшь в назначенную точку'
    case 'collect-cargo':
      return 'собираешь груз по поручению командира'
    case 'return-to-escort':
      return 'возвращаешься к командиру'
    case 'hold':
      return 'держишь позицию и ждёшь'
  }
}

function headingOf(world: World, other: ShipEntity, docked: boolean): string {
  // ПОРУЧЕНИЕ важнее роли: раз командир дал приказ — это и есть то, чем ты занят.
  const task = taskHeading(world, other)
  if (task) return task
  if (other.ai?.escortOf === world.player.id) return 'следуешь за своим нанимателем'
  if (occupationSelf(other) === 'патрульный') {
    return docked ? 'несёшь службу у причала' : 'на службе — патрулируешь систему, идёшь по служебному делу'
  }
  if (docked) return 'стоишь у причала станции'
  return 'по своим делам — вероятнее всего, идёшь к станции'
}

/**
 * Собрать контекст переговоров из мира. `allowedIntents` считает домен
 * (`linesFor` минус заблокированное) и передаёт вызывающий: правило одно.
 */
export function buildContext(
  world: World,
  other: ShipEntity,
  allowedIntents: Topic[],
  memory: DigestMemory = createDigestMemory(),
  freshDigests: readonly ContextDigest[] = [],
): NegotiationContext {
  const { active, forgotten } = memory
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
  const fee = escortFee(world, other)
  const escortHired = other.ai?.escortOf === player.id

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
      worlds: active.includes('worlds')
        ? world.bodies
            .filter((b) => b.settlement)
            .map((b) => ({
              name: properName(b.name),
              type: b.surface ?? '—',
              economy: economyName(b.settlement!.economy),
              government: governmentName(b.settlement!.government),
              species: speciesName(b.settlement!.species),
              populationM: Math.round(b.settlement!.population),
            }))
        : [],
    },
    them: party(other, roleOf(other, world.player.id)),
    divine: other.divine === true,
    // Игрок — только наблюдаемое (имя/род занятий/вид/борт). Характер, груз, деньги
    // и планы собеседнику не отдаём: узнает, лишь если игрок сам скажет.
    you: {
      name: player.name,
      // Род занятий игрока — его ВЫБРАННАЯ профессия (самоназвание, но публичное и за
      // правду): собеседник видит её открыто и по ней задаёт тон и общий стиль общения.
      role: professionName(player.persona.profession),
      species: speciesName(player.persona.species),
      ship: chassisName(player.loadout.chassis.name),
    },
    theirLocation,
    docked: at.docked,
    home: homeOf(world, other),
    heading: headingOf(world, other, at.docked),
    distanceM: Math.round(other.state.pos.distanceTo(world.player.state.pos)),
    nearby,
    localMarket: active.includes('market') ? localMarket(world) : [],
    neighbours: active.includes('neighbours') ? neighbours(world) : [],
    theyObeyYou: commandableByPlayer(other, world.player.id),
    stance: stanceTo(world, other),
    grievanceLevel: other.ai?.grievance ?? 0,
    combatEnemy: other.faction === 'hostile',
    mood: moodTo(world, other),
    allowedIntents,
    // Узнаёт, если виделись РАНЬШЕ (встреча не первая) ИЛИ в журнале уже есть что-то
    // сверх самого знакомства (сделка, просьба, факт) — тогда встреча памятная.
    metBefore: (record?.meetings ?? 0) > 1 || (record?.history.length ?? 0) > 1,
    history: record ? historyLines(record.history) : [],
    entrusted: record ? entrustedLines(record.entrusted) : [],
    economy: {
      commanderCredits: world.credits,
      escortFee: fee,
      escortHired,
      canAffordEscort: fee != null && world.credits >= fee,
    },
    station: buildStationSnapshot(world, at.docked),
    activeDigests: [...active],
    forgottenDigests: [...forgotten],
    freshDigests: [...freshDigests],
  }
}
