import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { COSMIC } from '../../config/weapons'
import { systemDefFor } from '../galaxy/jump'
import { SHARED_START_INDEX } from '../galaxy/sharedStart'
import { stepWorld } from '../sim/step'
import { createWorld, enterSystem } from '../world/index'
import type { World } from '../world/entities'
import { effectiveRadius } from '../scale/scale'
import { blastKick, stepCataclysmKicks } from './blastKick'

/**
 * Удар окончательного взрыва разбивающего импульса. Держим свойства, а не числа: толкает ПРОЧЬ
 * от центра, куда бы ни смотрел нос и куда бы корабль ни летел; дальше досягаемости — ничего;
 * сдвиг — порядка корпуса, а не за горизонт; разрыв мира бьёт ровно однажды, в миг вспышки.
 */
function startWorld(): World {
  const def = { ...systemDefFor(SHARED_START_INDEX, GALAXY.SEED), patrols: [] }
  const world = createWorld({ ...def, belt: null })
  enterSystem(world, def, SHARED_START_INDEX)
  world.player.state.vel.set(0, 0, 0)
  world.player.state.angVel.set(0, 0, 0)
  return world
}

const forwardOf = (world: World): Vector3 => new Vector3(0, 0, -1).applyQuaternion(world.player.state.quat)

describe('удар окончательного взрыва', () => {
  it('толкает прочь от центра — и когда нос смотрит на взрыв, и когда корабль от него уходит', () => {
    for (const facing of [1, -1]) {
      const world = startWorld()
      const fwd = forwardOf(world)
      // facing 1: взрыв перед носом; −1: за кормой, а корабль уже летит прочь на ходу.
      const at = world.player.state.pos.clone().addScaledVector(fwd, 500 * facing)
      if (facing < 0) world.player.state.vel.copy(fwd).multiplyScalar(150)
      blastKick(world, at, 1_000, false, 5)
      const away = world.player.state.pos.clone().sub(at).normalize()
      expect(world.player.blastDrift.dot(away)).toBeGreaterThan(0)
      expect(world.player.lastBlastAt).toBe(world.time)
    }
  })

  it('дальше досягаемости — ни толчка, ни тряски: улетевшему на форсаже всё равно', () => {
    const world = startWorld()
    const at = world.player.state.pos.clone().add(new Vector3(10_000, 0, 0))
    blastKick(world, at, 1_000, false, 5)
    expect(world.player.blastDrift.length()).toBe(0)
    expect(world.player.lastBlastAt).toBeLessThan(0)
  })

  it('откидывает примерно на корпус и встаёт: рывок гаснет сам, а не уносит за горизонт', () => {
    // Пойманное: простой добавкой к скорости лётная модель на нейтрали снос почти не гасила —
    // за 6 с корабль уносило на 7.5 корпусов, и он летел дальше. Удар — «откинуло и встал».
    // Сверяем с близнецом без удара: у станции корабль и так сползает (тяготение, обстановка).
    const world = startWorld()
    const twin = startWorld()
    const at = world.player.state.pos.clone().add(new Vector3(300, 0, 0))
    blastKick(world, at, 1_000, false, 5)
    // Закрут уводит нос и меняет дальнейший путь — здесь меряем лишь сам рывок.
    world.player.state.angVel.set(0, 0, 0)
    for (let i = 0; i < 60 * 3; i++) {
      stepWorld(world, 1 / 60, new Map())
      stepWorld(twin, 1 / 60, new Map())
    }
    const length = 2 * effectiveRadius(world.player)
    const shift = world.player.state.pos.distanceTo(twin.player.state.pos)
    expect(shift).toBeGreaterThan(0.5 * COSMIC.KICK.SHIFT * length)
    expect(shift).toBeLessThan(2 * COSMIC.KICK.SHIFT * length)
    // Рывок угас: от его скорости остались доли процента.
    expect(world.player.blastDrift.length()).toBeLessThan(0.01 * (COSMIC.KICK.SHIFT * length) / COSMIC.KICK.TAU)
  })

  it('разрыв мира бьёт однажды и лишь в миг вспышки, а не в миг попадания', () => {
    const world = startWorld()
    const p = world.player.state.pos
    world.cataclysms.push({
      kind: 'rock',
      at: p.clone().add(new Vector3(0, 0, 2_000)).add(world.originOffset),
      radius: 1_000,
      color: 0x808080,
      axis: new Vector3(0, 1, 0),
      born: world.time,
      face: { id: -1, kind: 'planet', surface: null, name: 'X', spin: 0 },
    })
    stepCataclysmKicks(world)
    expect(world.player.blastDrift.length()).toBe(0)
    world.time += COSMIC.BURST.rock
    stepCataclysmKicks(world)
    const v = world.player.blastDrift.length()
    expect(v).toBeGreaterThan(0)
    world.time += 1
    stepCataclysmKicks(world)
    expect(world.player.blastDrift.length()).toBe(v)
  })
})
