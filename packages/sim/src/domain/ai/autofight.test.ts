import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { COMMODITIES } from '../cargo/items'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { stepWorld } from '../sim'
import { autofightActive, autofightSpent, disengageAutofight, engageAutofight } from './autofight'
import { aiController } from './pilot'

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
    world.lockedTargetId = null
    world.targetFocus = 'contact'
    expect(engageAutofight(world)).toBe(false)
    expect(autofightActive(world)).toBe(false)
  })

  it('включается по захваченной цели и снимается повторно', () => {
    const world = withEnemy()
    world.lockedTargetId = world.ships[0]!.id
    world.targetFocus = 'contact'

    expect(engageAutofight(world)).toBe(true)
    expect(autofightActive(world)).toBe(true)

    disengageAutofight(world)
    expect(autofightActive(world)).toBe(false)
  })

  it('при фокусе нава (Shift+Tab) не бьёт старый контакт', () => {
    const world = withEnemy()
    world.lockedTargetId = world.ships[0]!.id
    world.targetFocus = 'nav'
    expect(engageAutofight(world)).toBe(false)
  })

  it('бьёт контейнер и астероид по захвату', () => {
    const world = withEnemy()
    world.targetFocus = 'contact'
    world.lockedTargetId = null
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
    world.lockedPodId = world.pods[0]!.id
    expect(engageAutofight(world)).toBe(true)
    expect(world.player.ai!.orderedSoft).toEqual({ kind: 'pod', id: world.pods[0]!.id })
    disengageAutofight(world)

    world.lockedPodId = null
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
    world.lockedAsteroidId = world.asteroids[0]!.id
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

    world.lockedTargetId = far!.id
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
    world.lockedTargetId = target.id
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
    world.lockedTargetId = target.id
    world.targetFocus = 'contact'
    engageAutofight(world)

    target.state.pos.set(0, 0, -1e6)
    expect(autofightSpent(world)).toBe(true)
  })

  it('отпускает штурвал вместе с гибелью пилота', () => {
    const world = withEnemy()
    world.lockedTargetId = world.ships[0]!.id
    world.targetFocus = 'contact'
    engageAutofight(world)

    world.player.alive = false
    expect(autofightSpent(world)).toBe(true)
  })

  /** Симуляция не должна замечать подмены пилота: мир шагает, как шагал. */
  it('мир шагает с ботом за штурвалом игрока', () => {
    const world = withEnemy()
    world.lockedTargetId = world.ships[0]!.id
    world.targetFocus = 'contact'
    engageAutofight(world)

    for (let i = 0; i < 60; i++) stepWorld(world, 1 / 60, new Map())
    expect(world.player.alive).toBe(true)
    expect(autofightActive(world)).toBe(true)
  })
})
