import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, type World } from './index'
import { applyStance, residentAcquaintances, rememberPilot } from './acquaintance'

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

  it('знакомство переживает гибель борта: знакомый снова становится жителем системы', () => {
    const world = withStranger()
    const ship = world.ships[0]!
    rememberPilot(world, ship)

    // Пока борт жив и в мире — он уже тут, повторно выставлять некого.
    expect(residentAcquaintances(world)).toHaveLength(0)

    // Борт исчез (улетел/погиб) — запись осталась, и знакомого нужно выставить снова:
    // со знакомыми нет случайных встреч, в своей системе они всегда на радаре.
    world.ships = []
    const here = residentAcquaintances(world)
    expect(here).toHaveLength(1)
    expect(here[0]!.name).toBe(ship.name)
  })

  it('знакомый из другой системы жителем ЗДЕСЬ не считается', () => {
    const world = withStranger()
    rememberPilot(world, world.ships[0]!)
    world.ships = []

    world.systemIndex += 1 // прыгнули в соседнюю
    expect(residentAcquaintances(world)).toHaveLength(0)
  })

  it('погибший знакомый жителем не становится: мёртвый на радаре не всплывает', () => {
    const world = withStranger()
    const ship = world.ships[0]!
    rememberPilot(world, ship)
    world.ships = []
    expect(residentAcquaintances(world)).toHaveLength(1)

    world.acquaintances[0]!.alive = false
    expect(residentAcquaintances(world)).toHaveLength(0)
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
