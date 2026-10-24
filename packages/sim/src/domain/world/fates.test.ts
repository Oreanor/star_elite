import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ARRIVAL, FAUNA_SPECIES, GALAXY } from '../../config/galaxy'
import { COSMIC } from '../../config/weapons'
import { generateGalaxy } from '../galaxy/generate'
import { commitPreparedJump, systemDefFor } from '../galaxy/jump'
import { arrivalPointAt, stationSeat } from '../galaxy/arrival'
import { isSettled } from '../galaxy/types'
import { applyDelta, fateEdits, pushEdit, type FateEdit } from '../galaxy/delta'
import { stepWorld } from '../sim/step'
import { chargeBallRadius, stepPulses, spawnPulse } from '../combat/cosmic'
import { coolGuns, fireLasers, laserOverheated, settlePulseCharges, unholdPulseCharges } from '../combat/weapons'
import { SEED_PULSE, SHATTER_CANNON } from '../../config/modules'
import type { LaserModule } from '../loadout'
import { layoutSystemBodies, refreshSpec } from './factory'
import { createWorld, enterSystem } from './index'
import type { BodyEntity, World } from './entities'
import { commitFate, reconcileFates } from './fates'
import { orbitTime, stepOrbits } from './orbits'
import { stationHost } from '../station/docking'
import { dispatcherBriefing } from '../station/dispatcher'
import { focusedPlanet } from './queries'

/**
 * Судьбы тел — космические лазеры. Держим то, ради чего судьба живёт в журнале ГАЛАКТИКИ, а не
 * в мире одного клиента: тот, кто войдёт в систему позже, видит ровно то же, что видел стрелок.
 * И правила остатка: скала — пояс, газ — ничего, луна — дуга, дети погибшего — на своём удалении.
 */

function systemWhere(test: (w: World) => boolean): { world: World; index: number } {
  for (let index = 1; index < 400; index++) {
    const world = createWorld({ ...systemDefFor(index, GALAXY.SEED), patrols: [], belt: null })
    enterSystem(world, { ...systemDefFor(index, GALAXY.SEED), patrols: [] }, index)
    if (test(world)) return { world, index }
  }
  throw new Error('нет подходящей системы')
}

const rockyWithStationAndMoon = (w: World): boolean =>
  w.bodies.some((p) => p.kind === 'planet' && p.surface !== 'Газовый гигант'
    && w.bodies.some((s) => s.kind === 'station' && s.orbit?.parentId === p.id)
    && w.bodies.some((m) => m.kind === 'moon' && m.orbit?.parentId === p.id))

function hostPlanet(w: World): BodyEntity {
  return w.bodies.find((p) => p.kind === 'planet' && p.surface !== 'Газовый гигант'
    && w.bodies.some((s) => s.kind === 'station' && s.orbit?.parentId === p.id)
    && w.bodies.some((m) => m.kind === 'moon' && m.orbit?.parentId === p.id))!
}

/** Чужой клиент: тот же журнал, та же система, вход «позже». */
function lateVisitor(source: World, index: number, laterBy = 0): World {
  const def = { ...systemDefFor(index, GALAXY.SEED), patrols: [] }
  const other = createWorld({ ...def, belt: null })
  other.galaxyDelta = { edits: [...source.galaxyDelta.edits] }
  other.calendarTime = source.calendarTime + laterBy
  enterSystem(other, def, index)
  return other
}

describe('судьбы тел (космические лазеры)', () => {
  it('скала разбивается в пояс на своей орбите; причал и луны остаются на своём удалении у звезды', () => {
    const { world, index } = systemWhere(rockyWithStationAndMoon)
    const planet = hostPlanet(world)
    const star = world.bodies.find((b) => b.kind === 'star' && !b.faint)!
    const station = world.bodies.find((s) => s.kind === 'station' && s.orbit?.parentId === planet.id)!
    const moon = world.bodies.find((m) => m.kind === 'moon' && m.orbit?.parentId === planet.id)!
    const stationAt = station.pos.clone()
    const belts = world.asteroidBelts.length
    const orbit = planet.orbit!

    expect(commitFate(world, planet, 'shatter')).toBe(true)

    expect(world.bodies).not.toContain(planet)
    expect(world.asteroidBelts.length).toBe(belts + 1)
    const belt = world.asteroidBelts.at(-1)!
    expect(belt.radius).toBeCloseTo(orbit.radius, 0)
    expect(belt.arc).toBeNull()
    // Причал не прыгнул и теперь кружит вокруг хозяина погибшей планеты.
    expect(station.pos.distanceTo(stationAt)).toBeLessThan(1)
    expect(station.orbit!.parentId).toBe(orbit.parentId)
    expect(moon.orbit!.parentId).toBe(orbit.parentId)
    // Темп — Кеплер у той же массы: на чуть большем радиусе чуть медленнее планеты.
    expect(station.orbit!.rate).toBeGreaterThan(0)
    expect(station.orbit!.rate / orbit.rate).toBeCloseTo((orbit.radius / station.orbit!.radius) ** 1.5, 6)
    // Свежая правка — со зрелищем; правка — в общей очереди сети.
    expect(world.cataclysms.at(-1)!.kind).toBe('rock')
    expect(world.galaxyEditsOut.at(-1)!.edit.op).toBe('fate')
    void star

    // Пришедший позже видит ровно то же: планеты нет, пояс тот же, причал там же.
    const other = lateVisitor(world, index)
    expect(other.bodies.some((b) => b.ref === planet.ref)).toBe(false)
    expect(other.asteroidBelts.length).toBe(world.asteroidBelts.length)
    const otherStation = other.bodies.find((b) => b.kind === 'station' && b.name === station.name)!
    expect(otherStation.pos.clone().add(other.originOffset).distanceTo(station.pos.clone().add(world.originOffset))).toBeLessThan(1)
    // Старая правка — без зрелища: тело просто уже разбито.
    const stale = lateVisitor(world, index, COSMIC.FRESH * 10)
    expect(stale.cataclysms.length).toBe(0)
  })

  it('луну — в дугу ~30° вокруг её планеты, а не в кольцо', () => {
    const { world } = systemWhere(rockyWithStationAndMoon)
    const planet = hostPlanet(world)
    const moon = world.bodies.find((m) => m.kind === 'moon' && m.orbit?.parentId === planet.id)!
    commitFate(world, moon, 'shatter')
    const belt = world.asteroidBelts.at(-1)!
    expect(belt.parentId).toBe(planet.id)
    expect(belt.arc).not.toBeNull()
    expect(belt.arc!.half * 2).toBeCloseTo(Math.PI / 6, 6)
    expect(world.bodies).not.toContain(moon)
  })

  it('газовый гигант рассеивается без пояса', () => {
    const { world } = systemWhere((w) => w.bodies.some((b) => b.surface === 'Газовый гигант'))
    const giant = world.bodies.find((b) => b.surface === 'Газовый гигант')!
    const belts = world.asteroidBelts.length
    commitFate(world, giant, 'shatter')
    expect(world.bodies).not.toContain(giant)
    expect(world.asteroidBelts.length).toBe(belts)
    expect(world.cataclysms.at(-1)!.kind).toBe('gas')
  })

  it('засев: на голом мире зарождается первобытная жизнь, без причала', () => {
    const { world, index } = systemWhere((w) => w.bodies.some((b) => b.kind === 'planet' && !b.settlement && b.surface === 'Скалистая'))
    const rock = world.bodies.find((b) => b.kind === 'planet' && !b.settlement && b.surface === 'Скалистая')!
    const stations = world.bodies.filter((b) => b.kind === 'station').length
    commitFate(world, rock, 'seed')
    expect(rock.settlement?.species).toBe(FAUNA_SPECIES)
    expect(rock.settlement!.techLevel).toBeLessThanOrEqual(4)
    expect(rock.surface).toBe('Земного типа')
    expect(world.bodies.filter((b) => b.kind === 'station').length).toBe(stations)
    // Карта галактики знает о том же: каталог системы уже с жизнью.
    const sys = applyDelta(generateGalaxy(GALAXY.SEED), world.galaxyDelta)[index]!
    expect(sys.planets[Number(rock.ref!.split(':')[1])]!.settlement?.species).toBe(FAUNA_SPECIES)
  })

  it('одиночная звезда растворяется — планеты продолжают путь вокруг её места', () => {
    const { world } = systemWhere((w) => !w.bodies.some((b) => b.ref === 'star:1') && w.bodies.some((b) => b.kind === 'planet') && w.bodies[0]!.kind === 'star')
    const star = world.bodies.find((b) => b.ref === 'star')!
    const planet = world.bodies.find((b) => b.kind === 'planet')!
    const before = planet.pos.clone()
    commitFate(world, star, 'shatter')
    expect(world.bodies).not.toContain(star)
    expect(planet.orbit!.parentId).toBeNull()
    expect(planet.pos.distanceTo(before)).toBeLessThan(1)
    expect(world.cataclysms.at(-1)!.kind).toBe('star')
    expect(world.dyson).toBeNull()
  })

  it('звезда двойной: партнёр остаётся и встаёт на месте, поток между ними рвётся', () => {
    const { world } = systemWhere((w) => w.bodies.filter((b) => b.kind === 'star' && !b.faint).length === 2)
    const [a, b] = world.bodies.filter((x) => x.kind === 'star' && !x.faint) as [BodyEntity, BodyEntity]
    a.streamTo = b.id
    const bAt = b.pos.clone()
    commitFate(world, a, 'shatter')
    expect(world.bodies).not.toContain(a)
    expect(world.bodies).toContain(b)
    expect(b.orbit!.rate).toBe(0)
    expect(b.pos.distanceTo(bAt)).toBeLessThan(1)
    // Час спустя партнёр всё там же: без пары кружить ему не вокруг чего.
    world.calendarClock = world.calendarTime = world.calendarTime + 3600
    stepOrbits(world, orbitTime(world))
    expect(b.pos.clone().add(world.originOffset).distanceTo(bAt.clone().add(world.originOffset))).toBeLessThan(1)
  })

  it('чёрной дыре всё равно: её не разбить', () => {
    const world = createWorld({ ...systemDefFor(1, GALAXY.SEED), patrols: [], belt: null })
    enterSystem(world, systemDefFor(0, GALAXY.SEED), 0)
    const hole = world.bodies.find((b) => b.kind === 'blackhole')!
    commitFate(world, hole, 'shatter')
    reconcileFates(world)
    expect(world.bodies).toContain(hole)
  })

  it('импульс игрока долетает до планеты и пишет правку галактики', () => {
    const { world } = systemWhere(rockyWithStationAndMoon)
    // Ближайшая к кораблю: импульс бьёт первое тело на линии, а под бортом — его планета.
    const me = world.player.state.pos
    const planet = world.bodies.filter((b) => b.kind === 'planet')
      .sort((x, y) => x.pos.distanceTo(me) - y.pos.distanceTo(me))[0]!
    const dir = planet.pos.clone().sub(world.player.state.pos).normalize()
    spawnPulse(world, world.player, world.player.state.pos, dir, 1e9)
    for (let i = 0; i < 120 * 30 && world.pulses.length > 0; i++) stepPulses(world, 1 / 120)
    const edit = world.galaxyEditsOut.at(-1)?.edit as FateEdit | undefined
    expect(edit?.ref).toBe(planet.ref)
    expect(edit?.fate).toBe('shatter')
  })
})

describe('космические лазеры в стрельбе', () => {
  /** Поставить на все лазерные точки игрока один ствол. */
  function arm(world: World, laser: LaserModule): void {
    const p = world.player
    p.loadout = { ...p.loadout, weapons: p.loadout.weapons.map((w) => (w && w.kind === 'laser' ? laser : w)) }
    refreshSpec(p)
    p.laserHeat.heat = 0
    p.laserHeat.overheatUntil = 0
  }

  /** Такт оружия, как в `stepWeapons`: гашетка держится или отпущена. */
  function tick(world: World, hold: boolean): void {
    const dt = 1 / 120
    world.time += dt
    unholdPulseCharges([world.player])
    coolGuns(world.player, world.time, dt)
    if (hold) fireLasers(world, world.player, false, dt)
    settlePulseCharges(world, [world.player])
  }
  const hold = (world: World, seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 120); i++) tick(world, true)
  }

  it('заряд: держат гашетку — шар и шкала растут; на полном стоит, не перегреваясь', () => {
    const { world } = systemWhere(rockyWithStationAndMoon)
    arm(world, SHATTER_CANNON)
    hold(world, COSMIC.CHARGE_TIME / 2)
    const half = world.player.pulseCharge!
    expect(half.level).toBeGreaterThan(0.4)
    expect(half.level).toBeLessThan(0.6)
    expect(chargeBallRadius(world.player, world.time)).toBeGreaterThan(0)
    expect(world.pulses.length).toBe(0)
    // Держат и после полного: шар готов, решать пилоту — перегрева сам набор не даёт.
    hold(world, COSMIC.CHARGE_TIME * 2)
    expect(world.player.pulseCharge!.level).toBe(1)
    expect(world.player.laserHeat.heat).toBe(1)
    expect(laserOverheated(world.player, world.time)).toBe(false)
    expect(world.pulses.length).toBe(0)
  })

  it('отпустил на полном — шар летит, и лазеры уходят в перегрев', () => {
    const { world } = systemWhere(rockyWithStationAndMoon)
    arm(world, SHATTER_CANNON)
    hold(world, COSMIC.CHARGE_TIME + 0.1)
    tick(world, false)
    expect(world.pulses.length).toBe(1)
    expect(world.player.pulseCharge).toBeUndefined()
    expect(laserOverheated(world.player, world.time)).toBe(true)
    // Второго шара в отключке нет: гашетка даже набор не начинает.
    world.player.guns.forEach((g) => { g.cooldown = 0 })
    hold(world, 1)
    expect(world.player.pulseCharge).toBeUndefined()
    expect(world.pulses.length).toBe(1)
  })

  it('отпустил раньше — заряд отменён: шар схлопывается, выстрела нет', () => {
    const { world } = systemWhere(rockyWithStationAndMoon)
    arm(world, SHATTER_CANNON)
    hold(world, COSMIC.CHARGE_TIME * 0.8)
    tick(world, false)
    const charge = world.player.pulseCharge!
    expect(charge.cancelledAt).not.toBeNull()
    expect(world.pulses.length).toBe(0)
    expect(laserOverheated(world.player, world.time)).toBe(false)
    for (let i = 0; i < 120 * COSMIC.CHARGE_FIZZLE + 2; i++) tick(world, false)
    expect(world.player.pulseCharge).toBeUndefined()
    expect(world.pulses.length).toBe(0)
  })

  it('шар проходит сквозь станцию и корабли — бьёт планету за ними', () => {
    const { world } = systemWhere(rockyWithStationAndMoon)
    const station = world.bodies.find((b) => b.kind === 'station')!
    const planet = world.bodies.find((b) => b.id === station.orbit!.parentId)!
    // Сквозь центр станции на центр её планеты.
    const from = new Vector3().copy(station.pos).addScaledVector(station.pos.clone().sub(planet.pos).normalize(), 20_000)
    const dir = planet.pos.clone().sub(from).normalize()
    spawnPulse(world, world.player, from, dir, 1e9)
    for (let i = 0; i < 120 * 30 && world.pulses.length > 0; i++) stepPulses(world, 1 / 120)
    expect(world.bodies).toContain(station)
    expect(world.bodies).not.toContain(planet)
  })
})

describe('судьбы тел вне живого мира', () => {
  const planetIndex = (body: BodyEntity): number => Number(body.ref!.split(':')[1])
  /** Хозяйка ГЛАВНОГО причала (первая станция системы — к ней ведёт выход из прыжка). */
  const seatPlanet = (w: World): BodyEntity | undefined => {
    const station = w.bodies.find((b) => b.kind === 'station')
    const host = w.bodies.find((b) => b.id === station?.orbit?.parentId)
    return host?.kind === 'planet' && host.surface !== 'Газовый гигант' ? host : undefined
  }
  // Причал общей стартовой системы правится отдельно (`applySharedStartWorld`) и стоит
  // не у ближайшей к нему по описанию планеты — берём системы, где номер сходится.
  const withSeat = (w: World): boolean => {
    const host = seatPlanet(w)
    return host !== undefined && stationSeat(systemDefFor(w.systemIndex, GALAXY.SEED)) === planetIndex(host)
  }

  it('расчётная раскладка видит судьбы: причал разбитой планеты там же, где в живом мире', () => {
    // Раскладка считает точку выхода из прыжка. Без судеб она ставила причал туда, где
    // он кружил бы вокруг живой хозяйки, — выход из прыжка промахивался мимо станции.
    const { world, index } = systemWhere(withSeat)
    const planet = seatPlanet(world)!
    commitFate(world, planet, 'shatter')
    for (let i = 0; i < 600; i++) {
      world.calendarTime += 1
      stepOrbits(world)
    }
    const def = { ...systemDefFor(index, GALAXY.SEED), patrols: [] }
    const bodies = layoutSystemBodies(def, world.calendarTime, undefined, fateEdits(world.galaxyDelta, index))
    expect(bodies.some((b) => b.ref === planet.ref)).toBe(false)
    const live = world.bodies.find((b) => b.kind === 'station')!.pos.clone().add(world.originOffset)
    const laid = bodies.find((b) => b.kind === 'station')!.pos
    expect(laid.distanceTo(live)).toBeLessThan(1)
  })

  it('прыжок к причалу разбитой планеты выводит к самому причалу', () => {
    const { world, index } = systemWhere(withSeat)
    const planet = seatPlanet(world)!
    const def = { ...systemDefFor(index, GALAXY.SEED), patrols: [] }
    const seat = planetIndex(planet)
    expect(stationSeat(def)).toBe(seat)
    commitFate(world, planet, 'shatter')
    const at = arrivalPointAt(def, { kind: 'body', planet: seat }, world.calendarTime, fateEdits(world.galaxyDelta, index))
    expect(at).not.toBe(def.playerStart)
    const station = world.bodies.find((b) => b.kind === 'station')!
    const d = new Vector3(...at).sub(world.originOffset).distanceTo(station.pos)
    expect(d).toBeCloseTo(station.radius + ARRIVAL.STANDOFF, -1)
  })

  it('мир за порталом принимается с общим журналом: разбитое за кольцом тоже разбито', () => {
    // Портальный мир строился с пустым журналом и после перехода становился настоящим:
    // разбитая планета стояла целой, а правки бога терялись на переходе.
    const { world: source, index } = systemWhere(rockyWithStationAndMoon)
    const planet = hostPlanet(source)
    commitFate(source, planet, 'shatter')
    const other = systemWhere((w) => w.systemIndex !== index && w.bodies.some((b) => b.kind === 'planet'))
    const traveller = other.world
    traveller.galaxyDelta = source.galaxyDelta
    traveller.calendarTime = source.calendarTime

    const def = { ...systemDefFor(index, GALAXY.SEED), patrols: [] }
    const dest = createWorld({ ...def, belt: null })
    dest.calendarTime = traveller.calendarTime
    enterSystem(dest, def, index)
    expect(dest.bodies.some((b) => b.ref === planet.ref)).toBe(true)

    expect(commitPreparedJump(traveller, dest, index, { establishedPortal: true })).toBe(true)
    expect(dest.galaxyDelta).toBe(traveller.galaxyDelta)
    expect(dest.bodies.some((b) => b.ref === planet.ref)).toBe(false)
  })

  it('на карте разбитый мир не обитаем, а у двойной без главной звезды светит выжившая', () => {
    const galaxy = generateGalaxy(GALAXY.SEED)
    const settledAt = galaxy.findIndex((s) => s.planets.some(isSettled))
    const p = galaxy[settledAt]!.planets.findIndex(isSettled)
    const binaryAt = galaxy.findIndex((s) => s.companion !== null)
    const edits: FateEdit[] = [
      { op: 'fate', index: settledAt, ref: `planet:${p}`, fate: 'shatter', at: 0 },
      { op: 'fate', index: binaryAt, ref: 'star', fate: 'shatter', at: 0 },
    ]
    const after = applyDelta(galaxy, { edits })
    expect(isSettled(after[settledAt]!.planets[p]!)).toBe(false)
    expect(after[binaryAt]!.star).toEqual(galaxy[binaryAt]!.companion)
    expect(after[binaryAt]!.companion).toBeNull()
  })
})

describe('причал разбитой планеты', () => {
  it('у причала нет «планеты»: звезда, вокруг которой он теперь кружит, ему не хозяйка', () => {
    // Пойманный баг: стартовал у причала разбитой планеты — консоль открывала вкладку
    // ПЛАНЕТА, а показывала в ней звезду (родителя новой орбиты причала).
    const { world } = systemWhere(rockyWithStationAndMoon)
    const planet = hostPlanet(world)
    const station = world.bodies.find((s) => s.kind === 'station' && s.orbit?.parentId === planet.id)!
    expect(stationHost(world, station)).toBe(planet)
    commitFate(world, planet, 'shatter')
    expect(stationHost(world, station)).toBeNull()
    world.player.state.pos.copy(station.pos)
    world.docked = true
    expect(focusedPlanet(world)).toBeNull()
  })
})

describe('память о погибших телах', () => {
  it('диспетчер знает, что мир разбит, и что его причал кружил у этого мира', () => {
    // Пойманный баг: тело из мира вынуто — и диспетчер о нём не знал вовсе, разбитую
    // хозяйку собственного причала называл целой (или молчал о ней).
    const { world, index } = systemWhere(rockyWithStationAndMoon)
    const planet = hostPlanet(world)
    const station = world.bodies.find((s) => s.kind === 'station' && s.orbit?.parentId === planet.id)!
    commitFate(world, planet, 'shatter')
    world.player.state.pos.copy(station.pos)
    const brief = dispatcherBriefing(world)
    expect(brief.fallen.map((f) => f.name)).toContain(planet.name)
    expect(brief.fallen.find((f) => f.name === planet.name)!.remains).toBe('belt')
    expect(brief.lostHost).toBe(planet.name)
    expect(brief.bodies.some((b) => b.name === planet.name)).toBe(false)
    // Позже прилетевший помнит то же: память собирается из журнала при входе.
    const other = lateVisitor(world, index, 10_000)
    expect(other.fallen.map((f) => f.name)).toContain(planet.name)
  })
})

describe('судьбы у причала', () => {
  it('правка журнала, пришедшая в доке, сверяется сразу, а не после отчаливания', () => {
    // Пойманный баг: на старте игры журнал приходит из сети, пока пилот в доке, а док-такт
    // журнал не сверял — разбитая планета жила во вкладке и на карте до вылета.
    const { world, index } = systemWhere(rockyWithStationAndMoon)
    const planet = hostPlanet(world)
    world.docked = true
    pushEdit(world.galaxyDelta, { op: 'fate', index, ref: planet.ref!, fate: 'shatter', at: world.calendarTime - 10_000 })
    stepWorld(world, 1 / 30, new Map())
    expect(world.bodies).not.toContain(planet)
  })
})

describe('шар на ходу', () => {
  it('наследует скорость стрелка: на ходу не отстаёт, а уходит вперёд', () => {
    // Пойманный баг: старт шара медленный (40 м/с), и корабль на крейсерской боевой
    // скорости обгонял собственный выстрел.
    const { world } = systemWhere(rockyWithStationAndMoon)
    const ship = world.player
    const dir = new Vector3(0, 0, -1)
    ship.state.vel.copy(dir).multiplyScalar(500)
    const shipAt = ship.state.pos.clone()
    spawnPulse(world, ship, ship.state.pos, dir, 1e6)
    const pulse = world.pulses[0]!
    for (let i = 0; i < 120; i++) stepPulses(world, 1 / 120)
    shipAt.addScaledVector(ship.state.vel, 1)
    // Впереди корабля, который за ту же секунду прошёл свои 500 м.
    expect(pulse.pos.clone().sub(shipAt).dot(dir)).toBeGreaterThan(0)
  })
})


describe('импульс жизни', () => {
  /** Выпустить импульс жизни игрока в тело `body` с пяти километров и дать ему долететь. */
  function seedAt(world: World, body: BodyEntity): void {
    const dir = body.pos.clone().sub(world.player.state.pos).normalize()
    const from = body.pos.clone().addScaledVector(dir, -(body.radius + 5_000))
    spawnPulse(world, world.player, from, dir, 1e9, undefined, 'seed')
    for (let i = 0; i < 120 * 30 && world.pulses.length > 0; i++) {
      world.time += 1 / 120
      stepPulses(world, 1 / 120)
    }
  }

  it('одно попадание в необитаемую твердь — жизнь, вспышка и весть', () => {
    const { world } = systemWhere((w) => w.bodies.some((b) => b.kind === 'planet' && !b.settlement && b.surface === 'Скалистая'))
    const rock = world.bodies.find((b) => b.kind === 'planet' && !b.settlement && b.surface === 'Скалистая')!
    seedAt(world, rock)
    expect(rock.settlement?.species).toBe(FAUNA_SPECIES)
    expect(world.cataclysms.at(-1)?.kind).toBe('seed')
    expect(world.notices.at(-1)).toMatchObject({ kind: 'life', name: rock.name })
  })

  it('в газовый гигант и на луну импульс гаснет: жизни там не бывать', () => {
    const { world } = systemWhere((w) => w.bodies.some((b) => b.surface === 'Газовый гигант') && w.bodies.some((b) => b.kind === 'moon'))
    const giant = world.bodies.find((b) => b.surface === 'Газовый гигант')!
    const moon = world.bodies.find((b) => b.kind === 'moon')!
    seedAt(world, giant)
    seedAt(world, moon)
    expect(world.galaxyEditsOut.some(({ edit }) => edit.op === 'fate')).toBe(false)
    expect(giant.settlement).toBeNull()
    expect(moon.settlement).toBeNull()
  })

  it('заряд импульса жизни копит точку, а не шар; выстрел — по отпусканию', () => {
    const { world } = systemWhere(rockyWithStationAndMoon)
    const p = world.player
    p.loadout = { ...p.loadout, weapons: p.loadout.weapons.map((w) => (w && w.kind === 'laser' ? SEED_PULSE : w)) }
    refreshSpec(p)
    p.laserHeat.heat = 0
    p.laserHeat.overheatUntil = 0
    for (let i = 0; i < 120 * (COSMIC.CHARGE_TIME + 0.2); i++) {
      world.time += 1 / 120
      unholdPulseCharges([p])
      coolGuns(p, world.time, 1 / 120)
      fireLasers(world, p, false, 1 / 120)
      settlePulseCharges(world, [p])
    }
    expect(p.pulseCharge?.kind).toBe('seed')
    // Точка мельче шара разбивающего на том же заряде.
    expect(chargeBallRadius(p, world.time)).toBeLessThan(p.spec.hull.radius * COSMIC.CHARGE_BALL)
    world.time += 1 / 120
    unholdPulseCharges([p])
    settlePulseCharges(world, [p])
    expect(world.pulses.at(-1)?.kind).toBe('seed')
    expect(laserOverheated(p, world.time)).toBe(true)
  })
})

describe('промах импульса', () => {
  it('впереди пусто — импульс тает через пару секунд, а не висит до конца дальности', () => {
    // Пойманный баг: промахнувшийся летел десяток секунд до предела дальности и, уходя
    // прямо от камеры, висел на экране неподвижной точкой.
    const { world } = systemWhere(rockyWithStationAndMoon)
    // Прочь от звезды и вверх — туда, где на пути нет ни одного тела.
    const dir = new Vector3(0, 1, 0)
    spawnPulse(world, world.player, world.player.state.pos.clone().add(new Vector3(0, 1e7, 0)), dir, 2e12, undefined, 'seed')
    let alive = 0
    for (let i = 0; i < 120 * 10 && world.pulses.length > 0; i++) {
      world.time += 1 / 120
      stepPulses(world, 1 / 120)
      alive = i / 120
    }
    expect(world.pulses.length).toBe(0)
    expect(alive).toBeLessThanOrEqual(COSMIC.PULSE_MISS_LIFE + 0.1)
  })
})
