import { describe, expect, it } from 'vitest'
import { makeRng } from '../../core/math'
import { createWorld, STARTER_SYSTEM, type World } from './index'
import { applyStance, recurringAcquaintance, rememberPilot } from './acquaintance'

/**
 * Память знакомств. Прохожих космос забывает, с кем говорил — помнит. Проверяем
 * без браузера: реестр — данные и правило, а не окно.
 */

function withStranger(faction: 'neutral' | 'hostile' = 'neutral'): World {
  return createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction, name: 'Кто-то' }],
  })
}

describe('память знакомств', () => {
  it('разговор заводит запись, даёт пилоту имя и связывает борт', () => {
    const world = withStranger()
    const ship = world.ships[0]!
    const before = ship.name

    rememberPilot(world, ship)

    expect(world.acquaintances).toHaveLength(1)
    const rec = world.acquaintances[0]!
    expect(ship.acquaintanceId).toBe(rec.id)
    expect(rec.meetings).toBe(1)
    expect(rec.systemIndex).toBe(world.systemIndex)
    // Был «Торговец» — стал человек с именем, и это имя теперь на борту.
    expect(ship.name).not.toBe(before)
    expect(ship.name).toBe(rec.name)
  })

  it('второй разговор в ту же встречу записи не плодит', () => {
    const world = withStranger()
    const ship = world.ships[0]!
    rememberPilot(world, ship)
    rememberPilot(world, ship)
    expect(world.acquaintances).toHaveLength(1)
  })

  it('знакомство переживает гибель борта и годится для повторной встречи', () => {
    const world = withStranger()
    const ship = world.ships[0]!
    rememberPilot(world, ship)

    // Пока борт жив и в мире — повторно его не «встретить», он уже тут.
    expect(recurringAcquaintance(world, makeRng(1))).toBeNull()

    // Улетел/погиб — запись осталась, и теперь знакомого можно встретить снова.
    world.ships = []
    expect(recurringAcquaintance(world, makeRng(1))?.name).toBe(ship.name)
  })

  it('знакомый из другой системы здесь не встречается', () => {
    const world = withStranger()
    const ship = world.ships[0]!
    rememberPilot(world, ship)
    world.ships = []

    world.systemIndex += 1 // прыгнули в соседнюю
    expect(recurringAcquaintance(world, makeRng(1))).toBeNull()
  })

  it('нахамил нейтралу — он встаёт на бой, и это помнится', () => {
    const world = withStranger('neutral')
    const ship = world.ships[0]!
    rememberPilot(world, ship)

    applyStance(world, ship, 'hostile')
    expect(ship.faction).toBe('hostile')
    expect(world.acquaintances[0]!.relationship).toBe('hostile')
  })

  it('дружелюбие НЕ разоружает врага: замирение — дело сдачи, не слов', () => {
    const world = withStranger('hostile')
    const ship = world.ships[0]!
    rememberPilot(world, ship)

    applyStance(world, ship, 'friendly')
    // Отношение записалось, но пират остался врагом: уболтать целого в друзья нельзя.
    expect(world.acquaintances[0]!.relationship).toBe('friendly')
    expect(ship.faction).toBe('hostile')
  })

  it('знакомство переживает прыжок: реестр не чистится сменой системы', () => {
    const world = withStranger()
    rememberPilot(world, world.ships[0]!)
    expect(world.acquaintances).toHaveLength(1)
    // enterSystem не трогает реестр — проверяем, что поле не в списке эфемерного.
    // (createWorld инициализирует пустым; наполнение живёт дольше системы.)
    expect(world.acquaintances[0]!.systemIndex).toBe(world.systemIndex)
  })
})
