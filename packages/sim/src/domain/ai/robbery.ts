import { ROBBERY } from '../../config/ai'
import { clamp } from '../../core/math'
import { usedCapacityOf } from '../cargo/hold'
import { healthFraction, shieldFraction } from '../combat/damage'
import { jettisonCargo } from '../combat/salvage'
import { isDroneShip } from '../combat/drones'
import type { ShipEntity, World } from '../world/entities'
import { cowardice } from './morale'
import { sees } from './perception'
import { declareFoe } from './targeting'
import { enqueueTask } from './tasks'

/**
 * ГРАБЁЖ. Пират кормится не только игроком: он выходит на мирного с грузом и ТРЕБУЕТ
 * сбросить трюм. Раньше пираты нейтралов не трогали вовсе (`isHostileTo` молчит для
 * `neutral`), и «чужой бой» с торговцем в глуши был пиратами, мирно кружащими рядом с
 * жертвой. Теперь у жертвы есть выбор, а у игрока — повод вмешаться:
 *
 *   уступил — груз летит контейнерами, пират подбирает и уходит;
 *   отказал — личная вражда (`declareFoe`), бой, и торговец зовёт на помощь.
 *
 * Решение жертвы — ОДИН бросок `world.rng` на требование, в такте, по характеру и силам.
 */

/** Тонн в трюме — ради них и грабят. */
export function cargoTons(ship: ShipEntity): number {
  return usedCapacityOf(ship.hold)
}

/** Годится ли борт в жертвы: мирный, с грузом, не под защитой причала, не бог, не дрон. */
export function isPrey(ship: ShipEntity): boolean {
  return (
    ship.alive &&
    ship.faction === 'neutral' &&
    !ship.divine &&
    !ship.clearance &&
    !ship.kinematic &&
    !isDroneShip(ship) &&
    !ship.warpDeparting &&
    cargoTons(ship) >= ROBBERY.MIN_CARGO
  )
}

/**
 * Кого грабить: из ВИДИМЫХ мирных с грузом — где добычи больше на метр пути. Детерминирован:
 * никакой кости, тот же мир — та же жертва.
 */
export function choosePrey(pirate: ShipEntity, world: World): ShipEntity | null {
  let best: ShipEntity | null = null
  let bestScore = 0
  for (const s of world.ships) {
    if (s === pirate || !isPrey(s)) continue
    if (!sees(pirate, s, world)) continue
    const score = cargoTons(s) / Math.max(200, s.state.pos.distanceTo(pirate.state.pos))
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  return best
}

/** Текущая жертва пирата, если она ещё годится. */
export function preyOf(pirate: ShipEntity, world: World): ShipEntity | null {
  const id = pirate.ai?.preyId
  if (id == null) return null
  const s = world.ships.find((o) => o.id === id)
  return s && isPrey(s) ? s : null
}

/** Боевая сила класса корабля (корпус+щит по паспорту), без текущего здоровья. */
const strength = (s: ShipEntity): number => s.spec.hull.hull + s.spec.hull.shield

/**
 * Шанс, что жертва уступит. Трус уступает охотнее, волевой — реже; против сильного пирата
 * и с побитым щитом — охотнее. Середина 0.5: обычный торговец против равного — монетка.
 */
export function yieldChance(prey: ShipEntity, pirate: ShipEntity): number {
  const timid = cowardice(prey.persona) // −0.5..1, трус плюс
  const odds = clamp(strength(pirate) / Math.max(1, strength(prey)) - 1, -1, 1)
  const battered = 1 - (shieldFraction(prey) + healthFraction(prey)) / 2
  return clamp(0.5 + ROBBERY.NERVE_WEIGHT * timid + ROBBERY.ODDS_WEIGHT * odds + 0.2 * battered, 0.05, 0.95)
}

/** Пират выходит на связь с требованием. Слышно в эфире — это видит и игрок. */
export function issueDemand(world: World, pirate: ShipEntity, prey: ShipEntity): void {
  const ai = pirate.ai
  if (!ai) return
  ai.demandAt = world.time
  world.notices.push({ kind: 'demand', name: pirate.name, other: prey.name, at: world.time })
}

/**
 * Жертва решила. Уступила — груз за борт, пират ставит себе сбор добычи и уход; отказала —
 * личная вражда с обеих сторон, бой начнётся сам (`isFoe` → `selectTarget`).
 * Возвращает, уступила ли.
 */
export function settleDemand(world: World, pirate: ShipEntity, prey: ShipEntity): boolean {
  const ai = pirate.ai!
  ai.preyId = null
  ai.demandAt = -1
  const yielded = world.rng() < yieldChance(prey, pirate)
  if (yielded) {
    jettisonCargo(world, prey)
    enqueueTask(pirate, { kind: 'collect-cargo', anchor: prey.state.pos.clone(), radius: 1500, own: true })
    enqueueTask(pirate, { kind: 'depart', own: true })
    world.notices.push({ kind: 'yielded', name: prey.name, other: pirate.name, at: world.time })
    return true
  }
  declareFoe(pirate, prey)
  declareFoe(prey, pirate)
  ai.targetId = prey.id
  world.notices.push({ kind: 'refused', name: prey.name, other: pirate.name, at: world.time })
  return false
}
