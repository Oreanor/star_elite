import type { StarSystem } from './types'

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
}

function withOverride(s: StarSystem, o: Override): StarSystem {
  // Ни одного поля — вернуть тот же объект (не плодим копий: горячий путь чтения карты).
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
    }
  }

  const result = base.map((s, i) => {
    const o = overrides.get(i)
    return o ? withOverride(s, o) : s
  })
  return added.length ? [...result, ...added] : result
}
