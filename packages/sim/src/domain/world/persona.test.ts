import { describe, expect, it } from 'vitest'
import { HUMAN_SPECIES, SPECIES } from '../../config/galaxy'
import { makeRng } from '../../core/math'
import { createWorld } from './factory'
import { DISPOSITIONS, makePersona } from './persona'

/**
 * Персона — данные для торга, но раздаётся seeded-RNG, а значит обязана быть
 * детерминированной и в пределах шкалы. Иначе тот же сид дал бы разный характер,
 * и по сети корабли разъехались бы личностями.
 */
describe('persona', () => {
  it('черты лежат в шкале 1..5, нрав — из списка', () => {
    const rng = makeRng(1234)
    for (let i = 0; i < 200; i++) {
      const p = makePersona(rng)
      expect(DISPOSITIONS).toContain(p.disposition)
      for (const v of [p.intellect, p.temperament, p.charisma, p.willpower]) {
        expect(v).toBeGreaterThanOrEqual(1)
        expect(v).toBeLessThanOrEqual(5)
        expect(Number.isInteger(v)).toBe(true)
      }
    }
  })

  it('один сид — одна личность', () => {
    const a = makePersona(makeRng(42))
    const b = makePersona(makeRng(42))
    expect(a).toEqual(b)
  })

  it('корабли мира рождаются с личностью, включая игрока', () => {
    const world = createWorld()
    expect(world.player.persona.disposition).toBeDefined()
    for (const ship of world.ships) {
      expect(ship.persona.intellect).toBeGreaterThanOrEqual(1)
    }
  })

  it('тот же сид мира — та же личность игрока', () => {
    expect(createWorld().player.persona).toEqual(createWorld().player.persona)
  })

  it('у пилота есть вид — человек или один из гуманоидов', () => {
    const known = new Set<string>([HUMAN_SPECIES, ...SPECIES.map((s) => s.name)])
    const rng = makeRng(7)
    for (let i = 0; i < 200; i++) expect(known.has(makePersona(rng).species)).toBe(true)
  })

  it('игрок — человек, а не случайный инопланетянин', () => {
    expect(createWorld().player.persona.species).toBe(HUMAN_SPECIES)
  })
})
