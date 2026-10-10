import { CHASSIS_CATALOGUE, createLoadout, Modules, refreshSpec, type Chassis, type Hardpoint, type Loadout, type World } from '@elite/sim'
import {
  chassisMeshScale,
  chassisNozzles,
  clearNozzleOverride,
  clearSizeOverride,
  setNozzleOverride,
  setSizeOverride,
  type Nozzle,
} from '../geometry/ships'
import { consumePress, isHeld } from '../../platform/input/input'
import { setInputCaptured } from '../../session/inputCapture'

/**
 * РЕДАКТОР ОСНАСТКИ (клавиша O). Дев-инструмент: за один обход правит у корпуса ВСЁ, что
 * ставится на глаз, — дула, сопла и общий размер. Числа в конфиге раньше ставились наугад
 * и каждая правка стоила перезапуска; здесь корабль показывает точки, лазер бьёт из дул,
 * факел льётся из сопел, а облёт камеры (стрелки без модификатора) остаётся рабочим.
 *
 * Шесть групп в одном списке: три дула (домен, `hardpoints`) и три сопла (рендер, `nozzles`).
 * Пары симметричны по построению — правится ПОЛУРАЗМАХ. Носовое дуло вдвое крупнее калибром
 * (`bore: 2`). У сопла, в отличие от дула, есть РАДИУС (толщина факела).
 *
 *   Shift + ← / →   — пара: шире / уже (одиночная: влево / вправо)
 *   Shift + ↑ / ↓   — выше / ниже
 *   Ctrl  + ↑ / ↓   — вперёд / назад вдоль корпуса
 *   − / =           — радиус группы (только сопла)
 *   6 / 7           — весь корабль меньше / больше (посадочные места растут вместе)
 *   Enter           — следующая группа (закольцованно)
 *   0               — следующий корпус
 *   O               — напечатать конфиг в консоль и выйти
 *
 * Слой — `app/control`: это ввод и состояние сеанса. Дула правим как верфь (КЛОН шасси,
 * каталог неприкосновенен), сопла и размер — через рантайм-оверрайды рендера.
 */

const BASE_RATE = 3
const RAMP = 2
const RAMP_MAX = 4
const RADIUS_RATE = 0.8
const RADIUS_MIN = 0.15
/** Скорость изменения размера, 1/с (экспонента, как рост миелофона). */
const SIZE_RATE = 0.6

export type SlotKind = 'gun' | 'nozzle'
export type GroupKind = 'pair' | 'single'

export interface RigGroup {
  slot: SlotKind
  kind: GroupKind
  label: string
  /** Пара — ПОЛУРАЗМАХ (|x|, ≥0); одиночная — просто x. Метры, В ТЕКУЩЕМ размере. */
  x: number
  y: number
  z: number
  /** Толщина факела — только сопла. */
  radius: number
  /** Класс точки — только дула, переносится в печать. */
  maxClass: Hardpoint['maxClass']
}

const editor = {
  active: false,
  index: 0,
  chassisId: '',
  chassisName: '',
  groups: [] as RigGroup[],
  /** Точки дул редакторского шасси. Мутируем ИХ ЖЕ — `spec.mounts` держит эти объекты. */
  points: [] as Hardpoint[],
  held: 0,
  /** Множитель размера корпуса: копится клавишами 6/7, уходит в печать `scale`/`radius`. */
  sizeMul: 1,
  baseRadius: 12,
  restore: null as Loadout | null,
}

export type RigEditorView = {
  readonly active: boolean
  readonly index: number
  readonly chassisName: string
  readonly sizeMul: number
  readonly groups: readonly RigGroup[]
}

export function rigEditor(): RigEditorView {
  return editor
}

export function rigEditorActive(): boolean {
  return editor.active
}

/** O: включить редактор либо напечатать конфиг и выйти. */
export function toggleRigEditor(world: World): void {
  if (editor.active) exitEditor(world)
  else enterEditor(world)
  // Пока редактор жив, штурвал не должен трактовать Ctrl как ручник (см. inputCapture).
  setInputCaptured(editor.active)
}

/**
 * СЛЕДУЮЩИЙ КОРПУС (клавиша 0). Меняется всё честно — рама, габарит, меш, точки, — это
 * обычная смена `loadout.chassis` плюс пересбор спеки, тот же путь, что у верфи. Редактор
 * перезапускается на новом корпусе с чистым размером: его оснастка принадлежит новой раме.
 */
export function cycleHull(world: World): string {
  const editing = editor.active
  if (editing) exitEditor(world)

  const player = world.player
  const index = CHASSIS_CATALOGUE.findIndex((c) => c.id === player.loadout.chassis.id)
  const next = CHASSIS_CATALOGUE[(index + 1) % CHASSIS_CATALOGUE.length]
  if (!next) return player.loadout.chassis.name

  player.loadout = createLoadout(next, player.loadout.internals, player.loadout.weapons)
  refreshSpec(player)

  if (editing) enterEditor(world)
  return next.name
}

/**
 * Шаг редактора. Возвращает `true`, если стрелки в этом кадре забрал он: тогда вызывающий
 * не отдаёт их камере. Без модификатора стрелки не наши — облёт обязан работать.
 */
export function stepRigEditor(dt: number): boolean {
  if (!editor.active) return false

  if (consumePress('Enter') && editor.groups.length > 0) {
    editor.index = (editor.index + 1) % editor.groups.length
  }

  // Размер корпуса — на 6/7, без модификатора: он множит ВСЮ оснастку разом, чтобы
  // посадочные места росли вместе с силуэтом, а не отставали от него.
  let changed = false
  if (isHeld('Digit6')) { resize(Math.exp(-SIZE_RATE * dt)); changed = true }
  if (isHeld('Digit7')) { resize(Math.exp(SIZE_RATE * dt)); changed = true }

  const group = editor.groups[editor.index]
  if (group) {
    // Радиус — на −/=, только у сопла: у дула толщина не хранится (её задаёт класс/калибр).
    if (group.slot === 'nozzle') {
      if (isHeld('Minus')) { group.radius = Math.max(RADIUS_MIN, group.radius - RADIUS_RATE * dt); changed = true }
      if (isHeld('Equal')) { group.radius += RADIUS_RATE * dt; changed = true }
    }
  }

  const shift = isHeld('ShiftLeft') || isHeld('ShiftRight')
  const ctrl = isHeld('ControlLeft') || isHeld('ControlRight')
  // Без модификатора стрелки не наши — их забирает облёт камеры. Размер (6/7) и радиус (−/=)
  // стрелок не трогают и работают одновременно с облётом.
  if ((!shift && !ctrl) || !group) {
    editor.held = 0
    if (changed) syncAll()
    return false
  }

  const left = isHeld('ArrowLeft')
  const right = isHeld('ArrowRight')
  const up = isHeld('ArrowUp')
  const down = isHeld('ArrowDown')
  if (!left && !right && !up && !down) {
    editor.held = 0
    if (changed) syncAll()
    return true
  }

  editor.held += dt
  const step = BASE_RATE * dt * Math.min(RAMP_MAX, 1 + editor.held * RAMP)

  if (shift) {
    if (left) group.x -= step
    if (right) group.x += step
    if (group.kind === 'pair' && group.x < 0) group.x = 0
    if (up) group.y += step
    if (down) group.y -= step
  } else {
    // Ctrl — вдоль корпуса. Нос в −Z, поэтому «вперёд» (↑) уменьшает z.
    if (up) group.z -= step
    if (down) group.z += step
  }

  syncAll()
  return true
}

/** Все дула/сопла группы (для маркеров): пара разворачивается в два, одиночная — в одно. */
export function groupPoints(group: RigGroup): { x: number; y: number; z: number }[] {
  if (group.kind === 'pair') {
    return [
      { x: -group.x, y: group.y, z: group.z },
      { x: group.x, y: group.y, z: group.z },
    ]
  }
  return [{ x: group.x, y: group.y, z: group.z }]
}

/** Множит всю оснастку на коэффициент: корабль растёт целиком, места остаются на силуэте. */
function resize(factor: number): void {
  editor.sizeMul *= factor
  for (const g of editor.groups) {
    g.x *= factor
    g.y *= factor
    g.z *= factor
    g.radius *= factor
  }
}

function enterEditor(world: World): void {
  const player = world.player
  const chassis = player.loadout.chassis

  editor.chassisId = chassis.id
  editor.chassisName = chassis.name
  editor.baseRadius = chassis.radius
  editor.sizeMul = 1
  editor.groups = initialGroups(chassis)
  editor.points = [blankPoint(), blankPoint(), blankPoint()]
  editor.index = 0
  editor.held = 0

  editor.restore = player.loadout
  // Дула-группы (первые три) уезжают в клон шасси; сопла и размер — в оверрайды рендера.
  const pylons = chassis.hardpoints.filter((hp) => hp.kind === 'pylon')
  const editChassis: Chassis = { ...chassis, hardpoints: [...editor.points, ...pylons] }
  // Три лазера РАЗНЫХ классов: цвет луча (1 голубой, 2 зелёный, 3 красный) показывает, какая
  // группа откуда бьёт, без подписей.
  player.loadout = createLoadout(editChassis, player.loadout.internals, [
    Modules.BURST_LASER,
    Modules.BEAM_LASER_HEAVY,
    Modules.PULSE_LASER_CENTRAL,
  ])
  refreshSpec(player)
  editor.active = true
  syncAll()
}

function exitEditor(world: World): void {
  console.log(printout())
  clearNozzleOverride(editor.chassisId)
  clearSizeOverride(editor.chassisId)
  const restore = editor.restore
  if (restore) {
    world.player.loadout = restore
    refreshSpec(world.player)
  }
  editor.restore = null
  editor.active = false
}

function blankPoint(): Hardpoint {
  return { offset: [0, 0, 0], kind: 'gun', maxClass: 4 }
}

/**
 * Начальная раскладка. Дула — из орудийных точек корпуса; сопла — из его текущего выхлопа.
 * Чего в конфиге нет (второй пары, центра) — достраиваем по габариту, но группы всегда все
 * шесть: единый обход правит любой корпус одинаково.
 */
function initialGroups(chassis: Chassis): RigGroup[] {
  const guns = chassis.hardpoints.filter((hp) => hp.kind === 'gun')
  const span = Math.max(2, chassis.radius * 0.5)

  const g0 = readGun(guns[0]) ?? { x: span, y: 0, z: 0 }
  const g1 = readGun(guns[1]) ?? { x: g0.x * 1.6, y: g0.y, z: g0.z }
  const g2 = readGun(guns[2]) ?? { x: 0, y: g0.y, z: g0.z - span }

  const noz = chassisNozzles(chassis.id)
  const na = noz[0]
  const nb = noz[1]
  const nspread = na && nb ? Math.abs(na.offset[0] - nb.offset[0]) / 2 : span * 0.3
  const ny = na?.offset[1] ?? 0
  const nz = na?.offset[2] ?? span
  const nr = na?.radius ?? 0.8

  return [
    { slot: 'gun', kind: 'pair', label: 'дуло, середина', x: Math.abs(g0.x), y: g0.y, z: g0.z, radius: 0, maxClass: guns[0]?.maxClass ?? 2 },
    { slot: 'gun', kind: 'pair', label: 'дуло, законцовки', x: Math.abs(g1.x), y: g1.y, z: g1.z, radius: 0, maxClass: guns[1]?.maxClass ?? 3 },
    { slot: 'gun', kind: 'single', label: 'дуло, нос', x: g2.x, y: g2.y, z: g2.z, radius: 0, maxClass: guns[2]?.maxClass ?? 3 },
    { slot: 'nozzle', kind: 'pair', label: 'сопла', x: nspread, y: ny, z: nz, radius: nr, maxClass: 4 },
  ]
}

function readGun(hp: Hardpoint | undefined): { x: number; y: number; z: number } | null {
  if (!hp) return null
  const source = hp.nozzles?.[0] ?? hp.offset
  return { x: source[0], y: source[1], z: source[2] }
}

/** Разложить группы обратно: дула — в точки шасси, сопла — в оверрайд рендера, размер — тоже. */
function syncAll(): void {
  editor.groups.forEach((group) => {
    if (group.slot !== 'gun') return
    const i = group === editor.groups[0] ? 0 : group === editor.groups[1] ? 1 : 2
    const point = editor.points[i]
    if (!point) return
    point.maxClass = 4
    if (group.kind === 'pair') {
      point.offset = [0, group.y, group.z]
      point.nozzles = [
        [-group.x, group.y, group.z],
        [group.x, group.y, group.z],
      ]
      point.bore = undefined
    } else {
      point.offset = [group.x, group.y, group.z]
      point.nozzles = [[group.x, group.y, group.z]]
      // Носовое дуло вдвое крупнее калибром — и в правке ведёт себя так же.
      point.bore = 2
    }
  })

  const nozzles: Nozzle[] = []
  for (const group of editor.groups) {
    if (group.slot !== 'nozzle') continue
    for (const p of groupPoints(group)) nozzles.push({ offset: [p.x, p.y, p.z], radius: group.radius })
  }
  setNozzleOverride(editor.chassisId, nozzles)
  setSizeOverride(editor.chassisId, editor.sizeMul)
}

function num(v: number): string {
  const r = Math.round(v * 100) / 100
  return (Object.is(r, -0) ? 0 : r).toString()
}

/** Готовый конфиг: строки `hardpoints` (в `chassis.ts`), `nozzles` и `scale`/`radius` (в `ships.ts`). */
function printout(): string {
  const guns = editor.groups.filter((g) => g.slot === 'gun')
  const gunLines = guns.map((g) => {
    const nozzles =
      g.kind === 'pair'
        ? `[[${num(-g.x)}, ${num(g.y)}, ${num(g.z)}], [${num(g.x)}, ${num(g.y)}, ${num(g.z)}]]`
        : `[[${num(g.x)}, ${num(g.y)}, ${num(g.z)}]]`
    const offset = g.kind === 'pair' ? `[0, ${num(g.y)}, ${num(g.z)}]` : `[${num(g.x)}, ${num(g.y)}, ${num(g.z)}]`
    const bore = g.kind === 'single' ? ' bore: 2,' : ''
    return `  { offset: ${offset}, kind: 'gun', maxClass: ${g.maxClass},${bore} nozzles: ${nozzles} }, // ${g.label}`
  })

  const nz = editor.groups
    .filter((g) => g.slot === 'nozzle')
    .flatMap((g) => groupPoints(g).map((p) => `{ offset: [${num(p.x)}, ${num(p.y)}, ${num(p.z)}], radius: ${num(g.radius)} }`))

  const scale = num(chassisMeshScale(editor.chassisId) * editor.sizeMul)
  const radius = num(editor.baseRadius * editor.sizeMul)

  return [
    `// ${editor.chassisId} — из редактора (O). scale: ${scale} (ships.ts), radius: ${radius} (chassis.ts)`,
    ...gunLines,
    `  nozzles: [${nz.join(', ')}],`,
  ].join('\n')
}
