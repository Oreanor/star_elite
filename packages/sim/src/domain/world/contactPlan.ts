/**
 * Исполняемый план знакомого — не журнал и не эфемерный `ship.ai`.
 *
 * Журнал (`history`) — что было между вами. План — что контакт ДЕЛАЕТ сейчас и
 * после прыжка: очередь конечных шагов и долгоживущая поза (эскорт, прикрытие).
 */

/** Долгоживущий режим после очереди. */
export type PlanPosture = 'idle' | 'escort' | 'cover'

/** Элементарная отложенная команда. */
export type PlanStep =
  | { kind: 'dock' }
  | { kind: 'buy'; moduleId: string; hardpoint?: number }
  | { kind: 'undock' }
  | { kind: 'goto-system'; systemIndex: number }
  | { kind: 'join'; patronId: number }

/** Шаг из JSON модели — компилируется в `PlanStep`. */
export type RawPlanStep =
  | { step: 'dock' }
  | { step: 'buy'; module: string; hardpoint?: number }
  | { step: 'undock' }
  | { step: 'escort'; cover?: boolean }
  | { step: 'goto-system'; systemIndex?: number }
  /** Поручение в очередь задач: собрать груз вокруг себя и вернуться. */
  | { step: 'collect'; radius?: number }
  /** Подлететь к текущей цели навигации игрока. */
  | { step: 'approach-nav' }
  /** Снять все задачи из очереди. */
  | { step: 'clear-tasks' }

export interface ContactPlan {
  queue: PlanStep[]
  posture: PlanPosture
  /** Кого сопровождать/прикрывать, когда posture escort/cover. */
  patronId: number | null
}

export const EMPTY_PLAN: ContactPlan = { queue: [], posture: 'idle', patronId: null }

export function emptyPlan(): ContactPlan {
  return { queue: [], posture: 'idle', patronId: null }
}
