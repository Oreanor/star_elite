import { Vector3 } from 'three'
import { MONOLITH } from '../../config/monoliths'
import { WARBASE } from '../../config/warbase'
import { makeRng } from '../../core/math'
import type { BodyEntity, World } from './entities'
import type { SystemDef } from './system'

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
 * Военные базы на снос — из ДАННЫХ системы (`def.warBases`), а не спавн-хардкодом.
 * Смещение отсчитывается от станции (как у «Двери»): базы стоят у причала, но телами не
 * являются — своего списка, без гравитации и орбиты. Прочность корки растёт с радиусом.
 *
 * Навесные детали (башня на полюсе, пушки/глаза вразброс) считает РЕНДЕР по `seed` базы —
 * это визуал, домену их знать незачем, пока они не станут отдельно отстреливаемыми.
 */
export function placeWarBases(world: World, def: SystemDef): void {
  world.warBases = []
  const station = anchorStation(world)
  const bases = def.warBases ?? []
  for (let i = 0; i < bases.length; i++) {
    const b = bases[i]!
    const offset = new Vector3(...b.stationOffset)
    const pos = station
      ? station.pos.clone().add(offset)
      : new Vector3(...def.star.pos).add(offset)
    world.warBases.push({
      id: world.ids.next(),
      kind: 'warbase',
      name: b.name,
      shape: b.model ?? 0,
      pos,
      spinAxis: new Vector3(0, 1, 0),
      spin: WARBASE.SPIN,
      radius: b.radius,
      hull: WARBASE.HULL_PER_KM * (b.radius / 1000),
      hullMax: WARBASE.HULL_PER_KM * (b.radius / 1000),
      alive: true,
      // Сид детерминирован по номеру базы в системе — расстановка деталей у всех одна.
      seed: ((world.systemIndex * 131 + i * 977) ^ 0x7761726b) >>> 0,
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

  // Сколько их здесь вообще — 0..COUNT_MAX по сиду системы. Бросок ПЕРВЫЙ в потоке, до любых
  // координат: так число статуй не зависит от того, где стоит причал.
  const count = Math.floor(rng() * (MONOLITH.COUNT_MAX + 1))

  // Какие облики достались этой системе. Тасуем список и берём первые `count` — двух
  // одинаковых у одного причала быть не должно, а какие именно, решает сид.
  const looks = Array.from({ length: MONOLITH.VARIANTS }, (_, i) => i)
  for (let i = looks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[looks[i], looks[j]] = [looks[j]!, looks[i]!]
  }

  for (let i = 0; i < count; i++) {
    const variant = looks[i]!
    // Веер разводится по ФАКТИЧЕСКОМУ числу статуй, а не по числу обликов: иначе одинокая
    // статуя вставала бы в позу «одной из трёх», оставив рядом пустые места строя.
    const angle = (i / count) * Math.PI * 2
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

}
