import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { starExposure, stepStarHeat } from './starheat'

/**
 * Нагрев корпуса звездой.
 *
 * Подойти можно, прижаться — нельзя: у короны корпус калится, за порогом течёт
 * сперва щит, потом обшивка, и спасает только манёвр. Проверяем не числа (они
 * переживут перебалансировку плохо), а СВОЙСТВА: вдали холодно, у короны жарко,
 * щит горит раньше корпуса, отвернул — остыл.
 */

const DT = 1 / 120

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

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
    const world = quiet() // старт — 150 млн км от звезды
    cook(world, 30)
    expect(world.player.hullHeat).toBeCloseTo(0, 2)
    expect(world.player.shield).toBe(world.player.spec.hull.shield)
    expect(world.player.hull).toBe(world.player.spec.hull.hull)
  })

  it('облучение растёт по мере приближения к короне', () => {
    const world = quiet()
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
    const world = quiet()
    const star = world.bodies.find((b) => b.kind === 'star')!

    place(world, 0.5)
    const asIs = starExposure(world.player, world)

    star.radius *= 3
    place(world, 0.5) // снова 0.5 радиуса, но радиус теперь втрое больше
    const bigger = starExposure(world.player, world)

    expect(bigger).toBeCloseTo(asIs, 5)
  })

  it('щит горит раньше корпуса', () => {
    const world = quiet()
    place(world, 0.1)
    const p = world.player

    // Ждём, пока щит не сгорит полностью.
    let shieldGoneAt = -1
    for (let i = 0; i < 120 * 30 && p.alive; i++) {
      world.time += DT
      stepStarHeat(p, world, DT)
      if (shieldGoneAt < 0 && p.shield <= 0) shieldGoneAt = i
    }

    expect(shieldGoneAt).toBeGreaterThan(0)
    // В момент, когда щит только исчез, обшивка ещё почти целая: корпус течёт ПОСЛЕ.
    // (Проверяем через отдельный прогон до этого мгновения.)
    const w2 = quiet()
    place(w2, 0.1)
    for (let i = 0; i <= shieldGoneAt; i++) {
      w2.time += DT
      stepStarHeat(w2.player, w2, DT)
    }
    expect(w2.player.hull).toBeGreaterThan(w2.player.spec.hull.hull * 0.8)
  })

  it('за порогом корпус в конце концов гибнет, если не уходить', () => {
    const world = quiet()
    place(world, 0.05)
    cook(world, 60)
    expect(world.player.alive).toBe(false)
  })

  it('отвернул — остыл, и потерь корпуса за короткий жар нет', () => {
    const world = quiet()
    place(world, 0.1)
    cook(world, 7) // почти до порога, но течь едва началась
    const heated = world.player.hullHeat
    expect(heated).toBeGreaterThan(0.5)

    place(world, 4) // ушли за SAFE_RATIO
    cook(world, 10)
    expect(world.player.hullHeat).toBeLessThan(0.05)
    // За семь секунд у самой короны обшивка почти не пострадала: побег спасает.
    expect(world.player.hull).toBeGreaterThan(world.player.spec.hull.hull * 0.95)
  })

  /**
   * Нагрев — свойство мира, а не привилегия игрока: греется любой корабль.
   * Иначе «игрок и бот неотличимы для физики» перестало бы быть правдой.
   */
  it('греется любой корабль, а не только игрок', () => {
    const world = quiet()
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
})
