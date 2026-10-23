import { FAUNA_SPECIES } from '../../config/galaxy'
import type { Planet, StarSystem } from './types'

/**
 * ДЕЛЬТА ГАЛАКТИКИ — правки бога поверх сид-галактики.
 *
 * Сид даёт неизменную БАЗУ: галактика — чистая функция зерна (`generateGalaxy`), одинаковая
 * при каждом запуске, её не хранят. Но бог-редактор двигает, красит, убирает и добавляет
 * звёзды. Держать это МУТАЦИЕЙ базы нельзя: тогда пропадёт детерминизм, а с ним сеть и
 * сохранения. Поэтому правки живут ОТДЕЛЬНО — списком операций поверх базы:
 *
 *  • сохранение крохотное (только правки, не 2500 систем);
 *  • синхронизация по сети — те же операции;
 *  • ОТКАТ возможен: убери правку из списка — база проступит как была.
 *
 * Ключ правки — стабильный `index` системы (он же место в сетке и вход генератора). Двигаем
 * и красим ПО ИНДЕКСУ, НЕ переиндексируя: сменить индекс значит пересобрать всю систему
 * (имя, звезду, планеты — см. `generate.ts`). Удаление не сдвигает массив (индекс = место в
 * нём у читателей карты) — слот держим, а факт удаления сообщаем предикатом `removedIndices`.
 * Добавленные системы получают индексы В ХВОСТ (≥ base.length), не трогая существующие.
 */

/** Одна правка. Union по `op`: новая операция — новый член, а не ветка в применении (OCP). */
export type GalaxyEdit =
  | { op: 'move'; index: number; x: number; y: number; z: number }
  | { op: 'recolor'; index: number; color: number }
  | { op: 'rename'; index: number; name: string }
  | { op: 'remove'; index: number }
  | { op: 'add'; system: StarSystem }
  | FateEdit

/**
 * СУДЬБА ТЕЛА СИСТЕМЫ — космический лазер засеял мир жизнью или разбил тело. Это правка
 * ГАЛАКТИКИ, а не мира одного клиента: ложится в тот же общий журнал, что и правки бога, и
 * видна всем — и тем, кто сейчас в системе (`reconcileFates`), и тем, кто войдёт позже.
 *
 * Тело адресуется ярлыком каталога (`BodyEntity.ref`): 'star', 'star:1' (компаньон двойной),
 * 'planet:2', 'moon:2:0', 'pair:0:1' (звезда декоративной тесной пары). Ярлык — из места тела
 * в описании системы, поэтому один и тот же у всех клиентов и после перезахода.
 *
 * `at` — календарь мига (`world.calendarTime`): по нему клиент решает, показывать ли взрыв
 * (свежая правка) или молча принять итог (старая, пришла при входе). И по нему же луны и
 * причал разбитой планеты встают на орбиту звезды там, где их застал взрыв.
 */
export interface FateEdit {
  op: 'fate'
  index: number
  ref: string
  fate: 'shatter' | 'seed'
  at: number
}

/** Изменяемый оверлей поверх базы. Пустой — галактика ровно как из зерна. */
export interface GalaxyDelta {
  edits: GalaxyEdit[]
}

export function emptyDelta(): GalaxyDelta {
  return { edits: [] }
}

/** Дописать правку в журнал (append-only — так возможен откат снятием последней). */
export function pushEdit(delta: GalaxyDelta, edit: GalaxyEdit): void {
  delta.edits.push(edit)
}

/** Откатить последнюю правку. Возвращает снятую или null, если журнал пуст. */
export function popEdit(delta: GalaxyDelta): GalaxyEdit | null {
  return delta.edits.pop() ?? null
}

/** Судьбы тел одной системы в порядке журнала. Мир применяет их сам (`reconcileFates`). */
export function fateEdits(delta: GalaxyDelta, index: number): FateEdit[] {
  return delta.edits.filter((e): e is FateEdit => e.op === 'fate' && e.index === index)
}

/** Индексы систем, СКРЫТЫХ богом. Слот в массиве держим — читатель просто их пропускает. */
export function removedIndices(delta: GalaxyDelta): Set<number> {
  const out = new Set<number>()
  for (const e of delta.edits) {
    if (e.op === 'remove') out.add(e.index)
  }
  return out
}

/** Поля-переопределения одной системы, собранные из правок (поздняя перекрывает раннюю). */
interface Override {
  x?: number
  y?: number
  z?: number
  color?: number
  name?: string
  /** Судьбы тел этой системы по ярлыку (поздняя перекрывает раннюю). */
  fates?: Map<string, FateEdit['fate']>
}

/** Цвет остатка звезды на карте: тусклая туманность там, где светило растворилось. */
const REMNANT_COLOR = 0x4a3a52

/**
 * Засеянный мир: только ПЕРВОБЫТНАЯ жизнь (тех 1, фауна, без причала). Разум и станции
 * вырастают веками, а не от луча; правило мира то же, что у генератора (тех ≤ 4 — фауна).
 */
function seededPlanet(p: Planet): Planet {
  if (p.settlement) return p
  return {
    ...p,
    type: p.type === 'Скалистая' || p.type === 'Ледяная' ? 'Земного типа' : p.type,
    settlement: { economy: 'Аграрная', government: 'Анархия', techLevel: 1, population: 0.05, species: FAUNA_SPECIES },
  }
}

/** Применить судьбы к системе. Разбитые тела помечаются `remnant`, а не вынимаются: индекс = ярлык. */
function withFates(s: StarSystem, fates: Map<string, FateEdit['fate']>): StarSystem {
  const planets = s.planets.map((p, i) => {
    let out = p
    if (fates.get(`planet:${i}`) === 'seed') out = seededPlanet(out)
    if (fates.get(`planet:${i}`) === 'shatter') out = { ...out, remnant: true }
    const moons = out.moons.map((m, k) => (fates.get(`moon:${i}:${k}`) === 'shatter' ? { ...m, remnant: true } : m))
    return moons.some((m, k) => m !== out.moons[k]) ? { ...out, moons } : out
  })
  const starGone = fates.get('star') === 'shatter'
  const companionGone = fates.get('star:1') === 'shatter'
  // Одиночное светило растворилось — на карте тусклый остаток. У двойной светилом
  // системы становится выживший: его класс и цвет, а пары больше нет.
  const companion = companionGone ? null : s.companion
  const star = !starGone ? s.star : companion ?? { ...s.star, color: REMNANT_COLOR, scoopable: false }
  return { ...s, planets, star, companion: starGone ? null : companion }
}


function withOverride(s: StarSystem, o: Override): StarSystem {
  // Ни одного поля — вернуть тот же объект (не плодим копий: горячий путь чтения карты).
  if (o.fates) s = withFates(s, o.fates)
  if (o.x === undefined && o.y === undefined && o.z === undefined && o.color === undefined && o.name === undefined) {
    return s
  }
  return {
    ...s,
    x: o.x ?? s.x,
    y: o.y ?? s.y,
    z: o.z ?? s.z,
    name: o.name ?? s.name,
    // Цвет — вложенное поле звезды: пересобираем звезду, не мутируя исходную.
    star: o.color === undefined ? s.star : { ...s.star, color: o.color },
  }
}

/**
 * Применить дельту к базовой галактике → НОВЫЙ список (база не тронута ни в одном элементе).
 * Правки идут по порядку — поздняя перекрывает раннюю (журнал редактора). Удалённые системы
 * ОСТАЮТСЯ в массиве (индекс = место у читателей); их прячет `removedIndices`, а не пропуск
 * здесь. Добавленные — в хвост, чтобы индексы базы не поехали.
 */
export function applyDelta(base: readonly StarSystem[], delta: GalaxyDelta): StarSystem[] {
  if (delta.edits.length === 0) return base as StarSystem[]

  const overrides = new Map<number, Override>()
  const added: StarSystem[] = []
  const get = (index: number): Override => {
    let o = overrides.get(index)
    if (!o) {
      o = {}
      overrides.set(index, o)
    }
    return o
  }

  for (const e of delta.edits) {
    switch (e.op) {
      case 'move': {
        const o = get(e.index)
        o.x = e.x
        o.y = e.y
        o.z = e.z
        break
      }
      case 'recolor':
        get(e.index).color = e.color
        break
      case 'rename':
        get(e.index).name = e.name
        break
      case 'remove':
        // Ничего не переопределяет — только предикат `removedIndices`; слот остаётся.
        break
      case 'add':
        added.push(e.system)
        break
      case 'fate': {
        const o = get(e.index)
        const fates = (o.fates ??= new Map())
        // Разбитое не засеять: жизнь не вернёт пыль в планету.
        if (fates.get(e.ref) !== 'shatter') fates.set(e.ref, e.fate)
        break
      }
    }
  }

  const result = base.map((s, i) => {
    const o = overrides.get(i)
    return o ? withOverride(s, o) : s
  })
  return added.length ? [...result, ...added] : result
}
