import { describe, expect, it } from 'vitest'
import { parseModelReply } from './modelReply'

describe('parseModelReply', () => {
  it('clarify:true — только переспрос, без команд', () => {
    const r = parseModelReply(
      {
        reply: 'Не уловил перевод — расклады по шагам?',
        clarify: true,
        plan: [{ step: 'buy', module: 'pulse_1' }],
        intent: 'escort',
      },
      ['escort'],
    )
    expect(r?.clarify).toBe(true)
    expect(r?.commands).toEqual([])
  })

  it('понял объяснение — learn тихо и plan на исполнение', () => {
    const r = parseModelReply(
      {
        reply: 'Понял, командир. Беру лазер и иду за тобой.',
        clarify: false,
        learn: '«прикрывай» → купить лазер, встать в эскорт',
        plan: [{ step: 'buy', module: 'pulse_1' }, { step: 'escort', cover: true }],
      },
      [],
    )
    expect(r?.clarify).toBeUndefined()
    expect(r?.commands.map((c) => c.action)).toEqual(['learn', 'plan'])
  })
})
