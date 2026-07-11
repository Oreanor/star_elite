import { HUMAN_SPECIES, SYNTH_SPECIES } from '../../config/galaxy'
import type { Rng } from '../../core/math'

/**
 * Имена пилотов — ПО ВИДУ, чтобы имя не спорило с расой (робот-синтет не должен
 * зваться «Иван Петров», а землянин — инопланетным слогом):
 *
 *   • ЗЕМЛЯНЕ — земные имя+фамилия разных культур или позывной «качество+бессмыслица»
 *     («Багровый Кордан»): галактику колонизировали земляне, и голоса у них земные;
 *   • ПРОЧИЕ ВИДЫ (валдри, роботы-синтеты) — произносимые слоговые клички на 2..4
 *     слога, часть через дефис: чуждое, но выговариваемое в эфире.
 *
 * Имя — идентичность ПИЛОТА, а не корабля: он может сменить борт, имя останется
 * (потому оно и живёт в `Acquaintance`, отдельно от `chassisId`). Всё детерминировано
 * от переданного `rng`: то же зерно — тот же пилот, никакого `Math.random()`.
 */

/** Земные имена — по десятку на культуру. Не лор, а живые лица в эфире. */
const EARTH: readonly { readonly first: readonly string[]; readonly last: readonly string[] }[] = [
  {
    // Русские
    first: ['Алексей', 'Дмитрий', 'Иван', 'Сергей', 'Николай', 'Ольга', 'Екатерина', 'Анна', 'Павел', 'Юрий'],
    last: ['Иванов', 'Петров', 'Смирнов', 'Кузнецов', 'Соколов', 'Волков', 'Морозов', 'Новиков', 'Фёдоров', 'Орлов'],
  },
  {
    // Американцы
    first: ['James', 'Michael', 'John', 'Robert', 'William', 'Emily', 'Sarah', 'David', 'Chris', 'Laura'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Taylor', 'Anderson'],
  },
  {
    // Латино
    first: ['Carlos', 'Diego', 'Miguel', 'José', 'Luis', 'María', 'Sofía', 'Juan', 'Pedro', 'Ana'],
    last: ['García', 'Rodríguez', 'Martínez', 'López', 'González', 'Hernández', 'Pérez', 'Sánchez', 'Ramírez', 'Torres'],
  },
  {
    // Индийцы
    first: ['Arjun', 'Rohan', 'Vikram', 'Priya', 'Anjali', 'Rahul', 'Sanjay', 'Deepak', 'Neha', 'Ravi'],
    last: ['Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Reddy', 'Nair', 'Rao', 'Das', 'Iyer'],
  },
  {
    // Китайцы
    first: ['Wei', 'Ming', 'Jian', 'Hui', 'Yan', 'Feng', 'Xiu', 'Chen', 'Bo', 'Lei'],
    last: ['Wang', 'Li', 'Zhang', 'Liu', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou', 'Xu'],
  },
  {
    // Японцы
    first: ['Haruto', 'Yuki', 'Sora', 'Ren', 'Aoi', 'Hana', 'Kaito', 'Riku', 'Yui', 'Sota'],
    last: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato'],
  },
  {
    // Немцы
    first: ['Lukas', 'Felix', 'Maximilian', 'Jonas', 'Leon', 'Anna', 'Lena', 'Paul', 'Niklas', 'Emma'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann'],
  },
]

/** Слоги для бессмысленных кличек. Важно звучание, а не значение: борт должен произноситься. */
const SYLL = [
  'ка', 'ре', 'ми', 'то', 'лу', 'на', 'зи', 'во', 'рэ', 'ша', 'ло', 'ки', 'ту', 'ва', 'не',
  'сар', 'кор', 'тир', 'вел', 'мон', 'рин', 'тас', 'гол', 'фер', 'дан', 'лек', 'ном', 'рад', 'сен', 'вик',
]

/** Качество для позывного: цвет или иная черта. «Багровый Кордан», «Тихий Вельмо». */
const QUALITY = [
  'Багровый', 'Синий', 'Чёрный', 'Белый', 'Алый', 'Серый', 'Зелёный', 'Янтарный', 'Стальной', 'Пепельный',
  'Тихий', 'Быстрый', 'Кривой', 'Дикий', 'Хладный', 'Резкий', 'Двойной', 'Последний', 'Ржавый', 'Немой',
]

/** Смысловая приставка-обозначение робота-синтета: «Юнит Тарэ», «Блок Мирон-Ка». */
const SYNTH_PREFIX = ['Юнит', 'Блок', 'Модель', 'Серия', 'Контур', 'Ядро', 'Протокол', 'Индекс', 'Каркас', 'Реестр']

/**
 * Числа-«серийники» синтетов в ОДНОМ пуле: круглые модельные и заодно культовые
 * номера (2101, 969, 911, 2108) — они просто входят сюда, без отдельной ветки.
 */
const SYNTH_NUM = [2101, 969, 911, 2108, 2000, 3000, 5000, 8000, 9000]
/** Буквенные «комплектации» в духе автомобильных: «-GT», «-8G», «-3000GT». */
const SYNTH_TAGS = ['GT', 'RS', 'X', 'S', 'SE', 'Pro', 'Mk2', 'Mk3', '8G', '16V', 'Turbo']

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]!
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Слоговое слово в `min..max` слогов. */
function syllWord(rng: Rng, min: number, max: number): string {
  const n = min + Math.floor(rng() * (max - min + 1))
  let word = ''
  for (let i = 0; i < n; i++) word += pick(rng, SYLL)
  return cap(word)
}

/** Слоговое имя: одно-два слова по 2..4 слога, изредка — двойное через дефис. */
function syllableName(rng: Rng): string {
  if (rng() < 0.25) return `${syllWord(rng, 1, 2)}-${syllWord(rng, 1, 2)}`
  const first = syllWord(rng, 2, 4)
  return rng() < 0.4 ? `${first} ${syllWord(rng, 2, 3)}` : first
}

/** Позывной: качество + бессмыслица. */
function callsign(rng: Rng): string {
  return `${pick(rng, QUALITY)} ${syllWord(rng, 2, 3)}`
}

/** Земное имя: имя и фамилия ОДНОЙ культуры — смешивать «Ивана Танаку» незачем. */
function earthName(rng: Rng): string {
  const culture = pick(rng, EARTH)
  return `${pick(rng, culture.first)} ${pick(rng, culture.last)}`
}

/**
 * «Серийник» синтета разными окончаниями: культовый номер-пасхалка (2101, 911…),
 * круглое число («3000», «5000+»), буквенная комплектация («GT», «8G») или их
 * комбинация («3000GT»), а то и просто число. Строкой — суффиксы бывают не-числовые.
 */
function synthModel(rng: Rng): string {
  const r = rng()
  if (r < 0.3) return String(pick(rng, SYNTH_NUM))
  if (r < 0.45) return `${pick(rng, SYNTH_NUM)}+`
  if (r < 0.6) return pick(rng, SYNTH_TAGS)
  if (r < 0.75) return `${pick(rng, SYNTH_NUM)}${pick(rng, SYNTH_TAGS)}`
  return String(100 + Math.floor(rng() * 9900))
}

/** Имя синтета: приставка-обозначение + слоговое ядро + «серийник». «Юнит Тарэ-3000GT». */
function synthName(rng: Rng): string {
  return `${pick(rng, SYNTH_PREFIX)} ${syllableName(rng)}-${synthModel(rng)}`
}

/**
 * Имя пилота ПО ВИДУ. Земляне — земные имена (чаще) и позывные; синтеты — приставка
 * плюс слоговое ядро; прочие гуманоиды (валдри) — слоговые клички.
 */
export function makePilotName(rng: Rng, species: string): string {
  if (species === HUMAN_SPECIES) return rng() < 0.72 ? earthName(rng) : callsign(rng)
  if (species === SYNTH_SPECIES) return synthName(rng)
  return syllableName(rng)
}
