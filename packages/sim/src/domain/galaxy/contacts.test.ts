import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { makeRng } from '../../core/math'
import { CONTACTS } from '../../config/contacts'
import { createWorld, makeShip, STARTER_SYSTEM, type Acquaintance, type World } from '../world'
import { emptyPlan } from '../world/contactPlan'
import { driftContacts, contactWhereabouts } from './contacts'
import { placeSystem, distanceLy } from './shape'

/**
 * Закулисная жизнь знакомых. Проверяем не числа, а СВОЙСТВА: контакт перемещается
 * в пределах перелёта, связанный идёт К цели, редкий — гибнет с вестью, и всё это
 * детерминированно — иначе галактика знакомых рассинхронизируется по сети.
 */

/** Мир с одним знакомым в системе `at`, помещённым руками (без разговора). */
function withContact(at: number, over: Partial<Acquaintance> = {}): { world: World; rec: Acquaintance } {
  const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
  const rec: Acquaintance = {
    id: world.ids.next(),
    name: 'Векс',
    persona: world.player.persona,
    faction: 'neutral',
    chassisId: world.player.loadout.chassis.id,
    kindId: 'trader',
    systemIndex: at,
    boundFor: null,
    roaming: true,
    meetings: 1,
    relationship: 'neutral',
    history: [{ kind: 'met', at: 0 }],
    alive: true,
    credits: 50_000,
    savedLoadout: null,
    plan: emptyPlan(),
    entrusted: [],
    ...over,
  }
  world.acquaintances.push(rec)
  return { world, rec }
}

describe('закулисная жизнь знакомых', () => {
  it('праздный контакт уходит недалеко — в пределах одного перелёта', () => {
    // Зерно rng подбираем так, чтобы кость гибели не сорвала ход, а кость странствия — сорвала.
    const { world, rec } = withContact(100)
    const from = rec.systemIndex
    // Прогоняем несколько ходов: хоть один да сдвинет (WANDER_CHANCE=0.4).
    let moved = false
    for (let i = 0; i < 40 && !moved; i++) {
      world.rng = makeRng(1000 + i)
      const before = rec.systemIndex
      driftContacts(world)
      if (!rec.alive) return // редкая гибель — тест перемещения не про это
      if (rec.systemIndex !== before) {
        moved = true
        // Ушёл не дальше дальности перелёта от ТОГО места, откуда шагнул.
        const hop = distanceLy(placeSystem(before, world.galaxySeed), placeSystem(rec.systemIndex, world.galaxySeed))
        expect(hop).toBeLessThanOrEqual(CONTACTS.WANDER_RANGE_LY + 1e-6)
      }
    }
    expect(moved).toBe(true)
    expect(from).toBe(100)
  })

  it('присутствующий живым бортом не бродит и не гибнет: он рядом, не за кулисами', () => {
    const { world, rec } = withContact(100)
    // Живой борт с этой записью — контакт «здесь»: дрейф его не касается вовсе.
    const ship = makeShip(world.ids, 'neutral', rec.name, world.player.loadout, new Vector3(), new Quaternion())
    ship.acquaintanceId = rec.id
    world.ships.push(ship)

    const before = rec.systemIndex
    for (let i = 0; i < 30; i++) {
      world.rng = makeRng(2000 + i)
      driftContacts(world)
    }
    expect(rec.systemIndex).toBe(before)
    expect(rec.alive).toBe(true) // присутствующего фоновая кость гибели не трогает
  })

  it('связанный обещанием идёт К цели, а не бродит, и по прибытии гасит намерение', () => {
    // Дальняя цель: за несколько ходов контакт обязан к ней приблизиться и дойти.
    const dest = 1500
    const { world, rec } = withContact(100, { boundFor: dest })
    const goal = placeSystem(dest, world.galaxySeed)
    let prev = distanceLy(placeSystem(rec.systemIndex, world.galaxySeed), goal)

    for (let i = 0; i < 400 && rec.boundFor != null && rec.alive; i++) {
      world.rng = makeRng(1) // зерно без гибели: проверяем путь, не смерть
      const beforeIdx = rec.systemIndex
      driftContacts(world)
      if (!rec.alive) return
      const now = distanceLy(placeSystem(rec.systemIndex, world.galaxySeed), goal)
      // Каждый шаг либо приближает к цели, либо остаётся (в глуши), но не удаляет.
      expect(now).toBeLessThanOrEqual(prev + 1e-6)
      prev = now
      if (rec.systemIndex === beforeIdx && now > CONTACTS.WANDER_RANGE_LY) break // застрял — довольно
    }
    // Либо дошёл (boundFor погашен и он в целевой системе), либо честно приблизился.
    if (rec.boundFor == null && rec.alive) expect(rec.systemIndex).toBe(dest)
  })

  it('редкая гибель помечает запись мёртвой и шлёт весть игроку', () => {
    // Перебираем зёрна, пока не выпадет кость гибели: событие редкое, но неизбежное.
    let died = false
    for (let i = 0; i < 500 && !died; i++) {
      const w = withContact(100).world
      w.rng = makeRng(i)
      driftContacts(w)
      const r = w.acquaintances[0]!
      if (!r.alive) {
        died = true
        expect(w.notices).toHaveLength(1)
        expect(w.notices[0]).toMatchObject({ kind: 'contact-lost', name: 'Векс' })
      }
    }
    expect(died).toBe(true)
  })

  it('детерминизм: то же зерно и та же галактика — тот же ход', () => {
    const a = withContact(100)
    const b = withContact(100)
    a.world.rng = makeRng(777)
    b.world.rng = makeRng(777)
    driftContacts(a.world)
    driftContacts(b.world)
    expect(a.rec.systemIndex).toBe(b.rec.systemIndex)
    expect(a.rec.alive).toBe(b.rec.alive)
  })

  it('где он: отсутствующий контакт — в своей системе, у приметного места', () => {
    const { world, rec } = withContact(100)
    const w = contactWhereabouts(world, { record: rec, ship: null, distance: Infinity })
    expect(w.present).toBe(false)
    expect(typeof w.systemName).toBe('string')
    expect(w.systemName.length).toBeGreaterThan(0)
  })
})
