import { Vector3 } from 'three'
import { AI } from '../../config/ai'
import { isEngageable } from '../combat/engage'
import { findShip } from '../world/queries'
import type { World } from '../world/entities'
import { createAIState } from './types'

/**
 * Автобой. Пилот-бот садится за штурвал ИГРОКА и дерётся с захваченной целью.
 *
 * Ничего нового он не умеет: это тот же `aiController`, та же физика, тот же
 * `ShipControls`. Ровно то, ради чего `Controller` и был единственным швом между
 * «кто решает» и «что летит» — посадить бота в корабль игрока стоит одной ссылки.
 *
 * Отличие одно: цель ему НАЗНАЧЕНА (`orderedTargetId` / `orderedSoft`), а не выбрана.
 * Приказ исходит от игрока, и менять его пилот не вправе.
 *
 * Бьём то, что физически бьётся лазером: борт, контейнер, астероид — и только когда
 * фокус контакта (`targetFocus: contact`). Нав (планета/звезда) P не атакует.
 *
 * Правила отпускания штурвала живут ЗДЕСЬ, а не в слое ввода: они одинаковы
 * и на клиенте, и на сервере, и проверяются тестом без всякого браузера.
 */

/** Дальше этого автобой считает цель ушедшей и возвращает управление. Метры. */
const ABORT_RANGE = AI.AWARENESS * 1.6

export function autofightActive(world: World): boolean {
  return world.player.ai !== null
}

/**
 * Взять цель в автобой. Возвращает false, если брать нечего: фокус на наве,
 * цель не захвачена или это не бьющийся контакт. Молчаливый отказ хуже — HUD
 * обязан сказать почему.
 */
export function engageAutofight(world: World): boolean {
  const player = world.player
  if (!player.alive) return false
  // Как J смотрит на фокус: Shift+Tab на планету не превращает P в стрельбу по камню
  // из старого Tab — иначе снова путаница «куда жму».
  if (world.targetFocus !== 'contact') return false

  if (world.lockedPodId !== null) {
    const pod = world.pods.find((p) => p.id === world.lockedPodId && p.alive)
    if (!pod) return false
    const ai = createAIState(player.state.pos, world.rng)
    ai.orderedSoft = { kind: 'pod', id: pod.id }
    ai.missileCooldown = 0
    player.ai = ai
    return true
  }

  if (world.lockedAsteroidId !== null) {
    const rock = world.asteroids.find((a) => a.id === world.lockedAsteroidId && a.alive)
    if (!rock) return false
    const ai = createAIState(player.state.pos, world.rng)
    ai.orderedSoft = { kind: 'asteroid', id: rock.id }
    ai.missileCooldown = 0
    player.ai = ai
    return true
  }

  const target = findShip(world, world.lockedTargetId)
  if (!target || !target.alive || !isEngageable(target)) return false

  const ai = createAIState(player.state.pos, world.rng)
  ai.orderedTargetId = target.id
  ai.targetId = target.id
  // Бот-пират медлит с первой ракетой, давая игроку осмотреться. Здесь эта
  // фора бессмысленна: пилот уже в бою и ракеты — его, а не против него.
  ai.missileCooldown = 0
  player.ai = ai
  return true
}

/** Вернуть штурвал. Идемпотентно: снять несуществующий автобой не ошибка. */
export function disengageAutofight(world: World): void {
  world.player.ai = null
}

/**
 * Пора ли отпускать штурвал: цель погибла, ушла за горизонт или пилот мёртв.
 * «Улетел совсем» — это дальность, а не время: за целью, идущей на форсаже,
 * автобой погонится через полсистемы, если ему не сказать остановиться.
 */
export function autofightSpent(world: World): boolean {
  const player = world.player
  const ai = player.ai
  if (!ai) return false
  if (!player.alive) return true

  if (ai.orderedSoft) {
    const pos = softPos(world, ai.orderedSoft)
    if (!pos) return true
    return pos.distanceTo(player.state.pos) > ABORT_RANGE
  }

  const target = findShip(world, ai.orderedTargetId)
  if (!target || !target.alive) return true

  return target.state.pos.distanceTo(player.state.pos) > ABORT_RANGE
}

function softPos(world: World, soft: { kind: 'pod' | 'asteroid'; id: number }): Vector3 | null {
  if (soft.kind === 'pod') {
    const pod = world.pods.find((p) => p.id === soft.id && p.alive)
    return pod?.pos ?? null
  }
  const rock = world.asteroids.find((a) => a.id === soft.id && a.alive)
  return rock?.pos ?? null
}
