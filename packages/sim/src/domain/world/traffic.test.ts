import { describe, expect, it } from 'vitest'
import { TRAFFIC } from '../../config/world'
import { ARRIVAL } from '../../config/galaxy'
import { isHostileTo } from '../ai/targeting'
import { makeRng } from '../../core/math'
import { rememberPilot } from './acquaintance'
import { emptyPlan } from './contactPlan'
import { createWorld, STARTER_SYSTEM } from './index'
import type { ShipEntity, World } from './entities'
import { ENCOUNTERS, biasedWeight, remoteness, spawnResidentContacts, stepDockedBerth, stepDockTraffic, stepTraffic } from './traffic'

/**
 * Встречи. Космос без них — тир, а не место, где живут; но и встреча по
 * расписанию перестаёт быть встречей.
 */

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

/** Без станции: она рожает мирных у причала, и дистанция появления не проверяется. */
function deepSpace(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null, station: null })
}

const met = (world: World): ShipEntity[] => world.ships

/** Прогоняет `seconds` секунд трафика кадрами по 1/60, не двигая мир. */
function run(world: World, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) stepTraffic(world, dt)
}

/**
 * Гоняет трафик, пока не родится хоть один КОРАБЛЬ. Нужен затем, что встречей
 * иногда оказывается кит (см. TITAN): он приходит в свой список, а не в `ships`,
 * и тест про корабли не должен спотыкаться о попавшийся первым город.
 */
function runUntilShip(world: World, cap = 400): ShipEntity {
  for (let t = 0; t < cap && met(world).length === 0; t += TRAFFIC.INTERVAL) run(world, TRAFFIC.INTERVAL)
  const ship = met(world)[0]
  if (!ship) throw new Error('за отведённое время не родился ни один корабль')
  return ship
}

describe('встречи в космосе', () => {
  it('до первой задержки не приходит никто', () => {
    // Без станции: её «завсегдатаи» появляются сразу и вне первой задержки — это
    // отдельная жизнь причала. Первая ЗАДЕРЖКА стережёт рядовые встречи, их и меряем.
    const world = deepSpace()
    run(world, TRAFFIC.FIRST_DELAY - 1)
    expect(met(world)).toHaveLength(0)
  })

  /**
   * Темп задан ПЕРЕЗАРЯДОМ В СЕКУНДАХ, а не броском кости в шаге. Иначе на 120 Гц
   * кораблей рождалось бы вдвое больше, чем на 60, и трафик зависел бы от частоты
   * кадров — как когда-то зависела вся вероятностная механика.
   *
   * Проверяется НИЖЕ потолка: упёршись в MAX, оба мира сравнялись бы сами,
   * и восьмикратная разница в частоте осталась бы незамеченной.
   */
  it('число встреченных не зависит от частоты кадров', () => {
    const slow = quiet()
    const fast = quiet()

    const seconds = TRAFFIC.FIRST_DELAY + TRAFFIC.INTERVAL * 1.5
    run(slow, seconds, 1 / 30)
    run(fast, seconds, 1 / 240)

    expect(met(slow).length).toBe(met(fast).length)
  })

  it('больше положенного в системе не летает', () => {
    const world = quiet()
    run(world, TRAFFIC.INTERVAL * (TRAFFIC.MAX + 10))
    // Потолок считает ВСТРЕЧЕННЫХ, а прикрытие исключено намеренно (`escortOf`):
    // звено не бросают на полпути ради лимита. Поэтому инвариант — на не-эскортных
    // бортах, ровно как его стережёт `trafficCount`, а не на всех подряд. Экипаж
    // платформы-гнезда тоже исключаем: гнездо — событие, оно спавнится ПОМИМО потолка
    // трафика (как и эскорт), и его дремлющие пираты — не рядовая встреча.
    const counted = met(world).filter((s) => s.alive && s.ai?.escortOf == null && !s.ai?.dormant)
    expect(counted.length).toBeLessThanOrEqual(TRAFFIC.MAX)
  })

  /**
   * Пустой космос — тоже событие. Если бы каждая попытка приводила корабль,
   * встречи шли бы по метроному и перестали что-либо значить.
   */
  it('не всякая попытка кончается встречей', () => {
    // Без станции: жизнь причала подсевала бы завсегдатая на каждой очищенной итерации
    // и «встреча» случалась бы всегда. Пустоту космоса стережёт именно ветка встреч.
    const world = deepSpace()
    let attempts = 0
    let arrivals = 0

    for (let i = 0; i < 40; i++) {
      // Дотягиваем таймер до нуля мгновенно и считаем, чем кончилась попытка.
      world.trafficTimer = 0
      const born = stepTraffic(world, 1 / 60)
      attempts++
      if (born.length > 0) arrivals++
      // Освобождаем место: потолок не должен подменять собой вероятность.
      world.ships = []
    }

    expect(arrivals).toBeGreaterThan(0)
    expect(arrivals).toBeLessThan(attempts)
  })

  /** Не всегда пираты. За долгий прогон приходят и мирные, и враждебные. */
  it('встречаются и мирные, и враждебные', () => {
    const world = deepSpace()
    // Встаём у ДАЛЬНЕЙ необитаемой планеты: тут людно (маршруты у планеты есть), но
    // закон не достаёт — смещение по удалённости даёт и мирных, и пиратов вперемешку.
    // У станции пираты теперь почти не родятся, и там этот инвариант проверять нельзя.
    const planets = world.bodies.filter((b) => b.kind === 'planet')
    const lonely = planets.reduce((a, b) => (a.pos.length() > b.pos.length() ? a : b))
    world.player.state.pos.copy(lonely.pos).setX(lonely.pos.x + lonely.radius + 60_000)

    const factions = new Set<string>()
    for (let i = 0; i < 300; i++) {
      world.trafficTimer = 0
      for (const ship of stepTraffic(world, 1 / 60)) factions.add(ship.faction)
      world.ships = []
    }

    expect(factions.has('neutral')).toBe(true)
    expect(factions.has('hostile')).toBe(true)
  })

  /** Иногда приходят пачкой: стая пиратов и караван — это одна встреча, а не три. */
  it('встреча бывает групповой', () => {
    const world = quiet()
    let biggest = 0

    for (let i = 0; i < 200; i++) {
      world.trafficTimer = 0
      biggest = Math.max(biggest, stepTraffic(world, 1 / 60).length)
      world.ships = []
    }

    expect(biggest).toBeGreaterThan(1)
  })

  /**
   * Дистанция появления. Ближе — корабль возникает из ничего на глазах; дальше —
   * он не попадает даже на локатор, и встречи не выходит.
   */
  it('приходят с дистанции, на которой их уже видно локатором', () => {
    const world = deepSpace()

    for (let i = 0; i < 40; i++) {
      world.trafficTimer = 0
      for (const ship of stepTraffic(world, 1 / 60)) {
        const portal = world.warpPortals.find((p) => p.shipId === ship.id)
        const pos = portal?.pos ?? ship.state.pos
        const distance = pos.distanceTo(world.player.state.pos)
        // Группа расходится на GROUP_SPREAD от общего центра.
        expect(distance).toBeGreaterThan(TRAFFIC.SPAWN_MIN - TRAFFIC.GROUP_SPREAD)
        expect(distance).toBeLessThan(TRAFFIC.SPAWN_MAX + TRAFFIC.GROUP_SPREAD + 4000)
      }
      world.ships = []
    }
  })

  /**
   * Маршруты сходятся у планет: там причал, там рынок, там и пират, который этим
   * кормится. Проверяется ОТНОШЕНИЕ, а не число: `QUIET_RANGE` и `CHANCE` будут
   * крутить, и тест не должен падать от каждой правки баланса.
   *
   * В пустоте встречи не запрещены — они редки. Ноль здесь был бы враньём:
   * одинокий скиталец между мирами возможен.
   */
  it('вдали от миров встречи реже', () => {
    const born = (world: World): number => {
      let count = 0
      for (let i = 0; i < 400; i++) {
        world.trafficTimer = 0
        count += stepTraffic(world, 1 / 60).length
        world.ships = [] // потолок одновременных не должен мешать счёту
      }
      return count
    }

    const near = born(quiet())

    const far = quiet()
    // Далеко от всего: и от планет, и от причала. Звезда не в счёт — у неё не живут.
    far.player.state.pos.set(0, 3e9, 0)
    const void_ = born(far)

    expect(near).toBeGreaterThan(0)
    expect(void_).toBeLessThan(near / 4)
  })

  /**
   * Улетевший за горизонт убирается — ЛЮБОЙ фракции. Пират, потерявший игрока,
   * не вернётся никогда: он просто копился бы в списке.
   */
  it('ушедший далеко исчезает, кем бы он ни был', () => {
    // Без станции: иначе жизнь причала тут же родила бы нового завсегдатая на место
    // ушедшего, и «исчез» не проверить. Уборку по дистанции меряем на рядовой встрече.
    const world = deepSpace()
    runUntilShip(world)

    for (const s of met(world)) s.state.pos.copy(world.player.state.pos).setX(TRAFFIC.DESPAWN_RANGE + 100)
    stepTraffic(world, 1 / 60)
    expect(met(world)).toHaveLength(0)
  })

  /**
   * Захваченная цель не растворяется в рамке прицела: пилот на неё смотрит,
   * и исчезновение читается как поломка, а не как уход за пределы радара.
   */
  it('захваченный не исчезает, даже улетев далеко', () => {
    const world = quiet()
    const ship = runUntilShip(world)

    world.lockedTargetId = ship.id
    ship.state.pos.copy(world.player.state.pos).setX(TRAFFIC.DESPAWN_RANGE * 3)
    stepTraffic(world, 1 / 60)
    expect(met(world).some((s) => s.id === ship.id)).toBe(true)
  })

  /** Нейтрал не воюет и не является добычей — это свойство фракции, а не трафика. */
  it('торговец не враждебен никому и никому не враг', () => {
    expect(isHostileTo('neutral', 'hostile')).toBe(false)
    expect(isHostileTo('hostile', 'neutral')).toBe(false)
    expect(isHostileTo('neutral', 'player')).toBe(false)
  })

  it('корабль рождается с пилотом и с курсом на своё назначение', () => {
    const world = quiet()
    const ship = runUntilShip(world)

    expect(ship.ai).not.toBeNull()
    expect(ship.warpEmerging || ship.controls.throttle > 0).toBe(true)
    // Дом — это НАЗНАЧЕНИЕ, а не место рождения: иначе он закружит там, где возник.
    expect(ship.ai!.home.distanceTo(ship.state.pos)).toBeGreaterThan(1000)
  })

  /** Одно зерно — один трафик. Иначе ни сохранений, ни сети. */
  it('трафик детерминирован', () => {
    const a = quiet()
    const b = quiet()
    run(a, TRAFFIC.INTERVAL * 3)
    run(b, TRAFFIC.INTERVAL * 3)

    expect(met(a).map((s) => s.state.pos.toArray())).toEqual(met(b).map((s) => s.state.pos.toArray()))
  })

  /**
   * Станция не пустует: пока игрок рядом, у причала держится пара заходящих на
   * стыковку НЕЙТРАЛОВ — жизнь, а не пираты. И это настоящие корабли в цикле
   * стыковки, а не декорация: у них есть пилот и фаза захода.
   */
  it('у причала постоянно держатся завсегдатаи-нейтралы', () => {
    const world = quiet() // игрок в 2 км от станции
    run(world, 5) // ещё до первой встречи (FIRST_DELAY): это отдельная жизнь причала

    const regulars = met(world).filter((s) => s.ai?.dock === 'inbound' || s.ai?.dock === 'berthed')
    expect(regulars.length).toBe(TRAFFIC.STATION_REGULARS)
    expect(regulars.every((s) => s.faction === 'neutral')).toBe(true)
    expect(regulars.every((s) => s.ai !== null)).toBe(true)
    for (const s of regulars.filter((x) => x.ai?.dock === 'inbound')) {
      const portal = world.warpPortals.find((p) => p.shipId === s.id)
      const pos = portal?.pos ?? s.state.pos
      const dist = pos.distanceTo(world.player.state.pos)
      expect(dist).toBeGreaterThanOrEqual(TRAFFIC.SPAWN_MIN * 0.95)
      expect(dist).toBeLessThanOrEqual(TRAFFIC.SPAWN_MAX * 1.5)
    }
  })

  /** Вдали от станции причал не оживляют: незачем плодить то, чего игрок не видит. */
  it('вдали от станции завсегдатаев не подсевают', () => {
    const world = quiet()
    const station = world.bodies.find((b) => b.kind === 'station')!
    world.player.state.pos.copy(station.pos).setX(station.pos.x + TRAFFIC.STATION_LIFE_RANGE + 5000)

    run(world, 5)
    expect(met(world).filter((s) => s.ai?.dock != null)).toHaveLength(0)
  })

  /**
   * Чем дальше от жилья, тем больше пиратов. Проверяем СВОЙСТВО смещения, а не долю:
   * веса будут крутить, но у станции обязан править торговец, а в пустоте — пират.
   */
  it('доля пиратов растёт с удалением от обитаемого мира', () => {
    const pirate = ENCOUNTERS.find((k) => k.id === 'pirate')!
    const trader = ENCOUNTERS.find((k) => k.id === 'trader')!

    // Пирату дальше — тяжелее вес, торговцу — легче.
    expect(biasedWeight(pirate, 1)).toBeGreaterThan(biasedWeight(pirate, 0))
    expect(biasedWeight(trader, 1)).toBeLessThan(biasedWeight(trader, 0))
    // У самого жилья торговец кратно вероятнее пирата; в пустоте перевес к пирату.
    expect(biasedWeight(trader, 0)).toBeGreaterThan(biasedWeight(pirate, 0) * 3)
    expect(biasedWeight(pirate, 1)).toBeGreaterThan(biasedWeight(trader, 1))
  })

  /** Удалённость 0..1 растёт по мере ухода от обитаемого мира и у причала близка к нулю. */
  it('удалённость растёт с уходом от жилья', () => {
    const world = quiet()
    const station = world.bodies.find((b) => b.kind === 'station')!

    world.player.state.pos.copy(station.pos).setX(station.pos.x + 1000)
    const near = remoteness(world)
    world.player.state.pos.copy(station.pos).setX(station.pos.x + 500_000)
    const far = remoteness(world)

    expect(near).toBeLessThan(0.1)
    expect(far).toBeGreaterThan(near)
    expect(far).toBeGreaterThan(0.5)
  })

  /**
   * В глуши изредка встречаешь ЧУЖОЙ бой: пираты и их жертва рождаются разом. Только
   * такая встреча смешивает враждебных с не-враждебными в одной группе — по этому и
   * узнаём её. Помощь пиратам игрока не обеляет: это отдельная механика фракций.
   */
  it('в глуши можно наткнуться на чужой бой — обе стороны разом', () => {
    const world = deepSpace()
    const planets = world.bodies.filter((b) => b.kind === 'planet')
    const lonely = planets.reduce((a, b) => (a.pos.length() > b.pos.length() ? a : b))
    world.player.state.pos.copy(lonely.pos).setX(lonely.pos.x + lonely.radius + 60_000)

    let sawBattle = false
    for (let i = 0; i < 800 && !sawBattle; i++) {
      world.trafficTimer = 0
      const factions = new Set(stepTraffic(world, 1 / 60).map((s) => s.faction))
      if (factions.has('hostile') && (factions.has('neutral') || factions.has('police'))) sawBattle = true
      world.ships = []
    }
    expect(sawBattle).toBe(true)
  })
})

/**
 * Жизнь причала, пока игрок пристыкован и мир стоит. Обычный трафик заморожен, но
 * плашки у причала не должны застыть: раз в несколько секунд кто-то отходит, кто-то
 * швартуется. Меряем поведение, а не числа: причал наполняется, но не сверх нормы, и
 * отстоявшийся уходит.
 */
describe('жизнь причала в доке', () => {
  const inboundCount = (world: World): number =>
    world.ships.filter((s) => s.alive && s.ai?.dock === 'inbound' && s.faction === 'neutral').length

  const berthedCount = (world: World): number =>
    world.ships.filter((s) => s.alive && s.ai?.dock === 'berthed' && s.faction === 'neutral').length

  it('в доке на подлёте появляются заходящие с кромки радара, без мгновенного berthed', () => {
    const world = quiet()
    let maxInbound = 0
    for (let t = 0; t < 600; t += 2) {
      stepDockTraffic(world, 2)
      maxInbound = Math.max(maxInbound, inboundCount(world))
      expect(berthedCount(world)).toBeLessThanOrEqual(TRAFFIC.STATION_REGULARS)
    }
    expect(maxInbound).toBeGreaterThan(0)
    const inbound = world.ships.find((s) => s.ai?.dock === 'inbound')
    expect(inbound).toBeTruthy()
    const dist = inbound!.state.pos.distanceTo(world.player.state.pos)
    expect(dist).toBeGreaterThanOrEqual(TRAFFIC.SPAWN_MIN * 0.95)
    expect(dist).toBeLessThanOrEqual(TRAFFIC.SPAWN_MAX * 1.05)
  })

  it('отстоявшийся у причала отходит сам (dock=done)', () => {
    const world = quiet()
    for (let t = 0; t < 120 && inboundCount(world) === 0; t += 2) stepDockTraffic(world, 2)
    const guest = world.ships.find((s) => s.ai?.dock === 'inbound')
    expect(guest).toBeTruthy()
    guest!.ai!.dock = 'berthed'
    guest!.ai!.dockTimer = 2
    for (let t = 0; t < 10; t += 2) stepDockedBerth(world, 2)
    expect(guest!.ai!.dock).toBe('done')
  })

  it('inbound в доке не швартуется без полёта — тот же борт ждёт на подлёте', () => {
    const world = quiet()
    for (let t = 0; t < 120 && inboundCount(world) === 0; t += 2) stepDockTraffic(world, 2)
    const inbound = world.ships.find((s) => s.ai?.dock === 'inbound')
    expect(inbound).toBeTruthy()
    const id = inbound!.id
    for (let t = 0; t < 600; t += 2) stepDockTraffic(world, 2)
    expect(world.ships.find((s) => s.id === id)?.ai?.dock).toBe('inbound')
  })

  it('без станции причал не выдумывается', () => {
    const world = deepSpace()
    for (let t = 0; t < 200; t += 2) expect(stepDockedBerth(world, 2)).toBe(false)
    expect(berthedCount(world)).toBe(0)
  })
})

describe('знакомые при входе в систему', () => {
  function makeResidentWorld(seed: number): World {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    world.rng = makeRng(seed)
    world.acquaintances.push({
      id: 1,
      name: 'Векс',
      persona: world.player.persona,
      faction: 'neutral',
      chassisId: world.player.loadout.chassis.id,
      kindId: 'trader',
      systemIndex: world.systemIndex,
      boundFor: null,
      roaming: true,
      meetings: 1,
      relationship: 'neutral',
      history: [{ kind: 'met', at: 0 }],
      alive: true,
      credits: 20_000,
      savedLoadout: null,
      plan: emptyPlan(),
    })
    return world
  }

  it('выходят из гиперпрыжка у причала или подлетают с кромки радара', () => {
    let sawHyper = false
    let sawCruise = false
    for (let seed = 0; seed < 80 && (!sawHyper || !sawCruise); seed++) {
      const world = makeResidentWorld(seed)
      const born = spawnResidentContacts(world)
      expect(born).toHaveLength(1)
      const station = world.bodies.find((b) => b.kind === 'station')!
      const portal = world.warpPortals[0]
      expect(portal).toBeTruthy()
      const fromStation = portal!.pos.distanceTo(station.pos)
      const fromPlayer = portal!.pos.distanceTo(world.player.state.pos)
      const hyperDist = station.radius + ARRIVAL.STANDOFF
      if (fromStation >= hyperDist * 0.95 && fromStation <= hyperDist + ARRIVAL.SPREAD_MAX * 1.05) {
        sawHyper = true
      }
      if (fromPlayer >= TRAFFIC.SPAWN_MIN * 0.95 && fromPlayer <= TRAFFIC.SPAWN_MAX * 1.05) {
        sawCruise = true
      }
    }
    expect(sawHyper).toBe(true)
    expect(sawCruise).toBe(true)
  })

  it('без станции знакомый заходит только с кромки радара', () => {
    const world = deepSpace()
    world.ships.push(
      createWorld({
        ...STARTER_SYSTEM,
        belt: null,
        station: null,
        patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'X' }],
      }).ships[0]!,
    )
    rememberPilot(world, world.ships[0]!)
    world.ships = []
    const born = spawnResidentContacts(world)
    expect(born).toHaveLength(1)
    const portal = world.warpPortals[0]!
    const dist = portal.pos.distanceTo(world.player.state.pos)
    expect(dist).toBeGreaterThanOrEqual(TRAFFIC.SPAWN_MIN * 0.95)
    // pickFreeSpawn может чуть раздвинуть кольцо — главное, не у носа игрока.
    expect(dist).toBeLessThan(TRAFFIC.DESPAWN_RANGE * 0.5)
    expect(born[0]!.warpEmerging).toBe(true)
    expect(world.warpPortals).toHaveLength(1)
    expect(world.warpPortals[0]!.shipId).toBe(born[0]!.id)
  })
})
