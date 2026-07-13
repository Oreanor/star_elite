import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, rememberPilot, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { applyCommand, registerCommand } from './commandBus'

/**
 * Шина команд боту. Проверяем без окна: команда — данные {action, payload}, а её
 * исполнение и запись в журнал знакомства — чистый домен. Здесь стережём главное:
 * одна шина исполняет разные команды, каждая ложится в ОДИН журнал, а состоявшееся —
 * помнится (ради чего всё и затевалось: бот, отдавший денег, при встрече помнит подарок).
 */

function withAcquaintance(): { world: World; ship: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'Кто-то' }],
  })
  const ship = world.ships[0]!
  rememberPilot(world, ship) // теперь у борта есть запись — журнал есть куда писать
  return { world, ship }
}

describe('шина команд боту', () => {
  it('передача денег игроку зачисляется и ЛОЖИТСЯ В ЖУРНАЛ как дело', () => {
    const { world, ship } = withAcquaintance()
    const before = world.credits

    const out = applyCommand(world, ship, { action: 'transfer', payload: { direction: 'toYou', credits: 5000 } })

    expect(world.credits).toBe(before + 5000)
    expect(out?.line).toContain('5000')
    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)!
    const deal = rec.history.find((e) => e.kind === 'deal')
    expect(deal).toEqual({ kind: 'deal', at: world.time, toPlayer: true, credits: 5000, commodityName: null, units: 0 })
  })

  it('пустая сделка миром не двигает и в журнал не пишется', () => {
    const { world, ship } = withAcquaintance()
    const before = world.credits

    const out = applyCommand(world, ship, { action: 'transfer', payload: { direction: 'toYou', credits: 0 } })

    expect(out).toBeNull()
    expect(world.credits).toBe(before)
    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)!
    expect(rec.history.some((e) => e.kind === 'deal')).toBe(false)
  })

  it('«запомни факт» кладёт заметку в личный журнал знакомого', () => {
    const { world, ship } = withAcquaintance()

    applyCommand(world, ship, { action: 'note', payload: { text: '  торгует рудой в системе Лейв  ' } })

    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)!
    const note = rec.history.find((e) => e.kind === 'note')
    expect(note).toEqual({ kind: 'note', at: world.time, text: 'торгует рудой в системе Лейв' })
  })

  it('неизвестная команда — молча null, а не падение (старый домен, новая команда по сети)', () => {
    const { world, ship } = withAcquaintance()
    expect(applyCommand(world, ship, { action: 'нет-такой', payload: {} })).toBeNull()
  })

  it('реестр открыт: новую команду добавляют регистрацией, не правкой шины', () => {
    const { world, ship } = withAcquaintance()
    let seen: unknown = null
    registerCommand('test-echo', (_w, _s, payload) => {
      seen = payload
      return { line: 'эхо' }
    })

    const out = applyCommand(world, ship, { action: 'test-echo', payload: { n: 42 } })

    expect(out?.line).toBe('эхо')
    expect(seen).toEqual({ n: 42 })
  })
})
