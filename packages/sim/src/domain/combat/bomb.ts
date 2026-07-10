import { BOMB } from '../../config/weapons'
import type { ShipEntity, World } from '../world/entities'
import { applyDamage, shieldFraction } from './damage'
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
  if (!e.alive || e.bombCharge <= 0) return false

  const power = e.bombCharge
  e.bombCharge = 0
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
 * Накопитель копится сам — но реактор кормит ЩИТ первым, и в бомбу уходят только
 * его излишки. Пока щит не полон, бомба не заряжается вовсе.
 *
 * Отсюда её единственная цена: набрать полную мощность, не выходя из-под огня,
 * невозможно. Кораблю без щита бомба не светит никогда, и это не частный случай,
 * а то же правило: излишков у него не бывает.
 *
 * Набранный заряд НЕПРИКОСНОВЕНЕН. Попадание сбивает накопление, но не отнимает
 * накопленное: бомбу нельзя ни разбить, как щит, ни испортить. Единственный, кто
 * её тратит, — сам пилот. Поэтому `applyDamage` про `bombCharge` не знает и знать
 * не должен: заряд убывает ровно в одном месте — в `fireBomb`.
 */
export function regenBomb(e: ShipEntity, dt: number): void {
  if (!e.alive || e.bombCharge >= 1) return
  if (e.spec.hull.shield <= 0 || shieldFraction(e) < 1) return
  e.bombCharge = Math.min(1, e.bombCharge + BOMB.RECHARGE * dt)
}

/** Полностью ли заряжена. Ниже единицы бомба тоже сработает — но слабее. */
export const bombReady = (e: ShipEntity): boolean => e.bombCharge >= 1
