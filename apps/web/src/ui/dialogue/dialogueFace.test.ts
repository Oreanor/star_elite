import { describe, expect, it } from 'vitest'
import { dialogueBaseline, dialogueReaction } from './dialogueFace'

describe('dialogueFace', () => {
  it('лицо — по РЕАКЦИИ нрава: бежит — страх, огрызается или дерётся — злость, оттаял — радость', () => {
    expect(dialogueReaction({ askOutcome: null, reaction: 'flee' })).toBe('fear')
    expect(dialogueReaction({ askOutcome: null, reaction: 'bristle' })).toBe('anger')
    expect(dialogueReaction({ askOutcome: null, reaction: 'fight' })).toBe('anger')
    expect(dialogueReaction({ askOutcome: null, reaction: 'soften' })).toBe('joy')
  })

  it('отказ просьбы — злость, согласие на эскорт — радость', () => {
    expect(dialogueReaction({ askOutcome: { topic: 'escort', agreed: false }, reaction: null })).toBe('anger')
    expect(dialogueReaction({ askOutcome: { topic: 'escort', agreed: true }, reaction: null })).toBe('joy')
  })

  it('baseline: warm — радость, претензия не влияет на базу', () => {
    // Игрок в подделке нужен: отношение смотрит и на личную вражду с ним (`hostileToPlayer`).
    const player = { id: 0, faction: 'player' as const, ai: null }
    const world = { player, acquaintances: [{ id: 1, relationship: 'friendly' as const }] } as unknown as Parameters<typeof dialogueBaseline>[0]
    const warm = { faction: 'neutral' as const, acquaintanceId: 1, ai: { grievance: 0, foes: [] } } as unknown as Parameters<typeof dialogueBaseline>[1]
    expect(dialogueBaseline(world, warm)).toBe('joy')
    const gripe = { faction: 'neutral' as const, acquaintanceId: 1, ai: { grievance: 2, foes: [] } } as unknown as Parameters<typeof dialogueBaseline>[1]
    expect(dialogueBaseline(world, gripe)).toBe('neutral')
  })
})
