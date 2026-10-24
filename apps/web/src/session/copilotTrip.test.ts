import { afterEach, describe, expect, it } from 'vitest'
import { aiController, createWorld, GALAXY, jumpDistance, makePersona, makeRng, stepWorld, type Controller, type World } from '@elite/sim'
import { cancelTrip, stepCopilotTrip, tripActive, tripController, tripGrowHeld, tripSteersStraight } from './copilotTrip'
import { closePortal, jumpPortal, markPortalDestinationDrawn, tickPortal } from './jumpPortal'

/**
 * Рейс второго пилота — от «летим туда» до пересечения кольца: отчалить, отойти, встать,
 * раскрыть кольцо, войти. Мир шагает настоящим `stepWorld`, штурвал — тот же, что выбирает
 * кадр клиента (ИИ пилота, у кольца — прямой), кольцо — тем же `tickPortal`, что и в кадре клиента. Дальний мир здесь не строим:
 * событие «cross» — и есть приход рейса к кольцу.
 */

function reachable(world: World): number {
  for (let index = 0; index < GALAXY.COUNT; index++) {
    if (index === world.systemIndex) continue
    if (jumpDistance(world, index) <= world.player.jumpCharge) return index
  }
  throw new Error('нет системы в дальности')
}

function withCopilot(): World {
  const world = createWorld()
  world.copilot = { acquaintanceId: -1, name: 'Тест', persona: makePersona(makeRng(1)), xp: 0, paidUntil: Infinity }
  world.player.jumpCharge = world.player.spec.jumpRange
  return world
}

afterEach(() => {
  closePortal()
  cancelTrip(createWorld(), true)
})

describe('рейс второго пилота', () => {
  it('отходит, встаёт, раскрывает кольцо и входит в него', () => {
    const world = withCopilot()
    const target = reachable(world)
    world.tripRequest = { system: target, target: null }
    const controllers = new Map<number, Controller>([[world.player.id, aiController]])
    let crossed = false
    for (let frame = 0; frame < 60 * 180 && !crossed; frame++) {
      stepCopilotTrip(world)
      controllers.set(world.player.id, tripSteersStraight() ? tripController : aiController)
      stepWorld(world, 1 / 60, controllers, { unassigned: aiController })
      if (jumpPortal().open) {
        markPortalDestinationDrawn()
        crossed = tickPortal(world, tripGrowHeld(), world.time) === 'cross'
      }
    }
    expect(crossed).toBe(true)
    expect(jumpPortal().index).toBe(target)
    // Полминуты мира настоящим stepWorld — несколько секунд счёта: лимит с запасом от нагрузки.
  }, 30_000)

  it('отмена снимает рейс, закрывает его кольцо и отдаёт штурвал', () => {
    const world = withCopilot()
    world.tripRequest = { system: reachable(world), target: null }
    stepCopilotTrip(world)
    expect(tripActive()).toBe(true)
    world.tripRequest = 'cancel'
    stepCopilotTrip(world)
    expect(tripActive()).toBe(false)
    expect(world.player.ai).toBeNull()
  })
})
