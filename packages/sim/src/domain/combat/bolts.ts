import { Vector3 } from 'three'
import type { BoltEntity, World } from '../world/entities'
import { breakFromHit } from './breakage'
import { applyDamage } from './damage'
import { spawnExplosion, spawnShieldFlash, spawnTracer } from './effects'
import { registerPlayerHit } from './grievance'
import { damageAsteroid } from './mining'
import { castLaser } from './raycast'

/**
 * Полёт лазерных болтов. Лазер больше НЕ мгновенный: болт летит снарядом и попадает
 * тогда, когда долетит. Это то, что делает бой сетевым и честным — по такому лучу
 * можно увернуться, а ИИ обязан целиться с упреждением.
 *
 * Заметание, а не точка. За шаг физики (1/120 с) болт проходит ~200 м — куда больше
 * любого корабля. Проверять «попал ли болт СЕЙЧАС» значило бы пропускать цель между
 * шагами. Поэтому каждый шаг мы тем же `castLaser` тестируем ВЕСЬ отрезок, пройденный
 * за шаг: от старой позиции на длину `speed·dt`. Это ровно то, что раньше делал
 * мгновенный луч на всю дальность, — только теперь отрезок короткий и движется.
 */

const _dir = new Vector3()
const _hitPos = new Vector3()
/** Неподвижная сфера платформы: скорость обломков от неё — ноль. Не мутируется. */
const _still = /* @__PURE__ */ new Vector3()
/**
 * Стрелок глазами луча: id ВЛАДЕЛЬЦА (не самого болта!) и его маскировка. Луч по
 * этому id не бьёт в стрелка — а болт стартует внутри сферы носителя, так что без
 * исключения владельца первый же шаг «попал» бы в того, кто выстрелил.
 */
const _shooter = { id: 0, cloaked: false }

function resolveHit(world: World, bolt: BoltEntity, hitPos: Vector3, hit: ReturnType<typeof castLaser>): void {
  if (hit.ship) {
    spawnExplosion(world, hitPos, hit.ship.state.vel, 0.6)
    if (hit.ship.kinematic) {
      // HP кинематического (чужого) борта живёт на ЕГО клиенте — локально урон не наносим,
      // а РЕГИСТРИРУЕМ попадание, чтобы сеть переслала его владельцу (авторитет над своим HP).
      // Ни урона, ни обиды: это не наш бот, а внешний игрок; его реакция — на его стороне.
      world.remoteHits.push({ targetId: hit.ship.id, damage: bolt.damage })
    } else {
      // Щит ДО удара: по нему решается, изнашивается ли сам щит (цел) или ломается
      // деталь (пробит). Считаем до applyDamage — оно этот щит и просадит.
      const shieldUp = hit.ship.shield > 0
      applyDamage(hit.ship, bolt.damage, world.time)
      // Поломка снаряжения — только у игрока (боты не чинятся). Враг ли стрелял, не
      // важно: попали по игроку — железо под ударом. Кинематический борт (чужой) — мимо.
      if (hit.ship.faction === 'player') breakFromHit(hit.ship, shieldUp, world.rng)
      // Попал болт игрока по не-врагу — повод к обиде, а не к мгновенной войне: копим
      // претензию, во враги переводит уже сам `registerPlayerHit` на пороге. `hostile`
      // ложно ровно у выстрелов игрока — по нему и узнаём стрелка, стрелок мог погибнуть.
      if (!bolt.hostile) registerPlayerHit(world, hit.ship)
    }
  } else if (hit.asteroid) {
    spawnExplosion(world, hitPos, hit.asteroid.vel, 0.4)
    // Камень не исчезает — он раскалывается. Правило дробления живёт в одном месте.
    damageAsteroid(world, hit.asteroid, bolt.damage)
  } else if (hit.missile) {
    // Ракета не «повреждается»: у неё нет прочности, только боевая часть.
    hit.missile.alive = false
    spawnExplosion(world, hit.missile.pos, hit.missile.vel, 1.2)
  } else if (hit.platform) {
    // Ядро платформы принимает урон корпусом: щита у гнезда нет. Гибель, взрыв и
    // металл — забота `stepPlatforms`, когда прочность уйдёт в ноль.
    hit.platform.hull = Math.max(0, hit.platform.hull - bolt.damage)
    spawnExplosion(world, hitPos, _still, 0.6)
  } else if (hit.station) {
    // Станция неуязвима: болт гаснет о защитное поле голубой вспышкой. Ни урона, ни
    // обиды — стрелять по станции бессмысленно, и это должно читаться сразу. Прямое
    // попадание — полная яркость.
    spawnShieldFlash(world, hitPos, hit.station.pos, 1)
  }
}

export function stepBolts(world: World, dt: number): void {
  for (const bolt of world.bolts) {
    if (!bolt.alive) continue

    const speed = bolt.vel.length()
    if (speed < 1e-6) {
      bolt.alive = false
      continue
    }
    _dir.copy(bolt.vel).divideScalar(speed)

    // Отрезок этого шага: не длиннее остатка дальности — на последнем шаге болт
    // не должен «дотянуться» за свой предел.
    const reach = Math.min(speed * dt, bolt.distanceLeft)
    _shooter.id = bolt.ownerId
    _shooter.cloaked = bolt.cloaked
    const hit = castLaser(world, bolt.pos, _dir, _shooter, reach)
    _hitPos.copy(bolt.pos).addScaledVector(_dir, hit.distance)

    // След за пройденный отрезок отдаём каждый шаг: контур болта складывается из
    // коротких трасс, что рендер уже умеет рисовать. Домен цветов не знает — несёт `weapon`.
    spawnTracer(world, bolt.pos, _hitPos, bolt.hostile, bolt.weapon)

    if (hit.distance < reach) {
      resolveHit(world, bolt, _hitPos, hit)
      bolt.alive = false
      continue
    }

    bolt.pos.copy(_hitPos)
    bolt.distanceLeft -= reach
    if (bolt.distanceLeft <= 0) bolt.alive = false
  }

  world.bolts = world.bolts.filter((b) => b.alive)
}
