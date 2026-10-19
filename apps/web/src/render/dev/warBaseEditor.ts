import { Vector3 } from 'three'
import { WARBASE, warBaseGrid, warBaseIntegrity, type WarBaseEntity, type World } from '@elite/sim'
import { consumePress } from '../../platform/input/input'

/**
 * ДЕВ-РЕДАКТОР ВОЕННОЙ БАЗЫ: подобрать габарит и набивку глазами, а не наугад в конфиге.
 *
 * Работает по АКТИВНОЙ ЦЕЛИ: навёлся на базу (Shift+Tab) — правишь её. Отдельного режима
 * нет намеренно, поэтому и захват ввода не нужен: цифры 5–9 в полёте ничем не заняты, а
 * без выбранной базы они молчат.
 *
 *   6 / 7 — диаметр базы меньше / больше
 *   8 / 9 — снять деталь / поставить деталь в свободную клетку
 *   5     — напечатать в консоль готовый конфиг: и числа для `config/warbase`, и запись
 *           базы для `SystemDef`, чтобы найденное не пришлось переписывать с экрана
 *
 * Места берутся из ТОЙ ЖЕ сетки, по которой база строится в домене (кварталы вдоль широт
 * и меридианов): редактор не выдумывает свою раскладку, иначе подобранное им не совпало бы
 * с тем, что построит генератор.
 */

/** Шаг изменения диаметра за нажатие. */
const SIZE_STEP = 1.12
/** Ниже и выше не пускаем: база перестаёт быть базой. */
const RADIUS_MIN = 200
const RADIUS_MAX = 20_000

/** Активная нав-цель, если это живая база. */
function targetBase(world: World): WarBaseEntity | null {
  if (world.targetFocus !== 'nav' || world.navTargetId === null) return null
  return world.warBases.find((b) => b.id === world.navTargetId && b.alive) ?? null
}

/** Занята ли клетка. Порог — середина шага до соседа на экваторе, иначе на крупной сетке сосед считается той же клеткой. */
function occupied(base: WarBaseEntity, cell: Vector3, cols: number): boolean {
  const limit = Math.cos(Math.PI / cols)
  return base.fixtures.some((f) => f.alive && f.dir.dot(cell) > limit)
}

/** Изменить диаметр шара. Пушки остаются своего калибра: большая база — это больше шар, не крупнее детали. */
function resize(base: WarBaseEntity, factor: number): void {
  base.radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, base.radius * factor))
}

/** Поставить деталь в случайную СВОБОДНУЮ клетку сетки. Нет свободных — молчим. */
function addFixture(world: World, base: WarBaseEntity): boolean {
  const { cells, cols } = warBaseGrid(base.radius)
  const free = cells.filter((c) => !occupied(base, c, cols))
  if (free.length === 0) return false
  const cell = free[Math.floor(world.rng() * free.length)]!
  const size = WARBASE.FIXTURE_SIZE_MIN + world.rng() * (WARBASE.FIXTURE_SIZE_MAX - WARBASE.FIXTURE_SIZE_MIN)
  const dir = base.fixtures[0]!.dir.clone().set(cell.x, cell.y, cell.z).normalize()
  base.fixtures.push({
    id: world.ids.next(),
    model: 1 + Math.floor(world.rng() * WARBASE.FIXTURE_MODELS),
    dir,
    size,
    roll: world.rng() * Math.PI * 2,
    // Свежая турель заряжена и смотрит куда поставили: её ведение начнётся со следующего кадра.
    cooldown: 0,
    burstLeft: 0,
    shotIn: 0,
    hitsLeft: WARBASE.FIXTURE_HITS,
    lastHitAt: -Infinity,
    alive: true,
  })
  return true
}

/** Снять последнюю поставленную деталь — «отменить» для 9. Полюсные башни не трогаем. */
function removeFixture(base: WarBaseEntity): boolean {
  for (let i = base.fixtures.length - 1; i >= 0; i--) {
    const f = base.fixtures[i]!
    if (!f.alive || Math.abs(f.dir.y) > 0.99) continue
    base.fixtures.splice(i, 1)
    return true
  }
  return false
}

/** Готовый конфиг в консоль: и числа каталога, и запись базы для системы. */
function dump(base: WarBaseEntity): void {
  const alive = base.fixtures.filter((f) => f.alive)
  const sizes = alive.map((f) => f.size)
  const min = sizes.length ? Math.min(...sizes) : 0
  const max = sizes.length ? Math.max(...sizes) : 0
  const { cells } = warBaseGrid(base.radius)
  console.log(
    [
      `// база «${base.name}»: деталей ${alive.length}, живучесть ${(warBaseIntegrity(base) * 100).toFixed(0)}%`,
      `{ name: '${base.name}', radius: ${Math.round(base.radius)}, stationOffset: [?, ?, ?], model: ${base.shape} },`,
      `// калибр деталей ${min.toFixed(0)}…${max.toFixed(0)} м`,
      `// сетка на этом радиусе: ${cells.length} клеток`,
    ].join('\n'),
  )
}

/**
 * Шаг редактора базы. Зовётся из сцены каждый кадр; без выбранной базы ничего не делает,
 * поэтому цифры остаются свободны для всего прочего.
 */
export function stepWarBaseEditor(world: World): void {
  const base = targetBase(world)
  if (!base) return

  if (consumePress('Digit6')) resize(base, 1 / SIZE_STEP)
  if (consumePress('Digit7')) resize(base, SIZE_STEP)
  if (consumePress('Digit8')) removeFixture(base)
  if (consumePress('Digit9')) addFixture(world, base)
  if (consumePress('Digit5')) dump(base)
}
