import { figurineTitleName, type CargoItem, type Commodity, type LifeLevel, type ShipModule } from '@elite/sim'
import { currentLang, t, type Key } from './i18n'
import {
  COMMODITY_L,
  COMMODITY_DESC_L,
  FIGURINE_TITLE_L,
  GALAXY_SHAPE_L,
  MODULE_L,
  OCCUPATION_FACTION_L,
  OCCUPATION_L,
  OCCUPATION_PILOT_L,
  PLACE_L,
  PROFESSION_FALLBACK_L,
  PROFESSION_L,
  SECURITY_L,
  SHIP_TYPE_L,
  SPECIES_L,
  STAR_CLASS_L,
  STATION_TYPE_L,
} from './dataTranslations'

/**
 * Перевод ДАННЫХ, а не хрома. Домен авторит имена по-русски (товары, модули, расы) —
 * это его канон и запас на случай, если строки для языка нет. Интерфейс же переводит их
 * по `id`: домену язык знать незачем, а игроку на английском не должно лезть «Двигатель».
 *
 * Таблицы плоские и по языку (`dataTranslations.ts`, генерятся): новый модуль — новая
 * строка, не ветвление. Нет строки — показываем русский канон из домена, а не пустоту:
 * игра не ломается на пропущенном переводе, он лишь виден как недоделка.
 */

type LangTable = Partial<Record<string, Record<string, string>>>

/**
 * Показ значения по языку интерфейса. Русский — доменный канон (он и есть авторитет).
 * Иначе таблица языка; нет строки — снова канон: перевод недоделан, но игра цела.
 */
function pick(table: LangTable, key: string, canon: string): string {
  const lang = currentLang()
  if (lang === 'ru') return canon
  return table[lang]?.[key] ?? canon
}

export function commodityName(c: Commodity): string {
  return pick(COMMODITY_L, c.id, c.name)
}

/** Описание товара на языке интерфейса — откат на русский канон домена, если нет строки. */
export function commodityDesc(c: Commodity): string {
  return pick(COMMODITY_DESC_L, c.id, c.description)
}

export function moduleName(m: ShipModule): string {
  return pick(MODULE_L, m.id, m.name)
}

/** Имя расы: сперва целиком (люди), иначе по словам — русские части через пробел. */
export function speciesName(s: string): string {
  const lang = currentLang()
  if (lang === 'ru') return s
  const table = SPECIES_L[lang]
  if (!table) return s
  if (table[s]) return table[s]!
  return s.split(' ').map((w) => table[w] ?? w).join(' ')
}

/** Имя предмета трюма на языке интерфейса — товар с количеством, модуль по id. */
export function itemDisplayName(item: CargoItem): string {
  if (item.kind === 'module') return moduleName(item.module)
  if (item.commodity.id === 'figurine' && item.specimens && item.specimens.length > 0) {
    const titles = item.specimens.map((s) => figurineTitleLocal(s.titleId))
    return titles.length === 1 ? titles[0]! : titles.map((n) => `«${n}»`).join(', ')
  }
  return `${commodityName(item.commodity)} ×${item.units}`
}

/** Имя экземпляра статуэтки: канон RU из домена, иначе таблица языка. */
export function figurineTitleLocal(titleId: string): string {
  return pick(FIGURINE_TITLE_L, titleId, figurineTitleName(titleId))
}

/**
 * СОБСТВЕННЫЕ имена — системы, планеты, луны, станции, галактики — собраны доменом
 * из русских слогов. Переводить их нечем (это не слова, а звучание), поэтому для любого
 * ЛАТИНСКОГО языка они РОМАНИЗИРУЮТСЯ: «Даррион» → «Darrion». Единая транслитерация, а не
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

export function properName(name: string): string {
  const lang = currentLang()
  if (lang === 'ru') return name
  const place = PLACE_L[lang]?.[name]
  if (place) return place
  // Станция зовётся «Тип «Имя»»: тип переводим, имя внутри кавычек — транслитом.
  const station = /^(.+?) «(.+)»$/.exec(name)
  if (station) {
    const type = STATION_TYPE_L[lang]?.[station[1]!] ?? translit(station[1]!)
    return `${type} «${translit(station[2]!)}»`
  }
  return translit(name)
}

// ─── Доменные перечисления: таблица по языку, откат на русский канон домена ──────

export function starClassName(star: { class: string; className: string }): string {
  return pick(STAR_CLASS_L, star.class, star.className)
}

export function galaxyShapeName(shape: { id: string; name: string }): string {
  return pick(GALAXY_SHAPE_L, shape.id, shape.name)
}

/** Типы кораблей трафика — это слова («Пират», «Торговец»), а не собственные имена:
 *  переводятся, а не романизируются. Нет в таблице (напр. имя шасси) — откат на properName. */
export function shipTypeName(name: string): string {
  const lang = currentLang()
  if (lang === 'ru') return name
  return SHIP_TYPE_L[lang]?.[name] ?? properName(name)
}

/**
 * Род занятий по ТИПУ ВСТРЕЧИ (`originKind`), а не по имени борта: имя после знакомства
 * становится личным, а занятие остаётся. Внешне читаемое — показываем в диалоге сразу,
 * чтобы не позвать в напарники пирата вслепую. Неизвестный тип — откат по фракции.
 */
export function occupationName(originKind: string | null, faction: string): string {
  const lang = currentLang()
  const byKind = OCCUPATION_L[lang] ?? OCCUPATION_L.ru!
  if (originKind && byKind[originKind]) return byKind[originKind]!
  const byFaction = OCCUPATION_FACTION_L[lang] ?? OCCUPATION_FACTION_L.ru!
  return byFaction[faction] ?? OCCUPATION_PILOT_L[lang] ?? OCCUPATION_PILOT_L.ru!
}

/**
 * Профессия ИГРОКА словом (самоназвание, `persona.profession`). Публичный род занятий:
 * его открыто видит собеседник и относится соответственно, за правду. Пустая (старый
 * сейв без выбора) — нейтральный «вольный делец».
 */
export function professionName(profession: string | undefined): string {
  const lang = currentLang()
  const by = PROFESSION_L[lang] ?? PROFESSION_L.ru!
  return (profession && by[profession]) || (PROFESSION_FALLBACK_L[lang] ?? PROFESSION_FALLBACK_L.ru!)
}

/**
 * Имена корпусов — собственные (бренд греческих богов). В RU как есть, в латинских —
 * устоявшееся латинское написание из таблицы (транслит дал бы «Avrora», а не «Aurora»);
 * незнакомого — романизируем, чтобы не текла кириллица.
 */
const CHASSIS_EN: Record<string, string> = {
  'Аврора Мк III': 'Aurora Mk III',
  'Аврора One': 'Aurora One',
  'Арес': 'Ares',
  'Деметра': 'Demeter',
  'Каллиопа': 'Calliope',
  'Аполлон': 'Apollo',
  'Артемида': 'Artemis',
  'Афина': 'Athena',
  'Икар': 'Icarus',
  'Каркинос': 'Karkinos',
  'Гермес': 'Hermes',
  'Персей': 'Perseus',
  'Пегас': 'Pegasus',
  'Орион': 'Orion',
  'Тесей': 'Theseus',
  'Атлас': 'Atlas',
}

export function chassisName(name: string): string {
  const lang = currentLang()
  if (lang === 'ru') return name
  return CHASSIS_EN[name] ?? translit(name)
}

export function securityName(security: string): string {
  return pick(SECURITY_L, security, security)
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
