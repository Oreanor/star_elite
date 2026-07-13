import { describe, expect, it } from 'vitest'
import { BREAKAGE } from '../../config/weapons'
import { isCargo, isMissile, isShield } from '../loadout'
import { createWorld } from '../world'
import { breakFromHit } from './breakage'

/**
 * Поломка снаряжения в бою. Проверяем ИНВАРИАНТЫ, а не числа: щит бьётся только под
 * живым щитом, детали — только по пробитому, расходник и контейнер не ломаются никогда,
 * и за одно попадание страдает не больше одной детали.
 *
 * Поломка заменяет деталь КЛОНОМ на месте (сток общий, править нельзя), поэтому характеристики
 * читаем ПОСЛЕ вызова заново, а не по прежней ссылке.
 */

/** Скриптованный ГПСЧ: отдаёт заготовленную последовательность. `breakFromHit` тянет по одному. */
function scripted(values: number[]): () => number {
  let i = 0
  return () => values[i++] ?? 0
}

function shieldFault(world: ReturnType<typeof createWorld>): number {
  return world.player.loadout.internals.find(isShield)?.fault ?? 0
}

/** Сколько деталей на борту сейчас с ненулевой поломкой — по оснастке и внутренним. */
function brokenCount(world: ReturnType<typeof createWorld>): number {
  const p = world.player
  const w = p.loadout.weapons.filter((m) => m != null && (m.fault ?? 0) > 0).length
  const i = p.loadout.internals.filter((m) => (m.fault ?? 0) > 0).length
  return w + i
}

describe('поломка от попадания', () => {
  it('под ЖИВЫМ щитом бьётся только сам щит, и лишь на удачный бросок', () => {
    const world = createWorld()

    // Бросок ВЫШЕ порога щита — ничего не ломается.
    breakFromHit(world.player, true, scripted([BREAKAGE.SHIELD_CHANCE + 0.01]))
    expect(brokenCount(world)).toBe(0)

    // Бросок НИЖЕ порога — щит просел, а прочих поломок нет.
    breakFromHit(world.player, true, scripted([0]))
    expect(shieldFault(world)).toBeCloseTo(BREAKAGE.SHIELD_AMOUNT, 5)
    expect(brokenCount(world)).toBe(1) // только щит
  })

  it('по ЖИВОМУ щиту деталь оснастки не ломается — щит держит', () => {
    const world = createWorld()
    // Даже на «ломающем» броске: под живым щитом путь один — щит, не оснастка.
    breakFromHit(world.player, true, scripted([0, 0, 0]))
    const nonShieldBroken = world.player.loadout.weapons.some((m) => m != null && (m.fault ?? 0) > 0)
    expect(nonShieldBroken).toBe(false)
  })

  it('по ПРОБИТОМУ щиту ломается ровно одна деталь', () => {
    const world = createWorld()
    // rng: [0] < HULL_HIT_CHANCE (ломаем), [1]=0 → первое место пула, [2]=0 → минимум поломки.
    breakFromHit(world.player, false, scripted([0, 0, 0]))
    expect(brokenCount(world)).toBe(1)
  })

  it('расходник (ракета) и контейнер не ломаются НИКОГДА, сколько ни попадай', () => {
    const world = createWorld()

    // Сотня «ломающих» попаданий подряд: перебор всего пула не заденет исключённых.
    for (let k = 0; k < 100; k++) {
      breakFromHit(world.player, false, scripted([0, (k % 7) / 7, 0.4]))
    }
    for (const w of world.player.loadout.weapons) {
      if (w != null && isMissile(w)) expect(w.fault ?? 0).toBe(0)
    }
    for (const m of world.player.loadout.internals) {
      if (isCargo(m)) expect(m.fault ?? 0).toBe(0)
    }
  })
})
