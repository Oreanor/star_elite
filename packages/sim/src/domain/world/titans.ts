import { Quaternion, Vector3 } from 'three'
import { TITAN } from '../../config/titans'
import { signed } from '../../core/math'
import type { TitanEntity, World } from './entities'

/**
 * Киты — корабли поколений.
 *
 * Живут отдельно от боевой машинерии: не стреляют, не стреляют по ним, ни с чем
 * не сталкиваются. Всё, что они делают, — плывут (или висят у станции) и исчезают,
 * уйдя за горизонт. Рождает их тот же трафик, но реже и в свой список.
 */

const _dir = new Vector3()
const _side = new Vector3()

/** Единичный вектор в случайную сторону. */
function randomDir(world: World, out: Vector3): Vector3 {
  do {
    out.set(signed(world.rng), signed(world.rng), signed(world.rng))
  } while (out.lengthSq() < 1e-6)
  return out.normalize()
}

/** Сколько китов сейчас в системе. */
export const titanCount = (world: World): number => world.titans.length

/**
 * Родить кита. Либо он висит у станции, либо ПРОПЛЫВАЕТ мимо игрока: появляется
 * сбоку и идёт поперёк взгляда, чтобы его прошло видно целиком, а не «на камеру».
 */
export function spawnTitan(world: World): TitanEntity {
  const variant = Math.floor(world.rng() * TITAN.VARIANTS)
  const station = world.bodies.find((b) => b.kind === 'station')

  const pos = new Vector3()
  const vel = new Vector3()

  if (station && world.rng() < TITAN.STATION_SHARE) {
    // Висит поодаль от причала: город на рейде. Дрейф почти нулевой.
    randomDir(world, _dir)
    pos.copy(station.pos).addScaledVector(_dir, TITAN.RADIUS * 4)
  } else {
    // Появляется сбоку от игрока и идёт ПОПЕРЁК его взгляда — так проплывает в кадре.
    randomDir(world, _dir)
    pos.copy(world.player.state.pos).addScaledVector(_dir, TITAN.SPAWN_RANGE)
    // Направление хода перпендикулярно линии «игрок → кит»: мимо, а не на игрока.
    randomDir(world, _side)
    _side.addScaledVector(_dir, -_side.dot(_dir)).normalize()
    vel.copy(_side).multiplyScalar(TITAN.DRIFT_SPEED)
  }

  // Нос вдоль дрейфа; у висящего — произвольно, но детерминированно от направления.
  const facing = vel.lengthSq() > 1e-6 ? _side.copy(vel).normalize() : randomDir(world, _side)
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), facing)

  const titan: TitanEntity = {
    id: world.ids.next(),
    kind: 'titan',
    variant,
    name: TITAN.MARKS[variant] ?? 'Корабль поколений',
    pos,
    vel,
    quat,
    spin: TITAN.SPIN,
    radius: TITAN.RADIUS,
  }
  world.titans.push(titan)
  return titan
}

/**
 * Показательная тройка — по одному киту КАЖДОГО облика поодаль от старта, чтобы
 * их можно было облететь и рассмотреть. Стоят неподвижно, носом к точке старта.
 * Детерминированно: те же места при том же зерне, никакого rng.
 *
 * Расставлены веером в разные стороны и на разной дальности, чтобы не слиплись
 * друг с другом и читались тремя силуэтами, а не одной кучей.
 */
export function placeShowcaseTitans(world: World): void {
  const origin = world.player.state.pos
  const layout = [
    { dir: new Vector3(0.85, 0.12, 0.5), dist: TITAN.RADIUS * 3.5 },
    { dir: new Vector3(-0.8, 0.18, 0.55), dist: TITAN.RADIUS * 4.5 },
    { dir: new Vector3(0.05, -0.15, 1), dist: TITAN.RADIUS * 4 },
  ]
  for (let variant = 0; variant < TITAN.VARIANTS; variant++) {
    const { dir, dist } = layout[variant % layout.length]!
    const pos = origin.clone().addScaledVector(_dir.copy(dir).normalize(), dist)
    // Носом к точке старта: игрок сразу видит их «лицо», а не корму.
    const facing = _side.copy(origin).sub(pos).normalize()
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), facing)
    world.titans.push({
      id: world.ids.next(),
      kind: 'titan',
      variant,
      name: TITAN.MARKS[variant] ?? 'Корабль поколений',
      pos,
      vel: new Vector3(),
      quat,
      spin: TITAN.SPIN,
      radius: TITAN.RADIUS,
    })
  }
}

/** Движение китов. По секундам дрейфа — за кадр, как и трафик. */
export function stepTitans(world: World, dt: number): void {
  for (const titan of world.titans) titan.pos.addScaledVector(titan.vel, dt)

  const limitSq = TITAN.DESPAWN_RANGE * TITAN.DESPAWN_RANGE
  world.titans = world.titans.filter(
    (t) => t.pos.distanceToSquared(world.player.state.pos) <= limitSq,
  )
}
