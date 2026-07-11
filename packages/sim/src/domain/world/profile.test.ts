import { describe, expect, it } from 'vitest'
import { HUMAN_SPECIES, PLAYABLE_SPECIES, SYNTH_SPECIES } from '../../config/galaxy'
import { applyPlayerSave, serializePlayer } from '../save'
import { createWorld, STARTER_SYSTEM } from '.'
import type { PilotProfile } from './persona'

/** Выбор игрока на экране создания: синтет с приметной личностью и лицом. */
const KAIRA: PilotProfile = {
  name: 'Кайра',
  persona: {
    disposition: 'brave',
    intellect: 4,
    temperament: 2,
    charisma: 5,
    willpower: 3,
    agility: 3,
    accuracy: 4,
    species: SYNTH_SPECIES,
    portrait: 17,
    profession: 'explorer',
  },
}

describe('создание персонажа', () => {
  it('ровно три вида на выбор, земляне первыми', () => {
    expect(PLAYABLE_SPECIES).toEqual([HUMAN_SPECIES, 'Гуманоиды', SYNTH_SPECIES])
  })

  it('профиль открывает имя и ставит выбранную личность, лицо и профессию', () => {
    const w = createWorld(STARTER_SYSTEM, KAIRA)
    // Имя игрока открыто сразу — это ТЫ, не незнакомец с радара.
    expect(w.player.name).toBe('Кайра')
    expect(w.player.pilotName).toBe('Кайра')
    expect(w.player.persona.species).toBe(SYNTH_SPECIES)
    expect(w.player.persona.disposition).toBe('brave')
    expect(w.player.persona.portrait).toBe(17)
    expect(w.player.persona.profession).toBe('explorer')
  })

  it('без профиля — землянин по умолчанию, лицо не выбрано', () => {
    const w = createWorld(STARTER_SYSTEM)
    expect(w.player.persona.species).toBe(HUMAN_SPECIES)
    // Портрет не задан — у безымянного дефолта лицо возьмётся хешем, как у NPC.
    expect(w.player.persona.portrait).toBeUndefined()
  })

  it('корабль у выбора и у дефолта ОДИН — отличается только пилот', () => {
    const chosen = createWorld(STARTER_SYSTEM, KAIRA)
    const plain = createWorld(STARTER_SYSTEM)
    expect(chosen.player.loadout.chassis.id).toBe(plain.player.loadout.chassis.id)
    expect(chosen.player.spec.hull.hull).toBe(plain.player.spec.hull.hull)
  })

  it('имя, вид, лицо и профессия переживают сейв', () => {
    const src = createWorld(STARTER_SYSTEM, KAIRA)
    const dst = createWorld(STARTER_SYSTEM)
    applyPlayerSave(dst, serializePlayer(src))
    expect(dst.player.name).toBe('Кайра')
    expect(dst.player.persona.species).toBe(SYNTH_SPECIES)
    expect(dst.player.persona.portrait).toBe(17)
    expect(dst.player.persona.profession).toBe('explorer')
  })
})
