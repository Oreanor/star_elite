import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { pirateLoadout } from '../../config/loadouts'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { makeShip } from '../world/factory'
import type { ShipEntity } from '../world/entities'
import { aiController } from './pilot'
import { createAIState } from './types'
import { applyOrder, orderAttack, orderCeaseFire, orderEngageAll, orderHold, orderKeepBack, orderResume } from './commands'

/**
 * Команды автоботу — послушание, а не уговоры. Проверяем не текст, а поведение:
 * приказ обязан пережить такт размышления пилота и лечь в его выбор цели/хода.
 * Это база, работающая и без всякой LLM: те же функции дёргает и речь, и кнопка.
 */

/** Мир без пояса/патрулей: только эскорт игрока и одинокий пират в 300 м. */
function withEscortAndPirate(): { world: World; escort: ShipEntity; pirate: ShipEntity } {
  const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
  const player = world.player
  player.state.pos.set(0, 0, 0)

  const escort = makeShip(world.ids, 'police', 'Эскорт', pirateLoadout(), new Vector3(30, 0, 0), new Quaternion(), world.rng)
  escort.ai = createAIState(player.state.pos, world.rng)
  escort.ai.escortOf = player.id
  world.ships.push(escort)

  const pirate = makeShip(world.ids, 'hostile', 'Пират', pirateLoadout(), new Vector3(0, 0, -300), new Quaternion(), world.rng)
  pirate.ai = createAIState(new Vector3(0, 0, -300), world.rng)
  world.ships.push(pirate)

  return { world, escort, pirate }
}

/** Прогнать один такт РАЗМЫШЛЕНИЯ: обнуляем таймер, чтобы пилот пересмотрел решение. */
function think(world: World, ship: ShipEntity): void {
  ship.ai!.thinkTimer = 0
  aiController.update(ship, world, 0.1)
}

describe('команды автоботу', () => {
  it('по умолчанию эскорт игрока сам защищает от врага рядом', () => {
    const { world, escort, pirate } = withEscortAndPirate()
    think(world, escort)
    // Пират рядом — наёмник берёт его сам, не дожидаясь захвата: компаньон, что
    // летит красиво, пока тебя разбирают, бесполезен. Захват лишь ПЕРЕнаправит его.
    expect(escort.ai!.targetId).toBe(pirate.id)
  })

  it('«атакуй всех» заставляет эскорта самому взять врага', () => {
    const { world, escort, pirate } = withEscortAndPirate()
    expect(orderEngageAll(escort)).toBe(true)
    think(world, escort)
    expect(escort.ai!.targetId).toBe(pirate.id)
  })

  it('«атакуй этого» назначает конкретную цель', () => {
    const { world, escort, pirate } = withEscortAndPirate()
    expect(orderAttack(escort, pirate.id)).toBe(true)
    think(world, escort)
    expect(escort.ai!.targetId).toBe(pirate.id)
  })

  it('«стой тут» глушит ход и не даёт стрелять', () => {
    const { world, escort } = withEscortAndPirate()
    orderEngageAll(escort) // сперва в бой…
    orderHold(escort) //     …а теперь стоять
    think(world, escort)
    expect(escort.controls.throttle) .toBe(0)
    expect(escort.ai!.wantsFire).toBe(false)
  })

  it('«держись в хвосте» уводит от врага и не даёт стрелять', () => {
    const { world, escort } = withEscortAndPirate()
    orderKeepBack(escort)
    think(world, escort)
    // Враг в 300 м — уходит на полном ходу, огня не ведёт, цель не берёт.
    expect(escort.controls.throttle).toBe(1)
    expect(escort.ai!.wantsFire).toBe(false)
    expect(escort.ai!.targetId).toBeNull()
  })

  it('«отбой» снимает бой даже при враге под носом', () => {
    const { world, escort } = withEscortAndPirate()
    orderEngageAll(escort)
    orderCeaseFire(escort)
    think(world, escort)
    expect(escort.ai!.targetId).toBeNull()
  })

  it('«вольно» возвращает обычное поведение', () => {
    const { world, escort, pirate } = withEscortAndPirate()
    orderAttack(escort, pirate.id)
    orderResume(escort)
    think(world, escort)
    // Снова обычный эскорт: приказа нет (default), но врага рядом сам защищает.
    expect(escort.ai!.command).toBe('default')
    expect(escort.ai!.targetId).toBe(pirate.id)
  })

  it('приказ «атакуй этого» сам снимается, когда цель гибнет', () => {
    const { world, escort, pirate } = withEscortAndPirate()
    orderAttack(escort, pirate.id)
    pirate.alive = false
    think(world, escort)
    expect(escort.ai!.command).toBe('default')
  })

  /**
   * `applyOrder` — одна дверь для кнопки и распознанного из речи приказа: имя приказа
   * ложится в то же поведение, что и прямой вызов. attack без цели не отдаётся.
   */
  it('applyOrder разводит приказ по имени, attack требует цель', () => {
    const { world, escort, pirate } = withEscortAndPirate()

    expect(applyOrder(escort, 'attack')).toBe(false) // без цели — некого бить
    expect(applyOrder(escort, 'attack', pirate.id)).toBe(true)
    think(world, escort)
    expect(escort.ai!.targetId).toBe(pirate.id)

    expect(applyOrder(escort, 'hold')).toBe(true)
    expect(escort.ai!.command).toBe('hold')

    // Борту без пилота-бота приказывать некому.
    escort.ai = null
    expect(applyOrder(escort, 'engageAll')).toBe(false)
  })
})
