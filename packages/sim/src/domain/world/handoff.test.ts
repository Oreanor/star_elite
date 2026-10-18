import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { COMMODITIES } from '../cargo/items'
import { addCommodity } from '../cargo/hold'
import { acceptBlock, acceptOffer } from '../contracts/contracts'
import { linesFor } from '../dialogue/dialogue'
import { serializeLoadout } from '../save/player'
import { createWorld, STARTER_SYSTEM, type World } from './index'
import type { ShipEntity } from './entities'
import { adoptShip, captureHandoff, isBoundShip, peerHitYields, releaseShip } from './handoff'
import { isPersonalShip, spawnMirrorShip, spawnRemotePlayer } from './remote'

/**
 * Передача борта между клиентами. Смысл — геймплей не зависит от того, кто первым вошёл в
 * систему: у кого бот, с тем всё как у хозяина. Проверяем, что после передачи копия ведёт
 * себя как свой борт, а не что совпали числа.
 */

function world(): World {
  const w = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, 0], spread: 0, faction: 'neutral', name: 'Торговец' }],
  })
  w.desolate = true
  w.docked = false
  for (const s of w.ships) s.state.pos.copy(w.player.state.pos).add(new Vector3(0, 0, -1500))
  return w
}

/** Копия борта `src` у гостя — как её собрал бы реестр. */
function mirrorOf(guest: World, src: ShipEntity): ShipEntity {
  return spawnMirrorShip(guest, {
    name: src.name,
    pilotName: src.pilotName,
    faction: src.faction,
    originKind: src.originKind,
    loadout: serializeLoadout(src.loadout),
    persona: src.persona,
    divine: false,
    pos: guest.player.state.pos.clone().add(new Vector3(0, 0, -1500)),
    quat: new Quaternion(),
  })
}

/** Провод между двумя мирами: свой игрок — `u:me`, игрок другого мира — его борт у меня. */
function wire(from: World, peerInTo: ShipEntity) {
  const refOf = (id: number) => (id === from.player.id ? 'u:peer' : `h:${id}`)
  const resolve = (ref: string) => (ref === 'u:peer' ? peerInTo.id : null)
  return { refOf, resolve }
}

describe('передача борта', () => {
  it('отданная копия — свой борт: сопровождение берётся, как у хозяина', () => {
    const host = world()
    const trader = host.ships[0]!
    trader.offer = { kind: 'escort', toSystem: 9, toSystemName: 'Z', reward: 2000, days: 5, revealed: true }
    // Трюм задаём сами: тест про то, что груз ЕДЕТ с бортом, а не про вместимость корпуса.
    trader.hold.capacity = 20
    addCommodity(trader.hold, COMMODITIES.METALS, 3)

    const guest = world()
    guest.ships = []
    const copy = mirrorOf(guest, trader)
    copy.offer = { ...trader.offer }
    expect(acceptBlock(guest, copy)).toBe('remote')
    expect(linesFor(guest, copy)).toEqual([])

    const hostPeer = spawnRemotePlayer(guest, { name: 'H', species: 'human', portrait: 0, pos: new Vector3(), quat: new Quaternion() })
    const { refOf, resolve } = wire(host, hostPeer)
    const handoff = captureHandoff(host, trader, refOf)
    releaseShip(trader)
    adoptShip(guest, copy, JSON.parse(JSON.stringify(handoff)), 'host:1', resolve)

    expect(trader.mirror && trader.kinematic).toBe(true)
    expect(copy.mirror || copy.kinematic).toBe(false)
    expect(copy.netOrigin).toBe('host:1')
    // Груз пришёл с бортом: ограбить его у гостя есть что.
    expect(copy.hold.items.some((it) => it.kind === 'commodity' && it.units === 3)).toBe(true)
    expect(linesFor(guest, copy).length).toBeGreaterThan(0)
    expect(acceptBlock(guest, copy)).toBeNull()
    expect(acceptOffer(guest, copy)).not.toBeNull()
    // Попутчик теперь держится у гостя — его не отдать, пока дело идёт.
    expect(isBoundShip(guest, copy)).toBe(true)
  })

  it('память пилота переезжает: враг по ту сторону — враг и здесь', () => {
    const host = world()
    const trader = host.ships[0]!
    trader.ai!.foes = [host.player.id]
    trader.ai!.dock = 'inbound'
    const guest = world()
    guest.ships = []
    const copy = mirrorOf(guest, trader)
    const hostPeer = spawnRemotePlayer(guest, { name: 'H', species: 'human', portrait: 0, pos: new Vector3(), quat: new Quaternion() })
    const { refOf, resolve } = wire(host, hostPeer)
    adoptShip(guest, copy, captureHandoff(host, trader, refOf), 'host:1', resolve)
    expect(copy.ai!.foes).toEqual([hostPeer.id])
    expect(copy.ai!.dock).toBe('inbound')
  })

  it('взятый борт — личный, но свободный: уйдёт владелец — его подхватит хозяин', () => {
    const w = world()
    const trader = w.ships[0]!
    expect(isPersonalShip(w, trader)).toBe(false)
    trader.claimed = true
    expect(isPersonalShip(w, trader)).toBe(true)
    expect(isBoundShip(w, trader)).toBe(false)
    trader.ai!.escortOf = w.player.id
    expect(isBoundShip(w, trader)).toBe(true)
  })

  it('чужой задел мирного — борт уходит к нему; дерётся со своим — не отдаётся', () => {
    const w = world()
    const trader = w.ships[0]!
    expect(peerHitYields(w, trader)).toBe(true)
    // Свой игрок только что задел его сам — эпизод обиды здесь.
    trader.ai!.strikeCount = 1
    trader.ai!.grievanceAt = w.time
    expect(peerHitYields(w, trader)).toBe(false)
    trader.ai!.strikeCount = 0
    trader.ai!.targetId = w.player.id
    expect(peerHitYields(w, trader)).toBe(false)
    trader.ai!.targetId = null
    trader.faction = 'hostile'
    expect(peerHitYields(w, trader)).toBe(false)
  })
})
