import { describe, expect, it } from 'vitest'
import { MIELOPHONE } from '@elite/sim'
import { GALAXY_LAYER } from './config'
import { galaxyViewMetersPerLy, starLayerRadiusLy, starRadiusFactor, starWorldShrink } from './worldShrink'

/**
 * Баг: системная звезда честно сжималась с ростом, а на пороге галактики слой
 * подменял её шаром полного радиуса — и только что исчезнувшая точка снова
 * закрывала кадр. Кривая одна на всю дорогу: R·INFLATE/scale, без возврата к R.
 */

describe('видимый радиус звезды на росте', () => {
  const ghost = MIELOPHONE.GHOST_BODY_SCALE
  const inflate = GALAXY_LAYER.STAR_INFLATE
  const sun = 6.96e8

  it('после полки сжимается как INFLATE/scale и не раздувается обратно', () => {
    expect(starRadiusFactor(1)).toBe(1)
    expect(starRadiusFactor(inflate)).toBe(1)
    expect(starRadiusFactor(90)).toBeCloseTo(inflate / 90)
    let prev = starRadiusFactor(inflate)
    for (const s of [90, ghost, 5e4, 1e6, 1e8]) {
      const f = starRadiusFactor(s)
      expect(f).toBeCloseTo(inflate / s)
      expect(f).toBeLessThan(prev)
      prev = f
    }
  })

  it('на пороге шар слоя продолжает радиус системы, а не честный R', () => {
    const layerScale = GALAXY_LAYER.LY_TO_M / ghost
    const worldR = starLayerRadiusLy(sun, layerScale) * layerScale
    const systemR = sun * starWorldShrink(ghost - 1)

    expect(worldR).toBeCloseTo((sun * inflate) / ghost)
    expect(systemR / worldR).toBeCloseTo(ghost / (ghost - 1))
    expect(sun / worldR).toBeGreaterThan(100)

    const laterScale = GALAXY_LAYER.LY_TO_M / (ghost * 10)
    const later = starLayerRadiusLy(sun, laterScale) * laterScale
    expect(later).toBeCloseTo(worldR / 10)
  })
})

describe('кадр галактики на росте', () => {
  // Баг: с ×2·10⁵ до потолка галактика на глаз стояла — сжатие 1/scale вокруг борта при
  // упёртой в потолок камере не меняет угловую картину. Кадр сжат сильнее, но без шва.
  const fade = GALAXY_LAYER.FADE_IN_START
  const lock = GALAXY_LAYER.LOCK_SCALE

  it('на пороге слоя совпадает с доменом — шва с системой нет', () => {
    expect(galaxyViewMetersPerLy(fade)).toBeCloseTo(GALAXY_LAYER.LY_TO_M / fade)
  })

  it('на потолке — калиброванный верх, дальше замирает', () => {
    expect(galaxyViewMetersPerLy(lock)).toBeCloseTo(GALAXY_LAYER.TOP_VIEW_M_PER_LY)
    expect(galaxyViewMetersPerLy(lock * 10)).toBe(galaxyViewMetersPerLy(lock))
  })

  it('убывает гладко и сильнее домена — галактика заметно отдаляется до самого верха', () => {
    let prev = galaxyViewMetersPerLy(fade)
    for (let s = fade * 1.01; s <= lock; s *= 1.01) {
      const v = galaxyViewMetersPerLy(s)
      expect(v).toBeLessThan(prev)
      expect(prev / v).toBeLessThan(1.03)
      expect(v).toBeLessThan(GALAXY_LAYER.LY_TO_M / s)
      prev = v
    }
  })
})
