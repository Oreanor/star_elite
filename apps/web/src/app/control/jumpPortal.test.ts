import { Quaternion, Scene, Vector3 } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { commitPreparedJump, createWorld, GALAXY, jumpDistance, type World } from '@elite/sim'
import type { Session } from '../GameContext'
import {
  destPortalScene,
  disposeJumpPortalWorld,
  activeWorldRenderScene,
  prepareJumpPortalWorld,
  prepareReverseJumpPortalWorld,
  promotePreparedJumpPortalScene,
  promotedJumpPortalWorld,
  resetJumpPortalWorlds,
  syncPreparedJumpWorld,
} from '../../render/scene/jumpPortalWorld'
import {
  closePortal,
  completePortalTransit,
  establishedPortalCloseRequested,
  freshPortalKeyDown,
  jumpPortal,
  openPortal,
  portalActive,
  portalOpen,
  portalRetargetRequested,
  setDestPortal,
  tickPortal,
} from './jumpPortal'

function reachableTarget(world: World, excluded = -1): number {
  for (let index = 0; index < GALAXY.COUNT; index++) {
    if (index === world.systemIndex || index === excluded) continue
    if (jumpDistance(world, index) <= world.player.jumpCharge) return index
  }
  throw new Error('no reachable target for sequential portal test')
}

afterEach(() => {
  closePortal()
  resetJumpPortalWorlds()
})

describe('linked jump portal frame sync', () => {
  it('does not overwrite the collider pose while the radius is changing', () => {
    const world = createWorld()
    openPortal(world, 1, null, 0)
    const gate = world.jumpGates[0]!
    const shifted = gate.pos.clone().add(new Vector3(3_000, -700, 420))

    // Orbit/floating-origin code owns the collider pose before the render director runs.
    gate.pos.copy(shifted)
    tickPortal(world, 1 / 60, true, 1 / 60)

    expect(gate.pos.distanceTo(shifted)).toBeLessThan(1e-9)
    expect(jumpPortal().ringPos.distanceTo(shifted)).toBeLessThan(1e-9)
  })

  it('keeps the approaching half in this world and the crossed half in the destination', () => {
    const world = createWorld()
    openPortal(world, 1, null, 0)
    setDestPortal(new Vector3(800, -200, 150), new Quaternion())
    const portal = jumpPortal()
    const hereBefore = portal.ringPos.clone().addScaledVector(portal.ringNormal, -1)
    const hereAfter = portal.ringPos.clone().addScaledVector(portal.ringNormal, 1)
    const thereBefore = portal.destPos.clone().addScaledVector(portal.destNormal, -1)
    const thereAfter = portal.destPos.clone().addScaledVector(portal.destNormal, 1)

    expect(portal.clipHere.distanceToPoint(hereBefore)).toBeGreaterThan(0)
    expect(portal.clipHere.distanceToPoint(hereAfter)).toBeLessThan(0)
    expect(portal.clipThere.distanceToPoint(thereBefore)).toBeLessThan(0)
    expect(portal.clipThere.distanceToPoint(thereAfter)).toBeGreaterThan(0)
  })

  it('treats an explicitly selected old endpoint as a new portal command', () => {
    const world = createWorld()
    openPortal(world, 17, null, 0)

    // После перехода null продолжает управлять оставшейся парой. Повторный выбор
    // её дальнего индекса уже явный: старое кольцо надо заменить новым перед носом.
    expect(portalRetargetRequested(null)).toBe(false)
    expect(portalRetargetRequested(jumpPortal().index)).toBe(true)
  })

  it('does not restart an opening portal on keyboard auto-repeat', () => {
    // Размер меняется по isHeld в каждом кадре. Повторный keydown раньше заново открывал
    // ту же цель с радиуса ноль, поэтому удерживаемая H визуально «не реагировала».
    expect(freshPortalKeyDown(false)).toBe(true)
    expect(freshPortalKeyDown(true)).toBe(false)
  })

  it('closes the established pair when H has no newly selected target', () => {
    expect(establishedPortalCloseRequested(null, true)).toBe(true)
    expect(establishedPortalCloseRequested(7, true)).toBe(false)
    expect(establishedPortalCloseRequested(null, false)).toBe(false)
  })

  it('makes the portal immediately available for a second command after transit', () => {
    const world = createWorld()
    openPortal(world, 17, null, 0)

    completePortalTransit(world, new Vector3(), false)

    expect(portalOpen()).toBe(false)
    expect(portalActive()).toBe(false)

    openPortal(world, 23, null, 1)
    expect(portalOpen()).toBe(true)
    expect(jumpPortal().index).toBe(23)
  })

  it('does not spend hyper charge when a portal is opened and closed without transit', () => {
    const world = createWorld()
    const targetIndex = reachableTarget(world)
    const chargeBefore = world.player.jumpCharge

    openPortal(world, targetIndex, null, 0)
    tickPortal(world, 1, true, 1)
    closePortal()

    expect(world.player.jumpCharge).toBe(chargeBefore)
  })

  it('detects a moving ship crossing while H is still held', () => {
    const world = createWorld()
    openPortal(world, reachableTarget(world), null, 0)

    // Первый кадр запоминает подходную сторону и полностью раскрывает отверстие.
    expect(tickPortal(world, 2.5, true, 2.5)).toBeNull()
    const portal = jumpPortal()
    world.player.state.pos.copy(portal.ringPos).addScaledVector(portal.ringNormal, 1)

    expect(tickPortal(world, 1 / 60, true, 2.5 + 1 / 60)).toBe('cross')
  })

  it('prepares the real destination World before stencil renders it', () => {
    const world = createWorld()
    const targetIndex = world.systemIndex === 1 ? 2 : 1
    openPortal(world, targetIndex, null, 0)
    const session = { world, running: false } as Session

    const prepared = prepareJumpPortalWorld(session)

    expect(jumpPortal().destReady).toBe(true)
    expect(prepared.world.systemIndex).toBe(targetIndex)
    expect(prepared.world.bodies.length).toBeGreaterThan(0)
    expect(destPortalScene()).toBe(prepared.scene)
  }, 30_000)

  it('keeps the prepared destination simulation alive before transit', () => {
    const world = createWorld()
    const targetIndex = reachableTarget(world)
    openPortal(world, targetIndex, null, 0)
    const session = { world, running: true } as Session
    const prepared = prepareJumpPortalWorld(session)
    const before = prepared.world.trafficTimer

    syncPreparedJumpWorld(session, prepared, 1 / 60)

    expect(prepared.world.trafficTimer).toBeLessThan(before)
    expect(prepared.world.time).toBe(world.time)
  }, 30_000)

  it('keeps the exact prepared scene mounted after transit handoff', () => {
    const world = createWorld()
    const targetIndex = reachableTarget(world)
    openPortal(world, targetIndex, null, 0)
    const session = { world, running: false } as Session
    const target = prepareJumpPortalWorld(session)

    promotePreparedJumpPortalScene(target)
    disposeJumpPortalWorld()

    expect(promotedJumpPortalWorld(target.world)).toBe(target)
    expect(activeWorldRenderScene(new Scene(), target.world)).toBe(target.scene)
  }, 30_000)

  it('can retarget and complete a second jump after the first transit', () => {
    const source = createWorld()
    const firstIndex = reachableTarget(source)
    const session = { world: source, running: false } as Session
    const sourceOrigin = source.originOffset.clone()

    openPortal(source, firstIndex, null, 0)
    const first = prepareJumpPortalWorld(session)
    expect(commitPreparedJump(source, first.world, firstIndex)).toBe(true)
    session.world = first.world
    completePortalTransit(session.world, sourceOrigin)
    prepareReverseJumpPortalWorld(session, source)

    const secondIndex = reachableTarget(session.world, source.systemIndex)
    session.world.jumpTargetIndex = secondIndex
    openPortal(session.world, secondIndex, null, 10)
    const second = prepareJumpPortalWorld(session)

    expect(second.world).not.toBe(first.world)
    expect(second.world.systemIndex).toBe(secondIndex)
    expect(commitPreparedJump(session.world, second.world, secondIndex)).toBe(true)
  }, 30_000)
})
