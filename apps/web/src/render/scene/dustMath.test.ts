import { describe, expect, it } from 'vitest'
import { DUST } from '../config'
import { dustExtents, wrapUnit } from './dustMath'

/**
 * Пыль на ПРЕДЕЛЬНЫХ скоростях и масштабах.
 *
 * Крейсер выходит на девять гигаметров в секунду, миелофон раздувает борт до 1e15.
 * Их произведение раньше рвало картинку: то пыль схлопывалась в точку, то иголки
 * вставали колом. Здесь заперты числовые инварианты, чтобы правки не вернули этого.
 */

const dt = 1 / 60
// Покой → манёвр → бой → досвет → крейсерский потолок (~9 Гм/с).
const SPEEDS = [0, 1, 200, 1_000_000, 9e9]
// Обычный → до предела масштаба миелофона (MIELOPHONE.MAX_SCALE).
const GROWS = [1, 1e3, 1e8, 1e15]

describe('пыль на предельных скоростях и масштабах', () => {
  it('всё конечно и неотрицательно при любой паре (скорость, масштаб)', () => {
    for (const s of SPEEDS)
      for (const g of GROWS) {
        const e = dustExtents(s, dt, g)
        for (const v of [e.box, e.streak, e.tail, e.rate]) {
          expect(Number.isFinite(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(0)
        }
      }
  })

  it('штрих не длиннее доли куба — не пробивает стенку ни на какой скорости', () => {
    for (const s of SPEEDS)
      for (const g of GROWS) {
        const e = dustExtents(s, dt, g)
        expect(e.streak).toBeLessThanOrEqual(e.box * DUST.STREAK_FRACTION + 1e-3)
      }
  })

  /**
   * Ключевой инвариант починки: темп «проноса» пыли задаёт БАЗОВЫЙ куб и от масштаба
   * НЕ зависит. Иначе на большом кубе частица за кадр почти не сдвигается — иголки
   * стоят колом вместо того, чтобы нестись. `rate` обязан быть одним при любом grow.
   */
  it('темп проноса (rate) не зависит от масштаба', () => {
    for (const s of SPEEDS) {
      const base = dustExtents(s, dt, 1).rate
      for (const g of GROWS) expect(dustExtents(s, dt, g).rate).toBeCloseTo(base)
    }
  })

  /** В покое куб не схлопывается в точку: остаётся `DUST.BOX`, лишь умноженный на масштаб. */
  it('в покое куб равен DUST.BOX × grow', () => {
    expect(dustExtents(0, dt, 1).box).toBe(DUST.BOX)
    expect(dustExtents(0, dt, 5).box).toBe(DUST.BOX * 5)
  })

  /** Куб и штрих растут с масштабом СИНХРОННО: их отношение (угловая длина штриха) постоянно. */
  it('отношение штрих/куб не зависит от масштаба — картинка та же, крупнее', () => {
    for (const s of SPEEDS) {
      if (s === 0) continue
      const small = dustExtents(s, dt, 1)
      const big = dustExtents(s, dt, 1e8)
      expect(big.streak / big.box).toBeCloseTo(small.streak / small.box)
    }
  })

  /** В покое хвоста нет: делить на нулевую скорость нельзя, иначе NaN разъедет буфер. */
  it('в покое хвост нулевой (без деления на ноль)', () => {
    expect(dustExtents(0, dt, 1e8).tail).toBe(0)
  })

  it('обёртка держит долю в [-0.5, 0.5] даже на огромных смещениях', () => {
    for (const u of [-3.2, -0.5, 0, 0.4, 0.5, 1e6 + 0.3, -1e9 - 0.2]) {
      const w = wrapUnit(u)
      expect(w).toBeGreaterThanOrEqual(-0.5)
      expect(w).toBeLessThanOrEqual(0.5)
    }
  })
})
