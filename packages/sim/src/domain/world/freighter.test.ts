import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { freighterLoadout, pirateLeaderLoadout, pirateLoadout } from '../../config/loadouts'
import { aiController } from '../ai/pilot'
import { createAIState } from '../ai/types'
import { deriveShipSpec } from '../loadout'
import { createWorld, makeShip, STARTER_SYSTEM, type World } from '../world'

/**
 * Грузовик — не боевой корабль, а мишень с трюмом. Проверяем не числа баланса,
 * а СВОЙСТВА, которые переживут перебалансировку: он неповоротлив по физике,
 * возит тонны, а его полицейский эскорт защищает подопечного сам.
 */

/** Пустой мир: чужие патрули и пояс тут только мешали бы выбору цели. */
function emptyWorld(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

describe('тяжёлый грузовик', () => {
  it('неповоротлив: угловое ускорение ниже истребительского', () => {
    // Гружёный (как в бою) грузовик против пирата. Виновата не «штрафная цифра»,
    // а масса × момент инерции при гражданских маневровых — честная физика.
    const barge = deriveShipSpec(freighterLoadout(), 140)
    const fighter = deriveShipSpec(pirateLoadout())

    expect(barge.tuning.PITCH_ACCEL).toBeLessThan(fighter.tuning.PITCH_ACCEL / 2)
    expect(barge.tuning.YAW_ACCEL).toBeLessThan(fighter.tuning.YAW_ACCEL / 2)
  })

  it('возит тонны: трюм на порядок больше боевого', () => {
    const barge = deriveShipSpec(freighterLoadout())
    const fighter = deriveShipSpec(pirateLoadout())
    // Четыре больших контейнера — за две сотни тонн. Ради этого груза и нападают.
    expect(barge.cargoCapacity).toBeGreaterThanOrEqual(200)
    expect(barge.cargoCapacity).toBeGreaterThan(fighter.cargoCapacity * 10)
  })

  /**
   * Ключевое отличие конвойного стража от наёмника игрока: у мирного грузовика
   * своей цели нет, поэтому эскорт обязан ВЫБРАТЬ врага сам, иначе прикрытие лишь
   * красиво летит, пока баржу разбирают. Наёмник же игрока чужих драк не ищет —
   * иначе автобой перестаёт слушаться захвата.
   */
  it('полицейский страж конвоя сам берёт на прицел налётчика', () => {
    const world = emptyWorld()
    const at = new Vector3(2e9, 0, 0)

    const freighter = makeShip(world.ids, 'neutral', 'Грузовик', freighterLoadout(), at.clone(), world.player.state.quat.clone())
    world.ships.push(freighter)

    const raider = makeShip(world.ids, 'hostile', 'Налётчик', pirateLoadout(), at.clone().add(new Vector3(150, 0, 0)), world.player.state.quat.clone())
    world.ships.push(raider)

    const guard = makeShip(world.ids, 'police', 'Эскорт', pirateLeaderLoadout(), at.clone().add(new Vector3(80, 0, 0)), world.player.state.quat.clone())
    guard.ai = createAIState(freighter.state.pos, world.rng)
    guard.ai.escortOf = freighter.id
    world.ships.push(guard)

    // dt заведомо больше стартового thinkTimer (≤0.12): такт размышления сработает.
    aiController.update(guard, world, 0.2)
    expect(guard.ai!.targetId).toBe(raider.id)
  })

  it('наёмник ИГРОКА без захвата сам защищает от врага рядом', () => {
    const world = emptyWorld()
    const at = world.player.state.pos.clone()

    const raider = makeShip(world.ids, 'hostile', 'Налётчик', pirateLoadout(), at.clone().add(new Vector3(150, 0, 0)), world.player.state.quat.clone())
    world.ships.push(raider)

    const merc = makeShip(world.ids, 'police', 'Наёмник', pirateLeaderLoadout(), at.clone().add(new Vector3(80, 0, 0)), world.player.state.quat.clone())
    merc.ai = createAIState(world.player.state.pos, world.rng)
    merc.ai.escortOf = world.player.id // патрон — игрок, а не грузовик
    world.ships.push(merc)

    world.lockedTargetId = null // игрок никого не захватил — но враг рядом
    aiController.update(merc, world, 0.2)
    // Компаньон не ждёт приказа: берёт налётчика сам, а не летит красиво рядом.
    // Захват (Tab) лишь ПЕРЕнаправил бы его на другую цель.
    expect(merc.ai!.targetId).toBe(raider.id)
  })
})
