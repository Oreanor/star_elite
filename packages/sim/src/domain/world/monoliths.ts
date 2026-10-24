import { Vector3 } from 'three'
import { MONOLITH } from '../../config/monoliths'
import { WARBASE } from '../../config/warbase'
import { makeRng, type Rng } from '../../core/math'
import type { BodyEntity, WarBaseFixture, World } from './entities'
import type { SystemDef } from './system'
import { warBaseGrid } from './warBase'

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
 * Навесные детали базы: башня на «северном» полюсе и кварталы по сетке. Калибр в метрах
 * один на все базы; число и густота сетки растут с площадью шара. Тип и места — из `rng`,
 * поэтому расстановка у всех игроков одна. Детали в ДОМЕНЕ, потому что они отстреливаются.
 */
function layoutFixtures(ids: World['ids'], radius: number, rng: Rng): WarBaseFixture[] {
  const out: WarBaseFixture[] = []
  // Число — от площади шара. На опорном радиусе множитель 1, и база выходит как раньше.
  const span = WARBASE.FIXTURES_MIN + Math.floor(rng() * (WARBASE.FIXTURES_MAX - WARBASE.FIXTURES_MIN + 1))
  const area = (radius / WARBASE.FIXTURE_REF_RADIUS) ** 2
  const n = Math.max(2, Math.round(span * area))
  const push = (model: number, dir: Vector3, size: number): void => {
    out.push({ id: ids.next(), model, dir, size, roll: rng() * Math.PI * 2, cooldown: rng() * WARBASE.TURRET_COOLDOWN, burstLeft: 0, shotIn: 0, hitsLeft: WARBASE.FIXTURE_HITS, lastHitAt: -Infinity, alive: true })
  }
  // ОБА полюса всегда прикрыты деталью. На полюсе equirect-карта стягивается в точку
  // («закрутка звёздочкой»), и башня/пушка маскируют этот артефакт — иначе на «макушке»
  // базы виден шов. Север — башня, юг — пушка. Калибр в метрах, не в долях радиуса.
  push(0, new Vector3(0, 1, 0), WARBASE.TOWER_SIZE)
  push(1, new Vector3(0, -1, 0), WARBASE.TOWER_SIZE * 0.8)
  /**
   * Прочие — ПО СЕТКЕ параллелей и меридианов, а не спиралью.
   *
   * Спираль Фибоначчи раскладывает точки равномерно, но БЕЗ ПОРЯДКА: получалась сыпь, а
   * не сооружение. Рукотворная база должна читаться кварталами — ряды турелей вдоль
   * широт, колонны вдоль меридианов. Поэтому сетка, а занятость каждой клетки решает
   * бросок: где-то батарея, где-то пусто. Порядок виден, однообразия нет.
   *
   * Число колонн на параллели считается от её длины (`cos φ`): у экватора клеток больше,
   * к полюсам меньше — иначе у макушки квартал сжимался бы в точку.
   */
  const wanted = n - 2
  const { cells } = warBaseGrid(radius)

  // Занятость клетки — бросок, но с поправкой: сколько деталей заказано, столько и ставим.
  // Идём по всем клеткам, беря каждую с шансом «осталось поставить / осталось клеток», —
  // так число сходится точно, а места остаются случайными (без «первые подряд, дальше пусто»).
  let left = Math.min(wanted, cells.length)
  for (let i = 0; i < cells.length && left > 0; i++) {
    const remaining = cells.length - i
    if (rng() >= left / remaining) continue
    left--
    const model = 1 + Math.floor(rng() * WARBASE.FIXTURE_MODELS)
    const size = WARBASE.FIXTURE_SIZE_MIN + rng() * (WARBASE.FIXTURE_SIZE_MAX - WARBASE.FIXTURE_SIZE_MIN)
    push(model, cells[i]!, size)
  }
  return out
}

/**
 * Военные базы на снос — из ДАННЫХ системы (`def.warBases`), а не спавн-хардкодом.
 * Смещение отсчитывается от станции (как у «Двери»): базы стоят у причала, но телами не
 * являются — своего списка, без гравитации и орбиты. Крупный шар несёт больше деталей,
 * и снести его дольше: живучесть — это они, а не толщина корки.
 * Навесные детали отстреливаются поштучно, расставлены детерминированно по сиду базы.
 */
export function placeWarBases(world: World, def: SystemDef): void {
  world.warBases = []
  const station = anchorStation(world)
  const bases = def.warBases ?? []
  for (let i = 0; i < bases.length; i++) {
    const b = bases[i]!
    const offset = new Vector3(...b.stationOffset)
    // У планеты — над её поверхностью по направлению смещения; планеты нет (разбита) — как все.
    const planet = b.anchorPlanet != null ? world.bodies.find((x) => x.ref === `planet:${b.anchorPlanet}`) : undefined
    // Без причала — от точки выхода из прыжка: у звезды база стояла бы в её короне.
    const pos = planet
      ? planet.pos.clone().addScaledVector(offset.clone().normalize(), planet.radius + offset.length())
      : station
        ? station.pos.clone().add(offset)
        : new Vector3(...def.playerStart).sub(world.originOffset).add(offset)
    // Сид детерминирован по номеру базы в системе — расстановка деталей у всех одна.
    const seed = ((world.systemIndex * 131 + i * 977) ^ 0x7761726b) >>> 0
    world.warBases.push({
      id: world.ids.next(),
      slot: i,
      kind: 'warbase',
      name: b.name,
      shape: b.model ?? 0,
      pos,
      spinAxis: new Vector3(0, 1, 0),
      spin: WARBASE.SPIN,
      radius: b.radius,
      alive: true,
      wreckAt: null,
      scattered: false,
      fixtures: layoutFixtures(world.ids, b.radius, makeRng(seed)),
      ...(planet ? { anchorId: planet.id } : {}),
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
