import { Vector3 } from 'three'
import { COSMIC } from '../../config/weapons'
import { randomUnit } from '../../core/math/random'
import { apparentRadius, effectiveRadius } from '../scale/scale'
import type { ShipEntity, World } from '../world/entities'

/**
 * УДАР ОКОНЧАТЕЛЬНОГО ВЗРЫВА разбивающего импульса — разрыва мира или общего взрыва базы.
 * Корабли в досягаемости получают толчок ПРОЧЬ от центра — откуда бы ни смотрел нос: летишь
 * ты от взрыва или к нему, толкает по линии «центр → корабль», — и короткий закрут, который
 * выправляет обычное управление. Рендер по метке `lastBlastAt` трясёт кабину.
 *
 * Это физика, а не камера: смещение настоящее и одинаковое у всех, кто считает этот мир.
 * Сдвиг меряется в длинах корпуса (SHIFT), иначе гиганта с миелофоном не сдвинуло бы вовсе,
 * а мелочь вышвырнуло бы за горизонт. Рывок живёт отдельно (`blastDrift`) и гаснет сам.
 */

const _away = new Vector3()
const _twist = new Vector3()

/**
 * Толкнуть всех у взрыва тела (или базы) радиуса `radius` в `at` (локальные координаты).
 * Досягаемость — `reachMul` радиусов тела ТОГО размера, что виден кораблю (закон зума):
 * выросшему борту и взрыв меньше. Полная сила — ближе `KICK.FULL` досягаемости.
 */
export function blastKick(world: World, at: Vector3, radius: number, star: boolean, reachMul: number): void {
  kick(world, world.player, at, radius, star, reachMul)
  // У зеркала чужими кораблями правит хозяин — толкаем лишь своего; остальных сдвинет он.
  if (world.trafficRole === 'mirror') return
  for (const ship of world.ships) kick(world, ship, at, radius, star, reachMul)
}

function kick(world: World, ship: ShipEntity, at: Vector3, radius: number, star: boolean, reachMul: number): void {
  if (!ship.alive) return
  const K = COSMIC.KICK
  const reach = apparentRadius(radius, star, ship.state.scale) * reachMul
  _away.copy(ship.state.pos).sub(at)
  const d = _away.length()
  if (d >= reach) return
  const power = Math.min(1, (1 - d / reach) / (1 - K.FULL))
  if (d < 1e-6) randomUnit(world.rng, _away)
  else _away.divideScalar(d)
  const length = 2 * effectiveRadius(ship)
  ship.blastDrift.addScaledVector(_away, (K.SHIFT * length * power) / K.TAU)
  // Закрут в связанных осях: тряхнуло — нос повело, пилот выправляет.
  ship.state.angVel.add(randomUnit(world.rng, _twist).multiplyScalar(K.SPIN * power))
  ship.lastBlastAt = world.time
  ship.lastBlastPower = power
}

/** Рывок несёт корабль и гаснет экспонентой: сумма пути — ровно `скорость · TAU`. */
function drift(ship: ShipEntity, dt: number, decay: number): void {
  const v = ship.blastDrift
  if (v.lengthSq() < 1e-6) return
  ship.state.pos.addScaledVector(v, dt)
  v.multiplyScalar(decay)
}

/** Такт рывков — у всех кораблей одинаково: игрок и бот неотличимы для физики. */
export function stepBlastDrift(world: World, dt: number): void {
  const decay = Math.exp(-dt / COSMIC.KICK.TAU)
  drift(world.player, dt, decay)
  for (const ship of world.ships) drift(ship, dt, decay)
}

/**
 * Разрывы миров: в миг вспышки (`born + BURST`) — удар. Метка `kicked` — чтобы однажды;
 * время в такте, не в кадре: тот же миг при любой герцовке.
 */
export function stepCataclysmKicks(world: World): void {
  for (const c of world.cataclysms) {
    if (c.kicked || c.kind === 'seed') continue
    if (world.time < c.born + COSMIC.BURST[c.kind]) continue
    c.kicked = true
    _away.copy(c.at).sub(world.originOffset)
    blastKick(world, _away, c.radius, c.kind === 'star', COSMIC.KICK.REACH[c.kind])
  }
}
