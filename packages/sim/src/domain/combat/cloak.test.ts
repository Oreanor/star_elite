import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { selectTarget } from '../ai/targeting'
import { createAIState } from '../ai'
import { cycleTarget } from '../world/queries'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { canCloak, hasCloak, isVisible, stepCloak, toggleCloak } from './cloak'

/**
 * Маскировочное поле. Его ценность целиком в том, ЧЕГО не происходит: враг не
 * находит, локатор не берёт, ракета теряет. Значит и проверять надо отсутствие.
 */

/** Мир с одним пиратом в двухстах метрах от игрока. */
function withPirate(): { world: World; pirate: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  const pirate = world.ships[0]
  if (!pirate) throw new Error('нет пирата')
  world.player.state.pos.set(0, 0, 0)
  pirate.state.pos.set(0, 0, -200)
  pirate.ai = createAIState(new Vector3(0, 0, -200), world.rng)
  return { world, pirate }
}

describe('маскировочное поле', () => {
  it('без устройства поле не поднимается', () => {
    const { pirate } = withPirate()
    expect(hasCloak(pirate)).toBe(false)
    expect(toggleCloak(pirate)).toBe(false)
    expect(pirate.cloaked).toBe(false)
  })

  it('одна клавиша поднимает поле и она же опускает', () => {
    const { world } = withPirate()
    const player = world.player
    expect(hasCloak(player)).toBe(true)

    expect(toggleCloak(player)).toBe(true)
    expect(player.cloaked).toBe(true)
    expect(toggleCloak(player)).toBe(false)
    expect(player.cloaked).toBe(false)
  })

  /**
   * Таймера у поля нет — есть счёт за электричество. Оно опадает ровно тогда,
   * когда батареи опустели, и ни секундой раньше.
   */
  it('держится, пока хватает батарей, и опадает само', () => {
    const { world } = withPirate()
    const player = world.player
    player.energy = player.spec.power.capacity
    toggleCloak(player)

    // Расход обязан превышать восполнение, иначе поле держалось бы вечно.
    expect(player.spec.cloakDrain).toBeGreaterThan(player.spec.power.regen)

    // Шагаем БЕЗ восполнения: здесь проверяется только расход.
    const life = player.energy / player.spec.cloakDrain
    for (let t = 0; t < life - 0.02; t += 0.01) stepCloak(player, 0.01)
    expect(player.cloaked).toBe(true)

    for (let i = 0; i < 10; i++) stepCloak(player, 0.01)
    expect(player.cloaked).toBe(false)
    expect(player.energy).toBe(0)
  })

  it('на пустых батареях поле не поднять', () => {
    const { world } = withPirate()
    const player = world.player
    player.energy = 0
    expect(canCloak(player)).toBe(false)
    expect(toggleCloak(player)).toBe(false)
  })

  /** Обломок обязан быть виден: иначе трофеи ищут вслепую. */
  it('мёртвый не прячется', () => {
    const { world } = withPirate()
    const player = world.player
    toggleCloak(player)
    player.alive = false
    stepCloak(player, 0.01)
    expect(player.cloaked).toBe(false)
    expect(isVisible(player)).toBe(false)
  })
})

describe('невидимку никто не видит', () => {
  /**
   * Три независимых потребителя правила: захват, ИИ и головка ракеты. Каждый
   * спрашивает `isVisible`, а не проверяет флаг у себя, — иначе одна из трёх
   * копий однажды отстанет, и невидимка окажется видимой ракете.
   */
  it('ИИ теряет цель, поднявшую поле', () => {
    const { world, pirate } = withPirate()
    expect(selectTarget(pirate, world)).toBe(world.player)

    toggleCloak(world.player)
    expect(selectTarget(pirate, world)).toBeNull()
  })

  it('замаскированного нельзя захватить', () => {
    const { world, pirate } = withPirate()
    expect(cycleTarget(world, null)).toBe(pirate.id)

    pirate.cloaked = true
    expect(cycleTarget(world, null)).toBeNull()
  })
})
