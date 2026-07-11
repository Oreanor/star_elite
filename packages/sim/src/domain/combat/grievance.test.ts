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

/**
 * Обида. Проверяем не числа, а ПРАВИЛА: случайное попадание не делает врага мгновенно
 * (сначала претензия и вызов по связи), непрерывный чирк лучом не считается очередью
 * попаданий, упорная пальба переводит во враги честно, извинение разряжает без смены
 * отношения, а забытая претензия гаснет сама. Перебалансировка вправе двигать пороги —
 * эти инварианты она ломать не должна.
 */

function neutral(world: World): ShipEntity {
  const s = makeShip(world.ids, 'neutral', 'Торговец', traderLoadout(), new Vector3(0, 0, -600), new Quaternion())
  s.ai = createAIState(s.state.pos, world.rng)
  world.ships.push(s)
  return s
}

function emptyWorld(): World {
  return createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
}

/** Отдельные попадания «с паузой»: время двигаем больше дебаунса, чтобы каждое засчиталось. */
function pokeApart(world: World, victim: ShipEntity, times: number): void {
  for (let i = 0; i < times; i++) {
    world.time += GRIEVANCE.HIT_DEBOUNCE + 0.1
    registerPlayerHit(world, victim)
  }
}

describe('обида', () => {
  it('одно попадание не делает врагом, но поднимает претензию и вызов по связи', () => {
    const world = emptyWorld()
    const t = neutral(world)

    world.time = 10
    registerPlayerHit(world, t)

    expect(t.faction).toBe('neutral')
    expect(t.ai!.grievance).toBe(1)
    expect(hasGrievance(t)).toBe(true)
  })

  it('непрерывный чирк лучом — одно событие, а не очередь попаданий', () => {
    const world = emptyWorld()
    const t = neutral(world)

    // Дробим на кадры в пределах дебаунса: держим луч на борту полсекунды.
    for (let i = 0; i < 20; i++) {
      world.time = 10 + i * 0.02
      registerPlayerHit(world, t)
    }

    expect(t.ai!.grievance).toBe(1)
    expect(t.faction).toBe('neutral')
  })

  it('упорная пальба (порог попаданий подряд) переводит во враги честно', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10

    pokeApart(world, t, GRIEVANCE.HOSTILE_HITS)

    expect(t.faction).toBe('hostile')
    // Стал честным врагом — претензии больше нет, к разговору-примирению не зовём.
    expect(hasGrievance(t)).toBe(false)
  })

  it('на попадание меньше порога враждебности ещё нет', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10

    pokeApart(world, t, GRIEVANCE.HOSTILE_HITS - 1)

    expect(t.faction).toBe('neutral')
    expect(hasGrievance(t)).toBe(true)
  })

  it('извинение разряжает претензию, но отношения не меняет', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10
    pokeApart(world, t, GRIEVANCE.HOSTILE_HITS - 1)

    expect(defuseGrievance(t)).toBe(true)
    expect(t.ai!.grievance).toBe(0)
    expect(t.faction).toBe('neutral')
    expect(hasGrievance(t)).toBe(false)
    // Разряжать нечего — второй раз вернёт false.
    expect(defuseGrievance(t)).toBe(false)
  })

  it('забытая претензия гаснет сама через cooldown', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10
    registerPlayerHit(world, t)
    expect(t.ai!.grievance).toBe(1)

    world.time = 10 + GRIEVANCE.COOLDOWN + 1
    stepGrievances(world)

    expect(t.ai!.grievance).toBe(0)
    expect(t.faction).toBe('neutral')
  })

  it('счёт «подряд» рвётся паузой: попадание после cooldown начинает заново', () => {
    const world = emptyWorld()
    const t = neutral(world)
    world.time = 10
    pokeApart(world, t, GRIEVANCE.HOSTILE_HITS - 1)
    const before = t.ai!.grievance

    // Долгая пауза — и снова попадание: это уже новый повод, не продолжение старого.
    world.time += GRIEVANCE.COOLDOWN + 5
    registerPlayerHit(world, t)

    expect(t.ai!.grievance).toBe(1)
    expect(before).toBeGreaterThan(1)
    expect(t.faction).toBe('neutral')
  })

  it('по уже-врагу претензий нет: по врагу стреляют без обид', () => {
    const world = emptyWorld()
    const t = neutral(world)
    t.faction = 'hostile'
    world.time = 10

    pokeApart(world, t, GRIEVANCE.HOSTILE_HITS + 2)

    expect(t.ai!.grievance).toBe(0)
    expect(hasGrievance(t)).toBe(false)
  })

  it('входящий вызов — ближайший обиженный в пределах слышимости, и только он', () => {
    const world = emptyWorld()
    world.player.state.pos.set(0, 0, 0)
    world.time = 10

    // Обиженный близко (в разговорной дальности) — он и вызывает.
    const near = neutral(world)
    near.state.pos.set(0, 0, -300)
    registerPlayerHit(world, near)
    expect(pendingHail(world)?.id).toBe(near.id)

    // Обиженный, но за пределом слышимости — не вызывает.
    near.state.pos.set(0, 0, -(DIALOGUE.RANGE + 100))
    expect(pendingHail(world)).toBeNull()

    // Необиженный рядом — тоже молчит: вызывать не с чего.
    near.state.pos.set(0, 0, -300)
    defuseGrievance(near)
    expect(pendingHail(world)).toBeNull()
  })

  it('борт без ИИ не роняет расчёт и не копит обиду', () => {
    const world = emptyWorld()
    const s = makeShip(world.ids, 'neutral', 'Пустой', traderLoadout(), new Vector3(), new Quaternion())
    s.ai = null

    expect(() => registerPlayerHit(world, s)).not.toThrow()
    expect(hasGrievance(s)).toBe(false)
    expect(defuseGrievance(s)).toBe(false)
  })
})
