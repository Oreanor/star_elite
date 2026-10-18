import { COPILOT } from '../../config/crew'
import { isFoe } from '../ai/targeting'
import { isEngageable } from '../combat/engage'
import { moduleFault } from '../station/moduleState'
import { distanceToBody } from '../station/docking'
import type { World } from '../world/entities'
import { brokenModules, copilotRank, copilotRepairQuote, copilotSalary } from './copilot'
import { xpToNextRank } from './rank'

/**
 * СВОДКА ВТОРОГО ПИЛОТА — что он видит из кабины прямо сейчас: тела системы, борта на
 * локаторе, контейнеры, состояние корабля. Голые факты с id: модель выбирает цель по id из
 * сводки, а не по имени — имя можно перепутать, id домен проверит. Чистое чтение мира.
 */
export interface CopilotBriefing {
  name: string
  rank: number
  /** Опыта до следующего ранга; `null` — ас. */
  xpToNext: number | null
  salary: number
  playerRank: number
  docked: boolean
  /** Что сейчас делает за штурвалом. */
  helm: 'idle' | 'fight' | 'fightAll' | 'collect' | 'flee' | 'cruise'
  credits: number
  bodies: { id: number; name: string; kind: string; distanceM: number; populated: boolean }[]
  /** Борта на локаторе, ближние первыми. */
  contacts: { id: number; name: string; chassis: string; foe: boolean; faction: string; rank: number; distanceM: number }[]
  /** Контейнеров на локаторе. */
  pods: number
  /** Корпус, доля целого, и цена его ремонта вторым пилотом (0 — цел). */
  hull: { share: number; repairPrice: number }
  /** Сломанные детали: номер (с 1) — ссылка для `repair`. */
  broken: { n: number; moduleId: string; faultPct: number; price: number }[]
}

const CONTACTS_LIMIT = 12

export function copilotBriefing(world: World): CopilotBriefing | null {
  const copilot = world.copilot
  if (!copilot) return null
  const player = world.player
  const pos = player.state.pos
  const range2 = COPILOT.SCAN_RANGE ** 2
  const rank = copilotRank(copilot)
  const ai = player.ai
  const task = ai?.tasks[0]
  const helm: CopilotBriefing['helm'] = task
    ? task.kind === 'collect-cargo' ? 'collect' : 'flee'
    : ai
      ? ai.chainFoes ? 'fightAll' : 'fight'
      : world.helmRequest === 'flyto' ? 'cruise' : 'idle'

  return {
    name: copilot.name,
    rank,
    xpToNext: xpToNextRank(copilot.xp),
    salary: copilotSalary(rank),
    playerRank: player.rank,
    docked: world.docked,
    helm,
    credits: world.credits,
    bodies: world.bodies
      .map((b) => ({ id: b.id, name: b.name, kind: b.kind, distanceM: Math.round(distanceToBody(world, b)), populated: b.population > 0 }))
      .sort((a, b) => a.distanceM - b.distanceM),
    contacts: world.ships
      .filter((s) => s.alive && isEngageable(s) && s.state.pos.distanceToSquared(pos) <= range2)
      .map((s) => ({
        id: s.id,
        name: s.name,
        chassis: s.loadout.chassis.name,
        foe: isFoe(player, s),
        faction: s.faction,
        rank: s.rank,
        distanceM: Math.round(s.state.pos.distanceTo(pos)),
      }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, CONTACTS_LIMIT),
    pods: world.pods.filter((p) => p.alive && p.pos.distanceToSquared(pos) <= range2).length,
    hull: {
      share: player.spec.hull.hull > 0 ? player.hull / player.spec.hull.hull : 1,
      repairPrice: copilotRepairQuote(world, { kind: 'hull' })?.price ?? 0,
    },
    broken: brokenModules(world).map((m, i) => ({
      n: i + 1,
      moduleId: m.id,
      faultPct: Math.round(moduleFault(m) * 100),
      price: copilotRepairQuote(world, { kind: 'module', module: m })?.price ?? 0,
    })),
  }
}
