import { describe, expect, it } from 'vitest'
import { MIELOPHONE } from '@elite/sim'
import { GALAXY } from '@elite/sim'
import { CAMERA, GALAXY_LAYER, GIANT_RENDER_CAP } from './config'
import { galaxyStarSizeMul, galaxyViewMetersPerLy, starLayerRadiusLy, starRadiusFactor, starWorldShrink } from './worldShrink'

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
    // Гладко = без ступенек: наклон в логарифмах (степень) один на всём отрезке.
    const slope = (a: number, b: number) =>
      Math.log(galaxyViewMetersPerLy(b) / galaxyViewMetersPerLy(a)) / Math.log(b / a)
    const k = slope(fade, lock)
    for (let s = fade; s * 1.01 <= lock; s *= 1.01) {
      expect(slope(s, s * 1.01)).toBeCloseTo(k, 6)
      expect(galaxyViewMetersPerLy(s * 1.01)).toBeLessThan(GALAXY_LAYER.LY_TO_M / (s * 1.01))
    }
    expect(k).toBeLessThan(-1) // сжимается быстрее домена (1/scale)
  })

  it('на потолке камера «отъезжает» дальше поперечника галактики — та видна целиком', () => {
    // Сжатие кадра вокруг борта = отъезд камеры; на экране меняется лишь то, что ближе
    // отъезда в св.г. С калибровкой 8000 м/св.г на потолке выходило 12 св.г — изнутри
    // галактики радиусом 92, и вид с ×4·10⁵ до потолка стоял.
    const [ox, oy, oz] = CAMERA.CHASE_OFFSET
    const camera = Math.hypot(ox, oy, oz) * GIANT_RENDER_CAP
    const pulledLy = camera / galaxyViewMetersPerLy(lock)
    expect(pulledLy).toBeGreaterThan(2 * GALAXY.RADIUS_LY)
  })
})

describe('звезда слоя за порогом', () => {
  // Баг: радиус 10/scale в СЖАТЫХ метрах слоя при сжатых же расстояниях давал постоянный
  // угловой размер — звезда переставала уменьшаться, полы пикселей делали ступеньки.
  const fade = GALAXY_LAYER.FADE_IN_START

  it('на пороге — без шва, дальше угловой размер ∝ 1/scale', () => {
    expect(galaxyStarSizeMul(fade)).toBe(1)
    for (const s of [fade * 2, 4e5, 1e6, GALAXY_LAYER.LOCK_SCALE]) {
      expect(galaxyStarSizeMul(s) * s).toBeCloseTo(fade, 6)
    }
  })
})

