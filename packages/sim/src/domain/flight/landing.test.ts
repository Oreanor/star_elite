import { Euler, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { LANDING } from '../../config/landing'
import { ASTEROID } from '../../config/world'
import { PHYSICS } from '../../config/physics'
import { effectiveRadius } from '../scale/scale'
import { stepWorld } from '../sim/step'
import { createWorld, enterSystem, STARTER_SYSTEM, type AsteroidEntity, type BodyEntity, type World } from '../world'
import {
  armAutoland,
  canAutoland,
  landingCue,
  landingPromptTarget,
  meshSolidRadius,
  releaseLanding,
  stepLanding,
} from './landing'

const NO_CONTROLLERS = new Map()

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

/**
 * Тихий мир в системе, где стоит Люцифер (облик 0) и лежит его двор глыб. Число статуй —
 * бросок 0..COUNT_MAX по сиду системы, ноль законен, поэтому систему ищем перебором.
 */
function quietWithYard(): World {
  // ОДИН мир, в который переходим системами: `createWorld` в цикле слишком дорог.
  const world = quiet()
  for (let i = 0; i < 200; i++) {
    enterSystem(world, { ...STARTER_SYSTEM, patrols: [], belt: null }, i)
    if (world.monoliths.some((m) => m.variant === 0)) return world
  }
  throw new Error('не нашлось системы с двором Люцифера')
}

function moonOf(world: World): BodyEntity {
  const moon = world.bodies.find((body) => body.kind === 'moon')
  if (!moon) throw new Error('в системе нет луны')
  return moon
}

/** Заводит корабль в окно автопосадки над телом и крутит шаги, пока он не сядет. */
function landOn(world: World, body: BodyEntity): void {
  const player = world.player
  player.state.pos
    .copy(body.pos)
    .add(new Vector3(body.radius + effectiveRadius(player) + LANDING.HOVER_ALT, 0, 0))
  player.state.vel.set(0, 0, 0)
  player.controls.throttle = 0
  if (!armAutoland(world)) throw new Error('автопосадка не в окне высот')
  for (let i = 0; i < 3000 && !player.landedOn; i++) stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
}

function landableRock(world: World): AsteroidEntity {
  const minR = effectiveRadius(world.player) * LANDING.ASTEROID_MIN_SCALE
  const rock: AsteroidEntity = {
    id: world.ids.next(),
    kind: 'asteroid',
    pos: world.player.state.pos.clone().add(new Vector3(500, 0, 0)),
    vel: new Vector3(0, 0, 0),
    quat: new Quaternion().setFromEuler(new Euler(0, 0, 0)),
    spin: new Vector3(0, 0.4, 0),
    radius: minR + 5,
    hull: ASTEROID.HULL,
    shape: 0,
    alive: true,
  }
  world.asteroids.push(rock)
  return rock
}

describe('посадка на поверхность', () => {
  it('автопосадка на луну сажает так же, как на планету', () => {
    const world = quiet()
    const moon = moonOf(world)
    landOn(world, moon)

    expect(world.player.alive).toBe(true)
    expect(world.player.landedOn?.bodyId).toBe(moon.id)
  })

  it('на ховере высота держится у HOVER_ALT, пока луна уходит по орбите', () => {
    const world = quiet()
    const moon = moonOf(world)
    landOn(world, moon)
    const parent = world.bodies.find((body) => body.id === moon.orbit?.parentId)!
    const before = moon.pos.clone().sub(parent.pos)

    world.calendarTime += 10_000
    stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)

    expect(moon.pos.clone().sub(parent.pos).distanceTo(before)).toBeGreaterThan(1000)
    expect(world.player.landedOn?.bodyId).toBe(moon.id)
    const altitude =
      world.player.state.pos.distanceTo(moon.pos) - moon.radius - effectiveRadius(world.player)
    expect(altitude).toBeGreaterThan(LANDING.HOVER_ALT - LANDING.HOVER_BOB_AMP - 1)
    expect(altitude).toBeLessThan(LANDING.HOVER_ALT + LANDING.HOVER_BOB_AMP + 1)
  })

  it('после отрыва L ближайшее тело не уносит орбитальной скоростью', () => {
    const world = quiet()
    const moon = moonOf(world)
    landOn(world, moon)

    expect(releaseLanding(world.player, world)).toBe(true)

    for (let i = 0; i < 120; i++) {
      world.calendarTime += PHYSICS.FIXED_DT
      stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    }

    const altitude =
      world.player.state.pos.distanceTo(moon.pos) - moon.radius - effectiveRadius(world.player)
    expect(world.player.landedOn).toBeNull()
    expect(altitude).toBeGreaterThan(0)
    expect(altitude).toBeLessThan(5_000)
  })

  it('повторный L отлипает от поверхности', () => {
    const world = quiet()
    const moon = moonOf(world)
    landOn(world, moon)
    expect(releaseLanding(world.player, world)).toBe(true)
    expect(world.player.landedOn).toBeNull()
  })

  it('автопосадка сажает на крупный астероид', () => {
    const world = quiet()
    const rock = landableRock(world)
    const player = world.player
    const solid = meshSolidRadius(rock.radius)
    player.state.pos
      .copy(rock.pos)
      .add(new Vector3(solid + effectiveRadius(player) + LANDING.HOVER_ALT, 0, 0))
    player.state.vel.set(0, 0, 0)
    player.controls.throttle = 0
    expect(armAutoland(world)).toBe(true)
    for (let i = 0; i < 3000 && !player.landedOn; i++) {
      stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    }
    expect(player.alive).toBe(true)
    expect(player.landedOn?.bodyId).toBe(rock.id)
    expect(player.state.pos.distanceTo(rock.pos)).toBeCloseTo(
      solid + effectiveRadius(player) + LANDING.HOVER_ALT,
      3,
    )
  })

  it('мелкий астероид (меньше 10 корпусов) не притягивает к стоянке', () => {
    const world = quiet()
    const player = world.player
    const er = effectiveRadius(player)
    const pebble: AsteroidEntity = {
      id: world.ids.next(),
      kind: 'asteroid',
      pos: player.state.pos.clone().add(new Vector3(er * LANDING.ASTEROID_MIN_SCALE - 1, 0, 0)),
      vel: new Vector3(0, 0, 0),
      quat: new Quaternion().setFromEuler(new Euler(0, 0, 0)),
      spin: new Vector3(0, 0, 0),
      radius: er * LANDING.ASTEROID_MIN_SCALE - 1,
      hull: ASTEROID.HULL,
      shape: 0,
      alive: true,
    }
    // Уводим прочие шары, чтобы мелочь была единственным кандидатом рядом.
    for (const body of world.bodies) {
      if (body.kind === 'planet' || body.kind === 'moon') body.pos.add(new Vector3(1e9, 0, 0))
    }
    world.asteroids.push(pebble)
    player.state.pos
      .copy(pebble.pos)
      .add(new Vector3(meshSolidRadius(pebble.radius) + er + LANDING.HOVER_ALT, 0, 0))
    expect(canAutoland(world)).toBe(false)
  })

  it('на статую стоянка не предлагается', () => {
    const world = quietWithYard()
    const statue = world.monoliths[0]
    expect(statue).toBeDefined()
    const player = world.player
    // Уводим прочие шары далеко, чтобы ближайшей «поверхностью» была только статуя.
    for (const body of world.bodies) {
      if (body.kind === 'planet' || body.kind === 'moon') {
        body.pos.add(new Vector3(1e9, 0, 0))
      }
    }
    for (const rock of world.scenicRocks) rock.pos.add(new Vector3(1e9, 0, 0))
    player.state.pos
      .copy(statue!.pos)
      .add(new Vector3(statue!.radius + effectiveRadius(player) + LANDING.HOVER_ALT, 0, 0))
    player.state.vel.set(0, 0, 0)
    expect(canAutoland(world)).toBe(false)
    expect(armAutoland(world)).toBe(false)
  })

  it('автопосадка сажает на глыбу двора Люцифера', () => {
    const world = quietWithYard()
    const rock = world.scenicRocks[0]
    expect(rock).toBeDefined()
    const player = world.player
    const solid = meshSolidRadius(rock!.radius)
    player.state.pos
      .copy(rock!.pos)
      .add(new Vector3(solid + effectiveRadius(player) + LANDING.HOVER_ALT, 0, 0))
    player.state.vel.set(0, 0, 0)
    player.controls.throttle = 0
    expect(armAutoland(world)).toBe(true)
    for (let i = 0; i < 3000 && !player.landedOn; i++) {
      stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    }
    expect(player.alive).toBe(true)
    expect(player.landedOn?.bodyId).toBe(rock!.id)
  })

  /**
   * РЕГРЕССИЯ. В поясе глыб «ближайшая» часто чуть ниже окна и глушила
   * подсказку/L на соседнем камне в полосе — пилот не видел голубой пуш вовсе.
   */
  it('окно посадки смотрит на камень в полосе высот, а не на ближайший вне её', () => {
    const world = quiet()
    const player = world.player
    const close = landableRock(world)
    const inWindow = landableRock(world)
    const closeSolid = meshSolidRadius(close.radius)
    const windowSolid = meshSolidRadius(inWindow.radius)
    close.pos
      .copy(player.state.pos)
      .add(new Vector3(closeSolid + effectiveRadius(player) + 80, 0, 0))
    inWindow.pos
      .copy(player.state.pos)
      .add(new Vector3(windowSolid + effectiveRadius(player) + LANDING.HOVER_ALT, 0, 0))

    expect(canAutoland(world)).toBe(true)
    const target = landingPromptTarget(world)
    expect(target?.id).toBe(inWindow.id)
    expect(armAutoland(world)).toBe(true)
    expect(player.autoland).toBe(inWindow.id)
  })

  /**
   * РЕГРЕССИЯ. Отлип оставлял высоту ниже PROMPT_LO — повторный пуш «нажмите L»
   * не загорался, пока не уйдёшь и не зайдёшь в окно заново.
   */
  it('после взлёта снова в окне посадки — можно сесть повторно', () => {
    const world = quiet()
    const rock = landableRock(world)
    const player = world.player
    const solid = meshSolidRadius(rock.radius)
    player.state.pos
      .copy(rock.pos)
      .add(new Vector3(solid + effectiveRadius(player) + LANDING.HOVER_ALT, 0, 0))
    player.state.vel.set(0, 0, 0)
    expect(armAutoland(world)).toBe(true)
    for (let i = 0; i < 3000 && !player.landedOn; i++) {
      stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    }
    expect(player.landedOn?.bodyId).toBe(rock.id)

    expect(releaseLanding(player, world)).toBe(true)
    expect(player.landedOn).toBeNull()
    expect(canAutoland(world)).toBe(true)
    expect(landingCue(world)?.phase).toBe('prompt')
    expect(armAutoland(world)).toBe(true)
  })

  it('при scale > 1 стоянка не предлагается — окна высот не для миелофона', () => {
    const world = quiet()
    const moon = moonOf(world)
    const player = world.player
    player.state.pos
      .copy(moon.pos)
      .add(new Vector3(moon.radius + effectiveRadius(player) + LANDING.HOVER_ALT, 0, 0))
    player.state.vel.set(0, 0, 0)
    expect(canAutoland(world)).toBe(true)

    player.state.scale = 1.5
    expect(canAutoland(world)).toBe(false)
    expect(landingCue(world)).toBeNull()
    expect(armAutoland(world)).toBe(false)
  })

  it('на 1000…600 м — жёлтая подготовка, на 600…400 м — можно жать L', () => {
    const world = quiet()
    const rock = landableRock(world)
    const player = world.player
    const er = effectiveRadius(player)
    const solid = meshSolidRadius(rock.radius)

    rock.pos
      .copy(player.state.pos)
      .add(new Vector3(solid + er + (LANDING.PROMPT_HI + LANDING.APPROACH_HI) / 2, 0, 0))
    const prep = landingCue(world)
    expect(prep?.phase).toBe('approach')
    expect(prep?.id).toBe(rock.id)
    expect(canAutoland(world)).toBe(false)

    rock.pos
      .copy(player.state.pos)
      .add(new Vector3(solid + er + LANDING.HOVER_ALT, 0, 0))
    const ready = landingCue(world)
    expect(ready?.phase).toBe('prompt')
    expect(canAutoland(world)).toBe(true)
  })

  it('на ховере высота легко покачивается вокруг HOVER_ALT', () => {
    const world = quiet()
    const rock = landableRock(world)
    const player = world.player
    const solid = meshSolidRadius(rock.radius)
    player.state.pos
      .copy(rock.pos)
      .add(new Vector3(solid + effectiveRadius(player) + LANDING.HOVER_ALT, 0, 0))
    player.state.vel.set(0, 0, 0)
    expect(armAutoland(world)).toBe(true)
    for (let i = 0; i < 3000 && !player.landedOn; i++) {
      stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    }
    expect(player.landedOn?.bodyId).toBe(rock.id)

    let minAlt = Infinity
    let maxAlt = -Infinity
    for (let i = 0; i < 600; i++) {
      stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
      const alt =
        player.state.pos.distanceTo(rock.pos) - solid - effectiveRadius(player)
      minAlt = Math.min(minAlt, alt)
      maxAlt = Math.max(maxAlt, alt)
    }
    expect(maxAlt - minAlt).toBeGreaterThan(LANDING.HOVER_BOB_AMP * 0.5)
    expect(minAlt).toBeGreaterThan(LANDING.HOVER_ALT - LANDING.HOVER_BOB_AMP - 2)
    expect(maxAlt).toBeLessThan(LANDING.HOVER_ALT + LANDING.HOVER_BOB_AMP + 2)
  })

  it('на ховере тяга ведёт вдоль сферы и не отрывает без ×ESCAPE', () => {
    const world = quiet()
    const rock = landableRock(world)
    const player = world.player
    const solid = meshSolidRadius(rock.radius)
    const er = effectiveRadius(player)
    player.state.pos
      .copy(rock.pos)
      .add(new Vector3(solid + er + LANDING.HOVER_ALT, 0, 0))
    player.state.vel.set(0, 0, 0)
    expect(armAutoland(world)).toBe(true)
    for (let i = 0; i < 3000 && !player.landedOn; i++) {
      stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    }
    expect(player.landedOn?.bodyId).toBe(rock.id)

    const before = player.state.pos.clone()
    // Нос вдоль касательной (брюхо к нормали уже после входа) + тяга — облёт, не отрыв.
    player.controls.throttle = 1
    player.controls.pitch = 1
    for (let i = 0; i < 240; i++) stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    expect(player.landedOn).not.toBeNull()
    expect(player.state.pos.distanceTo(before)).toBeGreaterThan(5)
    const alt = player.state.pos.distanceTo(rock.pos) - solid - er
    expect(alt).toBeGreaterThan(LANDING.HOVER_ALT - LANDING.HOVER_BOB_AMP - 1)
    expect(alt).toBeLessThan(LANDING.HOVER_ALT + LANDING.HOVER_BOB_AMP + 1)

    // updateCruise без удержания клавиши успел бы сбросить factor ниже порога —
    // проверяем отрыв напрямую в шаге ховера.
    player.cruise.factor = LANDING.ESCAPE_CRUISE
    stepLanding(player, world, PHYSICS.FIXED_DT)
    expect(player.landedOn).toBeNull()
  })
})
