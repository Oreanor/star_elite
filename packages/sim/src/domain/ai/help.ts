import { HELP } from '../../config/ai'
import { stanceTo } from '../dialogue/dialogue'
import type { ShipEntity, World } from '../world/entities'
import { knowsOf } from './perception'
import { declareFoe, isFoe } from './targeting'
import { enqueueTask } from './tasks'

/**
 * ЗОВ НА ПОМОЩЬ. Мирного или игрока бьёт враг — жертва зовёт, и на зов идут:
 *   • ПОЛИЦИЯ — на нападение на мирного и на игрока; на игрока, напавшего на мирного, тоже;
 *   • ЗНАКОМЫЕ, дружные с игроком, — когда бьют его самого.
 * Прежде торговец, отказавший пирату, «звал на помощь» лишь строкой в эфире: никто не шёл.
 *
 * Зов — только на НАСТОЯЩЕЕ нападение: стрелок должен быть жертве врагом (`isFoe`). Случайное
 * попадание игрока в мирного до обиды (`grievance`) врагом его не делает — полиция не летит.
 * Отклик — правило, без кости: тот же мир, та же подмога.
 */

/** Может ли борт откликнуться: свободен, не стыкуется, не спит, не ведомый, не под приказом. */
function free(s: ShipEntity): boolean {
  const ai = s.ai
  if (!ai || !s.alive || s.kinematic || ai.dormant || s.warpDeparting) return false
  if (ai.command !== 'default' || ai.escortOf != null || ai.orderedSoft) return false
  if (ai.dock === 'inbound' || ai.dock === 'berthed') return false
  return ai.tasks.every((t) => t.own)
}

/** Откликнется ли `s` на зов `victim` против `attacker`. */
function answers(world: World, s: ShipEntity, victim: ShipEntity, attacker: ShipEntity): boolean {
  if (s === victim || s === attacker || !free(s)) return false
  if (s.faction === 'police') return attacker.faction !== 'police'
  return victim === world.player && s.acquaintanceId != null && stanceTo(world, s) === 'friendly'
}

/**
 * Позвать подмогу к `victim` против `attacker`: ближайшие отозвавшиеся в `HELP.RANGE`
 * объявляют стрелку личную вражду и летят к месту; увидев его, их поведёт обычный бой.
 */
export function callForHelp(world: World, victim: ShipEntity, attacker: ShipEntity): number {
  const r2 = HELP.RANGE * HELP.RANGE
  const candidates = world.ships
    .filter((s) => answers(world, s, victim, attacker) && s.state.pos.distanceToSquared(victim.state.pos) <= r2)
    .sort((a, b) => a.state.pos.distanceToSquared(victim.state.pos) - b.state.pos.distanceToSquared(victim.state.pos))
    .slice(0, HELP.MAX_RESPONDERS)
  for (const s of candidates) {
    if (!isFoe(s, attacker)) declareFoe(s, attacker)
    // Уже видит стрелка — бой и так начнётся; иначе — лететь к месту зова.
    if (!knowsOf(s, attacker, world)) {
      enqueueTask(s, { kind: 'goto', point: attacker.state.pos.clone(), arriveRadius: HELP.ARRIVE, own: true })
    }
  }
  return candidates.length
}

/**
 * Такт: кого в этом такте ударил враг — тот зовёт (не чаще `HELP.COOLDOWN`). Жертвы —
 * мирные и игрок: пират и полиция сами за себя, им звать некого.
 */
export function stepDistress(world: World, dt: number): void {
  const victims = world.player.alive ? [world.player, ...world.ships] : world.ships
  for (const v of victims) {
    if (!v.alive || v.lastAttackerId == null) continue
    if (v !== world.player && v.faction !== 'neutral') continue
    if (world.time - v.lastHitAt > dt * 1.5) continue
    if (v.helpCalledAt !== undefined && world.time - v.helpCalledAt < HELP.COOLDOWN) continue
    const attacker = v.lastAttackerId === world.player.id ? world.player : world.ships.find((s) => s.id === v.lastAttackerId)
    if (!attacker || !attacker.alive || !isFoe(v, attacker)) continue
    v.helpCalledAt = world.time
    callForHelp(world, v, attacker)
  }
}
