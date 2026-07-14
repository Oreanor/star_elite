import { describe, expect, it } from 'vitest'
import { dialogueBaseline, dialogueReaction } from './dialogueFace'

describe('dialogueFace', () => {
  it('insult даёт злость, flatter — радость', () => {
    expect(dialogueReaction([{ action: 'social', payload: { tone: 'insult' } }], { askOutcome: null })).toBe('anger')
    expect(dialogueReaction([{ action: 'social', payload: { tone: 'flatter' } }], { askOutcome: null })).toBe('joy')
  })

  it('отказ просьбы — злость, согласие на эскорт — радость', () => {
    expect(dialogueReaction([], { askOutcome: { topic: 'escort', agreed: false } })).toBe('anger')
    expect(dialogueReaction([], { askOutcome: { topic: 'escort', agreed: true } })).toBe('joy')
  })

  it('baseline: warm — радость, претензия не влияет на базу', () => {
    const world = { acquaintances: [{ id: 1, relationship: 'friendly' as const }] } as Parameters<typeof dialogueBaseline>[0]
    const warm = { faction: 'neutral' as const, acquaintanceId: 1, ai: { grievance: 0 } } as Parameters<typeof dialogueBaseline>[1]
    expect(dialogueBaseline(world, warm)).toBe('joy')
    const gripe = { faction: 'neutral' as const, acquaintanceId: 1, ai: { grievance: 2 } } as Parameters<typeof dialogueBaseline>[1]
    expect(dialogueBaseline(world, gripe)).toBe('neutral')
  })
})
