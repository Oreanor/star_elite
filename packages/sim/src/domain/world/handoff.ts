import { Vector3 } from 'three'
import { GRIEVANCE } from '../../config/ai'
import { createAIState, type AICommand, type DockPhase } from '../ai/types'
import { refreshSpec } from './factory'
import { rehydrateCargoItem, serializeCargoItem, type SavedCargoItem } from '../save/player'
import type { ContractOffer } from '../contracts/types'
import type { ShipEntity, World } from './entities'
import { promoteMirror } from './remote'

/**
 * ПЕРЕДАЧА БОРТА между клиентами. Правило общего мира: ботом правит тот, кто с ним ИМЕЕТ ДЕЛО —
 * заговорил с ним или задел его огнём. Иначе геймплей зависел бы от того, кто первым вошёл в
 * систему: у хозяина бот живой (нанять, ограбить, сопроводить), у гостя — копия, с которой
 * можно только болтать. Передача делает гостя хозяином этого борта, и правила те же.
 *
 * Домен про сеть не знает: здесь — что передаётся и как борт оживает у нового владельца.
 * Ссылки на другие борта (враги, цель) — словами провода: id у каждого клиента свои.
 */

/** Борт держит текущий владелец, отдавать нельзя: он работает на игрока или занят им. */
export function isBoundShip(world: World, s: ShipEntity): boolean {
  const playerId = world.player.id
  if (s.divine || s.bountyOf != null) return true
  if (s.ai?.escortOf === playerId || s.droneOf === playerId) return true
  // Бьётся с игроком этого клиента — уйти к другому посреди боя он не может.
  if (s.ai?.targetId === playerId) return true
  return world.contracts.some((c) => c.status === 'active' && c.progress.kind === 'rescue' && c.progress.clientShipId === s.id)
}

/**
 * Чужой игрок задел мирного: отдать борт стрелку, чтобы обида шла по тем же правилам, что у
 * своего (прощённые промахи, претензия по связи, ответный огонь). Не отдаём, если борт уже
 * занят своим игроком: тогда — сразу личный враг, как раньше.
 */
export function peerHitYields(world: World, s: ShipEntity): boolean {
  if (!s.alive || s.kinematic || !s.ai || s.faction !== 'neutral' || isBoundShip(world, s)) return false
  const ai = s.ai
  // Свой игрок недавно задел его сам — эпизод обиды здесь, борт не отдаём (иначе пинг-понг).
  const engaged = ai.strikeCount > 0 && world.time - ai.grievanceAt <= GRIEVANCE.COOLDOWN
  return !engaged && ai.grievance === 0 && !ai.foes.includes(world.player.id)
}

/** Состояние борта, которое не идёт реестром и кадром: трюм, оферта и память пилота. */
export interface ShipHandoff {
  hull: number
  shield: number
  energy: number
  aux: number
  hold: SavedCargoItem[]
  offer: ContractOffer | null
  /** У спасения — нападающие словами провода (их id у нового владельца другие). */
  attackers: string[]
  rescueAsked: boolean
  ai: {
    dock: DockPhase
    dockTimer: number
    warpTimer: number
    skill: number
    command: AICommand
    dormant: boolean
    missileCooldown: number
    /** Абсолютные координаты: плавающее начало у каждого клиента своё. */
    home: [number, number, number]
    waypoint: [number, number, number]
    foes: string[]
    target: string | null
    prey: string | null
    /** Давность, а не отметка: `world.time` у клиентов разный. */
    demandAgo: number | null
  } | null
}

const abs = (v: Vector3, o: Vector3): [number, number, number] => [v.x + o.x, v.y + o.y, v.z + o.z]

/** Снять с борта то, что новый владелец должен получить вместе с ним. */
export function captureHandoff(world: World, s: ShipEntity, refOf: (id: number) => string | null): ShipHandoff {
  const ai = s.ai
  const o = world.originOffset
  const ref = (id: number | null) => (id == null ? null : refOf(id))
  return {
    hull: s.hull,
    shield: s.shield,
    energy: s.energy,
    aux: s.auxEnergy,
    hold: s.hold.items.map(serializeCargoItem),
    offer: s.offer,
    attackers: s.offer?.kind === 'rescue' ? s.offer.attackers.map(refOf).filter((r): r is string => r != null) : [],
    rescueAsked: s.rescueAsked,
    ai: ai
      ? {
          dock: ai.dock,
          dockTimer: ai.dockTimer,
          warpTimer: ai.warpTimer,
          skill: ai.skill,
          command: ai.command,
          dormant: ai.dormant,
          missileCooldown: ai.missileCooldown,
          home: abs(ai.home, o),
          waypoint: abs(ai.waypoint, o),
          foes: ai.foes.map(refOf).filter((r): r is string => r != null),
          target: ref(ai.targetId),
          prey: ref(ai.preyId),
          demandAgo: ai.demandAt >= 0 ? world.time - ai.demandAt : null,
        }
      : null,
  }
}

/**
 * Отдать борт: у прежнего владельца он становится копией (позу дальше шлёт новый). Пилот не
 * стирается — вернётся борт, оживёт с той же памятью.
 */
export function releaseShip(s: ShipEntity): void {
  s.kinematic = true
  s.mirror = true
  s.mirrorFiring = false
  s.claimed = undefined
}

/**
 * Принять борт: копия оживает здесь со снятым у прежнего владельца состоянием. `origin` —
 * прежний сетевой ключ: у остальных копия лишь сменит владельца, не мигнув.
 */
export function adoptShip(
  world: World,
  s: ShipEntity,
  h: ShipHandoff,
  origin: string,
  resolve: (ref: string) => number | null,
): void {
  promoteMirror(world, s, origin)
  s.claimed = true
  s.hull = Math.min(h.hull, s.spec.hull.hull)
  s.shield = Math.min(h.shield, s.spec.hull.shield)
  s.energy = h.energy
  s.auxEnergy = h.aux
  s.hold.items = h.hold.map(rehydrateCargoItem).filter((it): it is NonNullable<typeof it> => it != null)
  refreshSpec(s)
  // Слышал ли оферту — дело этого игрока, а не прежнего владельца.
  const heard = s.offer != null && h.offer != null && s.offer.kind === h.offer.kind && s.offer.revealed
  s.offer = h.offer ? { ...h.offer, revealed: heard } : null
  if (s.offer?.kind === 'rescue') s.offer.attackers = h.attackers.map(resolve).filter((id): id is number => id != null)
  s.rescueAsked = h.rescueAsked
  const src = h.ai
  if (!src) return
  const o = world.originOffset
  const ai = (s.ai ??= createAIState(s.state.pos, world.rng))
  ai.dock = src.dock
  ai.dockTimer = src.dockTimer
  ai.warpTimer = src.warpTimer
  ai.skill = src.skill
  ai.command = src.command
  ai.dormant = src.dormant
  ai.missileCooldown = src.missileCooldown
  ai.home.set(src.home[0] - o.x, src.home[1] - o.y, src.home[2] - o.z)
  ai.waypoint.set(src.waypoint[0] - o.x, src.waypoint[1] - o.y, src.waypoint[2] - o.z)
  ai.foes = src.foes.map(resolve).filter((id): id is number => id != null)
  ai.targetId = src.target ? resolve(src.target) : null
  ai.preyId = src.prey ? resolve(src.prey) : null
  ai.demandAt = src.demandAgo != null ? world.time - src.demandAgo : -1
}
