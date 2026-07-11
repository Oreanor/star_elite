import type { Rng } from '../../core/math'
import type { Persona } from './persona'
import type { ShipEntity, World } from './entities'

/**
 * Память знакомств. Космос населён случайными бортами, и почти все они —
 * прохожие: родились, пролетели, растворились за горизонтом событий. Но с кем
 * ты РАЗГОВАРИВАЛ — того мир запоминает. Такого пилота можно встретить снова, и
 * тогда он тебя узнает.
 *
 * Реестр — чистые данные на мире. Переживает и гибель борта (пилот — не корабль),
 * и прыжки: знакомство привязано к системе, где случилось, а встреча повторяется
 * редко, чтобы космос не стал тесным двором. По сети синхронизируется как есть.
 *
 * Живой корабль связан с записью полем `acquaintanceId`. Незнакомец — `null`:
 * его можно спокойно удалять при чистке трафика, память о нём не заводилась.
 */

/** Как пилот относится к игроку. Итог разговоров, помнится между встречами. */
export type Relationship = 'friendly' | 'neutral' | 'hostile'

export interface Acquaintance {
  /** Стабильный id ЗНАКОМСТВА, не корабля: корабль эфемерен, знакомство — нет. */
  id: number
  /** Личное имя пилота. Появляется в момент знакомства — до него он просто «Торговец». */
  name: string
  persona: Persona
  faction: ShipEntity['faction']
  chassisId: string
  /** Каким типом встречи он был — чтобы воссоздать ту же сборку при повторной встрече. */
  kindId: string
  /** В какой системе познакомились: там его и можно встретить снова. */
  systemIndex: number
  /** Сколько раз виделись. >1 — он тебя уже знает. */
  meetings: number
  /** Отношение к игроку по итогу бесед. Хранится тут и переносится на новую встречу. */
  relationship: Relationship
}

// Имена пилотов: пара коротких списков. Не культура и не лор — просто чтобы у
// знакомого была подпись на локаторе, а не «Торговец 1».
const FIRST = ['Дэн', 'Йенс', 'Мира', 'Кай', 'Ров', 'Талл', 'Нэя', 'Орм', 'Сол', 'Векка', 'Гром', 'Лия', 'Зандер', 'Ксан', 'Ума', 'Бор']
const LAST = ['Ковач', 'Рэн', 'Ольт', 'Стрейн', 'Вэйл', 'Дорн', 'Кесс', 'Марлоу', 'Крайн', 'Валло', 'Ромм', 'Сайкс', 'Град', 'Онн', 'Пёрл', 'Феск']

function makePilotName(rng: Rng): string {
  return `${FIRST[Math.floor(rng() * FIRST.length)]!} ${LAST[Math.floor(rng() * LAST.length)]!}`
}

/**
 * Запомнить пилота: игрок с ним заговорил. Идемпотентно на встречу — второй раз за
 * тот же разговор запись не плодит. В этот миг у пилота появляется имя, и оно тут же
 * ложится на локатор. Событие, не шаг физики: `rng`/`ids` двигать здесь можно.
 */
export function rememberPilot(world: World, ship: ShipEntity): void {
  if (ship.acquaintanceId != null) return

  const name = makePilotName(world.rng)
  const record: Acquaintance = {
    id: world.ids.next(),
    name,
    persona: ship.persona,
    faction: ship.faction,
    chassisId: ship.loadout.chassis.id,
    kindId: ship.originKind ?? 'trader',
    systemIndex: world.systemIndex,
    meetings: 1,
    relationship: 'neutral',
  }
  world.acquaintances.push(record)
  ship.acquaintanceId = record.id
  // Теперь он не «Торговец», а человек с именем — и в эфире, и на метке локатора.
  ship.name = name
}

/**
 * Разговор изменил отношение. Пишем его в запись знакомства — оно переживёт встречу.
 *
 * Но МЕХАНИКУ трогаем только в одну сторону: обозлить нейтрала (нейтрал→враждебный)
 * можно кого угодно — это во вред самому игроку, эксплойта нет. А вот РАЗОРУЖИТЬ
 * враждебного дружелюбием — нельзя: иначе целого пирата уболтали бы в друзья
 * бесплатно, в обход сдачи с её условиями (сначала сбей щит). Замирение — дело
 * `applyOutcome('surrender'/'mercy')`, а не доброго слова.
 */
export function applyStance(world: World, ship: ShipEntity, stance: Relationship): void {
  const record = world.acquaintances.find((a) => a.id === ship.acquaintanceId)
  if (record) record.relationship = stance

  if (stance === 'hostile' && ship.faction === 'neutral') {
    ship.faction = 'hostile'
    if (ship.ai) {
      ship.ai.escortOf = null
      ship.ai.targetId = null
      ship.ai.orderedTargetId = null
    }
  }
}

/**
 * Выбрать знакомого, которого можно встретить СНОВА здесь и сейчас: из этой системы
 * и не присутствующего уже в мире живьём. `null` — некого. Выбор случайный, а редкость
 * повторной встречи задаёт вызывающий (шанс в трафике), не эта функция.
 */
export function recurringAcquaintance(world: World, rng: Rng): Acquaintance | null {
  const here = world.acquaintances.filter(
    (a) => a.systemIndex === world.systemIndex && !world.ships.some((s) => s.alive && s.acquaintanceId === a.id),
  )
  if (here.length === 0) return null
  return here[Math.floor(rng() * here.length)] ?? null
}
