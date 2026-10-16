import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CALENDAR_DAY, CONTRACTS } from '../../config/contracts'
import { declareFoe } from '../ai/targeting'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { acceptBlock, acceptOffer, declineOffer, offerHail, stepContracts } from './contracts'
import { aiController } from '../ai/pilot'
import { stepWorld } from '../sim'
import { NULL_CONTROLLER } from '../sim/controller'
import { rollOffer } from './offers'
import { roundMoney } from '../../core/math'
import type { ContractOffer } from './types'

/**
 * Дела. Свойства, а не числа: доставка закрывается на станции назначения, «привези» платит
 * за сданное, премия — только за своего пирата, провал роняет отношение на ступень.
 */

function worldWith(...factions: ShipEntity['faction'][]): World {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: factions.map((f) => ({ count: 1, at: [0, 0, 0] as [number, number, number], spread: 0, faction: f, name: f })),
  })
  world.desolate = true
  world.docked = false
  world.calendarTime = 1_000_000
  for (const s of world.ships) s.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -1500))
  return world
}

function giveOffer(ship: ShipEntity, offer: ContractOffer): void {
  ship.offer = offer
}

const relationOf = (world: World, ship: ShipEntity) => world.acquaintances.find((a) => a.id === ship.acquaintanceId)!.relationship

function dockAt(world: World, systemIndex: number): void {
  world.systemIndex = systemIndex
  world.docked = true
  stepContracts(world, 1 / 60)
  world.docked = false
  stepContracts(world, 1 / 60)
}

describe('дела', () => {
  it('оферта бросается детерминированно: то же зерно — то же дело', () => {
    const a = worldWith('neutral')
    const b = worldWith('neutral')
    for (const w of [a, b]) w.ships[0]!.originKind = 'trader'
    const offers = [a, b].map((w) => Array.from({ length: 6 }, () => JSON.stringify(rollOffer(w, w.ships[0]!))))
    expect(offers[0]).toEqual(offers[1])
  })

  it('награды круглые, как их назвал бы человек', () => {
    // Пойманное: «проводи — заплачу 3254 кр». Никто так не торгуется; суммы — по `roundMoney`.
    const w = worldWith('neutral')
    let seen = 0
    for (const kind of ['trader', 'miner', 'patrol', 'courier']) {
      w.ships[0]!.originKind = kind
      for (let i = 0; i < 200; i++) {
        const o = rollOffer(w, w.ships[0]!)
        if (!o) continue
        seen++
        expect(roundMoney(o.reward), JSON.stringify(o)).toBe(o.reward)
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('доставка: груз в трюм при согласии, плата — на станции назначения', () => {
    const world = worldWith('neutral')
    const trader = world.ships[0]!
    giveOffer(trader, { kind: 'deliver', commodityId: 'metals', units: 4, toSystem: 77, toSystemName: 'X', reward: 900, days: 5, revealed: true })
    const credits = world.credits
    const c = acceptOffer(world, trader)!
    expect(c).not.toBeNull()
    const tons = () => world.player.hold.items.reduce((s, it) => s + (it.kind === 'commodity' && it.commodity.id === 'metals' ? it.units : 0), 0)
    expect(tons()).toBe(4)

    dockAt(world, world.systemIndex) // не та система — ничего
    expect(c.status).toBe('active')
    dockAt(world, 77)
    expect(c.status).toBe('done')
    expect(world.credits).toBe(credits + 900)
    expect(tons()).toBe(0)
    expect(relationOf(world, trader)).toBe('friendly')
  })

  it('«привези» платит за сданное частями; срок с частью — не провал', () => {
    const world = worldWith('neutral')
    const trader = world.ships[0]!
    const home = world.systemIndex
    giveOffer(trader, { kind: 'fetch', commodityId: 'food', units: 10, reward: 70, days: 2, revealed: true })
    const c = acceptOffer(world, trader)!
    world.player.hold.items.push({ kind: 'commodity', commodity: { id: 'food', name: 'Еда', description: '', unitMass: 1, basePrice: 42, tier: 2, contraband: false }, units: 4 })
    const credits = world.credits
    dockAt(world, home)
    expect(world.credits).toBe(credits + 4 * 70)
    expect(c.status).toBe('active')
    world.calendarTime += 3 * CALENDAR_DAY
    stepContracts(world, 1 / 60)
    expect(c.status).toBe('done')
    expect(c.end).toBe('partial')
  })

  it('вышел срок — провал и минус ступень отношения', () => {
    const world = worldWith('neutral')
    const trader = world.ships[0]!
    giveOffer(trader, { kind: 'deliver', commodityId: 'food', units: 2, toSystem: 5, toSystemName: 'Y', reward: 500, days: 1, revealed: true })
    const c = acceptOffer(world, trader)!
    world.calendarTime += 2 * CALENDAR_DAY
    stepContracts(world, 1 / 60)
    expect(c.status).toBe('failed')
    expect(relationOf(world, trader)).toBe('hostile')
  })

  it('охота: премия только за своих; ушедший прыжком — без премии', () => {
    const world = worldWith('police')
    const cop = world.ships[0]!
    giveOffer(cop, { kind: 'hunt', heads: 2, reward: 1000, days: null, revealed: true })
    const c = acceptOffer(world, cop)!
    const targets = world.ships.filter((s) => s.bountyOf === c.id)
    expect(targets).toHaveLength(2)
    const credits = world.credits
    targets[0]!.alive = false
    targets[0]!.lastAttackerId = world.player.id
    targets[1]!.warpDeparting = true
    stepContracts(world, 1 / 60)
    expect(world.credits).toBe(credits + 1000)
    expect(c.status).toBe('done')
    expect(c.end).toBe('partial')
  })

  it('убитый чужими — дело закрывается пустым, отношение не страдает', () => {
    const world = worldWith('police')
    const cop = world.ships[0]!
    giveOffer(cop, { kind: 'hunt', heads: 1, reward: 1000, days: null, revealed: true })
    const c = acceptOffer(world, cop)!
    const t = world.ships.find((s) => s.bountyOf === c.id)!
    t.alive = false
    t.lastAttackerId = cop.id
    stepContracts(world, 1 / 60)
    expect(c.end).toBe('empty')
    expect(relationOf(world, cop)).toBe('neutral')
  })

  it('ушёл из системы с делом «здесь и сейчас» — брошено', () => {
    const world = worldWith('police')
    const cop = world.ships[0]!
    giveOffer(cop, { kind: 'demolish', reward: 5000, days: null, revealed: true })
    const c = acceptOffer(world, cop)!
    expect(world.platforms.some((p) => p.contractId === c.id)).toBe(true)
    world.epoch += 1
    stepContracts(world, 1 / 60)
    expect(c.end).toBe('abandoned')
  })

  it('снос: гнездо взорвано — платят целиком', () => {
    const world = worldWith('police')
    const cop = world.ships[0]!
    giveOffer(cop, { kind: 'demolish', reward: 5000, days: null, revealed: true })
    const c = acceptOffer(world, cop)!
    const credits = world.credits
    world.platforms.find((p) => p.contractId === c.id)!.alive = false
    stepContracts(world, 1 / 60)
    expect(world.credits).toBe(credits + 5000)
  })

  it('на мирного напали — он сам зовёт на помощь; отбился — платит', () => {
    const world = worldWith('neutral', 'hostile')
    const [trader, pirate] = world.ships as [ShipEntity, ShipEntity]
    declareFoe(pirate, trader)
    trader.ai!.foes.push(pirate.id)
    stepContracts(world, 1 / 60)
    expect(offerHail(world)?.id).toBe(trader.id)
    expect(trader.offer?.kind).toBe('rescue')
    const c = acceptOffer(world, trader)!
    const credits = world.credits
    pirate.alive = false
    stepContracts(world, 1 / 60)
    expect(c.status).toBe('done')
    expect(world.credits).toBe(credits + c.reward)
  })

  it('сопровождение: клиент идёт за тобой и сдан на станции назначения', () => {
    const world = worldWith('neutral')
    const trader = world.ships[0]!
    giveOffer(trader, { kind: 'escort', toSystem: 9, toSystemName: 'Z', reward: 2000, days: 5, revealed: true })
    const c = acceptOffer(world, trader)!
    expect(trader.ai!.escortOf).toBe(world.player.id)
    const rec = world.acquaintances.find((a) => a.id === trader.acquaintanceId)!
    rec.systemIndex = 9 // перенесён прыжком вместе с игроком
    dockAt(world, 9)
    expect(c.status).toBe('done')
    expect(rec.plan.posture).toBe('idle')
  })

  it('сами заговаривают по сроку: первый вызов — в первую минуту', () => {
    const world = worldWith('neutral')
    const trader = world.ships[0]!
    giveOffer(trader, { kind: 'fetch', commodityId: 'food', units: 5, reward: 70, days: 5, revealed: false })
    for (let t = 0; t < CONTRACTS.FIRST_HAIL + 1; t += 1) stepContracts(world, 1)
    expect(offerHail(world)?.id).toBe(trader.id)
  })

  it('отказ вспыльчивого в жизненном деле — обида; в торговом — пожал плечами', () => {
    const world = worldWith('police', 'neutral')
    const [cop, trader] = world.ships as [ShipEntity, ShipEntity]
    cop.persona = { ...cop.persona, temperament: 5 }
    trader.persona = { ...trader.persona, temperament: 5 }
    giveOffer(cop, { kind: 'hunt', heads: 1, reward: 1, days: null, revealed: true })
    giveOffer(trader, { kind: 'fetch', commodityId: 'food', units: 5, reward: 70, days: 5, revealed: true })
    expect(declineOffer(world, cop)).toBe('angry')
    expect(declineOffer(world, trader)).toBe('shrug')
    expect(cop.offer).toBeNull()
  })

  it('копия чужого борта дел не даёт, пока владелец её не отдал — любых, не только сопровождения', () => {
    const world = worldWith('neutral')
    const trader = world.ships[0]!
    trader.kinematic = true
    trader.mirror = true
    giveOffer(trader, { kind: 'fetch', commodityId: 'food', units: 5, reward: 70, days: 5, revealed: true })
    expect(acceptBlock(world, trader)).toBe('remote')
    expect(acceptOffer(world, trader)).toBeNull()
  })
})

describe('заказчик помнит дело', () => {
  // Пойманный баг: бот знал о деле, лишь пока оно активно. Перебили пиратов — дело закрылось,
  // и при следующем разговоре заказчик «знать не знал ни о какой миссии». Взятое и его исход
  // обязаны лечь в журнал знакомства — в ту же память, что и сделки с просьбами.
  it('взятое дело и его исход с выплатой — в журнале заказчика', () => {
    const world = worldWith('police')
    const cop = world.ships[0]!
    giveOffer(cop, { kind: 'hunt', heads: 2, reward: 1000, days: null, revealed: true })
    const c = acceptOffer(world, cop)!
    const record = world.acquaintances.find((a) => a.id === cop.acquaintanceId)!
    expect(record.history.some((e) => e.kind === 'job' && e.outcome === 'taken')).toBe(true)

    for (const t of world.ships.filter((s) => s.bountyOf === c.id)) {
      t.alive = false
      t.lastAttackerId = world.player.id
    }
    stepContracts(world, 1 / 60)
    const closed = record.history.find((e) => e.kind === 'job' && e.outcome !== 'taken')
    expect(closed).toMatchObject({ kind: 'job', job: 'hunt', outcome: 'completed', paid: 2000 })
  })
})

describe('клиент сопровождения ведёт прыжком', () => {
  // Пойманный баг: клиент вставал в строй ЗА игроком и ждал, что тот сам догадается, куда
  // прыгать, — «медленно-медленно куда-то полетел». Клиент обязан позвать за собой, отметить
  // звезду целью прыжка и уйти порталом первым; его запись — уже в системе назначения.
  it('зовёт за собой, метит звезду и уходит прыжком туда', () => {
    const world = worldWith('neutral')
    const trader = world.ships[0]!
    giveOffer(trader, { kind: 'escort', toSystem: 9, toSystemName: 'Z', ly: 7.5, reward: 2000, days: 5, revealed: true })
    acceptOffer(world, trader)
    const rec = world.acquaintances.find((a) => a.id === trader.acquaintanceId)!
    const controllers = new Map([[world.player.id, NULL_CONTROLLER]])

    const step = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) stepWorld(world, 1 / 60, controllers, { unassigned: aiController })
    }
    step(CONTRACTS.LEAD_ANNOUNCE + 0.5)
    expect(world.notices.some((n) => n.kind === 'lead-jump' && n.other === 'Z')).toBe(true)
    expect(world.jumpTargetIndex).toBe(9)
    expect(rec.systemIndex).not.toBe(9) // ещё здесь: позвал и ждёт

    step(CONTRACTS.LEAD_JUMP + 1)
    expect(rec.systemIndex).toBe(9)
    expect(trader.warpDeparting || trader.warpedOut).toBe(true)
  })
})
