import { describe, expect, it } from 'vitest'
import { TITAN } from '../../config/titans'
import { applyDamage } from '../combat/damage'
import { createWorld, enterSystem, STARTER_SYSTEM, type World } from './index'
import { spawnTitan, stepTitans, titanCount } from './titans'

/**
 * Киты — корабли поколений.
 *
 * Декорация: они не в `ships` и не в `bodies`, поэтому боевая машинерия их не
 * видит вовсе. Проверяем именно это — что кит живёт мимо боя, — а не числа.
 */

const quiet = (): World => createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })

describe('киты', () => {
  it('рождаются в своём списке, а не среди кораблей или тел', () => {
    const world = quiet()
    const before = { ships: world.ships.length, bodies: world.bodies.length }
    const titan = spawnTitan(world)

    expect(world.titans).toContain(titan)
    expect(world.ships.length).toBe(before.ships)
    expect(world.bodies.length).toBe(before.bodies)
    expect(titan.kind).toBe('titan')
  })

  it('облик берётся из таблицы видов, а не выходит за неё', () => {
    const world = quiet()
    for (let i = 0; i < 50; i++) {
      const titan = spawnTitan(world)
      expect(titan.variant).toBeGreaterThanOrEqual(0)
      expect(titan.variant).toBeLessThan(TITAN.VARIANTS)
      world.titans.length = 0 // не упираемся в потолок — проверяем именно облик
    }
  })

  it('дрейфует по своей скорости и исчезает, уйдя за горизонт', () => {
    const world = quiet()
    const titan = spawnTitan(world)
    titan.pos.copy(world.player.state.pos)
    titan.pos.x += 100
    titan.vel.set(50, 0, 0)

    const start = titan.pos.x
    stepTitans(world, 2)
    expect(titan.pos.x).toBeCloseTo(start + 100, 3) // 50 м/с × 2 с

    // Утащим за предел удаления — следующий шаг его выметет.
    titan.pos.x = world.player.state.pos.x + TITAN.DESPAWN_RANGE + 1
    stepTitans(world, 0)
    expect(world.titans).not.toContain(titan)
  })

  /**
   * Главное свойство кита: его нельзя подбить. Он не `ShipEntity`, у него нет
   * ни корпуса, ни щита, и `applyDamage` его попросту не принимает по типу —
   * этот тест стережёт, что кит не «худой корабль», а другая сущность.
   */
  it('неуязвим: боевая машинерия его не касается', () => {
    const world = quiet()
    const titan = spawnTitan(world)

    // @ts-expect-error — кит не корабль, урон ему нанести нечем, и это гарантия типа.
    expect(() => applyDamage(titan, 1_000_000, world.time)).not.toThrow()
    // Кит остался в мире как ни в чём не бывало: у него нет поля alive.
    expect(world.titans).toContain(titan)
    expect('hull' in titan).toBe(false)
    expect('shield' in titan).toBe(false)
  })

  it('прыжок в новую систему уносит китов прежней', () => {
    const world = quiet()
    spawnTitan(world)
    expect(titanCount(world)).toBeGreaterThan(0)

    // Входим в ЧУЖУЮ систему (не домашнюю, где стоят киты-экспонаты): эфемерные
    // киты прежней системы должны исчезнуть, а новых тут никто не выставляет.
    enterSystem(world, { ...STARTER_SYSTEM, patrols: [], belt: null }, world.systemIndex + 1)
    expect(titanCount(world)).toBe(0)
  })

  it('в стартовой системе выставлены напоказ все облики китов', () => {
    // Дома по одному киту каждого вида стоит напоказ — их можно облететь, не
    // дожидаясь редкой случайной встречи. Проверяем: ровно по одному на облик.
    const world = quiet()
    const variants = new Set(world.titans.map((t) => t.variant))
    expect(world.titans.length).toBe(TITAN.VARIANTS)
    expect(variants.size).toBe(TITAN.VARIANTS)
  })
})
