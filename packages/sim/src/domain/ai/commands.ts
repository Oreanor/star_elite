import type { ShipEntity } from '../world/entities'

/**
 * Приказы игрока СВОЕМУ автоботу — собственному автобою или нанятому эскорту.
 *
 * Это команды ПОСЛУШАНИЯ: бот уже на твоей стороне, решать ему нечего — он
 * исполняет. Уговорить чужого что-то сделать — дело разговора (LLM) или
 * скриптового взвешивания персоны; здесь только прямая воля к тому, кто и так
 * подчиняется. Отсюда их и отдают одинаково: голосом через связь и кнопкой из
 * выпадушки, когда LLM недоступна. Функции — чистые мутации `ai`, детерминированы
 * и проверяются без всякого рендера.
 *
 * `false` — приказывать некому: у корабля нет пилота-бота (это не автобот).
 */

/** Бить/догонять именно этот корабль и никого другого. */
export function orderAttack(ship: ShipEntity, targetId: number): boolean {
  const ai = ship.ai
  if (!ai) return false
  ai.command = 'attack'
  ai.orderedTargetId = targetId
  ai.targetId = targetId
  return true
}

/** Свободный огонь: бить любого враждебного вокруг, не привязываясь к одному. */
export function orderEngageAll(ship: ShipEntity): boolean {
  const ai = ship.ai
  if (!ai) return false
  ai.command = 'engageAll'
  ai.orderedTargetId = null
  return true
}

/** Стоять тут: держать место, в бой не лезть, пока игрок отлучился. */
export function orderHold(ship: ShipEntity): boolean {
  const ai = ship.ai
  if (!ai) return false
  ai.command = 'hold'
  ai.orderedTargetId = null
  return true
}

/** Отбой: прекратить огонь, никого не атаковать. Держится рядом, но не бьёт. */
export function orderCeaseFire(ship: ShipEntity): boolean {
  const ai = ship.ai
  if (!ai) return false
  ai.command = 'standDown'
  ai.orderedTargetId = null
  ai.targetId = null
  return true
}

/** Держись в хвосте: уходи от боя и береги груз, пока игрок разбирается сам. */
export function orderKeepBack(ship: ShipEntity): boolean {
  const ai = ship.ai
  if (!ai) return false
  ai.command = 'keepBack'
  ai.orderedTargetId = null
  ai.targetId = null
  return true
}

/** Вольно: вернуть боту обычное поведение (эскорт снова бьёт цель нанимателя). */
export function orderResume(ship: ShipEntity): boolean {
  const ai = ship.ai
  if (!ai) return false
  ai.command = 'default'
  ai.orderedTargetId = null
  return true
}

/** Под приказом ли игрока этот бот-эскорт. Выпадушке — кому вообще отдавать команды. */
export function commandableByPlayer(ship: ShipEntity, playerId: number): boolean {
  return ship.ai != null && (ship.ai.escortOf === playerId || ship.id === playerId)
}

/**
 * Приказ послушания одним именем — чтобы и кнопка выпадушки, и распознанный из речи
 * триггер шли через ОДНУ дверь. `attack` требует цель (кого бить); прочие — нет.
 * Возвращает, отдан ли приказ (false — некому: у борта нет пилота-бота).
 */
export type AIOrder = 'attack' | 'engageAll' | 'hold' | 'standDown' | 'keepBack' | 'resume'

export function applyOrder(ship: ShipEntity, order: AIOrder, targetId: number | null = null): boolean {
  switch (order) {
    case 'attack': return targetId != null ? orderAttack(ship, targetId) : false
    case 'engageAll': return orderEngageAll(ship)
    case 'hold': return orderHold(ship)
    case 'standDown': return orderCeaseFire(ship)
    case 'keepBack': return orderKeepBack(ship)
    case 'resume': return orderResume(ship)
  }
}
