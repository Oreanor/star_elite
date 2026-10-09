import { WARBASE, warBaseIntegrity, type WarBaseEntity, type World } from '@elite/sim'
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

/**
 * Клетки сетки — те же, что кладёт `layoutFixtures`: ряды по широте, колонны по длине
 * параллели, чётные ряды сдвинуты на полшага. Здесь считается только НАПРАВЛЕНИЕ клетки,
 * занятость решает вызывающий.
 */
function gridCells(): { x: number; y: number; z: number }[] {
  const cells: { x: number; y: number; z: number }[] = []
  for (let r = 0; r < WARBASE.GRID_ROWS; r++) {
    const lat = WARBASE.SPIRAL_LAT * (1 - 2 * ((r + 0.5) / WARBASE.GRID_ROWS))
    const ring = Math.sqrt(Math.max(0, 1 - lat * lat))
    const cols = Math.max(2, Math.round(WARBASE.GRID_COLS * ring))
    const shift = (r % 2) * 0.5
    for (let c = 0; c < cols; c++) {
      const phi = ((c + shift) / cols) * Math.PI * 2
      cells.push({ x: Math.cos(phi) * ring, y: lat, z: Math.sin(phi) * ring })
    }
  }
  return cells
}

/** Занята ли клетка: деталь стоит достаточно близко к её направлению. */
function occupied(base: WarBaseEntity, cell: { x: number; y: number; z: number }): boolean {
  return base.fixtures.some((f) => f.alive && f.dir.x * cell.x + f.dir.y * cell.y + f.dir.z * cell.z > 0.985)
}

/** Изменить диаметр. Детали растут вместе с базой: их калибр — доля радиуса. */
function resize(base: WarBaseEntity, factor: number): void {
  const next = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, base.radius * factor))
  const k = next / base.radius
  base.radius = next
  for (const f of base.fixtures) f.size *= k
}

/** Поставить деталь в случайную СВОБОДНУЮ клетку сетки. Нет свободных — молчим. */
function addFixture(world: World, base: WarBaseEntity): boolean {
  const free = gridCells().filter((c) => !occupied(base, c))
  if (free.length === 0) return false
  const cell = free[Math.floor(world.rng() * free.length)]!
  const size =
    base.radius * (WARBASE.FIXTURE_SIZE_MIN + world.rng() * (WARBASE.FIXTURE_SIZE_MAX - WARBASE.FIXTURE_SIZE_MIN))
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
  const sizes = alive.map((f) => f.size / base.radius)
  const min = sizes.length ? Math.min(...sizes) : 0
  const max = sizes.length ? Math.max(...sizes) : 0
  console.log(
    [
      `// база «${base.name}»: деталей ${alive.length}, живучесть ${(warBaseIntegrity(base) * 100).toFixed(0)}%`,
      `{ name: '${base.name}', radius: ${Math.round(base.radius)}, stationOffset: [?, ?, ?], model: ${base.shape} },`,
      `// config/warbase: FIXTURES ≈ ${alive.length}, FIXTURE_SIZE ${min.toFixed(3)}…${max.toFixed(3)}`,
      `// сетка: GRID_ROWS ${WARBASE.GRID_ROWS}, GRID_COLS ${WARBASE.GRID_COLS} → клеток ${gridCells().length}`,
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
