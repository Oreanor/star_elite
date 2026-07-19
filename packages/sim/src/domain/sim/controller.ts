import type { ShipEntity, World } from '../world/entities'

/**
 * Единственный шов между «кто решает» и «что летит».
 *
 * PlayerController читает мышь и живёт в слое приложения.
 * AiController думает и живёт в домене.
 * Оба пишут в один и тот же `ship.controls` — и симуляция их не различает.
 *
 * Благодаря этому `stepWorld` не импортирует ни ИИ, ни ввод (DIP),
 * а «посадить бота в корабль игрока» или наоборот — это подмена одной ссылки.
 */
export interface Controller {
  /** Заполняет `ship.controls`. Не трогает `ship.state` — это дело физики. */
  update(ship: ShipEntity, world: World, dt: number): void
  /** Хочет ли стрелять из основного оружия в этом шаге. */
  wantsFire(ship: ShipEntity, world: World): boolean
  /**
   * Хочет ли выстрелить с пилона. Тип — что экипировано: ракета или дрон-ракета
   * (на пилонах один тип за раз). Боты тоже через это.
   */
  wantsMissile?(ship: ShipEntity, world: World): boolean
  /** Хочет ли пустить противоракетный импульс. */
  wantsEcm?(ship: ShipEntity, world: World): boolean
  /** Хочет ли подорвать энергетическую бомбу. Боты не умеют — и не надо. */
  wantsBomb?(ship: ShipEntity, world: World): boolean
  /**
   * Переключить маскировочное поле. Это ПЕРЕКЛЮЧАТЕЛЬ, а не «держит клавишу»:
   * возвращать true каждый кадр значит поднимать и опускать поле по 120 раз в
   * секунду. Спрашивается ровно одно нажатие.
   */
  wantsCloak?(ship: ShipEntity, world: World): boolean
  /** Держит ли тяговый луч. Боты не жадные — им трофеи не нужны. */
  wantsTractor?(ship: ShipEntity, world: World): boolean
  /**
   * Крейсерский ход. `false` — отпущен; `true` — разгон к MAX_FACTOR;
   * число > 1 — ДЕРЖАТЬ множитель (защёлка: не растёт и не тает, пока нет блока).
   */
  wantsCruise?(ship: ShipEntity, world: World): boolean | number
}

/** Кто чем управляет. Ключ — id корабля. */
export type ControllerMap = ReadonlyMap<number, Controller>

/** Заглушка для кораблей без пилота: дрейфуют, не стреляют. */
export const NULL_CONTROLLER: Controller = {
  update: () => {},
  wantsFire: () => false,
}
