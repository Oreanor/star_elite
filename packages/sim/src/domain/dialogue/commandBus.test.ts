import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, rememberPilot, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { applyCommand, registerCommand } from './commandBus'
import { escortFee } from './dialogue'

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
  world.calendarTime = 42_000
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
    expect(deal).toEqual({ kind: 'deal', at: world.calendarTime, toPlayer: true, credits: 5000, commodityName: null, units: 0 })
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
    expect(note).toEqual({ kind: 'note', at: world.calendarTime, text: 'торгует рудой в системе Лейв' })
  })

  it('stance меняет отношение в записи знакомого, а «hostile» делает мирного врагом', () => {
    const { world, ship } = withAcquaintance()
    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)!
    expect(rec.relationship).not.toBe('friendly')

    applyCommand(world, ship, { action: 'stance', payload: { stance: 'friendly' } })
    expect(rec.relationship).toBe('friendly')

    // Озлобился: мирный борт по фракции становится враждебным (это уже дело боя, не слов).
    applyCommand(world, ship, { action: 'stance', payload: { stance: 'hostile' } })
    expect(rec.relationship).toBe('hostile')
    expect(ship.faction).toBe('hostile')
  })

  it('mapEdit — только богу: смертный карту не правит, бог правит (дельта + epoch)', () => {
    const { world, ship } = withAcquaintance()
    // Смертный карту мироздания не трогает — молча null, дельта пуста.
    expect(applyCommand(world, ship, { action: 'mapEdit', payload: { op: 'recolor', color: 0xff0000 } })).toBeNull()
    expect(world.galaxyDelta.edits.length).toBe(0)

    // Бог правит: правка ложится в дельту, galaxyEpoch растёт (читатели карты пересоберут).
    ship.divine = true
    const epochBefore = world.galaxyEpoch
    const out = applyCommand(world, ship, { action: 'mapEdit', payload: { op: 'recolor', index: 7, color: 0x00ff00 } })
    expect(out?.line).toBeTruthy()
    expect(world.galaxyDelta.edits).toContainEqual({ op: 'recolor', index: 7, color: 0x00ff00 })
    expect(world.galaxyEpoch).toBe(epochBefore + 1)
  })

  it('неизвестная команда — молча null, а не падение (старый домен, новая команда по сети)', () => {
    const { world, ship } = withAcquaintance()
    expect(applyCommand(world, ship, { action: 'нет-такой', payload: {} })).toBeNull()
  })

  it('LLM-просьба эскорта без денег — blocked, не кость say', () => {
    const { world, ship } = withAcquaintance()
    world.credits = 0

    const out = applyCommand(world, ship, { action: 'ask', payload: { topic: 'escort', llm: true } })

    expect(out?.agreed).toBe(false)
    expect(out?.spoken).toBe('НЕ ХВАТАЕТ КРЕДИТОВ')
    expect(ship.ai?.escortOf).not.toBe(world.player.id)
  })

  it('LLM-просьба эскорта с деньгами — applyOutcome без кости', () => {
    const { world, ship } = withAcquaintance()
    const fee = escortFee(world, ship)!
    world.credits = fee + 500

    const out = applyCommand(world, ship, { action: 'ask', payload: { topic: 'escort', llm: true } })

    expect(out?.agreed).toBe(true)
    expect(ship.ai?.escortOf).toBe(world.player.id)
    expect(world.credits).toBe(500)
  })

  it('learn записывает мету переводчика тихо в журнал', () => {
    const { world, ship } = withAcquaintance()
    const out = applyCommand(world, ship, {
      action: 'learn',
      payload: { text: '«прикрывай» → купить лазер, эскорт, бить врагов нанимателя' },
    })
    expect(out?.line).toBeNull()
    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)!
    const note = rec.history.find((e) => e.kind === 'note')
    expect(note).toMatchObject({
      kind: 'note',
      text: 'МЕТА: «прикрывай» → купить лазер, эскорт, бить врагов нанимателя',
    })
  })

  it('поручение collect ставит задачи в очередь', () => {
    const { world, ship } = withAcquaintance()
    if (!ship.ai) throw new Error('no ai')
    ship.ai.escortOf = world.player.id

    const out = applyCommand(world, ship, {
      action: 'task',
      payload: { kind: 'collect-cargo', radius: 2000 },
    })

    expect(out?.spoken).toContain('СОБИРАЮ')
    expect(ship.ai.tasks.length).toBe(2)
  })

  it('plan с collect исполняет задачу без очереди ContactPlan', () => {
    const { world, ship } = withAcquaintance()
    if (!ship.ai) throw new Error('no ai')
    ship.ai.escortOf = world.player.id

    const out = applyCommand(world, ship, {
      action: 'plan',
      payload: { steps: [{ step: 'collect' }] },
    })

    expect(out?.spoken).toContain('СОБИРАЮ')
    expect(ship.ai.tasks.length).toBe(2)
    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)!
    expect(rec.plan.queue).toHaveLength(0)
  })

  it('макро-план с escort ставит posture на знакомом', () => {
    const { world, ship } = withAcquaintance()
    if (!ship.ai) throw new Error('no ai')
    ship.ai.dock = 'berthed'

    const out = applyCommand(world, ship, {
      action: 'plan',
      payload: { steps: [{ step: 'escort', cover: true }] },
    })

    expect(out?.line).toBeTruthy()
    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)!
    expect(rec.plan.posture).toBe('cover')
    expect(rec.plan.patronId).toBe(world.player.id)
  })

  it('demand/tip/mark ложатся в журнал знакомого с понятными пометками', () => {
    const { world, ship } = withAcquaintance()
    applyCommand(world, ship, { action: 'demand', payload: { text: 'сбрось груз' } })
    applyCommand(world, ship, { action: 'tip', payload: { text: 'в Лейве дёшев металл' } })
    applyCommand(world, ship, { action: 'mark', payload: { text: 'станция Орбис' } })
    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)!
    const texts = rec.history.filter((e) => e.kind === 'note').map((e) => (e as { text: string }).text)
    expect(texts).toContain('ТРЕБОВАНИЕ: сбрось груз')
    expect(texts).toContain('СОВЕТ: в Лейве дёшев металл')
    expect(texts).toContain('МЕТКА: станция Орбис')
  })

  it('flee уводит бота в отрыв, гасит огонь и метит бегство в журнал', () => {
    const { world, ship } = withAcquaintance()
    if (!ship.ai) throw new Error('no ai')
    ship.ai.mode = 'attack'
    ship.ai.targetId = world.player.id
    ship.ai.wantsFire = true

    applyCommand(world, ship, { action: 'flee', payload: {} })

    expect(ship.ai.mode).toBe('evade')
    expect(ship.ai.targetId).toBeNull()
    expect(ship.ai.wantsFire).toBe(false)
    // С приводом — заряжает прыжок-побег; без него просто уходит (тогда таймер не тронут).
    if (ship.spec.jumpRange > 0) expect(ship.ai.warpTimer).toBeGreaterThanOrEqual(0)
    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)!
    expect(rec.history.some((e) => e.kind === 'note' && (e as { text: string }).text === 'бежал из боя')).toBe(true)
  })

  it('surrender НЕВРЕДИМОГО врага — молча null: без эксплойта «сдача даром» (сначала сбей щит)', () => {
    const { world, ship } = withAcquaintance()
    ship.faction = 'hostile' // враг, но полного здоровья — тема surrender заблокирована
    expect(applyCommand(world, ship, { action: 'surrender', payload: {} })).toBeNull()
    expect(ship.faction).toBe('hostile') // остался врагом, даром не уболтали
  })

  it('surrender проигрывающего врага исполняется: он становится мирным', () => {
    const { world, ship } = withAcquaintance()
    ship.faction = 'hostile'
    ship.hull = ship.spec.hull.hull * 0.5 // щит сбит, корпус побит — сдача разблокирована

    const out = applyCommand(world, ship, { action: 'surrender', payload: {} })

    expect(out?.line).toContain('сдал')
    expect(ship.faction).toBe('neutral')
  })

  it('meet заводит знакомство с ещё безымянным бортом и даёт строку о нём', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'Кто-то' }],
    })
    const ship = world.ships[0]!
    expect(ship.acquaintanceId).toBeNull()

    const out = applyCommand(world, ship, { action: 'meet', payload: {} })

    expect(ship.acquaintanceId).not.toBeNull()
    expect(out?.line).toContain('Знакомство')
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
