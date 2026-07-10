import { Vector3 } from 'three'
import type { Rng } from '../../core/math'

export type AIMode = 'patrol' | 'pursue' | 'attack' | 'break' | 'evade'

/**
 * Память пилота-бота. Он не двигает корабль — он заполняет тот же ShipControls,
 * что и игрок мышью. Всё, что он умеет, физически доступно и тебе.
 */
export interface AIState {
  mode: AIMode
  /** Кого атакуем. null — цели нет. Выбирается по фракции, а не «это всегда игрок»:
   *  иначе полиция никогда не подерётся с пиратами. */
  targetId: number | null
  /**
   * ПРИКАЗ: атаковать именно этого и никого другого. null — пилот выбирает сам.
   *
   * Так работает автобой на корабле игрока: тот же пилот, та же физика, но цель
   * ему назначена, а не выбрана. Без приказа он в такте размышления переключился бы
   * на ближайшего врага, и «автобой по захваченной цели» перестал бы означать то,
   * что написано на кнопке.
   */
  orderedTargetId: number | null
  /** Куда сейчас летим: патрульная точка или точка отрыва. */
  waypoint: Vector3
  /** Район патрулирования. Бот не улетает из него без причины. */
  home: Vector3

  /** До следующего пересмотра решения. Это и есть время реакции. */
  thinkTimer: number
  /** Сколько бот уже в текущем режиме. */
  modeTimer: number

  /** Личный сдвиг фазы: без него звено маневрирует синхронно, как балет. */
  phase: number

  /** Смещение точки прицеливания — «рука дрожит». */
  aimJitter: Vector3
  aimJitterTimer: number

  wantsFire: boolean
  /** Решение о пуске принимается в такте размышления, а не каждый шаг физики. */
  wantsMissile: boolean
  /** Секунд до следующего возможного пуска. Иначе бот высыпает всю пусковую разом. */
  missileCooldown: number
  /** Жать ли ПРО. Тоже решение такта размышления: бот видит ракету не мгновенно. */
  wantsEcm: boolean
}

export function createAIState(home: Vector3, rng: Rng): AIState {
  return {
    mode: 'patrol',
    targetId: null,
    orderedTargetId: null,
    waypoint: home.clone(),
    home: home.clone(),
    thinkTimer: rng() * 0.12,
    modeTimer: 0,
    phase: rng() * Math.PI * 2,
    aimJitter: new Vector3(),
    aimJitterTimer: 0,
    wantsFire: false,
    wantsMissile: false,
    // Первая ракета не летит в первые же секунды боя: дай игроку осмотреться.
    missileCooldown: 6,
    wantsEcm: false,
  }
}
