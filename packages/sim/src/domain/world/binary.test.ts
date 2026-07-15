import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GRAVITY } from '../../config/bodies'
import { GALAXY } from '../../config/galaxy'
import { generateGalaxy } from '../galaxy/generate'
import { systemDefFor } from '../galaxy/jump'
import { createWorld } from './index'
import type { BodyEntity, World } from './entities'
import { stepOrbits } from './orbits'

/**
 * Двойные звёзды.
 *
 * Пара обходит общий центр масс, и это движение ЧЕСТНОЕ: период выведен из массы
 * (ω=√(G·M/d³)), как у луны, а не назначен. Назначенный период дал бы звезде
 * сотни километров в секунду — она носилась бы мимо корабля быстрее ракеты.
 * Барицентр обязан стоять неподвижно, иначе вся система уползёт вслед за парой.
 */

/** Первая двойная с двумя звёздами. */
function someBinary(): { index: number; world: World; stars: [BodyEntity, BodyEntity] } {
  const galaxy = generateGalaxy(GALAXY.SEED)
  for (const sys of galaxy) {
    if (!sys.companion) continue
    const def = systemDefFor(sys.index, GALAXY.SEED)
    const world = createWorld({ ...def, patrols: [], belt: null })
    const stars = world.bodies.filter((b) => b.kind === 'star')
    if (stars.length === 2) return { index: sys.index, world, stars: [stars[0]!, stars[1]!] }
  }
  throw new Error('в галактике нет двойной из двух звёзд')
}

const starMass = (radius: number): number => GRAVITY.STAR_DENSITY * (4 / 3) * Math.PI * radius ** 3

function wait(world: World, seconds: number): void {
  world.time += seconds
  stepOrbits(world)
}

describe('двойные звёзды', () => {
  it('двойные встречаются примерно у пятой части систем', () => {
    const galaxy = generateGalaxy(GALAXY.SEED)
    const share = galaxy.filter((s) => s.companion).length / galaxy.length
    expect(share).toBeGreaterThan(0.12)
    expect(share).toBeLessThan(0.28)
  })

  it('спутник не крупнее главной и не экзотический', () => {
    for (const s of generateGalaxy(GALAXY.SEED)) {
      if (!s.companion) continue
      // Главной зовут более массивную — значит и более крупную.
      expect(s.companion.radius).toBeLessThanOrEqual(s.star.radius)
      // Только главная последовательность: топливо у пары есть у обеих.
      expect(s.companion.scoopable).toBe(true)
    }
  })

  it('бывают и близнецы, и разноцветные пары — три сорта, а не один штамп', () => {
    let twins = 0
    let mixed = 0
    let redDwarfPairs = 0
    for (const s of generateGalaxy(GALAXY.SEED)) {
      if (!s.companion) continue
      if (s.companion.class === s.star.class) {
        twins++
        if (s.star.class === 'M') redDwarfPairs++
      } else {
        mixed++
        // Спутник всегда холоднее (дальше по списку), а не горячее главной.
        expect(s.companion.radius).toBeLessThan(s.star.radius)
      }
    }
    // Все три сорта должны встречаться, иначе «разнообразие» — пустой звук.
    expect(twins).toBeGreaterThan(0)
    expect(mixed).toBeGreaterThan(0)
    expect(redDwarfPairs).toBeGreaterThan(0)
  })

  it('обе обращаются вокруг барицентра, а не одна вокруг другой', () => {
    const { stars } = someBinary()
    for (const star of stars) {
      expect(star.orbit).not.toBeNull()
      // Родитель — барицентр (null), а не второе тело: у центра масс нет id.
      expect(star.orbit!.parentId).toBeNull()
    }
    // Идут с одной угловой скоростью — иначе разъедутся, а не кружат парой.
    expect(stars[0].orbit!.rate).toBeCloseTo(stars[1].orbit!.rate, 12)
  })

  it('центр масс неподвижен, пока пара кружит', () => {
    const { world, stars } = someBinary()
    const [a, b] = stars
    const ma = starMass(a.radius)
    const mb = starMass(b.radius)

    const centre = new Vector3()
    const first = new Vector3()
    let drift = 0
    // Мотаем ВРЕМЯ одного мира по суткам: положение следует из него.
    for (let day = 0; day <= 30; day++) {
      wait(world, 86_400)
      centre.copy(a.pos).multiplyScalar(ma).addScaledVector(b.pos, mb).divideScalar(ma + mb)
      if (day === 0) first.copy(centre)
      drift = Math.max(drift, centre.distanceTo(first))
    }
    // Разнос пары — миллионы километров; центр не должен гулять и на метр.
    expect(drift).toBeLessThan(1)
  })

  /**
   * Период выводится из массы и выходит в дни, как у настоящих тесных пар.
   * Если бы кто-то «ускорил для красоты» до минут, звезда пошла бы сотни км/с —
   * этот тест поймает такую правку.
   */
  it('период — дни, а не минуты: движение честное', () => {
    const { stars } = someBinary()
    const days = (2 * Math.PI) / stars[0].orbit!.rate / 86_400
    expect(days).toBeGreaterThan(0.3)
    expect(days).toBeLessThan(60)
  })

  it('пара разнесена, но не касается: это две звезды, а не контактная капля', () => {
    const { stars } = someBinary()
    const gap = stars[0].pos.distanceTo(stars[1].pos)
    expect(gap).toBeGreaterThan(stars[0].radius + stars[1].radius)
  })
})
