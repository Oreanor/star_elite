import { Vector3 } from 'three'
import { MONOLITH } from '../../config/monoliths'
import { makeRng, range, type Rng } from '../../core/math'
import type { BodyEntity, World } from './entities'

/**
 * Статуи-исполины у причала.
 *
 * Самый инертный объект мира: ни шага симуляции, ни столкновений, ни боя. Поставили при
 * заселении системы — и всё, дальше их только рисуют. Даже вращение им шагать не надо: угол
 * берётся как `spin·time` в рендере, поэтому пауза, прыжок и сеть их не рассинхронят.
 *
 * Расстановка ДЕТЕРМИНИРОВАНА от СИДА системы, а не от `world.rng`: у всех игроков статуи
 * стоят одинаково, и поток случайности трафика мы не сдвигаем (он зависит от порядка бросков —
 * тронешь его здесь, и встречи поедут). Тот же приём, что у облика станции.
 */

const _out = new Vector3()
const _side = new Vector3()
const _up = new Vector3(0, 1, 0)

/** Причал, у которого стоят статуи: первый в системе. Нет причала — статуй нет. */
function anchorStation(world: World): BodyEntity | null {
  return world.bodies.find((b) => b.kind === 'station') ?? null
}

/**
 * Пояс глыб вокруг Люцифера. Тор, а не шар: внутри остаётся «двор», куда можно влететь,
 * и камни читаются кольцом у силуэта, а не облаком, закрывающим статую.
 */
function placeScenicRocks(world: World, rng: Rng): void {
  world.scenicRocks = []
  // Пояс держится за Люцифера (variant 0). Нет его — не из чего строить двор.
  const lucifer = world.monoliths.find((m) => m.variant === 0)
  if (!lucifer) return

  for (let i = 0; i < MONOLITH.ROCK_COUNT; i++) {
    const angle = rng() * Math.PI * 2
    const dist = lucifer.radius * range(rng, MONOLITH.ROCK_GAP_MIN, MONOLITH.ROCK_GAP_MAX)
    const lift = (rng() - 0.5) * lucifer.radius * MONOLITH.ROCK_THICKNESS

    const pos = lucifer.pos
      .clone()
      .addScaledVector(_out, Math.cos(angle) * dist)
      .addScaledVector(_side, Math.sin(angle) * dist)
      .addScaledVector(_up, lift)

    const spinAxis = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5)
    if (spinAxis.lengthSq() < 1e-6) spinAxis.set(0, 1, 0)
    spinAxis.normalize()

    const radius = range(rng, MONOLITH.ROCK_RADIUS_MIN, MONOLITH.ROCK_RADIUS_MAX)
    world.scenicRocks.push({
      id: world.ids.next(),
      kind: 'scenicRock',
      shape: Math.floor(rng() * MONOLITH.ROCK_SHAPES),
      pos,
      spinAxis,
      spin: MONOLITH.ROCK_SPIN * (0.6 + rng() * 0.8),
      radius,
      // Крупнее камень — толще корка: иначе километровый и мелкий гибли бы за один залп.
      hull: MONOLITH.ROCK_HULL * (radius / MONOLITH.ROCK_RADIUS_MIN),
      alive: true,
    })
  }
}

/**
 * Расставить статуи у причала: по одной каждого облика, веером вокруг станции.
 *
 * Веер, а не куча: каждую сдвигаем по углу на равную долю круга, чтобы они не слипались и
 * читались порознь. Наклон и удаление слегка разные — иначе строй выглядит забором.
 */
export function placeMonoliths(world: World): void {
  const station = anchorStation(world)
  world.monoliths = []
  world.scenicRocks = []
  if (!station) return

  // Сид системы + соль: расстановка своя у каждой системы, но повторяемая.
  const rng = makeRng((world.systemIndex ^ 0x4d4f4e4f) >>> 0)

  // Наружу от звезды — статуи стоят на «дневной» стороне причала, как и точка выхода игрока.
  const star = world.bodies.find((b) => b.kind === 'star')
  _out.copy(station.pos)
  if (star) _out.sub(star.pos)
  if (_out.lengthSq() < 1e-6) _out.set(0, 0, 1)
  _out.normalize()

  // Боковая ось: вместе с `_out` задаёт плоскость веера вокруг причала.
  _side.crossVectors(_up, _out)
  if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0)
  _side.normalize()

  for (let variant = 0; variant < MONOLITH.VARIANTS; variant++) {
    const angle = (variant / MONOLITH.VARIANTS) * Math.PI * 2
    const gap = MONOLITH.STATION_GAP_MIN + rng() * (MONOLITH.STATION_GAP_MAX - MONOLITH.STATION_GAP_MIN)
    const dist = MONOLITH.RADIUS * gap

    const pos = station.pos
      .clone()
      .addScaledVector(_out, Math.cos(angle) * dist)
      .addScaledVector(_side, Math.sin(angle) * dist)
      // Разводим по высоте, иначе статуи лежат ровно в одной плоскости — видно, что расставлял циркуль.
      .addScaledVector(_up, (rng() - 0.5) * dist * 0.5)

    // Своя ось кувырка у каждой: строем крутиться им незачем.
    const spinAxis = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5)
    if (spinAxis.lengthSq() < 1e-6) spinAxis.set(0, 1, 0)
    spinAxis.normalize()

    world.monoliths.push({
      id: world.ids.next(),
      kind: 'monolith',
      variant,
      pos,
      spinAxis,
      spin: MONOLITH.SPIN,
      radius: MONOLITH.RADIUS,
    })
  }

  placeScenicRocks(world, rng)
}
