import { CONTACTS } from '../../config/contacts'
import { CORE_INDEX, GALAXY } from '../../config/galaxy'
import type { BodyEntity, ShipEntity, World } from '../world/entities'
import { markContactLost, type Acquaintance, type Contact } from '../world/acquaintance'
import { stepContactPlanOffScreen } from '../world/plan'
import { generateSystem } from './generate'
import { capitalOf } from './types'
import { distanceLy, placeSystem, type Spot3 } from './shape'

/**
 * Закулисная жизнь знакомых — скромная и детерминированная.
 *
 * Мир симулирует только текущую систему; контакты в других системах — это чистые
 * записи (`Acquaintance.systemIndex`). Чтобы они не застывали навсегда там, где их
 * видели, галактика делает ОДИН шаг на каждый прыжок игрока (`jump` → сюда): прыжок
 * есть отрезок времени, и за него праздный контакт может перелететь в соседнюю
 * систему, связанный обещанием — приблизиться к цели, а совсем невезучий — сгинуть.
 *
 * Никакой полноценной жизни за кадром: ни торговли, ни боёв, ни экономики. Только
 * перемещение и редкая гибель. Всё на `world.rng` — тот же прыжок на двух машинах
 * должен двигать галактику одинаково, иначе ни сети, ни реплея.
 */

/** Положения всех систем галактики — строим один раз за прыжок, и только если есть кого двигать. */
function buildPositions(seed: number): Spot3[] {
  const out: Spot3[] = new Array(GALAXY.COUNT)
  for (let i = 0; i < GALAXY.COUNT; i++) out[i] = placeSystem(i, seed)
  return out
}

/** Системы в пределах одного перелёта контакта: не ядро, не он сам, ближе `WANDER_RANGE_LY`. */
function reachable(from: number, positions: Spot3[]): number[] {
  const here = positions[from]!
  const out: number[] = []
  for (let i = 0; i < positions.length; i++) {
    if (i === from || i === CORE_INDEX) continue
    if (distanceLy(here, positions[i]!) <= CONTACTS.WANDER_RANGE_LY) out.push(i)
  }
  return out
}

/** Праздный контакт снимается с места: случайная соседняя система в пределах перелёта. */
function wander(c: Acquaintance, roll: number, positions: Spot3[]): void {
  const near = reachable(c.systemIndex, positions)
  if (near.length === 0) return // в глуши лететь некуда — остаётся на месте
  c.systemIndex = near[Math.floor(roll * near.length)] ?? c.systemIndex
}

/**
 * Связанный обещанием контакт делает шаг К цели. Если она уже в пределах перелёта —
 * прибывает и гасит намерение. Иначе идёт в соседнюю систему, ближайшую к цели, —
 * жадный шаг, а не полноценная прокладка маршрута: за кулисами этого довольно.
 */
function stepToward(c: Acquaintance, dest: number, positions: Spot3[]): void {
  const here = positions[c.systemIndex]!
  const goal = positions[dest]!
  if (distanceLy(here, goal) <= CONTACTS.WANDER_RANGE_LY) {
    c.systemIndex = dest
    c.boundFor = null
    return
  }
  let best = c.systemIndex
  let bestDist = distanceLy(here, goal)
  for (const i of reachable(c.systemIndex, positions)) {
    const d = distanceLy(positions[i]!, goal)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  c.systemIndex = best // не нашлось ближе — остаётся, но это редкость в плотном диске
}

/**
 * Один ход закулисной жизни всех знакомых. Зовётся из `jump` после `enterSystem`.
 *
 * Порядок бросков фиксирован: за КАЖДЫЙ отсутствующий живой контакт сначала кость
 * гибели, и только у выжившего — перемещение. Так добавление нового контакта не
 * сдвигает броски для остальных сверх своей записи, и реплей сходится.
 */
export function driftContacts(world: World): void {
  const seed = world.galaxySeed
  const rng = world.rng
  let positions: Spot3[] | null = null
  const grid = (): Spot3[] => (positions ??= buildPositions(seed))

  for (const c of world.acquaintances) {
    if (!c.alive) continue
    // Присутствует живым бортом здесь и сейчас — он рядом с тобой, не за кулисами.
    if (world.ships.some((s) => s.alive && s.acquaintanceId === c.id)) continue
    // Уже в системе, куда ты входишь: это ЖИТЕЛЬ, его сейчас выставят на радар
    // (`spawnResidentContacts`). За кулисами он не живёт этот ход — иначе бродил бы прочь
    // или гиб ровно в миг твоего прибытия, и «его всегда найдёшь в своей системе» врало бы.
    if (c.systemIndex === world.systemIndex) continue

    // Кость гибели — до перемещения: мёртвому лететь уже некуда, и весть уходит игроку.
    if (rng() < CONTACTS.DEATH_CHANCE) {
      markContactLost(world, c)
      continue
    }

    if (c.boundFor != null) stepToward(c, c.boundFor, grid())
    else if (c.roaming && rng() < CONTACTS.WANDER_CHANCE) wander(c, rng(), grid())

    stepContactPlanOffScreen(world, c)
  }
}

/** Где контакт находится — с точностью до системы и приметного места в ней. */
export interface Whereabouts {
  /** Имя системы (сырое: UI причешет через `properName`). */
  systemName: string
  /** Приметное место — станция или мир, у которого держится контакт. `null` — просто в системе. */
  place: string | null
  /** true — стоит в доке станции `place`; false — просто рядом с телом `place`. */
  docked: boolean
  /** Присутствует ли он живым бортом в ТЕКУЩЕЙ системе (с ним можно связаться напрямую). */
  present: boolean
}

/**
 * Где живой борт — по его позиции в ТЕКУЩЕЙ системе: в доке станции, если швартуется,
 * иначе у ближайшего тела. Отсюда и бот в разговоре знает, где он: «у такой-то планеты»,
 * «в доке такой-то станции». Не про знакомство — про любой борт, что сейчас в мире.
 */
export function shipWhereabouts(world: World, ship: ShipEntity): Whereabouts {
  const berthed = ship.ai?.dock === 'berthed' || ship.ai?.dock === 'inbound'
  let near: BodyEntity | null = null
  let best = Infinity
  for (const b of world.bodies) {
    const d = b.pos.distanceToSquared(ship.state.pos)
    if (d < best) {
      best = d
      near = b
    }
  }
  const docked = berthed && near?.kind === 'station'
  return { systemName: world.systemName, place: near?.name ?? null, docked, present: true }
}

/**
 * Где сейчас контакт. Присутствующий — по живой позиции борта (`shipWhereabouts`);
 * отсутствующий — по столице его системы, выведенной из зерна. Так и бот в разговоре
 * отвечает, где он, и вкладка «Люди» знает, куда лететь за ним.
 */
export function contactWhereabouts(world: World, c: Contact): Whereabouts {
  if (c.ship) return shipWhereabouts(world, c.ship)

  const sys = generateSystem(c.record.systemIndex, world.galaxySeed)
  const capital = capitalOf(sys)
  if (capital?.station) return { systemName: sys.name, place: capital.station.name, docked: true, present: false }
  if (capital) return { systemName: sys.name, place: capital.name, docked: false, present: false }
  return { systemName: sys.name, place: null, docked: false, present: false }
}
