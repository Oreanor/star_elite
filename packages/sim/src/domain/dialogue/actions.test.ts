import { describe, expect, it } from 'vitest'
import { actionsForRole } from './actions'
import { parseModelReply } from './modelReply'

/**
 * Пул экшнов и наборы ролей. Стережём главное: способности берутся ИЗ ДАННЫХ по роли,
 * а не из лестницы `if`. Бог правит иным набором, чем смертный, и парсер это соблюдает —
 * пришлёт бог `plan`, команда просто не соберётся. Роль решает и набор эмоций.
 */
describe('пул экшнов и наборы ролей', () => {
  it('у бога иной набор: нет боевых/торговых, но есть stance/social/note', () => {
    const bot = actionsForRole('bot').map((a) => a.id)
    const god = actionsForRole('god').map((a) => a.id)
    expect(bot).toEqual(expect.arrayContaining(['ask', 'order', 'transfer', 'plan', 'stance']))
    expect(god).toEqual(expect.arrayContaining(['stance', 'social', 'note']))
    expect(god).not.toContain('plan')
    expect(god).not.toContain('order')
    expect(god).not.toContain('transfer')
  })

  it('stance собирается в команду и боту, и богу', () => {
    for (const role of ['bot', 'god'] as const) {
      const r = parseModelReply({ reply: 'Быть посему.', stance: 'friendly' }, [], role)!
      expect(r.commands).toContainEqual({ action: 'stance', payload: { stance: 'friendly' } })
    }
  })

  it('богу недоступен plan: пришлёт — команда не соберётся, боту соберётся', () => {
    const json = { reply: '…', plan: [{ step: 'collect' }] }
    expect(parseModelReply(json, [], 'bot')!.commands.some((c) => c.action === 'plan')).toBe(true)
    expect(parseModelReply(json, [], 'god')!.commands.some((c) => c.action === 'plan')).toBe(false)
  })

  it('intent проходит только если тема РАЗРЕШЕНА сейчас', () => {
    const json = { reply: '…', intent: 'escort' }
    expect(parseModelReply(json, [], 'bot')!.commands.some((c) => c.action === 'ask')).toBe(false)
    expect(parseModelReply(json, ['escort'], 'bot')!.commands.some((c) => c.action === 'ask')).toBe(true)
  })

  it('эмоция валидируется по роли: у бога 8 (smile), у смертного 6 (joy)', () => {
    expect(parseModelReply({ reply: 'x', emotion: 'smile' }, [], 'god')!.emotion).toBe('smile')
    expect(parseModelReply({ reply: 'x', emotion: 'smile' }, [], 'bot')!.emotion).toBeNull()
    expect(parseModelReply({ reply: 'x', emotion: 'joy' }, [], 'bot')!.emotion).toBe('joy')
    expect(parseModelReply({ reply: 'x', emotion: 'joy' }, [], 'god')!.emotion).toBeNull()
  })

  it('новые экшны бота собираются в команды из своих полей', () => {
    const cmd = (json: Record<string, unknown>, action: string) =>
      parseModelReply({ reply: '…', ...json }, [], 'bot')!.commands.find((c) => c.action === action)
    expect(cmd({ demand: 'сбрось груз' }, 'demand')).toEqual({ action: 'demand', payload: { text: 'сбрось груз' } })
    expect(cmd({ surrender: true }, 'surrender')).toEqual({ action: 'surrender', payload: {} })
    expect(cmd({ flee: true }, 'flee')).toEqual({ action: 'flee', payload: {} })
    expect(cmd({ depart: true }, 'depart')).toEqual({ action: 'depart', payload: {} })
    expect(cmd({ meet: true }, 'meet')).toEqual({ action: 'meet', payload: {} })
    expect(cmd({ tip: 'в Лаве дёшев металл' }, 'tip')).toEqual({ action: 'tip', payload: { text: 'в Лаве дёшев металл' } })
    expect(cmd({ mark: 'станция Орбис' }, 'mark')).toEqual({ action: 'mark', payload: { text: 'станция Орбис' } })
  })

  it('пустые/ложные поля новых экшнов команду НЕ рождают', () => {
    const none = (json: Record<string, unknown>) => parseModelReply({ reply: '…', ...json }, [], 'bot')!.commands
    expect(none({ surrender: false }).some((c) => c.action === 'surrender')).toBe(false)
    expect(none({ demand: '   ' }).some((c) => c.action === 'demand')).toBe(false)
    expect(none({ tip: '' }).some((c) => c.action === 'tip')).toBe(false)
  })

  it('новые экшны — только боту: бог их не получает', () => {
    const god = actionsForRole('god').map((a) => a.id)
    for (const id of ['demand', 'surrender', 'flee', 'depart', 'meet', 'tip', 'mark']) {
      expect(god).not.toContain(id)
    }
  })

  it('уход (flee/depart) стоит в пуле ПОСЛЕ прочих: бот доигрывает реплику, потом бежит', () => {
    const ids = actionsForRole('bot').map((a) => a.id)
    const last = Math.max(ids.indexOf('flee'), ids.indexOf('depart'))
    for (const before of ['ask', 'transfer', 'demand', 'surrender', 'plan']) {
      expect(ids.indexOf(before)).toBeLessThan(last)
    }
  })
})
