import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createAIState } from '../ai'
import { selectTarget } from '../ai/targeting'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { stepMissiles } from './missiles'
import { fireMissile } from './weapons'
import { isEngageable } from './engage'

/**
 * Створ станции. Нажал стыковку — по тебе прекращают огонь, и это правило мира,
 * а не поблажка автопилоту: спрашивают его все, кто выбирает цель.
 *
 * Проверяется именно то, что перемирие видно из ТРЁХ независимых мест — ИИ,
 * головки ракеты, предиката. Разойдись они, и станция защищала бы от пирата,
 * но не от его ракеты; такой баг ловится только в бою и стоит корабля.
 */

function withPirate(): { world: World; pirate: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -400], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  const pirate = world.ships[0]
  if (!pirate) throw new Error('нет пирата')
  world.player.state.pos.set(0, 0, 0)
  pirate.state.pos.set(0, 0, -400)
  pirate.ai = createAIState(new Vector3(0, 0, -400), world.rng)
  return { world, pirate }
}

/**
 * Ракета живёт по `world.time`: возраст решает, взведены ли рули. `stepMissiles`
 * время не двигает — это делает шаг мира. Крутить её в цикле, забыв про часы,
 * значит вечно держать ракету моложе `armTime`: она полетит по прямой, и любой
 * тест наведения зазеленеет, ничего не проверив.
 */
function fly(world: World, steps: number, dt = 1 / 60): void {
  for (let i = 0; i < steps; i++) {
    world.time += dt
    stepMissiles(world, dt)
  }
}

describe('допуск в створ станции', () => {
  it('пират берёт игрока на прицел, пока тот не запросил стыковку', () => {
    const { world, pirate } = withPirate()
    expect(selectTarget(pirate, world)).toBe(world.player)
  })

  it('с допуском игрок исчезает из списка целей ИИ', () => {
    const { world, pirate } = withPirate()
    world.player.clearance = true
    expect(selectTarget(pirate, world)).toBeNull()
  })

  it('допуск снимает захват, а не только запрещает новый', () => {
    const { world, pirate } = withPirate()
    // Цель уже захвачена: прилипание к ней не должно пережить перемирие.
    expect(selectTarget(pirate, world)).toBe(world.player)
    world.player.clearance = true
    expect(selectTarget(pirate, world)).toBeNull()
  })

  it('головка выпущенной ракеты теряет цель, вошедшую в створ', () => {
    const { world, pirate } = withPirate()

    // Стреляет игрок: пусковая есть у него. Правило створа одно на всех, и кто
    // именно под защитой станции — ракете безразлично.
    pirate.state.pos.set(0, 0, -3000)
    for (const gun of world.player.guns) gun.cooldown = 0
    fireMissile(world, world.player, pirate.id)
    const missile = world.missiles[0]
    expect(missile).toBeDefined()
    if (!missile) return

    // Ждём взведения рулей: до него головка не наводится и без всякого перемирия.
    fly(world, 60)
    expect(missile.targetId).toBe(pirate.id)

    pirate.clearance = true
    fly(world, 1)

    /**
     * `targetId` головка не обнуляет: там это означает другое — срыв слежения,
     * из которого возврата нет. Проверяем следствие: ракета перестала
     * доворачивать и идёт по прямой.
     *
     * Цель сдвинута вбок НЕМНОГО и далеко: угловая скорость линии визирования
     * остаётся заведомо ниже предела головки. Резкий рывок сорвал бы захват сам,
     * и тест зеленел бы даже с выключенным перемирием — то есть не проверял бы ничего.
     */
    const before = missile.vel.clone().normalize()
    pirate.state.pos.set(150, 0, -2600)
    fly(world, 60)
    const after = missile.vel.clone().normalize()
    expect(before.dot(after)).toBeCloseTo(1, 6)
  })

  it('маскировка и допуск — разные причины, но один ответ', () => {
    const { world } = withPirate()
    const player = world.player
    expect(isEngageable(player)).toBe(true)

    player.clearance = true
    expect(isEngageable(player)).toBe(false)

    player.clearance = false
    player.cloaked = true
    expect(isEngageable(player)).toBe(false)
  })
})
