import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { AI } from '../../config/ai'
import { chanceWithin } from '../../core/math'
import { addCommodity } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { stepWorld } from '../sim'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { BodyEntity, MissileEntity, ShipEntity } from '../world/entities'
import type { Persona } from '../world/persona'
import { decideEcm } from './dogfight'
import { avoidBodies } from './maneuvers'
import { occluded } from './perception'
import { aiController } from './pilot'
import { yieldChance } from './robbery'
import { selectTarget } from './targeting'
import { assignVoyage, enqueueTask } from './tasks'

/**
 * Мозг бота: чувства, арбитр, характер, грабёж. Проверяются СВОЙСТВА (видит ли сквозь
 * планету, решает ли о ракете однажды, бросает ли храбрый поручение под огнём), а не числа.
 */

type Side = { faction: ShipEntity['faction']; at: [number, number, number] }

/**
 * Мир без трафика: только заданные борта, поставленные относительно игрока. Игрока уводим
 * далеко — он враг пирату, и без этого пират шёл бы на него, а не к жертве.
 */
function quietWorld(sides: Side[], playerAway = true): World {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: sides.map((s) => ({ count: 1, at: [0, 0, 0] as [number, number, number], spread: 0, faction: s.faction, name: s.faction })),
  })
  world.desolate = true
  world.docked = false
  // Подальше от станции (игрок стартует у причала): иначе её сфера мешает любому сценарию.
  const station = world.bodies.find((b) => b.kind === 'station')!
  const origin = world.player.state.pos.clone().sub(station.pos).normalize().multiplyScalar(20_000).add(world.player.state.pos)
  sides.forEach((s, i) => {
    world.ships[i]!.state.pos.copy(origin).add(new Vector3(...s.at))
    world.ships[i]!.ai!.home.copy(world.ships[i]!.state.pos)
  })
  if (playerAway) world.player.state.pos.add(new Vector3(0, 60_000, 0))
  return world
}

function run(world: World, seconds: number, until?: () => boolean): void {
  const controllers = new Map()
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld(world, 1 / 60, controllers, { unassigned: aiController })
    if (until?.()) return
  }
}

function withPersona(ship: ShipEntity, over: Partial<Persona>): void {
  ship.persona = { ...ship.persona, ...over }
}

describe('темп в секундах', () => {
  it('шанс за промежуток складывается: два полутакта — то же, что один такт', () => {
    // Пилот, думающий вдвое чаще, бросает кость вдвое чаще, но с меньшим шансом — итог тот же.
    const half = chanceWithin(2.7, 0.08)
    const whole = chanceWithin(2.7, 0.16)
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(whole, 10)
  })
})

describe('чувства', () => {
  it('тело между бортами загораживает обзор, тело в стороне — нет', () => {
    const body = { pos: new Vector3(0, 0, -1000), radius: 300 } as BodyEntity
    expect(occluded(new Vector3(), new Vector3(0, 0, -2000), [body])).toBe(true)
    expect(occluded(new Vector3(), new Vector3(2000, 0, -2000), [body])).toBe(false)
  })

  it('врага за планетой не видит, но стрелявшего — знает', () => {
    // Регрессия: выбор цели читал всех в радиусе сквозь планету.
    const world = quietWorld([
      { faction: 'police', at: [0, 0, 0] },
      { faction: 'hostile', at: [0, 0, -2000] },
    ])
    const [police, pirate] = world.ships as [ShipEntity, ShipEntity]
    expect(selectTarget(police, world)?.id).toBe(pirate.id)

    const middle = police.state.pos.clone().lerp(pirate.state.pos, 0.5)
    world.bodies.push({ pos: middle, radius: 300 } as BodyEntity)
    expect(selectTarget(police, world)).toBeNull()

    // Пират выстрелил из-за планеты — пилот знает, откуда.
    police.lastAttackerId = pirate.id
    police.lastHitAt = world.time
    expect(selectTarget(police, world)?.id).toBe(pirate.id)
  })
})

describe('облёт тел в настоящем масштабе', () => {
  it('у станции на низкой орбите планета не уводит руль прочь', () => {
    // Регрессия: запас в 15% радиуса планеты (955 км) глотал орбиту станции (высота 500 км),
    // и любой бот у причала правил в обход планеты — за восемь тысяч километров.
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const station = world.bodies.find((b) => b.kind === 'station')!
    const from = station.pos.clone().add(new Vector3(3000, 0, 0))
    const aim = station.pos.clone().add(new Vector3(-3000, 0, 0))
    const out = avoidBodies(from, aim, world.bodies.filter((b) => b.kind !== 'station'), new Vector3())
    expect(out.distanceTo(aim)).toBeLessThan(1)
  })
})

describe('ПРО', () => {
  it('о ракете решает ОДИН раз, сколько бы тактов она ни подлетала', () => {
    // Регрессия: кость за такт копила шанс со временем подлёта, и итог зависел от выучки.
    const world = quietWorld([{ faction: 'police', at: [0, 0, 0] }])
    const ship = world.ships[0]!
    world.missiles.push({
      id: 999,
      alive: true,
      ownerId: -5,
      pos: ship.state.pos.clone().add(new Vector3(0, 0, -AI.ECM_RANGE / 2)),
    } as unknown as MissileEntity)
    let rolls = 0
    world.rng = () => {
      rolls++
      return 0.99 // никогда не «собью» — пусть решает снова, если решение не окончательно
    }
    for (let i = 0; i < 30; i++) decideEcm(ship, ship.ai!, world)
    expect(rolls).toBe(1)
  })
})

describe('арбитр и характер', () => {
  /** Борт с поручением, по которому только что стрелял пират. */
  function shotWhileOnErrand(persona: Partial<Persona>): ShipEntity {
    const world = quietWorld([
      { faction: 'police', at: [0, 0, 0] },
      { faction: 'hostile', at: [0, 0, -1500] },
    ])
    const [cop, pirate] = world.ships as [ShipEntity, ShipEntity]
    withPersona(cop, persona)
    enqueueTask(cop, { kind: 'goto', point: cop.state.pos.clone().add(new Vector3(20_000, 0, 0)), arriveRadius: 300 })
    cop.lastAttackerId = pirate.id
    cop.lastHitAt = world.time
    cop.ai!.thinkTimer = 0
    aiController.update(cop, world, 1 / 60)
    return cop
  }

  it('храбрый под огнём бросает поручение и дерётся, трус — продолжает путь', () => {
    const brave = shotWhileOnErrand({ disposition: 'brave', temperament: 5 })
    const coward = shotWhileOnErrand({ disposition: 'cowardly', temperament: 1 })
    expect(brave.ai!.behavior).toBe('combat')
    expect(coward.ai!.behavior).toBe('tasks')
  })

  it('приказ «стой» важнее боя', () => {
    const world = quietWorld([
      { faction: 'police', at: [0, 0, 0] },
      { faction: 'hostile', at: [0, 0, -1500] },
    ])
    const cop = world.ships[0]!
    cop.ai!.command = 'hold'
    cop.ai!.thinkTimer = 0
    aiController.update(cop, world, 1 / 60)
    expect(cop.ai!.behavior).toBe('hold')
    expect(cop.ai!.wantsFire).toBe(false)
  })

  it('ракету бот пускает в СВОЮ цель, а не в игрока', () => {
    // Регрессия: шаг мира целил любую ракету бота в игрока.
    const world = quietWorld([
      { faction: 'police', at: [0, 0, 0] },
      { faction: 'hostile', at: [0, 0, -1200] },
    ])
    const [cop, pirate] = world.ships as [ShipEntity, ShipEntity]
    run(world, 1)
    expect(aiController.missileTarget!(pirate, world)).toBe(cop.id)
  })
})

describe('свой промысел', () => {
  it('торговец долетает до точки рейса и уходит прыжком', () => {
    const world = quietWorld([{ faction: 'neutral', at: [0, 0, 0] }])
    const trader = world.ships[0]!
    assignVoyage(trader, trader.state.pos.clone().add(new Vector3(0, 0, -1500)))
    run(world, 90, () => trader.warpDeparting || !world.ships.includes(trader))
    expect(trader.warpDeparting || !world.ships.includes(trader)).toBe(true)
  })
})

describe('грабёж', () => {
  it('трус уступает охотнее храбреца', () => {
    const world = quietWorld([
      { faction: 'neutral', at: [0, 0, 0] },
      { faction: 'hostile', at: [0, 0, -1000] },
    ])
    const [trader, pirate] = world.ships as [ShipEntity, ShipEntity]
    withPersona(trader, { disposition: 'cowardly', willpower: 1 })
    const timid = yieldChance(trader, pirate)
    withPersona(trader, { disposition: 'brave', willpower: 5 })
    expect(yieldChance(trader, pirate)).toBeLessThan(timid)
  })

  it('пират требует груз у мирного, и дело кончается сбросом или боем — не хороводом', () => {
    // Регрессия: пираты нейтралов не трогали вовсе, «чужой бой» с торговцем был пиратами,
    // мирно кружащими рядом.
    const world = quietWorld([
      { faction: 'neutral', at: [0, 0, 0] },
      { faction: 'hostile', at: [0, 0, -2500] },
    ])
    const [trader, pirate] = world.ships as [ShipEntity, ShipEntity]
    addCommodity(trader.hold, COMMODITIES.METALS, 5)
    const settled = (): boolean => trader.hold.items.length === 0 || pirate.ai!.foes.includes(trader.id)
    run(world, 60, settled)
    expect(world.notices.some((n) => n.kind === 'demand')).toBe(true)
    expect(settled()).toBe(true)
  })
})
