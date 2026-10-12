import type { Chassis, Hardpoint, RigEntry } from '@elite/sim'

/**
 * МОДЕЛЬ РЕДАКТОРА ОСНАСТКИ — чистые данные и операции, без React и three. Оснастка корпуса
 * разбирается на ПУНКТЫ: лазерная точка, подвес под ракету, сопло. Симметричные точки (±x на
 * той же высоте и дальности) сводятся в ПАРУ — правится полуразмах, и пара не расходится.
 *
 * Где что живёт в коде игры (печать конфига повторяет эту раскладку):
 *   • лазеры и подвесы — `hardpoints` шасси (`packages/sim/src/config/chassis.ts`);
 *   • сопла и размер ракет на подвесах — описание корпуса (`apps/web/src/render/geometry/ships.ts`).
 *
 * Оси модели: нос в −Z, размах ±X, верх +Y. Метры.
 */

export type RigItemKind = 'laser' | 'pylon' | 'nozzle'

export interface RigItem {
  kind: RigItemKind
  /** Пара: `x` — ПОЛУРАЗМАХ (≥0), точки в ±x. Одиночная: `x` как есть. */
  pair: boolean
  x: number
  y: number
  z: number
  /** Радиус сопла, м. У лазера и подвеса не используется. */
  radius: number
  /** Лазер: потолок класса и калибр точки — переносятся в печать как были. */
  maxClass: Hardpoint['maxClass']
  bore?: number
  /**
   * Из каких точек шасси пришёл пункт — по порядку `itemPoints`. Порядок точек свят: оружие в
   * сейвах привязано к НОМЕРУ точки, и переставь их — ракеты окажутся на месте лазеров.
   */
  slots?: number[]
}

export interface RigState {
  chassisId: string
  items: RigItem[]
  /** Размер ракет на подвесах этого корпуса, множитель к заводской игле. */
  missileScale: number
}

export interface NozzleDef {
  offset: readonly [number, number, number]
  radius: number
}

/** Насколько близки координаты, чтобы считать две точки зеркальными, м. */
const MIRROR_EPS = 0.05

const mirrored = (a: readonly number[], b: readonly number[]): boolean =>
  Math.abs(a[0]! + b[0]!) < MIRROR_EPS && Math.abs(a[1]! - b[1]!) < MIRROR_EPS && Math.abs(a[2]! - b[2]!) < MIRROR_EPS && Math.abs(a[0]!) > MIRROR_EPS

/**
 * Свести список точек в пункты: зеркальные — парами, прочие — поодиночке. `index(p)` — номер
 * точки в шасси (или −1, если её там нет, как у сопел); у пары номера кладутся в порядке
 * `itemPoints`: сперва −x, потом +x.
 */
function groupPoints<T>(
  points: readonly T[],
  at: (p: T) => readonly number[],
  index: (p: T) => number,
  make: (p: T, pair: boolean) => RigItem,
): RigItem[] {
  const used = new Set<number>()
  const out: RigItem[] = []
  points.forEach((p, i) => {
    if (used.has(i)) return
    const j = points.findIndex((q, k) => k > i && !used.has(k) && mirrored(at(p), at(q)))
    used.add(i)
    if (j >= 0) {
      used.add(j)
      const q = points[j]!
      const item = make(p, true)
      item.x = Math.abs(at(p)[0]!)
      const [neg, pos] = at(p)[0]! < 0 ? [p, q] : [q, p]
      item.slots = [index(neg), index(pos)]
      out.push(item)
    } else {
      const item = make(p, false)
      item.slots = [index(p)]
      out.push(item)
    }
  })
  return out
}

/** Разобрать оснастку корпуса на пункты редактора. */
export function fromChassis(chassis: Chassis, nozzles: readonly NozzleDef[], missileScale: number): RigState {
  const items: RigItem[] = []

  // Лазер: точка шасси с одним или двумя дулами. Два зеркальных дула — пара.
  chassis.hardpoints.forEach((hp, slot) => {
    if (hp.kind !== 'gun') return
    const muzzles = hp.nozzles ?? [hp.offset]
    const a = muzzles[0]!
    const b = muzzles[1]
    const pair = b != null && mirrored(a, b)
    items.push({
      kind: 'laser',
      pair,
      x: pair ? Math.abs(a[0]) : a[0],
      y: a[1],
      z: a[2],
      radius: 0,
      maxClass: hp.maxClass,
      bore: hp.bore,
      slots: [slot],
    })
  })

  // Подвесы: каждая точка шасси — одна, зеркальные соседние сводим в пару.
  const pylons = chassis.hardpoints.filter((hp) => hp.kind === 'pylon')
  items.push(
    ...groupPoints(pylons, (hp) => hp.offset, (hp) => chassis.hardpoints.indexOf(hp), (hp, pair) => ({
      kind: 'pylon',
      pair,
      x: hp.offset[0],
      y: hp.offset[1],
      z: hp.offset[2],
      radius: 0,
      maxClass: hp.maxClass,
    })),
  )

  items.push(
    ...groupPoints(nozzles, (n) => n.offset, () => -1, (n, pair) => ({
      kind: 'nozzle',
      pair,
      x: n.offset[0],
      y: n.offset[1],
      z: n.offset[2],
      radius: n.radius,
      maxClass: 1,
    })),
  )

  return { chassisId: chassis.id, items, missileScale }
}

/** Мировые точки пункта: пара — две (±x), одиночная — одна. */
export function itemPoints(item: RigItem): [number, number, number][] {
  return item.pair
    ? [
        [-item.x, item.y, item.z],
        [item.x, item.y, item.z],
      ]
    : [[item.x, item.y, item.z]]
}

/** Сдвинуть пункт. У пары `dx` — шире/уже (полуразмах не уходит за ноль). */
export function moveItem(item: RigItem, dx: number, dy: number, dz: number): void {
  item.x += dx
  if (item.pair && item.x < 0) item.x = 0
  item.y += dy
  item.z += dz
}

/** Наименьший размер сопла и ракеты: дальше пропадают из вида. */
const MIN_RADIUS = 0.05
const MIN_MISSILE = 0.1

/**
 * Изменить размер выбранного: у сопла — радиус, у подвеса — размер ракет ВСЕГО корпуса (он
 * один на корабль: ракеты одного калибра висят на всех подвесах). У лазера размера нет.
 */
export function resizeItem(state: RigState, item: RigItem, factor: number): void {
  if (item.kind === 'nozzle') item.radius = Math.max(MIN_RADIUS, item.radius * factor)
  else if (item.kind === 'pylon') state.missileScale = Math.max(MIN_MISSILE, state.missileScale * factor)
}

const KIND_LABEL: Record<RigItemKind, string> = { laser: 'лазер', pylon: 'подвес', nozzle: 'сопло' }

/** Подпись пункта в списке: «лазер · пара», «сопло · 2». */
export function itemLabel(state: RigState, index: number): string {
  const item = state.items[index]!
  const sameKind = state.items.filter((it) => it.kind === item.kind)
  const n = sameKind.indexOf(item) + 1
  return `${KIND_LABEL[item.kind]} ${n}${item.pair ? ' · пара' : ''}`
}

function num(v: number): string {
  const r = Math.round(v * 100) / 100
  return (Object.is(r, -0) ? 0 : r).toString()
}

const vec = (p: readonly number[]): string => `[${num(p[0]!)}, ${num(p[1]!)}, ${num(p[2]!)}]`

/**
 * Готовый конфиг — строки, которые вставляются в игру как есть:
 *   • `hardpoints` — в описание шасси (`chassis.ts`);
 *   • `nozzles` и `missileScale` — в строку корпуса в `GLB_HULLS` (`ships.ts`).
 */
export function printout(state: RigState): string {
  const lines: string[] = [`// ${state.chassisId} — chassis.ts, hardpoints:`]
  for (const item of state.items) {
    if (item.kind === 'laser') {
      const pts = itemPoints(item)
      const offset = item.pair ? `[0, ${num(item.y)}, ${num(item.z)}]` : vec(pts[0]!)
      const bore = item.bore != null ? ` bore: ${item.bore},` : ''
      lines.push(`  { offset: ${offset}, kind: 'gun', maxClass: ${item.maxClass},${bore} nozzles: [${pts.map(vec).join(', ')}] },`)
    } else if (item.kind === 'pylon') {
      for (const p of itemPoints(item)) lines.push(`  { offset: ${vec(p)}, kind: 'pylon', maxClass: ${item.maxClass} },`)
    }
  }
  const nozzles = state.items
    .filter((it) => it.kind === 'nozzle')
    .flatMap((it) => itemPoints(it).map((p) => `{ offset: ${vec(p)}, radius: ${num(it.radius)} }`))
  lines.push('', `// ${state.chassisId} — ships.ts, строка GLB_HULLS:`)
  lines.push(`  nozzles: [${nozzles.join(', ')}],`)
  lines.push(`  missileScale: ${num(state.missileScale)},`)
  return lines.join('\n')
}

/**
 * Запись для `rig.json` (кнопка «СОХРАНИТЬ В ИГРУ»): точки шасси — на СВОИ номера (порядок
 * свят, см. `RigItem.slots`), сопла и размер ракет — как есть.
 */
export function toEntry(chassis: Chassis, state: RigState): RigEntry {
  const hardpoints: Hardpoint[] = chassis.hardpoints.map((hp) => ({ ...hp }))
  for (const item of state.items) {
    if (item.kind === 'nozzle' || !item.slots) continue
    const pts = itemPoints(item)
    if (item.kind === 'laser') {
      const slot = item.slots[0]!
      const offset: [number, number, number] = item.pair ? [0, item.y, item.z] : pts[0]!
      hardpoints[slot] = {
        offset,
        kind: 'gun',
        maxClass: item.maxClass,
        ...(item.bore != null ? { bore: item.bore } : {}),
        nozzles: pts,
      }
    } else {
      pts.forEach((p, i) => {
        const slot = item.slots![i]
        if (slot != null && slot >= 0) hardpoints[slot] = { offset: p, kind: 'pylon', maxClass: item.maxClass }
      })
    }
  }
  const round = (v: number) => Math.round(v * 1000) / 1000
  const r3 = (p: readonly number[]): [number, number, number] => [round(p[0]!), round(p[1]!), round(p[2]!)]
  return {
    hardpoints: hardpoints.map((hp) => ({
      ...hp,
      offset: r3(hp.offset),
      ...(hp.nozzles ? { nozzles: hp.nozzles.map(r3) } : {}),
    })),
    nozzles: state.items
      .filter((it) => it.kind === 'nozzle')
      .flatMap((it) => itemPoints(it).map((p) => ({ offset: r3(p), radius: round(it.radius) }))),
    missileScale: round(state.missileScale),
  }
}
