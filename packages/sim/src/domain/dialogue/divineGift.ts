import { MIELOPHONE_DEVICE } from '../../config/modules'
import { addItem } from '../cargo/hold'
import { allModules } from '../loadout'
import { recordEvent, rememberPilot } from '../world/acquaintance'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'

/**
 * ДАР БОГА. Слово даёт КОПИЮ миелофона каждому, с кем договорится собирать ему статуи богов:
 * ему ничего не стоит повторить свой инструмент, а делить один на всех игроков — мучение.
 * Договорился ли — решает разговор (модель распознаёт согласие); можно ли дать — домен:
 *
 *   • бог не во гневе на смертного;
 *   • этому смертному он ещё не давал (раз на игрока — иначе дар стал бы станком денег);
 *   • в трюме есть место.
 *
 * Дар ложится в журнал знакомства, а с ним — в общую память бога: другие смертные узнают.
 */
export type GiftRefusal = 'not-god' | 'hostile' | 'given' | 'hold-full'

export function giveMielophone(world: World, god: ShipEntity): GiftRefusal | null {
  if (!god.divine) return 'not-god'
  rememberPilot(world, god)
  const rec = world.acquaintances.find((a) => a.id === god.acquaintanceId)
  if (!rec) return 'not-god'
  if (rec.relationship === 'hostile') return 'hostile'
  const player = world.player
  const has =
    allModules(player.loadout).some((m) => m.kind === 'mielophone') ||
    player.hold.items.some((it) => it.kind === 'module' && it.module.kind === 'mielophone')
  if (rec.mielophoneGiven || has) return 'given'
  if (!addItem(player.hold, { kind: 'module', module: MIELOPHONE_DEVICE })) return 'hold-full'
  refreshSpec(player)
  rec.mielophoneGiven = true
  recordEvent(world, god, { kind: 'deal', toPlayer: true, credits: 0, commodityName: MIELOPHONE_DEVICE.name, units: 1 })
  return null
}
