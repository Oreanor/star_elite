import { describe, expect, it } from 'vitest'
import { CHARACTER } from '../../config/character'
import { HUMAN_SPECIES } from '../../config/galaxy'
import {
  DEFAULT_PERSONA,
  isLegalPersona,
  isLegalProfile,
  personaPointsSpent,
  type Disposition,
  type PilotProfile,
} from './persona'

/**
 * Один валидатор — и для экрана создания, и для СЕРВЕРА: присланный профиль нельзя
 * накрутить. Тестируем правило (пул очков, шкала, допустимые тона), а не магические
 * числа: сами константы (`BASE/POOL/MAX`) берём из конфига, чтобы тест пережил их
 * перебалансировку.
 */
describe('валидатор создания персонажа', () => {
  it('дефолт легален: пять осей по (3−BASE), в пул укладывается', () => {
    // Пять покупаемых осей, каждая на 3 при BASE=2 → по одной цене за ось.
    expect(personaPointsSpent(DEFAULT_PERSONA)).toBe(5 * (3 - CHARACTER.BASE))
    expect(isLegalPersona(DEFAULT_PERSONA)).toBe(true)
  })

  it('перебор пула — незаконно', () => {
    // Все оси в потолок: заведомо дороже пула.
    const maxed = {
      ...DEFAULT_PERSONA,
      intellect: CHARACTER.MAX,
      charisma: CHARACTER.MAX,
      willpower: CHARACTER.MAX,
      agility: CHARACTER.MAX,
      accuracy: CHARACTER.MAX,
    }
    expect(personaPointsSpent(maxed)).toBeGreaterThan(CHARACTER.POOL)
    expect(isLegalPersona(maxed)).toBe(false)
  })

  it('перераспределение в пределах пула — законно', () => {
    // Опустили одну ось до базы (0 очков), подняли другую — суммарно в пул.
    const shifted = { ...DEFAULT_PERSONA, intellect: CHARACTER.BASE, agility: CHARACTER.MAX }
    expect(personaPointsSpent(shifted)).toBeLessThanOrEqual(CHARACTER.POOL)
    expect(isLegalPersona(shifted)).toBe(true)
  })

  it('вне шкалы — незаконно', () => {
    expect(isLegalPersona({ ...DEFAULT_PERSONA, intellect: CHARACTER.MAX + 1 })).toBe(false)
    expect(isLegalPersona({ ...DEFAULT_PERSONA, willpower: CHARACTER.MIN - 1 })).toBe(false)
    expect(isLegalPersona({ ...DEFAULT_PERSONA, accuracy: 2.5 })).toBe(false)
  })

  it('битый тон (не из enum) — незаконно', () => {
    const badTone = { ...DEFAULT_PERSONA, disposition: 'nope' as unknown as Disposition }
    expect(isLegalPersona(badTone)).toBe(false)
  })

  it('профиль: имя, доступный вид и выбранная профессия обязательны', () => {
    const ok: PilotProfile = {
      name: 'Рэй',
      persona: { ...DEFAULT_PERSONA, species: HUMAN_SPECIES, profession: 'traveler' },
    }
    expect(isLegalProfile(ok)).toBe(true)
    expect(isLegalProfile({ ...ok, name: '   ' })).toBe(false)
    expect(isLegalProfile({ ...ok, persona: { ...ok.persona, species: 'Марсиане' } })).toBe(false)
    // Игрок ОБЯЗАН назваться кем-то: профиль без профессии или с битой — незаконен.
    expect(isLegalProfile({ ...ok, persona: { ...ok.persona, profession: undefined } })).toBe(false)
    expect(isLegalProfile({ ...ok, persona: { ...ok.persona, profession: 'wizard' as never } })).toBe(false)
  })
})
