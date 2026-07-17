import type { Command, DialogueEffects, ShipEntity, World } from '@elite/sim'
import { moodTo } from '@elite/sim'
import type { Emotion } from '../portrait'

/** Сколько держится реакция на реплику, мс — по стенным часам, не по `world.time`. */
export const DIALOGUE_REACTION_MS = 2800

/**
 * Лицо, с которого разговор НАЧИНАЕТСЯ — расположение борта к тебе, и только оно.
 *
 * Читаем настроение честно, а не «тёплый или все прочие»: раньше враг и равнодушный имели
 * одинаковую нейтральную морду, и расположение по лицу не читалось вовсе.
 *
 * ПРЕТЕНЗИЯ в лицо НЕ идёт: насторожённый (`wary`) остаётся нейтральным. Обида — это канал
 * HUD, а не вечная гримаса в разговоре; сделай её лицом — и оно залипнет на весь диалог.
 *
 * Это именно СТАРТ, а не то, к чему лицо обязано возвращаться после каждой реплики: дальше
 * его ведёт разговор (см. `Dialogue`), иначе дружелюбный лыбился бы всегда и на что угодно.
 */
export function dialogueBaseline(world: World, other: ShipEntity): Emotion {
  switch (moodTo(world, other)) {
    case 'warm': return 'joy'
    case 'hostile': return 'anger'
    default: return 'neutral'
  }
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
