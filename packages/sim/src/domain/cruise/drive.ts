import { CRUISE } from '../../config/cruise'
import { clamp } from '../../core/math'
import { isHostileTo } from '../ai/targeting'
import type { ShipEntity, World } from '../world/entities'

/**
 * Крейсерский привод.
 *
 * Физика о нём не знает: он всего лишь пишет множитель в `controls.cruise`.
 * Здесь живут три правила, без которых режим ломает игру:
 *
 *  1. МАССОВАЯ БЛОКИРОВКА. Чужой корабль рядом не даёт разогнаться.
 *     Иначе любой бой кончается мгновенным побегом, и боя нет.
 *
 *  2. ТОРМОЖЕНИЕ У ТЕЛ. Вблизи планеты множитель режется автоматически.
 *     На полном ходу шаг физики — семьдесят тысяч километров: столкновение
 *     просто не сработает, ты пролетишь планету насквозь.
 *
 *  3. ВНЕ ФАЗЫ. Разогнавшись, корабль не стреляет и не сталкивается.
 *     Лазер, выпущенный на двадцати девяти световых, не догонит собственный ствол.
 */

export type CruiseBlock = 'mass-lock' | 'proximity' | null

export interface CruiseState {
  /** Текущий множитель, 1..MAX_FACTOR. */
  factor: number
  /** Почему не разгоняемся. Показывается на HUD: игрок должен понимать причину. */
  block: CruiseBlock
  /**
   * Держит ли пилот клавишу крейсера ПРЯМО СЕЙЧАС. Отдельно от `factor` (тот после
   * отпускания ещё стекает): HUD гасит плашку «форсажа» в тот же миг, как отпустили.
   */
  engaged: boolean
}

export function createCruiseState(): CruiseState {
  return { factor: 1, block: null, engaged: false }
}

/** Разогнан ли настолько, что вышел из обычного взаимодействия с миром. */
export function isPhased(ship: ShipEntity): boolean {
  return ship.cruise.factor > CRUISE.PHASE_THRESHOLD
}

export function isCruising(ship: ShipEntity): boolean {
  return ship.cruise.factor > CRUISE.IDLE_EPSILON
}

/** Ближайший чужой корабль держит тебя на месте. Только живой и только враждебный. */
function massLocked(ship: ShipEntity, world: World): boolean {
  const limit = CRUISE.MASS_LOCK_RANGE ** 2

  for (const other of world.ships) {
    if (!other.alive || other === ship) continue
    if (!isHostileTo(ship.faction, other.faction)) continue
    if (other.state.pos.distanceToSquared(ship.state.pos) < limit) return true
  }

  if (ship !== world.player && world.player.alive && isHostileTo(ship.faction, world.player.faction)) {
    if (world.player.state.pos.distanceToSquared(ship.state.pos) < limit) return true
  }
  return false
}

/**
 * Предельный множитель рядом с телами: высота над поверхностью, делённая
 * на зону торможения этого вида тел. У самой планеты — единица, в пустоте — полный ход.
 *
 * Решает БЛИЖАЙШЕЕ тело, а не самое большое: высота уже содержит радиус в себе,
 * и звезде в 696 000 км не нужны поблажки, чтобы удержать корабль у своей короны.
 * Побеждает не наименьшая высота, а наименьший ПОТОЛОК: у луны зона вчетверо
 * меньше, и она уступает планете даже тогда, когда висит ближе.
 */
function proximityCap(ship: ShipEntity, world: World): number {
  let cap: number = CRUISE.MAX_FACTOR

  for (const body of world.bodies) {
    const altitude = Math.max(0, body.pos.distanceTo(ship.state.pos) - body.radius)
    const allowed = altitude / CRUISE.BRAKE_ZONE[body.kind]
    if (allowed < cap) cap = allowed
  }
  return clamp(cap, 1, CRUISE.MAX_FACTOR)
}

/**
 * Шаг привода. Вызывается до физики: он определяет множитель, с которым
 * интегратор посчитает тягу.
 *
 * @param want Игрок держит клавишу крейсера.
 */
export function updateCruise(ship: ShipEntity, world: World, want: boolean, dt: number): void {
  const cruise = ship.cruise

  let target = 1
  let block: CruiseBlock = null

  if (want && ship.alive) {
    if (massLocked(ship, world)) {
      block = 'mass-lock'
    } else {
      const cap = proximityCap(ship, world)
      target = cap
      // Упёрлись в потолок близости, а не в потолок привода — сообщаем игроку.
      if (cap < CRUISE.MAX_FACTOR - 1e-6) block = 'proximity'
    }
  }

  // Экспоненциальный РОСТ, а не приближение к цели.
  //
  // Приближение (`factor += (target-factor)·k·dt`) при цели ×90 даёт начальную
  // скорость роста ≈50 в секунду: за две десятых секунды множитель улетал до 10.
  // Никакого «держишь — постепенно разгоняешься» там не было, был рывок.
  // Умножение на exp(k·dt) даёт постоянное время удвоения: ~8 с до полного хода.
  if (target > cruise.factor) {
    cruise.factor = Math.min(target, cruise.factor * Math.exp(CRUISE.CHARGE_RATE * dt))
  } else {
    // Сбросить ход всегда легче, чем набрать.
    cruise.factor = Math.max(target, cruise.factor * Math.exp(-CRUISE.DECAY_RATE * dt))
  }

  // Защёлка только при торможении. Иначе она съедает прирост первого шага
  // (он меньше epsilon) и разгон не начинается вовсе — там, где потолок близости
  // делает цель небольшой.
  if (target <= 1 && cruise.factor < CRUISE.IDLE_EPSILON) cruise.factor = 1

  cruise.block = block
  cruise.engaged = want && ship.alive
  ship.controls.cruise = cruise.factor
}
