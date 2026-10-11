import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { pirateLoadout } from '../../config/loadouts'
import { aiController } from '../ai/pilot'
import { selectTarget } from '../ai/targeting'
import { serializeLoadout } from '../save/player'
import { stepWorld } from '../sim'
import { createWorld, STARTER_SYSTEM, type World } from './index'
import type { ShipEntity } from './entities'
import { COMMODITIES } from '../cargo/items'
import { revokeScoop, spawnNetPod } from '../combat/salvage'
import { applyRockHit, damageAsteroid, spawnNetRock } from '../combat/mining'
import { rehydrateCargoItem, serializeCargoItem } from '../save/player'
import { killWarBaseFixture } from '../combat/warBase'
import { linesFor } from '../dialogue/dialogue'
import { applyPeerHit, applyStructHitAtHost, spawnMirrorPlatform, promoteMirror, spawnMirrorShip, spawnRemotePlayer, yieldLocalTraffic } from './remote'

/**
 * Общий трафик: у хозяина системы борта живые, у остальных — зеркала. Проверяем правила,
 * а не сеть: зеркало не рождает своего трафика, его залп не ранит, пират видит чужого игрока.
 */

function quiet(): World {
  const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
  world.docked = false
  return world
}

function mirrorPirate(world: World, at: Vector3): ShipEntity {
  return spawnMirrorShip(world, {
    name: 'Пират',
    pilotName: 'Пират',
    faction: 'hostile',
    originKind: 'pirate',
    loadout: serializeLoadout(pirateLoadout()),
    persona: world.player.persona,
    divine: false,
    pos: at,
    quat: new Quaternion(),
  })
}

const run = (world: World, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) stepWorld(world, 1 / 60, new Map(), { unassigned: aiController })
}

describe('общий трафик', () => {
  it('зеркало не рождает своего трафика: его ведёт хозяин', () => {
    const world = quiet()
    world.trafficRole = 'mirror'
    world.trafficTimer = 0
    run(world, 120)
    expect(world.ships.filter((s) => !s.kinematic && !s.divine)).toHaveLength(0)
  })

  it('косметический залп зеркала летит, но не ранит', () => {
    const world = quiet()
    world.trafficRole = 'mirror'
    // Зеркало смотрит носом (−Z) прямо на игрока в 400 м.
    const ship = mirrorPirate(world, world.player.state.pos.clone().add(new Vector3(0, 0, 400)))
    ship.mirrorFiring = true
    const hp = world.player.hull + world.player.shield
    // Следы живут доли секунды — считаем выпущенные по ходу, а не в конце.
    let shots = 0
    for (let i = 0; i < 120; i++) {
      stepWorld(world, 1 / 60, new Map(), { unassigned: aiController })
      shots = Math.max(shots, world.bolts.length)
    }
    expect(shots).toBeGreaterThan(0)
    expect(world.player.hull + world.player.shield).toBeGreaterThanOrEqual(hp)
  })

  it('пират у хозяина берёт чужого игрока в цель — бить пиратов можно вместе', () => {
    const world = quiet()
    const peer = spawnRemotePlayer(world, {
      name: 'Друг',
      species: 'Люди',
      portrait: 0,
      pos: world.player.state.pos.clone().add(new Vector3(0, 0, -800)),
      quat: new Quaternion(),
    })
    world.player.state.pos.add(new Vector3(0, 50_000, 0))
    const pirate = mirrorPirate(world, peer.state.pos.clone().add(new Vector3(0, 0, -600)))
    promoteMirror(world, pirate)
    expect(selectTarget(pirate, world)?.id).toBe(peer.id)
  })

  it('стал хозяином — зеркало оживает и летит само', () => {
    const world = quiet()
    const pirate = mirrorPirate(world, world.player.state.pos.clone().add(new Vector3(0, 0, -2000)))
    promoteMirror(world, pirate)
    const from = pirate.state.pos.clone()
    run(world, 5)
    expect(pirate.ai).not.toBeNull()
    expect(pirate.state.pos.distanceTo(from)).toBeGreaterThan(50)
  })

  it('стал зеркалом — свой трафик уходит, наёмник остаётся', () => {
    const world = quiet()
    const a = mirrorPirate(world, new Vector3(1000, 0, 0))
    const b = mirrorPirate(world, new Vector3(-1000, 0, 0))
    promoteMirror(world, a)
    promoteMirror(world, b)
    b.ai!.escortOf = world.player.id
    yieldLocalTraffic(world)
    expect(world.ships).not.toContain(a)
    expect(world.ships).toContain(b)
  })

  it('мирный, по которому стрелял живой игрок, берёт его во враги', () => {
    const world = quiet()
    const trader = mirrorPirate(world, new Vector3(0, 0, -500))
    trader.faction = 'neutral'
    promoteMirror(world, trader)
    const peer = spawnRemotePlayer(world, { name: 'Друг', species: 'Люди', portrait: 0, pos: new Vector3(), quat: new Quaternion() })
    applyPeerHit(world, trader, 10, peer)
    expect(trader.ai!.foes).toContain(peer.id)
    expect(trader.lastAttackerId).toBe(peer.id)
  })

  it('подобрал общий контейнер — заявка сети; не успел первым — предмет уходит из трюма', () => {
    const world = quiet()
    const item = { kind: 'commodity' as const, commodity: COMMODITIES.METALS, units: 3 }
    spawnNetPod(world, 'k1', item, world.player.state.pos.clone(), new Vector3(), 0)
    run(world, 0.2)
    expect(world.podClaims.map((c) => c.netId)).toContain('k1')
    const tons = () => world.player.hold.items.reduce((s, it) => s + (it.kind === 'commodity' && it.commodity.id === 'metals' ? it.units : 0), 0)
    expect(tons()).toBe(3)
    revokeScoop(world, world.player.id, item)
    expect(tons()).toBe(0)
  })

  it('предмет переживает провод туда и обратно', () => {
    const item = { kind: 'commodity' as const, commodity: COMMODITIES.FOOD, units: 5 }
    expect(rehydrateCargoItem(serializeCargoItem(item))).toEqual(item)
  })

  it('зеркало при гибели трофеев не сыплет (их сыплет хозяин), награда — добившему', () => {
    const world = quiet()
    world.trafficRole = 'mirror'
    const pirate = mirrorPirate(world, world.player.state.pos.clone().add(new Vector3(0, 0, -3000)))
    pirate.lastAttackerId = world.player.id
    pirate.alive = false
    const credits = world.credits
    run(world, 0.1)
    expect(world.pods).toHaveLength(0)
    expect(world.credits).toBeGreaterThan(credits)
  })

  it('общий камень у зеркала не колется — удар уходит хозяину; у хозяина колется', () => {
    const mirror = quiet()
    mirror.trafficRole = 'mirror'
    const rock = spawnNetRock(mirror, 'r1', new Vector3(0, 0, -5000), new Vector3(), 40, 0)
    damageAsteroid(mirror, rock, 5)
    expect(rock.alive).toBe(true)
    expect(mirror.rockHits).toEqual([{ netId: 'r1', damage: 5 }])

    const host = quiet()
    spawnNetRock(host, 'r1', new Vector3(0, 0, -5000), new Vector3(), 40, 0)
    const before = host.asteroids.length
    applyRockHit(host, 'r1', 5, false)
    expect(host.asteroids.find((a) => a.netId === 'r1')!.alive).toBe(false)
    expect(host.asteroids.length).toBeGreaterThan(before) // осколки
  })

  it('деталь базы колет хозяин: у зеркала гибель приходит готовой, у хозяина — от удара гостя', () => {
    const host = quiet()
    const base = host.warBases[0]
    if (!base) return // в стартовой системе баз может не быть — тогда проверять нечего
    const fix = base.fixtures[0]!
    for (let i = 0; i < 50 && fix.alive; i++) {
      host.time += 1
      applyStructHitAtHost(host, { kind: 'fixture', base: 0, fixture: 0 })
    }
    expect(fix.alive).toBe(false)

    const mirror = quiet()
    mirror.trafficRole = 'mirror'
    const mfix = mirror.warBases[0]!.fixtures[0]!
    killWarBaseFixture(mirror, mirror.warBases[0]!, mfix)
    expect(mfix.alive).toBe(false)
  })

  it('удар по копии гнезда уходит хозяину, прочность не трогается', () => {
    const world = quiet()
    world.trafficRole = 'mirror'
    const p = spawnMirrorPlatform(world, { netId: 'h:7', variant: 0, pos: new Vector3(), quat: new Quaternion(), hull: 100, maxHull: 100 })
    const host = quiet()
    host.platforms.push({ ...p, kinematic: false, netId: 'h:7' })
    applyStructHitAtHost(host, { kind: 'platform', netId: 'h:7', damage: 30 })
    expect(host.platforms[0]!.hull).toBe(70)
    expect(p.hull).toBe(100)
  })

  it('своё кинематическое (Слово у Крестов) — не копия: с ним говорят и торгуют как прежде', () => {
    // Регрессия: запрет сделок с копиями сначала опирался на `kinematic` и задел бы своего бога.
    const world = quiet()
    const local = mirrorPirate(world, new Vector3(0, 0, -500))
    local.faction = 'neutral'
    local.mirror = false // своё, просто кинематическое
    expect(linesFor(world, local).length).toBeGreaterThan(0)
    local.mirror = true // копия чужого — сделок нет
    expect(linesFor(world, local)).toHaveLength(0)
  })
})
