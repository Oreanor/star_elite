import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { STAR_HEAT } from '../../config/heat'
import { MIELOPHONE } from '../../config/mielophone'
import { type World } from '../world'
import { starExposure, stepStarHeat } from './starheat'
import { bodyZoom } from '../scale/scale'
import { quietWorld } from '../../testkit'

/**
 * Нагрев корпуса звездой.
 *
 * Подойти можно, прижаться — нельзя: у короны корпус калится, и на полном жару РАЗРУШАЕТСЯ
 * РАЗОМ — «отсидеться под щитом» нельзя, спасает только манёвр. Проверяем не числа (они
 * переживут перебалансировку плохо), а СВОЙСТВА: вдали холодно, у короны жарко, до самого
 * порога корпус цел, на пороге гибнет мгновенно, отвернул — остыл без потерь.
 */

const DT = 1 / 120

/** Ставит игрока на высоту `ratio` радиусов над поверхностью звезды. */
function place(world: World, ratio: number): void {
  const star = world.bodies.find((b) => b.kind === 'star')!
  world.player.state.pos.copy(star.pos).add(new Vector3(star.radius * (1 + ratio), 0, 0))
}

function cook(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    world.time += DT
    stepStarHeat(world.player, world, DT)
  }
}

describe('нагрев у звезды', () => {
  it('вдали от светила корпус не греется вовсе', () => {
    const world = quietWorld() // старт — 150 млн км от звезды
    cook(world, 30)
    expect(world.player.hullHeat).toBeCloseTo(0, 2)
    expect(world.player.shield).toBe(world.player.spec.hull.shield)
    expect(world.player.hull).toBe(world.player.spec.hull.hull)
  })

  it('облучение растёт по мере приближения к короне', () => {
    const world = quietWorld()
    place(world, 2)
    const far = starExposure(world.player, world)
    place(world, 0.1)
    const near = starExposure(world.player, world)

    expect(far).toBe(0) // выше SAFE_RATIO звезда не греет
    expect(near).toBeGreaterThan(0.9) // у самой короны — почти максимум
  })

  it('зона задана в РАДИУСАХ: у карлика и у гиганта опасная высота своя', () => {
    // Один и тот же корабль на одной доле радиуса облучён одинаково, каким бы ни
    // был размер звезды. Меняем радиус светила и проверяем, что облучение то же.
    const world = quietWorld()
    const star = world.bodies.find((b) => b.kind === 'star')!

    place(world, 0.5)
    const asIs = starExposure(world.player, world)

    star.radius *= 3
    place(world, 0.5) // снова 0.5 радиуса, но радиус теперь втрое больше
    const bigger = starExposure(world.player, world)

    expect(bigger).toBeCloseTo(asIs, 5)
  })

  it('в масштабе (миелофон) корона — у ВИДИМОЙ звезды: той же доли её радиуса', () => {
    // Гигант видит звезду меньше (закон зума `bodyZoom`), и корона меньше с ней: жжёт на той же
    // доле ВИДИМОГО радиуса, а не настоящего.
    const world = quietWorld()
    const star = world.bodies.find((b) => b.kind === 'star')!
    world.player.state.scale = 100
    const seen = star.radius * bodyZoom(star, 100)
    world.player.state.pos.copy(star.pos).add(new Vector3(seen * 1.1, 0, 0))
    expect(starExposure(world.player, world)).toBeGreaterThan(0.9)
    world.player.state.pos.copy(star.pos).add(new Vector3(seen * 3, 0, 0))
    expect(starExposure(world.player, world)).toBe(0)
  })

  it('выросший внутри НАСТОЯЩЕЙ сферы, но вдали от видимой — не горит', () => {
    // Пойманный баг: высоту мерили от настоящей поверхности и лишь домножали на масштаб.
    // Выросший рядом со звездой оказывался внутри её настоящего радиуса — высота отрицательна,
    // жар максимальный, «корабль потерян» у светила, которое на экране было далёкой точкой.
    const world = quietWorld()
    const star = world.bodies.find((b) => b.kind === 'star')!
    world.player.state.scale = 100
    world.player.state.pos.copy(star.pos).add(new Vector3(star.radius * 0.6, 0, 0))
    expect(starExposure(world.player, world)).toBe(0)
  })

  it('до самого порога корпус ЦЕЛ, а на пороге — мгновенная «потеря» (не постепенная течь)', () => {
    const world = quietWorld()
    place(world, 0.05) // глубоко в короне: облучение максимально, нагрев дойдёт до порога
    const p = world.player
    const star = world.bodies.find((b) => b.kind === 'star')!

    let lostAt = -1
    for (let i = 0; i < 120 * 60 && p.lastLostAt < 0; i++) {
      world.time += DT
      const before = p.hullHeat
      stepStarHeat(p, world, DT)
      // Пока не достигли порога разрушения — ни щит, ни обшивка не тронуты: течи нет вовсе.
      if (before < STAR_HEAT.DESTROY && p.lastLostAt < 0) {
        expect(p.shield).toBe(p.spec.hull.shield)
        expect(p.hull).toBe(p.spec.hull.hull)
      }
      if (p.lastLostAt >= 0 && lostAt < 0) lostAt = i
    }

    // Игрок не уходит в Game Over: полные щиты и штамп «корона · звезда».
    expect(lostAt).toBeGreaterThan(0)
    expect(p.alive).toBe(true)
    expect(p.shield).toBe(p.spec.hull.shield)
    expect(p.hull).toBe(p.spec.hull.hull)
    expect(p.lastLostHit).toEqual({ kind: 'heat', name: star.name })
  })

  it('отвернул — остыл, и потерь корпуса за короткий жар нет', () => {
    const world = quietWorld()
    place(world, 0.1)
    cook(world, 7) // прогрелись выше половины, но до порога разрушения далеко
    const heated = world.player.hullHeat
    expect(heated).toBeGreaterThan(0.5)

    place(world, 4) // ушли за SAFE_RATIO
    cook(world, 10)
    expect(world.player.hullHeat).toBeLessThan(0.05)
    // Порога разрушения не достигли — обшивка не тронута вовсе: побег спасает целиком.
    expect(world.player.hull).toBe(world.player.spec.hull.hull)
  })

  /**
   * Нагрев — свойство мира, а не привилегия игрока: греется любой корабль.
   * Иначе «игрок и бот неотличимы для физики» перестало бы быть правдой.
   */
  it('греется любой корабль, а не только игрок', () => {
    const world = quietWorld()
    const bot = world.ships[0]
    if (!bot) return // патрулей нет в тихом мире — тогда проверять нечего
    const star = world.bodies.find((b) => b.kind === 'star')!
    bot.state.pos.copy(star.pos).add(new Vector3(star.radius * 1.1, 0, 0))
    for (let i = 0; i < 120 * 5; i++) {
      world.time += DT
      stepStarHeat(bot, world, DT)
    }
    expect(bot.hullHeat).toBeGreaterThan(0.3)
  })
  it('на галактическом × корона и лучи не греют: гигант сквозь звезду не перегревается', () => {
    // Пойманное: за GHOST_BODY касание звезды выключено, а жар — нет. Высота внутри
    // светила отрицательна, и проходящий сквозь него гигант ловил «критический перегрев».
    const world = quietWorld()
    const star = world.bodies.find((b) => b.kind === 'star')!
    const p = world.player
    p.state.scale = MIELOPHONE.GHOST_BODY_SCALE
    p.state.pos.copy(star.pos) // в самом центре светила
    p.hullHeat = 0.5
    for (let i = 0; i < 600; i++) stepStarHeat(p, world, 1 / 120)
    expect(p.alive).toBe(true)
    expect(p.hullHeat).toBeLessThan(0.5)
  })
})
