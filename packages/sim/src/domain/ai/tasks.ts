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
  /** Долететь до НЕПОДВИЖНОЙ точки `point` и встать рядом. Для живых целей — задачи ниже. */
  | { kind: 'goto'; point: Vector3; arriveRadius: number }
  /**
   * Подойти к ТЕЛУ по его id и встать в `margin` от поверхности со своей стороны.
   *
   * Тело берём ПО ID и координаты читаем КАЖДЫЙ ШАГ, а не сохраняем точку: станция висит на
   * ОРБИТЕ и всё время едет. От замороженной точки бот пёр туда, где станции уже нет, — со
   * стороны это и выглядело как «летит то к ней, то от неё».
   */
  | { kind: 'approach-body'; bodyId: number; margin: number; arriveRadius: number }
  /**
   * Подойти к ЖИВОМУ БОРТУ по id (игрок или бот) и ДЕРЖАТЬСЯ рядом — «подлети ко мне».
   *
   * Позицию читаем каждый шаг: цель летит, и точка-слепок устарела бы мгновенно. Задача НЕ
   * завершается сама: раньше она снималась по прибытии, бот тут же падал в обычное поведение
   * и улетал по своим делам — со стороны это выглядело как «подлетел и промахнулся мимо».
   * Снимается приказом («отставить», `clearTasks`), как и `hold`.
   */
  | { kind: 'rendezvous'; shipId: number; arriveRadius: number }
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

/** Живой борт по id — игрок или бот. `null`, если погиб или пропал из системы. */
function shipById(world: World, id: number): ShipEntity | null {
  if (world.player.id === id) return world.player.alive ? world.player : null
  const s = world.ships.find((sh) => sh.id === id)
  return s?.alive ? s : null
}

/** Наниматель (кого сопровождает бот), если он жив. Возврат/встреча ориентируются на него. */
function patronOf(e: ShipEntity, world: World): ShipEntity | null {
  const id = e.ai?.escortOf
  if (id == null) return null
  return shipById(world, id)
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
    case 'approach-body': {
      const body = world.bodies.find((b) => b.id === task.bodyId)
      if (!body) return { done: true, intent: null } // тела нет (сменили систему) — снять задачу
      // Точку подлёта считаем ЗАНОВО от ТЕКУЩЕГО места тела: станция едет по орбите, и
      // сохранённая точка устарела бы. Встаём со своей стороны, в margin от поверхности.
      _approach.copy(e.state.pos).sub(body.pos)
      const len = _approach.length() || 1
      _aimPoint.copy(body.pos).addScaledVector(_approach, (body.radius + task.margin) / len)
      const arrived = e.state.pos.distanceTo(_aimPoint) <= task.arriveRadius
      if (arrived) return { done: true, intent: null }
      return { done: false, intent: { target: _aimPoint, scoop: false, arriveRadius: task.arriveRadius } }
    }
    case 'rendezvous': {
      const target = shipById(world, task.shipId)
      if (!target) return { done: true, intent: null } // цель погибла/пропала — снять задачу
      // НИКОГДА не done: подлетел — держись рядом, пока не отставят. Снимать по прибытии нельзя:
      // бот тут же уходил в свои дела, и «подлети ко мне» выглядело как пролёт мимо. Полёт-с-
      // тормозом сам гасит ход у цели, поэтому он висит рядом, а не нарезает круги.
      // Живая ссылка на позицию: цель летит, а пилот всё равно копирует её себе в кадре.
      return { done: false, intent: { target: target.state.pos, scoop: false, arriveRadius: task.arriveRadius } }
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

const _approach = new Vector3()
/** Точка подлёта, пересчитываемая каждый шаг. Пилот копирует её себе — наружу не утекает. */
const _aimPoint = new Vector3()

/**
 * Поручение «подойди к телу и встань рядом»: бот летит к точке в `margin` метрах от
 * ПОВЕРХНОСТИ тела со СВОЕЙ стороны — не в центр (там он воткнулся бы в планету), а на
 * подлётную дугу. Годится для «встреть меня у той станции/планеты».
 *
 * Тело запоминаем ПО ID, а не точкой: станция висит на ОРБИТЕ и всё время едет, поэтому
 * подлётная точка пересчитывается на каждом шаге (см. `approach-body`). С замороженной
 * точкой бот шёл туда, где станции уже нет. `false` — не автобот.
 */
export function assignApproach(e: ShipEntity, bodyId: number, margin = 800): boolean {
  if (!e.ai) return false
  // Допуск прибытия — небольшой (не `margin`!), иначе бот «уже на месте», ещё вися вдали.
  enqueueTask(e, { kind: 'approach-body', bodyId, margin, arriveRadius: 300 })
  return true
}

/**
 * Поручение «подлети ко мне»: бот идёт к ЖИВОМУ борту (обычно игроку) и встаёт рядом.
 * Позиция читается каждый шаг по id — цель может лететь. Отдельный примитив, потому что
 * `approach-nav` ведёт к НАВ-ЦЕЛИ (станции), и на просьбу «ко мне» бот улетал мимо, к ней.
 */
export function assignRendezvous(e: ShipEntity, shipId: number, arriveRadius = 220): boolean {
  if (!e.ai) return false
  enqueueTask(e, { kind: 'rendezvous', shipId, arriveRadius })
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
