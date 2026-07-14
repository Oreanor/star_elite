import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GRIEVANCE } from '../../config/ai'
import { traderLoadout } from '../../config/loadouts'
import { createAIState } from '../ai/types'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { makeShip } from '../world/factory'
import type { ShipEntity } from '../world/entities'
import { DIALOGUE } from '../../config/dialogue'
import { defuseGrievance, hasGrievance, pendingHail, registerPlayerHit, stepGrievances } from './grievance'

function neutral(world: World): ShipEntity {
  const s = makeShip(world.ids, 'neutral', 'Торговец', traderLoadout(), new Vector3(0, 0, -600), new Quaternion())
  s.ai = createAIState(s.state.pos, world.rng)
  world.ships.push(s)
  return s
}

function emptyWorld(): World {
  return createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
}

function pokeApart(world: World, victim: ShipEntity, times: number): void {
  for (let i = 0; i < times; i++) {
    world.time += GRIEVANCE.HIT_DEBOUNCE + 0.1
    registerPlayerHit(world, victim)
  }
}

describe('обида', () => {
  it('первые два попадания прощаются — без претензии и без враждебности', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10

    pokeApart(world, t, GRIEVANCE.FORGIVE_HITS)

    expect(t.faction).toBe('neutral')
    expect(t.ai!.grievance).toBe(0)
    expect(t.ai!.strikeCount).toBe(GRIEVANCE.FORGIVE_HITS)
    expect(hasGrievance(t)).toBe(false)
  })

  it('третье попадание поднимает претензию и вызов по связи', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10

    pokeApart(world, t, GRIEVANCE.FORGIVE_HITS + 1)

    expect(t.faction).toBe('neutral')
    expect(t.ai!.grievance).toBe(1)
    expect(hasGrievance(t)).toBe(true)
  })

  it('непрерывный чирк лучом — одно событие, а не очередь попаданий', () => {
    const world = emptyWorld()
    const t = neutral(world)

    for (let i = 0; i < 20; i++) {
      world.time = 10 + i * 0.02
      registerPlayerHit(world, t)
    }

    expect(t.ai!.strikeCount).toBe(1)
    expect(t.ai!.grievance).toBe(0)
    expect(t.faction).toBe('neutral')
  })

  it('упорная пальба после прощения переводит во враги', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10

    pokeApart(world, t, GRIEVANCE.FORGIVE_HITS + GRIEVANCE.HOSTILE_HITS)

    expect(t.faction).toBe('hostile')
    expect(hasGrievance(t)).toBe(false)
  })

  it('извинение разряжает претензию и счёт попаданий', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10
    pokeApart(world, t, GRIEVANCE.FORGIVE_HITS + 1)

    expect(defuseGrievance(t)).toBe(true)
    expect(t.ai!.grievance).toBe(0)
    expect(t.ai!.strikeCount).toBe(0)
    expect(t.faction).toBe('neutral')
  })

  it('забытая серия гаснет сама через cooldown', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10
    pokeApart(world, t, 1)

    world.time = 10 + GRIEVANCE.COOLDOWN + 1
    stepGrievances(world)

    expect(t.ai!.strikeCount).toBe(0)
    expect(t.faction).toBe('neutral')
  })

  it('stepGrievances переводит в бой по таймеру', () => {
    const world = emptyWorld()
    const t = neutral(world)
    const ai = t.ai!
    ai.grievance = 1
    ai.grievanceSince = 100
    ai.grievanceAt = 100
    ai.strikeCount = 3
    world.time = 100 + GRIEVANCE.RETALIATE_TIME
    stepGrievances(world)
    expect(t.faction).toBe('hostile')
  })

  it('без извинения через несколько секунд после претензии — ответный огонь', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10
    pokeApart(world, t, GRIEVANCE.FORGIVE_HITS + 1)
    expect(t.ai!.grievance).toBe(1)

    world.time = t.ai!.grievanceAt + GRIEVANCE.RETALIATE_TIME
    stepGrievances(world)

    expect(t.faction).toBe('hostile')
    expect(t.ai!.targetId).toBe(world.player.id)
  })

  it('извинение до таймера ответного огня не переводит во враги', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10
    pokeApart(world, t, GRIEVANCE.FORGIVE_HITS + 1)

    world.time = 10 + GRIEVANCE.RETALIATE_TIME - 1
    expect(defuseGrievance(t)).toBe(true)
    stepGrievances(world)

    expect(t.faction).toBe('neutral')
  })

  it('счёт рвётся паузой: после cooldown серия начинается заново', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10
    pokeApart(world, t, GRIEVANCE.FORGIVE_HITS + GRIEVANCE.HOSTILE_HITS - 1)

    world.time += GRIEVANCE.COOLDOWN + 5
    registerPlayerHit(world, t)

    expect(t.ai!.strikeCount).toBe(1)
    expect(t.ai!.grievance).toBe(0)
    expect(t.faction).toBe('neutral')
  })

  it('по уже-врагу претензий нет', () => {
    const world = emptyWorld()
    const t = neutral(world)
    t.faction = 'hostile'
    world.time = 10

    pokeApart(world, t, GRIEVANCE.FORGIVE_HITS + GRIEVANCE.HOSTILE_HITS + 2)

    expect(t.ai!.grievance).toBe(0)
    expect(hasGrievance(t)).toBe(false)
  })

  it('входящий вызов — ближайший обиженный в пределах слышимости', () => {
    const world = emptyWorld()
    world.player.state.pos.set(0, 0, 0)
    world.time = 10

    const near = neutral(world)
    near.state.pos.set(0, 0, -300)
    pokeApart(world, near, GRIEVANCE.FORGIVE_HITS + 1)
    expect(pendingHail(world)?.id).toBe(near.id)

    near.state.pos.set(0, 0, -(DIALOGUE.RANGE + 100))
    expect(pendingHail(world)).toBeNull()
  })

  it('борт без ИИ не копит обиду', () => {
    const world = emptyWorld()
    const s = makeShip(world.ids, 'neutral', 'Пустой', traderLoadout(), new Vector3(), new Quaternion())
    s.ai = null

    expect(() => registerPlayerHit(world, s)).not.toThrow()
    expect(hasGrievance(s)).toBe(false)
    expect(defuseGrievance(s)).toBe(false)
  })
})
