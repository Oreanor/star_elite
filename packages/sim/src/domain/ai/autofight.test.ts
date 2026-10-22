import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { COMMODITIES } from '../cargo/items'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { stepWorld } from '../sim'
import { autofightActive, autofightSpent, continueAutofight, disengageAutofight, engageAutofight, retargetAutofight } from './autofight'
import { aiController } from './pilot'
import { lockContact } from '../world/queries'

/**
 * Автобой — это тот же пилот-бот за штурвалом игрока. Проверяем не «летит красиво»,
 * а ПРАВИЛА: кого он бьёт, когда включается и когда отпускает управление.
 */
/**
 * Два пирата: ближний и дальний. Координаты патруля в `SystemDef` — МИРОВЫЕ,
 * а игрок стартует в астрономической единице от начала координат, поэтому
 * расставляем их относительно него, а не через `at`.
 */
function withEnemy(): World {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [
      { count: 1, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' },
      { count: 1, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' },
    ],
  })
  world.ships[0]!.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -600))
  world.ships[1]!.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -1400))
  return world
}

describe('автобой', () => {
  it('без захваченной цели не включается', () => {
    const world = withEnemy()
    lockContact(world, 'ship', null)
    world.targetFocus = 'contact'
    expect(engageAutofight(world)).toBe(false)
    expect(autofightActive(world)).toBe(false)
  })

  it('включается по захваченной цели и снимается повторно', () => {
    const world = withEnemy()
    lockContact(world, 'ship', world.ships[0]!.id)
    world.targetFocus = 'contact'

    expect(engageAutofight(world)).toBe(true)
    expect(autofightActive(world)).toBe(true)

    disengageAutofight(world)
    expect(autofightActive(world)).toBe(false)
  })

  it('при фокусе нава (Shift+Tab) не бьёт старый контакт', () => {
    const world = withEnemy()
    lockContact(world, 'ship', world.ships[0]!.id)
    world.targetFocus = 'nav'
    expect(engageAutofight(world)).toBe(false)
  })

  it('бьёт контейнер и астероид по захвату', () => {
    const world = withEnemy()
    world.targetFocus = 'contact'
    lockContact(world, 'ship', null)
    world.pods.push({
      id: world.ids.next(),
      kind: 'pod',
      pos: world.player.state.pos.clone().add(new Vector3(0, 0, -200)),
      vel: new Vector3(),
      quat: world.player.state.quat.clone(),
      spin: new Vector3(),
      item: { kind: 'commodity', commodity: COMMODITIES.MINERALS, units: 1 },
      born: 0,
      alive: true,
      tractored: false,
    })
    lockContact(world, 'pod', world.pods[0]!.id)
    expect(engageAutofight(world)).toBe(true)
    expect(world.player.ai!.orderedSoft).toEqual({ kind: 'pod', id: world.pods[0]!.id })
    disengageAutofight(world)

    lockContact(world, 'pod', null)
    world.asteroids.push({
      id: world.ids.next(),
      kind: 'asteroid',
      pos: world.player.state.pos.clone().add(new Vector3(0, 0, -300)),
      vel: new Vector3(),
      quat: world.player.state.quat.clone(),
      spin: new Vector3(),
      radius: 20,
      hull: 1,
      shape: 0,
      alive: true,
    })
    lockContact(world, 'asteroid', world.asteroids[0]!.id)
    expect(engageAutofight(world)).toBe(true)
    expect(world.player.ai!.orderedSoft).toEqual({ kind: 'asteroid', id: world.asteroids[0]!.id })
  })

  /**
   * Приказ сильнее выбора. Без него пилот в такте размышления перескочил бы на
   * ближайшего врага, и кнопка «автобой по захваченной цели» врала бы.
   */
  it('дерётся с назначенной целью, а не с ближайшей', () => {
    const world = withEnemy()
    const [near, far] = world.ships
    expect(near!.state.pos.distanceTo(world.player.state.pos))
      .toBeLessThan(far!.state.pos.distanceTo(world.player.state.pos))

    lockContact(world, 'ship', far!.id)
    world.targetFocus = 'contact'
    engageAutofight(world)
    expect(world.player.ai!.orderedTargetId).toBe(far!.id)

    /**
     * Мир обязан ШАГНУТЬ: цель пересматривается в такте размышления, а не при
     * включении. Проверка сразу после `engageAutofight` не отличила бы приказ
     * от его отсутствия — она и не отличала, пока мутация это не показала.
     */
    const controllers = new Map([[world.player.id, aiController]])
    for (let i = 0; i < 120; i++) stepWorld(world, 1 / 60, controllers)

    expect(world.player.ai!.targetId).toBe(far!.id)
  })

  it('отпускает штурвал, когда цель погибла', () => {
    const world = withEnemy()
    const target = world.ships[0]!
    lockContact(world, 'ship', target.id)
    world.targetFocus = 'contact'
    engageAutofight(world)

    expect(autofightSpent(world)).toBe(false)
    target.alive = false
    expect(autofightSpent(world)).toBe(true)
  })

  /** «Улетел совсем» — это дальность, а не время: иначе погоня уйдёт через полсистемы. */
  it('отпускает штурвал, когда цель ушла за горизонт', () => {
    const world = withEnemy()
    const target = world.ships[0]!
    lockContact(world, 'ship', target.id)
    world.targetFocus = 'contact'
    engageAutofight(world)

    target.state.pos.set(0, 0, -1e6)
    expect(autofightSpent(world)).toBe(true)
  })

  it('отпускает штурвал вместе с гибелью пилота', () => {
    const world = withEnemy()
    lockContact(world, 'ship', world.ships[0]!.id)
    world.targetFocus = 'contact'
    engageAutofight(world)

    world.player.alive = false
    expect(autofightSpent(world)).toBe(true)
  })

  /** Симуляция не должна замечать подмены пилота: мир шагает, как шагал. */
  it('мир шагает с ботом за штурвалом игрока', () => {
    const world = withEnemy()
    lockContact(world, 'ship', world.ships[0]!.id)
    world.targetFocus = 'contact'
    engageAutofight(world)

    for (let i = 0; i < 60; i++) stepWorld(world, 1 / 60, new Map())
    expect(world.player.alive).toBe(true)
    expect(autofightActive(world)).toBe(true)
  })
})

describe('автобой не уводит игрока прыжком', () => {
  // Пойманный баг: бот за штурвалом игрока под огнём решал «сбежать прыжком», как пират.
  // `beginWarpDeparture` обнулял ход и ставил `warpDeparting`, а портал ищет борт в
  // `world.ships`, где игрока нет: прыжок не завершался, флаг висел вечно, шаг пропускал
  // контроллер игрока — корабль стоял, и снятие автобоя (P) уже не помогало.
  it('под огнём автобой не заряжает побег, и корабль остаётся управляемым', () => {
    const world = withEnemy()
    expect(world.player.spec.jumpRange).toBeGreaterThan(0)
    lockContact(world, 'ship', world.ships[0]!.id)
    world.targetFocus = 'contact'
    expect(engageAutofight(world)).toBe(true)

    const controllers = new Map([[world.player.id, aiController]])
    for (let i = 0; i < 60 * 60 && world.player.alive; i++) {
      world.player.lastHitAt = world.time // всё время «под огнём»
      stepWorld(world, 1 / 60, controllers, { unassigned: aiController })
      expect(world.player.warpDeparting).toBe(false)
    }
  })
})

describe('автобой: следующая цель', () => {
  it('убил цель — берёт ближайшего врага рядом; врагов нет — бой окончен', () => {
    // Пойманное: после первого убийства автобой отдавал штурвал посреди свалки.
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 2, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' }],
    })
    const p = world.player
    p.state.pos.set(30_000, 0, 0)
    const [a, b] = world.ships
    a!.state.pos.copy(p.state.pos).add(new Vector3(0, 0, -300))
    b!.state.pos.copy(p.state.pos).add(new Vector3(200, 0, -400))
    lockContact(world, 'ship', a!.id)
    world.targetFocus = 'contact'
    expect(engageAutofight(world)).toBe(true)

    a!.alive = false
    expect(autofightSpent(world)).toBe(true)
    expect(retargetAutofight(world)).toBe(true)
    expect(p.ai!.orderedTargetId).toBe(b!.id)
    expect(autofightSpent(world)).toBe(false)

    b!.alive = false
    expect(retargetAutofight(world)).toBe(false)
  })

  it('цикл автобоя сам берёт следующего из группы, дальних за обзором — нет', () => {
    // Пойманное: перевод на соседа жил лишь в приказе «бей всех» второму пилоту, а обычный
    // автобой по одному пирату из группы, сбив его, отдавал штурвал посреди остальных.
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 3, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' }],
    })
    const p = world.player
    p.state.pos.set(30_000, 0, 0)
    const [a, b, far] = world.ships
    a!.state.pos.copy(p.state.pos).add(new Vector3(0, 0, -300))
    b!.state.pos.copy(p.state.pos).add(new Vector3(200, 0, -400))
    far!.state.pos.copy(p.state.pos).add(new Vector3(0, 0, -50_000))
    lockContact(world, 'ship', a!.id)
    world.targetFocus = 'contact'
    expect(engageAutofight(world)).toBe(true)

    a!.alive = false
    expect(continueAutofight(world)).toBe(true)
    expect(p.ai!.orderedTargetId).toBe(b!.id)

    // Сбит и второй — дальний (за обзором) не в счёт: бой окончен.
    b!.alive = false
    expect(continueAutofight(world)).toBe(false)
    expect(autofightActive(world)).toBe(false)
  })

  it('побитый корабль в автобое не бежит: бой — приказ игрока, а не выбор пилота', () => {
    // Пойманное: страх пилота-бота считался и у автобоя — от нрава персонажа игрока и просевшего
    // щита. Второй пилот сразу уходил вбок змейкой, лазер молчал, летели одни ракеты.
    const world = withEnemy()
    const p = world.player
    p.hull = p.spec.hull.hull * 0.2
    p.shield = 0
    p.energy = 0
    lockContact(world, 'ship', world.ships[0]!.id)
    world.targetFocus = 'contact'
    expect(engageAutofight(world)).toBe(true)
    const controllers = new Map([[p.id, aiController]])
    for (let i = 0; i < 120; i++) {
      stepWorld(world, 1 / 60, controllers)
      expect(p.ai?.mode).not.toBe('evade')
    }
  })
})

