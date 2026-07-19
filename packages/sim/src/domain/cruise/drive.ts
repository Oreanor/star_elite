import { Vector3 } from 'three'
import { CRUISE } from '../../config/cruise'
import { GRAVITY } from '../../config/bodies'
import { isHostileTo } from '../ai/targeting'
import { forward } from '../flight/axes'
import { speedScaleFactor } from '../scale/scale'
import type { ShipEntity, World } from '../world/entities'

const _fwd = /* @__PURE__ */ new Vector3()
const _out = /* @__PURE__ */ new Vector3()

/**
 * Крейсерский привод.
 *
 * Физика о нём не знает: он всего лишь пишет множитель в `controls.cruise`.
 * Здесь живут три правила, без которых режим ломает игру:
 *
 *  1. МАССОВАЯ БЛОКИРОВКА. Чужой корабль рядом не даёт разогнаться.
 *     Иначе любой бой кончается мгновенным побегом, и боя нет.
 *
 *  2. ВЫХОД У ЗВЕЗДЫ. Незадолго до зоны притяжения привод начинает обычный
 *     экспоненциальный спад к ×1. Планеты и луны привод не тормозят — мимо них
 *     можно пройти на крейсере, — но КОРА у них твёрдая: `stepBodyCollisions`
 *     заметает отрезок шага и на фазе (иначе на 29c прошиваешь планету между кадрами).
 *
 *  3. ВНЕ ФАЗЫ. Разогнавшись, корабль не стреляет и не бьётся о мелочь/станцию.
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

/** Пора ли начать выход, чтобы погасить текущую скорость до зоны притяжения звезды. */
function starRequiresExit(ship: ShipEntity, world: World, alreadyBraking: boolean): boolean {
  for (const body of world.bodies) {
    if (body.kind !== 'star') continue
    // Уходишь ОТ звезды — нос смотрит наружу — крейсер НЕ тормозим. Спад нужен, чтобы не
    // влететь В звезду и не проскочить зону притяжения, а не чтобы запереть у светила
    // корабль, который и так перегревается и пытается сбежать. Ловим только заход внутрь.
    forward(ship.state.quat, _fwd)
    _out.copy(ship.state.pos).sub(body.pos)
    if (_fwd.dot(_out) > 0) continue
    const altitude = body.pos.distanceTo(ship.state.pos) - body.radius
    const gravityEdge = body.radius * GRAVITY.REACH_RADII
    const minimumBuffer = body.radius * CRUISE.STAR_EXIT_BUFFER_RADII
    // При уже начатом выходе держим решение до полной расчётной зоны максимального
    // хода: уменьшающийся каждый шаг тормозной путь не должен включить привод обратно.
    const speed = alreadyBraking
      ? ship.spec.tuning.MAX_SPEED * CRUISE.MAX_FACTOR * speedScaleFactor(ship.state.scale)
      : ship.state.vel.length()
    const brakingDistance = speed / CRUISE.DECAY_RATE
    if (altitude <= gravityEdge + minimumBuffer + brakingDistance) return true
  }
  return false
}

/** `false` — отпущен; `true` — разгон к MAX; число — защёлка на этом множителе. */
export type CruiseWant = boolean | number

/**
 * Шаг привода. Вызывается до физики: он определяет множитель, с которым
 * интегратор посчитает тягу.
 *
 * @param want Клавиша / защёлка (см. `CruiseWant`).
 */
export function updateCruise(ship: ShipEntity, world: World, want: CruiseWant, dt: number): void {
  const cruise = ship.cruise

  // Ретро (Ctrl) рубит форсаж СРАЗУ. Экспоненциальный спад с ×40M — секунды «выхода»,
  // а пилоту нужен мгновенный обрыв: тормоз важнее удержания пробела в том же кадре.
  if (ship.controls.retro > 0) {
    cruise.factor = 1
    cruise.block = null
    cruise.engaged = false
    ship.controls.cruise = 1
    return
  }

  const holdAt = typeof want === 'number' && want > 1 ? want : 0
  const requesting = want === true || holdAt > 0

  let target = 1
  let block: CruiseBlock = null

  if (requesting && ship.alive) {
    if (massLocked(ship, world)) {
      block = 'mass-lock'
    } else if (starRequiresExit(ship, world, cruise.block === 'proximity')) {
      block = 'proximity'
    } else if (holdAt > 0) {
      // Защёлка: множитель СТОИТ, не ползёт к MAX и не тает.
      target = holdAt
      cruise.factor = holdAt
    } else {
      target = CRUISE.MAX_FACTOR
    }
  }

  // Экспоненциальный РОСТ, а не приближение к цели.
  //
  // Приближение (`factor += (target-factor)·k·dt`) при цели ×90 даёт начальную
  // скорость роста ≈50 в секунду: за две десятых секунды множитель улетал до 10.
  // Никакого «держишь — постепенно разгоняешься» там не было, был рывок.
  // Умножение на exp(k·dt) даёт постоянное время удвоения: ~8 с до полного хода.
  // При защёлке factor уже выставлен — ветки ниже no-op (target === factor).
  if (target > cruise.factor) {
    cruise.factor = Math.min(target, cruise.factor * Math.exp(CRUISE.CHARGE_RATE * dt))
  } else if (target < cruise.factor) {
    // Сбросить ход всегда легче, чем набрать.
    cruise.factor = Math.max(target, cruise.factor * Math.exp(-CRUISE.DECAY_RATE * dt))
  }

  // Защёлка только при торможении. Иначе она съедает прирост первого шага
  // (он меньше epsilon) и разгон не начинается вовсе — там, где потолок близости
  // делает цель небольшой.
  if (target <= 1 && cruise.factor < CRUISE.IDLE_EPSILON) cruise.factor = 1

  cruise.block = block
  cruise.engaged = requesting && ship.alive
  ship.controls.cruise = cruise.factor
}
