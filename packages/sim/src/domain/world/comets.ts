import { Euler, Quaternion, Vector3 } from 'three'
import { ASTEROID, COMET } from '../../config/world'
import { randomUnit, signed } from '../../core/math'
import type { AsteroidEntity, World } from './entities'

/**
 * Кометы — встречи трафика, только реже камней. Рождается у кромки пузыря трафика и летит
 * сквозь него пролётом мимо игрока — не в лоб, а так, чтобы хвост прошёл в виду. Дальше
 * её ведёт физика (`stepAsteroids`): тяготение светил гнёт путь у звезды, вдали он прямой.
 * Уходит за `COMET.DESPAWN_RANGE` — дальше хвоста. Камни у той же уборки снимают раньше,
 * на горизонте радара: у них нет ленты в десятки километров.
 */

const _dir = new Vector3()
const _side = new Vector3()
const _aim = new Vector3()

export function liveCometCount(world: World): number {
  let n = 0
  for (const a of world.asteroids) if (a.alive && a.comet) n++
  return n
}

export function spawnComet(world: World): AsteroidEntity | null {
  if (liveCometCount(world) >= COMET.MAX_LIVE) return null
  const rng = world.rng
  const player = world.player.state.pos

  // Откуда: случайное направление от игрока, на кромке пузыря.
  randomUnit(rng, _dir)
  const pos = player.clone().addScaledVector(_dir, COMET.SPAWN_DISTANCE)

  // Куда: мимо игрока на `miss` метров в случайную сторону, поперёк линии прилёта.
  randomUnit(rng, _side)
  _side.addScaledVector(_dir, -_side.dot(_dir))
  if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0).addScaledVector(_dir, -_dir.x)
  _side.normalize()
  const miss = COMET.MISS_MIN + rng() * (COMET.MISS_MAX - COMET.MISS_MIN)
  _aim.copy(player).addScaledVector(_side, miss).sub(pos).normalize()
  const speed = COMET.SPEED_MIN + rng() * (COMET.SPEED_MAX - COMET.SPEED_MIN)

  const comet: AsteroidEntity = {
    id: world.ids.next(),
    kind: 'asteroid',
    pos,
    vel: _aim.clone().multiplyScalar(speed),
    quat: new Quaternion().setFromEuler(new Euler(rng() * 6, rng() * 6, rng() * 6)),
    spin: new Vector3(signed(rng), signed(rng), signed(rng)).multiplyScalar(0.05),
    radius: COMET.RADIUS_MIN + rng() * (COMET.RADIUS_MAX - COMET.RADIUS_MIN),
    hull: ASTEROID.HULL,
    shape: Math.floor(rng() * ASTEROID.SHAPES),
    alive: true,
    comet: true,
  }
  world.asteroids.push(comet)
  return comet
}
