import { Vector3 } from 'three'
import { SALVAGE } from '../../config/weapons'
import { freeCapacity } from '../cargo/hold'
import { itemMass } from '../cargo/items'
import type { CargoPodEntity, ShipEntity, World } from '../world/entities'

/**
 * ОЧЕРЕДЬ ЗАДАЧ автобота. Договорился с компаньоном — он берёт поручение и уходит его
 * исполнять сам: «собери грузы по локатору → вернись», «встреться там-то», позже —
 * «перелети в систему», «продай на станции». Любая задача из известных движку.
 *
 * Задача — это ДАННЫЕ (тип + параметры + условие выхода), а исполнение — таблица
 * обработчиков (`runTask`). Новый вид поручения — новая ветка обработчика и новый
 * член союза `Task`, а НЕ `if` в общем шаге ИИ: движок остаётся открыт к расширению.
 *
 * Очередь исполняется по порядку (голова = текущая). Завершённая снимается с головы,
 * следующая становится текущей: `[собрать, вернуться]` — сперва сбор, потом возврат.
 * Домен лишь ведёт корабль и черпает груз; ни рендера, ни сети он не знает.
 */

export type Task =
  /** Собрать контейнеры в радиусе `radius` от `anchor`, пока не кончатся или не забьётся трюм. */
  | { kind: 'collect-cargo'; anchor: Vector3; radius: number }
  /** Долететь до точки `point` и встать рядом (встреча/рандеву). */
  | { kind: 'goto'; point: Vector3; arriveRadius: number }
  /** Вернуться к нанимателю (кого сопровождает) и встать рядом. */
  | { kind: 'return-to-escort'; arriveRadius: number }
  /**
   * Держать позицию у `anchor` (в радиусе `radius`) и ЖДАТЬ. Задача НЕ завершается сама —
   * бот висит, пока её не снимут (`clearTasks`) или не сменят приказ. Это примитив «подожди
   * там»: конечный член цепочки вроде «лети → купи → жди». Держим через тот же полёт-с-тормозом.
   */
  | { kind: 'hold'; anchor: Vector3; radius: number }

export type TaskKind = Task['kind']

/** Намерение движения от текущей задачи: куда лететь и черпать ли груз по пути. */
export interface MoveIntent {
  /** Точка, к которой ведём нос. */
  target: Vector3
  /** Черпать ближние контейнеры по пути (сбор груза). */
  scoop: boolean
  /** Ближе этого к `target` считаем «прибыл», м. */
  arriveRadius: number
}

/** Результат шага обработчика: завершена ли задача и куда двигаться, пока нет. */
interface TaskStep {
  done: boolean
  intent: MoveIntent | null
}

/** Наниматель (кого сопровождает бот), если он жив. Возврат/встреча ориентируются на него. */
function patronOf(e: ShipEntity, world: World): ShipEntity | null {
  const id = e.ai?.escortOf
  if (id == null) return null
  if (world.player.id === id) return world.player.alive ? world.player : null
  const s = world.ships.find((sh) => sh.id === id)
  return s?.alive ? s : null
}

/** Ближайший контейнер в районе задачи, который ВЛЕЗЕТ в трюм. Полный/чужой пропускаем. */
function nearestFittingPod(world: World, anchor: Vector3, radius: number, e: ShipEntity): CargoPodEntity | null {
  const free = freeCapacity(e.hold)
  let best: CargoPodEntity | null = null
  let bestSq = Infinity
  const radiusSq = radius * radius
  for (const pod of world.pods) {
    if (!pod.alive) continue
    if (itemMass(pod.item) > free) continue // не влезет — не гонимся за ним
    if (pod.pos.distanceToSquared(anchor) > radiusSq) continue
    const d = pod.pos.distanceToSquared(e.state.pos)
    if (d < bestSq) {
      bestSq = d
      best = pod
    }
  }
  return best
}

/** Один шаг обработки задачи. Таблица по типу: новый вид поручения — новая ветка. */
function runTask(e: ShipEntity, world: World, task: Task): TaskStep {
  switch (task.kind) {
    case 'collect-cargo': {
      // Забился трюм — сбор окончен, что бы ни осталось на локаторе.
      if (freeCapacity(e.hold) <= 0) return { done: true, intent: null }
      const pod = nearestFittingPod(world, task.anchor, task.radius, e)
      // Грузов, что влезут, в районе не осталось — задача выполнена.
      if (!pod) return { done: true, intent: null }
      return { done: false, intent: { target: pod.pos, scoop: true, arriveRadius: SALVAGE.SCOOP_RADIUS } }
    }
    case 'goto': {
      const arrived = e.state.pos.distanceTo(task.point) <= task.arriveRadius
      if (arrived) return { done: true, intent: null }
      return { done: false, intent: { target: task.point, scoop: false, arriveRadius: task.arriveRadius } }
    }
    case 'return-to-escort': {
      const patron = patronOf(e, world)
      if (!patron) return { done: true, intent: null } // некому возвращаться — снять задачу
      const arrived = e.state.pos.distanceTo(patron.state.pos) <= task.arriveRadius
      if (arrived) return { done: true, intent: null }
      return { done: false, intent: { target: patron.state.pos, scoop: false, arriveRadius: task.arriveRadius } }
    }
    case 'hold': {
      // Никогда не done: держит позицию, пока задачу не снимут. Полёт-с-тормозом сам гасит
      // ход у точки, и бот висит в радиусе, а не нарезает круги.
      return { done: false, intent: { target: task.anchor, scoop: false, arriveRadius: task.radius } }
    }
  }
}

/**
 * Продвинуть очередь и вернуть намерение движения. Завершённые задачи снимает сам (в цикле:
 * `collect` кончился — тут же берётся `return`). `null` — очередь пуста, боту нечего исполнять
 * (тогда пилот ведёт себя как обычно). Мутирует `ai.tasks` — снимает выполненные с головы.
 */
export function stepTasks(e: ShipEntity, world: World): MoveIntent | null {
  const ai = e.ai
  if (!ai) return null
  while (ai.tasks.length > 0) {
    const step = runTask(e, world, ai.tasks[0]!)
    if (step.done) {
      ai.tasks.shift()
      continue
    }
    return step.intent
  }
  return null
}

/** Поставить задачу в конец очереди. `false` — некому (у борта нет пилота-бота). */
export function enqueueTask(e: ShipEntity, task: Task): boolean {
  if (!e.ai) return false
  e.ai.tasks.push(task)
  return true
}

/** Снять все задачи: бот бросает поручение и возвращается к обычному поведению. */
export function clearTasks(e: ShipEntity): void {
  if (e.ai) e.ai.tasks.length = 0
}

/** Есть ли у бота активное поручение. */
export function hasTask(e: ShipEntity): boolean {
  return (e.ai?.tasks.length ?? 0) > 0
}

/**
 * Готовое поручение «полетай по локатору, пособирай грузы — и вернись ко мне»: сбор в
 * районе `anchor` радиусом `radius`, затем возврат к нанимателю. Первый пример очереди из
 * двух задач; так же собираются любые другие цепочки. `false` — у борта нет пилота-бота.
 */
export function assignCollectRun(e: ShipEntity, anchor: Vector3, radius: number, returnRadius = 220): boolean {
  if (!e.ai) return false
  enqueueTask(e, { kind: 'collect-cargo', anchor: anchor.clone(), radius })
  enqueueTask(e, { kind: 'return-to-escort', arriveRadius: returnRadius })
  return true
}
