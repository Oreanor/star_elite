import { RANK } from '../../config/crew'
import { clamp } from '../../core/math'
import type { Faction, ShipEntity, World } from '../world/entities'

/**
 * РАНГ ПИЛОТА: 10 (новичок) … 1 (ас). Опыт даёт только бой; ранг — это выучка, а выучка —
 * время реакции и кучность (`pilotSkill`). Урон, тяга и угловая скорость у всех одни.
 */

/** Индекс таблиц `RANK` / `COPILOT` по рангу: ранг 10 → 0, ранг 1 → 9. */
export function rankIndex(rank: number): number {
  return clamp(Math.round(RANK.WORST - rank), 0, RANK.WORST - RANK.BEST)
}

/** Ранг по накопленному опыту. */
export function rankOfXp(xp: number): number {
  let index = 0
  for (let i = 0; i < RANK.XP.length; i++) if (xp >= RANK.XP[i]!) index = i
  return RANK.WORST - index
}

/** С какого опыта начинается ранг. */
export function xpForRank(rank: number): number {
  return RANK.XP[rankIndex(rank)]!
}

/** Опыт до следующего ранга; `null` — уже ас. */
export function xpToNextRank(xp: number): number | null {
  const next = RANK.XP[rankIndex(rankOfXp(xp)) + 1]
  return next === undefined ? null : next - xp
}

/** Выучка по рангу: ранг 7 — единица, шаг `SKILL_STEP` за ранг. */
export function rankSkill(rank: number): number {
  return RANK.SKILL_AT_7 + (7 - rank) * RANK.SKILL_STEP
}

/**
 * Выучка того, кто СЕЙЧАС ведёт борт: ранг (у автобоя игрока — ранг второго пилота) на
 * поправку `ai.skill` (наёмник в эскорте нарочно слабее — это поправка, не ранг).
 */
export function pilotSkill(e: ShipEntity): number {
  const ai = e.ai
  return rankSkill(ai?.pilotRank ?? e.rank) * (ai?.skill ?? 1)
}

/** Хеш строки в 0..1 — FNV-1a. Ранг от имени не трогает `world.rng` и зерно мира. */
function unitHash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/**
 * Ранг бота от рождения — по имени пилота и фракции, по долям `RANK.SPAWN`. Тот же пилот
 * (знакомый, воссозданный в другой системе) — тот же ранг: имя у него то же.
 */
export function botRank(pilotName: string, faction: Faction): number {
  const table = faction === 'hostile' ? RANK.SPAWN.hostile : faction === 'police' ? RANK.SPAWN.police : RANK.SPAWN.other
  let u = unitHash(`${faction}:${pilotName}`)
  for (let i = 0; i < table.length; i++) {
    u -= table[i]!
    if (u < 0) return RANK.WORST - i
  }
  return RANK.BEST
}

/** Опыт за сбитого: чем сильнее пилот и крупнее корпус, тем больше. */
export function killXp(victim: ShipEntity): number {
  const cls = clamp(victim.loadout.chassis.class, 1, RANK.KILL_CLASS_CAP)
  return (RANK.WORST + 1 - clamp(victim.rank, RANK.BEST, RANK.WORST)) * cls
}

/**
 * Игрок сбил борт: опыт ему и второму пилоту (бой у них общий), ранг пересчитан.
 * Возвращает, вырос ли ранг игрока, — HUD может это отметить.
 */
export function awardKillXp(world: World, victim: ShipEntity): boolean {
  const gain = killXp(victim)
  const before = world.player.rank
  world.pilotXp += gain
  if (world.copilot) world.copilot.xp += gain
  world.player.rank = rankOfXp(world.pilotXp)
  return world.player.rank < before
}
