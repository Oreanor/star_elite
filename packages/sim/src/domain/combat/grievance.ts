import { GRIEVANCE } from '../../config/ai'
import { DIALOGUE } from '../../config/dialogue'
import { applyStance } from '../world/acquaintance'
import type { ShipEntity, World } from '../world/entities'

/**
 * Обида: как не-враждебный борт реагирует на попадания ИГРОКА.
 *
 * Задеть встречного — не то же, что напасть на него. Одно попадание не переводит
 * нейтрала во враги: пилот копит ПРЕТЕНЗИЮ (`ai.grievance`) и вызывает игрока по
 * связи — «фигле ты делаешь?». Отношение при этом ещё НЕ меняется: его можно
 * разрядить словом или кнопкой «случайно». Но если бросить трубку и продолжать
 * жать на гашетку, на `HOSTILE_HITS`-м попадании подряд пилот считает нападение
 * намеренным и становится врагом уже честно — тогда он и отвечает огнём.
 *
 * Всё детерминировано и живёт на `ai`: то же состояние — то же решение, синхронно
 * по сети. Правило одно на всех, кто не враг: и на мирного торговца, и на полицию,
 * и на собственный эскорт (подстрелить своего — тоже повод обидеться).
 */

/**
 * Может ли этот борт обижаться на попадание игрока. Только НЕЙТРАЛ: именно его
 * `applyStance` умеет перевести во враги, и именно он «свой-но-не-враг». Полиция и
 * союзники — отдельный разговор (у них своя логика возмездия), уже сбитый враг —
 * тем более: по врагу стреляют без претензий.
 */
function canResent(ship: ShipEntity): boolean {
  return ship.alive && ship.ai !== null && ship.faction === 'neutral'
}

/**
 * Игрок попал по борту. Копит претензию с дебаунсом и переводит во враги на пороге.
 * Зовётся из `fireLasers`, когда стреляет игрок: только его попадания — повод к обиде,
 * стычки ботов между собой пилота не касаются.
 */
export function registerPlayerHit(world: World, victim: ShipEntity): void {
  if (!canResent(victim)) return
  const ai = victim.ai!

  // Непрерывный чирк лучом — одно событие: пока попадания идут чаще дебаунса, счёт
  // не растёт, но «свежесть» претензии продлеваем, чтобы она не угасла посреди очереди.
  if (ai.grievance > 0 && world.time - ai.grievanceAt < GRIEVANCE.HIT_DEBOUNCE) {
    ai.grievanceAt = world.time
    return
  }

  // Претензия успела остыть — начинаем счёт заново, это уже новый повод.
  if (world.time - ai.grievanceAt > GRIEVANCE.COOLDOWN) ai.grievance = 0

  ai.grievance += 1
  ai.grievanceAt = world.time

  if (ai.grievance >= GRIEVANCE.HOSTILE_HITS) {
    // Довольно объяснений: это нападение. Дальше он честный враг, а не обиженный —
    // претензию обнуляем, чтобы UI больше не звал его к разговору-примирению.
    applyStance(world, victim, 'hostile')
    ai.grievance = 0
  }
}

/**
 * Провокация СЛОВОМ в разговоре: наглое требование сбросить груз целому торговцу,
 * угроза, хамство. Копится в тот же счётчик, что и попадания, но с ВЕСОМ — дерзкое
 * требование весомее случайного чирка лучом. Довольно провокаций (`HOSTILE_HITS`) —
 * и нейтрал встаёт на бой честно, ровно как от очереди в борт.
 *
 * Дебаунса тут нет: реплика — дискретное событие, а не непрерывная очередь. Порог
 * и остывание — общие с попаданиями, поэтому выстрелы и угрозы складываются.
 */
export function provoke(world: World, victim: ShipEntity, weight = 1): void {
  if (!canResent(victim)) return
  const ai = victim.ai!

  // Претензия успела остыть — новый повод, счёт с нуля.
  if (world.time - ai.grievanceAt > GRIEVANCE.COOLDOWN) ai.grievance = 0

  ai.grievance += weight
  ai.grievanceAt = world.time

  if (ai.grievance >= GRIEVANCE.HOSTILE_HITS) {
    applyStance(world, victim, 'hostile')
    ai.grievance = 0
  }
}

/** Есть ли открытая претензия — повод пилоту вызвать игрока по связи. Читает UI. */
export function hasGrievance(ship: ShipEntity): boolean {
  return canResent(ship) && (ship.ai?.grievance ?? 0) > 0
}

/**
 * Кто ПРЯМО СЕЙЧАС вызывает игрока по связи из-за обиды: ближайший не-враг с открытой
 * претензией в пределах слышимости (`DIALOGUE.RANGE` — та же дальность, что и разговор).
 * Это читает UI, чтобы показать входящий вызов и дать ответить — разрядить претензию,
 * пока она не перелилась во враги. null — рядом никто не в обиде.
 */
export function pendingHail(world: World): ShipEntity | null {
  let best: ShipEntity | null = null
  let bestDist = Infinity
  for (const ship of world.ships) {
    if (!hasGrievance(ship)) continue
    const dist = ship.state.pos.distanceTo(world.player.state.pos)
    if (dist <= DIALOGUE.RANGE && dist < bestDist) {
      best = ship
      bestDist = dist
    }
  }
  return best
}

/**
 * Разрядить претензию: игрок объяснился словом или нажал «случайно». Отношение не
 * трогаем — извинение возвращает к тому, что было, а не делает другом. `false`, если
 * обижаться было некому или не на что.
 */
export function defuseGrievance(ship: ShipEntity): boolean {
  if (!ship.ai || ship.ai.grievance === 0) return false
  ship.ai.grievance = 0
  return true
}

/**
 * Угасание претензий: перестал стрелять — пилот через `COOLDOWN` списывает попадание
 * на нелепость и успокаивается. Зовётся каждый шаг: без этого зависшая претензия
 * держала бы UI-вызов открытым вечно.
 */
export function stepGrievances(world: World): void {
  for (const ship of world.ships) {
    const ai = ship.ai
    if (!ai || ai.grievance === 0) continue
    if (world.time - ai.grievanceAt > GRIEVANCE.COOLDOWN) ai.grievance = 0
  }
}
