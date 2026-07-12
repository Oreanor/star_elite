import type { CargoItem, Commodity, LifeLevel, ShipModule } from '@elite/sim'
import { currentLang, t, type Key } from './i18n'

/**
 * Перевод ДАННЫХ, а не хрома. Домен авторит имена по-русски (товары, модули, расы) —
 * это его канон и запас на случай, если ключа тут нет. Интерфейс же переводит их по
 * `id`: домену язык знать незачем, а игроку на английском не должно лезть «Двигатель».
 *
 * Таблицы плоские и по id: новый модуль — новая строка, не ветвление. Нет строки —
 * показываем русское имя из домена, а не пустоту: игра не ломается на пропущенном
 * переводе, он лишь виден как недоделка.
 */

const COMMODITY_EN: Record<string, string> = {
  scrap: 'Scrap',
  food: 'Food',
  minerals: 'Ore',
  metals: 'Metals',
  machinery: 'Machinery',
  electronics: 'Electronics',
  slaves: 'Slaves',
  luxuries: 'Luxuries',
  narcotics: 'Narcotics',
}

const MODULE_EN: Record<string, string> = {
  engine_1e: 'Drive 1E «Civilian»',
  engine_2c: 'Drive 2C «Standard»',
  engine_3a: 'Drive 3A «Military»',
  engine_1d: 'Drive 1D «Civilian»',
  engine_2b: 'Drive 2B «Standard»',
  engine_2a: 'Drive 2A «Swift»',
  engine_3b: 'Drive 3B «Swift»',
  engine_3c: 'Drive 3C «Military»',
  rcs_1e: 'Thrusters 1E',
  rcs_2c: 'Thrusters 2C',
  rcs_3a: 'Thrusters 3A «Military»',
  rcs_1d: 'Thrusters 1D «Civilian»',
  rcs_2b: 'Thrusters 2B «Standard»',
  rcs_2a: 'Thrusters 2A «Vortex»',
  rcs_3b: 'Thrusters 3B «Vortex»',
  rcs_3c: 'Thrusters 3C «Military»',
  shield_1e: 'Shield 1E',
  shield_2c: 'Shield 2C',
  shield_3a: 'Shield 3A «Bastion»',
  shield_1d: 'Shield 1D',
  shield_2b: 'Shield 2B',
  shield_2a: 'Shield 2A «Mirage»',
  shield_3b: 'Shield 3B «Mirage»',
  shield_3c: 'Shield 3C «Bastion»',
  armour_1: 'Armour Plating',
  armour_2: 'Composite Armour',
  armour_2d: 'Armour 2D «Steel»',
  armour_3c: 'Armour 3C «Steel»',
  armour_2b: 'Armour 2B «Composite»',
  armour_1c: 'Armour 1C «Cermet»',
  armour_2a: 'Armour 2A «Cermet»',
  armour_3a: 'Armour 3A «Cermet»',
  pulse_0: 'Pulse Laser 0 «Worn»',
  pulse_1: 'Pulse Laser 1',
  pulse_2: 'Pulse Laser 2',
  beam_2: 'Beam Laser 2',
  pulse_1a: 'Pulse Laser 1A',
  beam_1: 'Beam Laser 1',
  beam_3: 'Beam Laser 3 «Blade»',
  rotary_1: 'Rotary Laser 1 «Gadfly»',
  rotary_2: 'Rotary Laser 2 «Squall»',
  plasma_2: 'Plasma Cannon 2 «Harpoon»',
  plasma_3: 'Plasma Cannon 3 «Ram»',
  missile_p: 'Missile «Hornet»',
  missile_1: 'Missile «Seeker»',
  missile_2: 'Missile «Hammer»',
  missile_pe: 'Missile 1E «Sting»',
  missile_pa: 'Missile 1A «Wasp»',
  missile_1e: 'Missile 1E «Pack»',
  missile_1b: 'Missile 1B «Hound»',
  missile_2a: 'Missile 2A «Sledge»',
  cargo_1: 'Cargo Rack 1',
  cargo_2: 'Cargo Rack 2',
  cargo_3: 'Cargo Rack 3',
  cargo_1a: 'Cargo Bay 1A «Composite»',
  cargo_2a: 'Cargo Bay 2A «Composite»',
  cargo_3a: 'Cargo Bay 3A «Composite»',
  cargo_2h: 'Cargo Hold 2E «Bulker»',
  cargo_3h: 'Cargo Hold 3E «Bulker»',
  hyper_1: 'Hyperdrive 1E «Arcane»',
  hyper_2: 'Hyperdrive 2C «Meridian»',
  hyper_3: 'Hyperdrive 3A «Deep»',
  hyper_1a: 'Hyperdrive 1C «Swift»',
  hyper_2a: 'Hyperdrive 2A «Swift»',
  hyper_2h: 'Hyperdrive 2E «Hauler»',
  hyper_3h: 'Hyperdrive 3E «Hauler»',
  drone_gun: 'Drone Laser',
  drone_bay: 'Drone Bay «Swarm»',
  drone_bay_e: 'Drone Bay «Flight»',
  drone_bay_a: 'Drone Bay «Legion»',
  cloak_1: 'Cloak Field «Veil»',
  cloak_1e: 'Cloak Field «Haze»',
  cloak_2: 'Cloak Field «Phantom»',
}

/** Виды — именованные, переводим целиком. Четыре: земляне, гуманоиды, фелиды, синтеты. */
const SPECIES_EN: Record<string, string> = {
  'Земляне': 'Earthers',
  'Гуманоиды': 'Humanoids',
  'Фелиды': 'Felids',
  'Синтеты': 'Synths',
}

const en = (): boolean => currentLang() === 'en'

export function commodityName(c: Commodity): string {
  return en() ? COMMODITY_EN[c.id] ?? c.name : c.name
}

export function moduleName(m: ShipModule): string {
  return en() ? MODULE_EN[m.id] ?? m.name : m.name
}

/** Имя расы: сперва целиком (люди), иначе по словам — русские части через пробел. */
export function speciesName(s: string): string {
  if (!en()) return s
  if (SPECIES_EN[s]) return SPECIES_EN[s]
  return s.split(' ').map((w) => SPECIES_EN[w] ?? w).join(' ')
}

/** Имя предмета трюма на языке интерфейса — товар с количеством, модуль по id. */
export function itemDisplayName(item: CargoItem): string {
  return item.kind === 'commodity' ? `${commodityName(item.commodity)} ×${item.units}` : moduleName(item.module)
}

/**
 * СОБСТВЕННЫЕ имена — системы, планеты, луны, станции, галактики — собраны доменом
 * из русских слогов. Переводить их нечем (это не слова, а звучание), поэтому в
 * английском они РОМАНИЗИРУЮТСЯ: «Даррион» → «Darrion». Единая транслитерация, а не
 * таблица: имён бесконечно много, они генерятся из зерна.
 *
 * Общие же имена, прилипшие к собственному, — тип станции («Кориолис»), само «Ядро» —
 * это слова, и они переводятся честно (как и просили): транслит для них дал бы
 * «Koriolis», а не «Coriolis».
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
}

function translit(name: string): string {
  let out = ''
  for (const ch of name) {
    const low = ch.toLowerCase()
    const mapped = TRANSLIT[low]
    if (mapped === undefined) {
      out += ch // латиница, цифры, пробелы, римские номера планет — как есть
      continue
    }
    // Заглавную кириллицу отдаём заглавной латиницей: «Даррион», не «дarrion».
    out += ch === low || mapped === '' ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1)
  }
  return out
}

/** Общие слова, приросшие к собственным именам, — переводятся, а не романизируются. */
const PLACE_EN: Record<string, string> = { 'Ядро': 'Core' }
const STATION_TYPE_EN: Record<string, string> = {
  'Кориолис': 'Coriolis',
  'Орбис': 'Orbis',
  'Аванпост': 'Outpost',
}

export function properName(name: string): string {
  if (!en()) return name
  const place = PLACE_EN[name]
  if (place) return place
  // Станция зовётся «Тип «Имя»»: тип переводим, имя внутри кавычек — транслитом.
  const station = /^(.+?) «(.+)»$/.exec(name)
  if (station) {
    const type = STATION_TYPE_EN[station[1]!] ?? translit(station[1]!)
    return `${type} «${translit(station[2]!)}»`
  }
  return translit(name)
}

// ─── Доменные перечисления: EN-таблица, откат на русский канон домена ───────────

const STAR_CLASS_EN: Record<string, string> = {
  O: 'Blue giant', B: 'Blue-white', A: 'White', F: 'Yellow-white', G: 'Yellow dwarf',
  K: 'Orange dwarf', M: 'Red dwarf', D: 'White dwarf', T: 'Brown dwarf',
  N: 'Neutron star', H: 'Black hole',
}

export function starClassName(star: { class: string; className: string }): string {
  return en() ? STAR_CLASS_EN[star.class] ?? star.className : star.className
}

const GALAXY_SHAPE_EN: Record<string, string> = {
  barred: 'Barred spiral', spiral: 'Spiral', elliptical: 'Elliptical',
  irregular: 'Irregular', lenticular: 'Lenticular', ring: 'Ring',
}

export function galaxyShapeName(shape: { id: string; name: string }): string {
  return en() ? GALAXY_SHAPE_EN[shape.id] ?? shape.name : shape.name
}

/** Типы кораблей трафика — это слова («Пират», «Торговец»), а не собственные имена:
 *  переводятся, а не романизируются. Нет в таблице (напр. имя шасси) — откат на properName. */
const SHIP_TYPE_EN: Record<string, string> = {
  'Торговец': 'Trader',
  'Караван': 'Convoy',
  'Пират': 'Pirate',
  'Стая': 'Pack',
  'Налётчик': 'Raider',
  'Патруль': 'Patrol',
  'Грузовик': 'Freighter',
  'Аврора': 'Aurora',
}

export function shipTypeName(name: string): string {
  if (!en()) return name
  return SHIP_TYPE_EN[name] ?? properName(name)
}

/**
 * Род занятий по ТИПУ ВСТРЕЧИ (`originKind`), а не по имени борта: имя после знакомства
 * становится личным, а занятие остаётся. Внешне читаемое — показываем в диалоге сразу,
 * чтобы не позвать в напарники пирата вслепую. Неизвестный тип — откат по фракции.
 */
const OCCUPATION_RU: Record<string, string> = {
  trader: 'Торговец', convoy: 'Торговец', pirate: 'Пират', gang: 'Пират',
  raider: 'Налётчик', police: 'Патрульный', freighter: 'Дальнобойщик', platform: 'Пират',
}
const OCCUPATION_EN: Record<string, string> = {
  trader: 'Trader', convoy: 'Trader', pirate: 'Pirate', gang: 'Pirate',
  raider: 'Raider', police: 'Patrol officer', freighter: 'Hauler', platform: 'Pirate',
}
const OCCUPATION_FACTION_RU: Record<string, string> = {
  hostile: 'Пират', police: 'Патрульный', neutral: 'Гражданский', player: 'Пилот',
}
const OCCUPATION_FACTION_EN: Record<string, string> = {
  hostile: 'Pirate', police: 'Patrol officer', neutral: 'Civilian', player: 'Pilot',
}

export function occupationName(originKind: string | null, faction: string): string {
  const byKind = en() ? OCCUPATION_EN : OCCUPATION_RU
  if (originKind && byKind[originKind]) return byKind[originKind]!
  const byFaction = en() ? OCCUPATION_FACTION_EN : OCCUPATION_FACTION_RU
  return byFaction[faction] ?? (en() ? 'Pilot' : 'Пилот')
}

/**
 * Профессия ИГРОКА словом (самоназвание, `persona.profession`). Публичный род занятий:
 * его открыто видит собеседник и относится соответственно, за правду. Пустая (старый
 * сейв без выбора) — нейтральный «вольный делец».
 */
const PROFESSION_RU: Record<string, string> = {
  traveler: 'Путешественник', explorer: 'Исследователь', businessman: 'Бизнесмен',
  military: 'Военный', pirate: 'Пират',
}
const PROFESSION_EN: Record<string, string> = {
  traveler: 'Traveler', explorer: 'Explorer', businessman: 'Businessman',
  military: 'Serviceman', pirate: 'Pirate',
}
export function professionName(profession: string | undefined): string {
  const by = en() ? PROFESSION_EN : PROFESSION_RU
  return (profession && by[profession]) || (en() ? 'Free agent' : 'вольный делец')
}

/** Имена корпусов — собственные (бренд): в RU как есть, в EN по таблице. */
const CHASSIS_EN: Record<string, string> = {
  'Аврора Мк III': 'Aurora Mk III',
  'Арес': 'Ares',
  'Деметра': 'Demeter',
  'Каллиопа': 'Calliope',
  'Аполлон': 'Apollo',
  'Артемида': 'Artemis',
  'Афина': 'Athena',
}

export function chassisName(name: string): string {
  return en() ? CHASSIS_EN[name] ?? name : name
}

const SECURITY_EN: Record<string, string> = {
  'Нет': 'None', 'Низкая': 'Low', 'Средняя': 'Medium', 'Высокая': 'High',
}

export function securityName(security: string): string {
  return en() ? SECURITY_EN[security] ?? security : security
}

/** Ступень жизни в системе — доменное перечисление, переводится по ключу UI. */
const LIFE_KEY: Record<LifeLevel, Key> = {
  none: 'map.life.none',
  primitive: 'map.life.primitive',
  developed: 'map.life.developed',
  advanced: 'map.life.advanced',
}

export function lifeName(level: LifeLevel): string {
  return t(LIFE_KEY[level])
}

/**
 * Экономика и строй генератор пишет по-русски («Промышленная», «Демократия»).
 * Переводятся по словарю UI (ключи `econ.*`/`gov.*`), общие для паспорта станции и
 * карты галактики: домену язык знать незачем.
 */
const ECON_KEY: Record<string, Key> = {
  'Аграрная': 'econ.agri',
  'Добывающая': 'econ.extract',
  'Перерабатывающая': 'econ.refine',
  'Промышленная': 'econ.industrial',
  'Высокие технологии': 'econ.hightech',
  'Туризм': 'econ.tourism',
  'Сервисная': 'econ.service',
}

const GOV_KEY: Record<string, Key> = {
  'Анархия': 'gov.anarchy',
  'Феодализм': 'gov.feudal',
  'Многовластие': 'gov.multi',
  'Диктатура': 'gov.dictator',
  'Коммунизм': 'gov.communist',
  'Конфедерация': 'gov.confed',
  'Демократия': 'gov.democracy',
  'Корпорация': 'gov.corporate',
}

export function economyName(economy: string): string {
  const key = ECON_KEY[economy]
  return key ? t(key) : economy
}

export function governmentName(government: string): string {
  const key = GOV_KEY[government]
  return key ? t(key) : government
}
