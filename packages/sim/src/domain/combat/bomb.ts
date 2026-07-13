import { BOMB } from '../../config/weapons'
import type { ShipEntity, World } from '../world/entities'
import { applyDamage } from './damage'
import { spawnExplosion, spawnShockwave } from './effects'

/**
 * Энергетическая бомба. Импульс сжигает всё враждебное вокруг корабля.
 *
 * Подорвать можно ЛЮБОЙ накопленный запас: бомба сработает ровно на столько
 * процентов мощности, сколько успела набрать. Полный заряд — гарантированная
 * смерть каждому в радиусе; половинный — половина, и раненого он добьёт, а
 * целого лишь оглушит.
 *
 * Доля меряется от ПОЛНОГО запаса врага, а не от текущего. Поэтому «полная
 * мощность = смерть» не назначено числом, а следует из определения: урон равен
 * `щит + корпус` того, в кого попал. Магической константы «урон бомбы» здесь нет
 * и быть не может — иначе новый, более крепкий корабль однажды пережил бы залп,
 * который обещали смертельным.
 *
 * Бомба НЕ убивает своей рукой: она наносит урон через тот же `applyDamage`, что
 * и лазер, а гибель оформляет `cleanup`. Поэтому обломки, трофеи, очки и награда
 * появляются сами. Второй путь к смерти корабля означал бы второе место, где
 * однажды забудут высыпать груз.
 *
 * Нейтралов не трогает. Расстрелять мирного можно только осознанно, лазером, —
 * оружие массового поражения не должно делать этот выбор за пилота.
 */
export function fireBomb(world: World, e: ShipEntity): boolean {
  if (!e.alive || e.auxEnergy <= 0) return false

  // Мощность — доля батареи доп-отсека: залил маскировку/ПРО — бомба выйдет слабее.
  const cap = e.spec.power.auxCapacity
  const power = cap > 0 ? e.auxEnergy / cap : 0
  e.auxEnergy = 0 // бомба выгребает доп-отсек досуха
  spawnShockwave(world, power)

  const radiusSq = BOMB.RADIUS * BOMB.RADIUS

  for (const ship of world.ships) {
    if (!ship.alive || ship.faction === e.faction) continue
    // Бомба — ответ на нападение. Мирные и полиция ей не по адресу.
    if (ship.faction !== 'hostile') continue
    if (ship.state.pos.distanceToSquared(e.state.pos) > radiusSq) continue

    // Полный запас цели: при power = 1 это ровно смертельный удар, кем бы она ни была.
    const lethal = ship.spec.hull.shield + ship.spec.hull.hull
    applyDamage(ship, lethal * power, world.time)
  }

  // Ракеты в воздухе гибнут от любого импульса: жечь электронику дешевле, чем броню.
  for (const m of world.missiles) {
    if (!m.alive || m.ownerId === e.id) continue
    if (m.pos.distanceToSquared(e.state.pos) > radiusSq) continue
    m.alive = false
    spawnExplosion(world, m.pos, m.vel, 1.2)
  }

  return true
}

/**
 * Полностью ли заряжена бомба — то есть полна ли батарея доп-отсека. Ниже полного она тоже
 * сработает, но слабее (мощность — доля запаса). Восполняет доп-отсек общий `regenAux`
 * (см. `ecm.ts`): бомба больше не копится «поверх щита» — у неё теперь своя батарея.
 */
export const bombReady = (e: ShipEntity): boolean =>
  e.spec.power.auxCapacity > 0 && e.auxEnergy >= e.spec.power.auxCapacity
