import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { GALAXY } from '../../config/galaxy'
import { systemDefFor } from '../galaxy/jump'
import { SHARED_START_INDEX } from '../galaxy/sharedStart'
import { stepWorld } from '../sim'
import { NULL_CONTROLLER } from '../sim/controller'
import { aiController } from '../ai/pilot'
import { createWorld, enterVoid } from '.'

/**
 * Пустота комнаты-гипертора. Пойманный баг: влетев в дыру, игрок оставался В СИСТЕМЕ — она жила
 * невидимо под задником: опора везла борт орбитой (камеру уносило на полтора км), а сам борт
 * врезался в планету Ардин, пока пилот летал по решётке. Комната — не система.
 */
describe('пустота за горизонтом', () => {
  it('в пустоте нет ни тел, ни трафика: борт стоит, не гибнет и не уезжает', () => {
    const world = createWorld({ ...systemDefFor(SHARED_START_INDEX, GALAXY.SEED), patrols: [] })
    // Борт внутри тела в миг ухода в пустоту: тело пропадает, и толкать его некому.
    const body = world.bodies.find((b) => b.kind === 'star')!
    world.player.state.pos.copy(body.pos).add(new Vector3(0, 0, body.radius * 0.5))
    enterVoid(world)
    expect(world.bodies).toHaveLength(0)

    const controllers = new Map([[world.player.id, NULL_CONTROLLER]])
    for (let i = 0; i < 120 * 30; i++) stepWorld(world, 1 / 120, controllers, { unassigned: aiController })

    expect(world.player.alive).toBe(true)
    expect(world.player.state.pos.length()).toBeLessThan(1)
    expect(world.ships).toHaveLength(0)
  })
})
