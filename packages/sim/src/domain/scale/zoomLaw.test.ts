import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { quietWorld } from '../../testkit'
import { gravityAccel } from '../flight/gravity'
import { beamExposure } from '../world/beams'
import { bodyZoom } from './scale'

/**
 * ЗАКОН ЗУМА — один на картинку, твердь, жар, притяжение и лучи: выросшему борту звезда
 * меньше ВО ВСЁМ. Пойманное: рост у звезды — она на экране съёживалась, а притяжение и жар
 * считались по НАСТОЯЩЕМУ радиусу: борт вяз и «терялся» у далёкой точки.
 */
describe('закон зума', () => {
  it('притяжение звезды — у видимой: изнутри настоящей сферы выросшего не тянет в центр', () => {
    const world = quietWorld()
    const star = world.bodies.find((b) => b.kind === 'star')!
    const p = world.player
    // Внутри настоящего радиуса звезды.
    p.state.pos.copy(star.pos).add(new Vector3(star.radius * 0.6, 0, 0))
    const pull = new Vector3()
    p.state.scale = 1
    const small = gravityAccel(p, star, pull).length()
    p.state.scale = 100
    // Видимая звезда — далеко: за краем её (меньшей) зоны притяжения тяги нет вовсе.
    expect(star.radius * 0.6).toBeGreaterThan(star.radius * bodyZoom(star, 100) * 3)
    expect(gravityAccel(p, star, pull).length()).toBe(0)
    expect(small).toBeGreaterThan(0)
  })

  it('луч (джет) выросшему короче — не жжёт там, где на экране его нет', () => {
    const world = quietWorld()
    const star = world.bodies.find((b) => b.kind === 'star')!
    star.spin = 0
    star.beams = { axis: new Vector3(0, 1, 0), length: star.radius * 40, halfAngle: 0.05 }
    const p = world.player
    p.state.pos.copy(star.pos).add(new Vector3(0, star.radius * 20, 0))
    p.state.scale = 1
    expect(beamExposure(p, world)).toBeGreaterThan(0)
    p.state.scale = 100
    expect(beamExposure(p, world)).toBe(0)
  })
})
