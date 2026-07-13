import { HYPERDRIVE, STAR_HEAT } from '../../config/heat'
import { clamp } from '../../core/math'
import type { ShipEntity, World } from '../world/entities'
import { applyDamage } from './damage'

/**
 * Что делает с кораблём близкая звезда: греет корпус и заряжает гипердвигатель.
 *
 * Обе стороны — про одно и то же: близость к светилу. Греется температура у
 * короны и спадает вдали, лишь за порогом превращаясь в потери. Топливо прыжка
 * черпается из той же близости, но раньше порога — узкая полка между «прогрелся
 * достаточно, чтобы черпать» и «сгораешь». Считается для ЛЮБОГО корабля: правило
 * мира одно на всех (см. CLAUDE.md). Торговцы к светилам не летают, поэтому на
 * них это не сказывается само собой.
 */

/**
 * Насколько корабль облучён, 0..1. Решает БЛИЖАЙШАЯ по высоте звезда — та, в чью
 * корону он залез. Высота меряется в радиусах звезды: у карлика и у гиганта своя
 * опасная дистанция, и одна доля радиуса честнее любого числа в метрах.
 */
export function starExposure(ship: ShipEntity, world: World): number {
  let hottest = 0
  for (const body of world.bodies) {
    if (body.kind !== 'star') continue
    const altitude = body.pos.distanceTo(ship.state.pos) - body.radius
    // Высота — в радиусах звезды, но ДОМНОЖЕННАЯ на масштаб борта (миелофон). Гигант
    // видит звезду в `scale` раз мельче (камера отъезжает / тела съёживаются за потолком),
    // и опасная дистанция обязана съёжиться так же: иначе тебя жжёт там, где светило —
    // далёкая точка. Для обычного корабля scale=1 — правило то же, что и было.
    const ratio = (altitude / body.radius) * ship.state.scale
    const e = clamp((STAR_HEAT.SAFE_RATIO - ratio) / (STAR_HEAT.SAFE_RATIO - STAR_HEAT.DANGER_RATIO), 0, 1)
    if (e > hottest) hottest = e
  }
  return hottest
}

/**
 * Шаг нагрева. Температура тянется к облучённости — вверх у звезды, вниз вдали,
 * причём вниз быстрее. За порогом течёт прочность: `applyDamage` снимает сперва
 * щит, потом обшивку, и он же метит `lastHitAt`, из-за чего щит не восстанавливается,
 * пока жар не спадёт. Отвернул — перестало течь, через задержку щит пошёл обратно.
 */
export function stepStarHeat(ship: ShipEntity, world: World, dt: number): void {
  if (!ship.alive) return

  const target = starExposure(ship, world)
  const rate = target > ship.hullHeat ? STAR_HEAT.RISE_RATE : STAR_HEAT.COOL_RATE
  // Устойчивое экспоненциальное приближение: не зависит от величины шага.
  ship.hullHeat += (target - ship.hullHeat) * (1 - Math.exp(-rate * dt))
  ship.hullHeat = clamp(ship.hullHeat, 0, 1)

  if (ship.hullHeat <= STAR_HEAT.LEAK_THRESHOLD) return

  // Доля перегрева над порогом, 0..1. Квадрат даёт «медленно у порога, сильно у края».
  const over = (ship.hullHeat - STAR_HEAT.LEAK_THRESHOLD) / (1 - STAR_HEAT.LEAK_THRESHOLD)
  applyDamage(ship, STAR_HEAT.LEAK_MAX * over * over * dt, world.time)
}

/** Заряжается ли сейчас привод: прогрелись достаточно, но заряд ещё не полон. */
export function scooping(ship: ShipEntity): boolean {
  return (
    ship.spec.jumpRange > 0 &&
    ship.hullHeat >= HYPERDRIVE.CHARGE_HEAT &&
    ship.jumpCharge < ship.spec.jumpRange - 1e-6
  )
}

/**
 * Зарядка гипердвигателя у звезды. Черпается, лишь когда корпус прогрет до
 * `CHARGE_HEAT`, и растёт до предела модели (`spec.jumpRange`). Нагрев считается
 * ДО этого шага — `stepStarHeat` уже обновил `hullHeat` в этом же кадре.
 */
export function chargeHyperdrive(ship: ShipEntity, dt: number): void {
  if (!ship.alive || ship.spec.jumpRange <= 0) return
  if (ship.hullHeat < HYPERDRIVE.CHARGE_HEAT) return
  ship.jumpCharge = Math.min(ship.spec.jumpRange, ship.jumpCharge + HYPERDRIVE.CHARGE_RATE * dt)
}
