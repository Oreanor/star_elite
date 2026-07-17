import { Vector3 } from 'three'
import { MONOLITH } from '../../config/monoliths'
import { makeRng } from '../../core/math'
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
 * Расставить статуи у причала: по одной каждого облика, веером вокруг станции.
 *
 * Веер, а не куча: сдвигаем каждую по углу на равную долю круга, чтобы они не слипались и
 * читались тремя силуэтами. Радиус и наклон слегка разные — иначе строй выглядит забором.
 */
export function placeMonoliths(world: World): void {
  const station = anchorStation(world)
  if (!station) return
  world.monoliths = []

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
      // Разводим по высоте, иначе три статуи лежат ровно в одной плоскости — видно, что расставлял циркуль.
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
}
