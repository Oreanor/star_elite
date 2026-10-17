import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { PHYSICS } from '../../config/physics'
import { makeRng } from '../../core/math'
import { systemDefFor } from '../galaxy/jump'
import { SHARED_START_INDEX } from '../galaxy/sharedStart'
import { aiController } from '../ai/pilot'
import { autofightSpent, engageAutofight, retargetAutofight } from '../ai/autofight'
import { applyPlayerSave, serializePlayer } from '../save/player'
import { createWorld, type World } from '../world'
import { lockContact } from '../world/queries'
import type { Controller } from './controller'
import { stepWorld } from '.'

/**
 * ПРОГОН НА ВЫНОСЛИВОСТЬ. Живая стартовая система — трафик, патрули, пираты — и игрок под
 * случайными рулями (от зерна, детерминированно) и автобоем, минута игрового времени. Ловит
 * то, что единичный тест не видит: NaN, расползшиеся пределы, умершее в такте состояние.
 */
const rng = makeRng(12345)
const randomPilot: Controller = {
  update(ship) {
    const c = ship.controls
    c.throttle = rng()
    c.pitch = rng() * 2 - 1
    c.yaw = rng() * 2 - 1
    c.roll = rng() * 2 - 1
    c.boost = rng() < 0.2 ? 2 : 1
  },
  wantsFire: () => rng() < 0.5,
  wantsMissile: () => rng() < 0.01,
}

const finite = (...xs: number[]) => xs.every(Number.isFinite)

function checkWorld(world: World, t: number): void {
  for (const s of [world.player, ...world.ships]) {
    const st = s.state
    const where = `t=${t.toFixed(1)} ${s.pilotName ?? s.id}`
    expect(finite(st.pos.x, st.pos.y, st.pos.z, st.vel.x, st.vel.y, st.vel.z), `${where}: позиция/скорость`).toBe(true)
    expect(finite(st.quat.x, st.quat.y, st.quat.z, st.quat.w), `${where}: поза`).toBe(true)
    expect(Math.abs(st.quat.length() - 1), `${where}: поза не единична`).toBeLessThan(1e-3)
    if (!s.alive) continue
    expect(s.hull, `${where}: корпус`).toBeLessThanOrEqual(s.spec.hull.hull + 1e-6)
    expect(s.shield, `${where}: щит`).toBeLessThanOrEqual(s.spec.hull.shield + 1e-6)
    expect(s.shield, `${where}: щит`).toBeGreaterThanOrEqual(0)
  }
  for (const a of world.asteroids) expect(finite(a.pos.x, a.pos.y, a.pos.z, a.radius), `t=${t} камень`).toBe(true)
  for (const b of world.bodies) expect(finite(b.pos.x, b.pos.y, b.pos.z), `t=${t} тело ${b.name}`).toBe(true)
  expect(finite(world.credits, world.time, world.player.laserHeat.heat)).toBe(true)
  expect(world.player.laserHeat.heat).toBeGreaterThanOrEqual(0)
  expect(world.player.laserHeat.heat).toBeLessThanOrEqual(1)
}

describe('прогон на выносливость', () => {
  it('минута живой системы под случайными рулями и автобоем — ни NaN, ни расползшихся пределов', () => {
    const world = createWorld(systemDefFor(SHARED_START_INDEX, GALAXY.SEED))
    const controllers = new Map<number, Controller>([[world.player.id, randomPilot]])
    const dt = PHYSICS.FIXED_DT
    for (let i = 0; i < 60 * 120; i++) {
      // Каждые 10 с — автобой по ближайшему, как жмёт пилот P; иначе случайные рули.
      if (i % 1200 === 0 && world.ships.length > 0) {
        lockContact(world, 'ship', world.ships[0]!.id)
        world.targetFocus = 'contact'
        if (engageAutofight(world)) controllers.set(world.player.id, aiController)
      }
      if (world.player.ai && autofightSpent(world) && !retargetAutofight(world)) {
        world.player.ai = null
        controllers.set(world.player.id, randomPilot)
      }
      stepWorld(world, dt, controllers, { unassigned: aiController })
      if (i % 120 === 0) checkWorld(world, world.time)
    }
    checkWorld(world, world.time)
  })

  it('после прогона сейв поднимается тем же: сохранил → загрузил → сохранил — одно и то же', () => {
    const world = createWorld(systemDefFor(SHARED_START_INDEX, GALAXY.SEED))
    for (let i = 0; i < 20 * 120; i++) stepWorld(world, PHYSICS.FIXED_DT, new Map(), { unassigned: aiController })
    const save = serializePlayer(world)
    const fresh = createWorld(systemDefFor(SHARED_START_INDEX, GALAXY.SEED))
    applyPlayerSave(fresh, save)
    expect(JSON.parse(JSON.stringify(serializePlayer(fresh)))).toEqual(JSON.parse(JSON.stringify(save)))
  })
})
