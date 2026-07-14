import type { Command, DialogueEffects, ShipEntity, World } from '@elite/sim'
import { moodTo } from '@elite/sim'
import type { Emotion } from '../portrait'

/** Сколько держится реакция на реплику, мс — по стенным часам, не по `world.time`. */
export const DIALOGUE_REACTION_MS = 2800

/** Спокойное лицо в разговоре: без «вечной злости» от претензии — она для HUD, не для гримасы. */
export function dialogueBaseline(world: World, other: ShipEntity): Emotion {
  if (moodTo(world, other) === 'warm') return 'joy'
  return 'neutral'
}

function socialTone(cmd: Command): 'insult' | 'flatter' | null {
  if (cmd.action !== 'social') return null
  const tone = (cmd.payload as { tone?: string } | null)?.tone
  return tone === 'insult' || tone === 'flatter' ? tone : null
}

/** Мгновенная реакция на ход: оскорбление, лесть, отказ, согласие. */
export function dialogueReaction(commands: Command[], fx: Pick<DialogueEffects, 'askOutcome'>): Emotion | null {
  for (const cmd of commands) {
    const tone = socialTone(cmd)
    if (tone === 'insult') return 'anger'
    if (tone === 'flatter') return 'joy'
  }
  if (fx.askOutcome) {
    if (!fx.askOutcome.agreed) return 'anger'
    if (fx.askOutcome.topic === 'surrender' || fx.askOutcome.topic === 'plunder') return 'sadness'
    if (fx.askOutcome.topic === 'escort') return 'joy'
  }
  return null
}
