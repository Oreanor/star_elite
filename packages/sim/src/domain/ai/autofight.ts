import { findWarBaseFixture } from '../world/warBase'
import { AI } from '../../config/ai'
import { COPILOT } from '../../config/crew'
import { isEngageable } from '../combat/engage'
import { findShip } from '../world/queries'
import type { ShipEntity, World } from '../world/entities'
import { lockContact } from '../world/queries'
import { isFoe } from './targeting'
import { createAIState } from './types'
import { lockedShipId, lockedPodId, lockedAsteroidId, lockedFixtureId, softTargetPos } from '../world/queries'

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
// Автобой ведёт второй пилот, и цель ему дают с локатора (`COPILOT.SCAN_RANGE`): прежние
// AWARENESS × 1.6 (5.6 км) сбрасывали бой с бортом в десяти километрах в первый же такт.
const ABORT_RANGE = COPILOT.SCAN_RANGE * 1.5

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

  if (lockedPodId(world) !== null) {
    const pod = world.pods.find((p) => p.id === lockedPodId(world) && p.alive)
    if (!pod) return false
    const ai = createAIState(player.state.pos, world.rng)
    ai.orderedSoft = { kind: 'pod', id: pod.id }
    ai.missileCooldown = 0
    player.ai = ai
    return true
  }

  if (lockedAsteroidId(world) !== null) {
    const rock = world.asteroids.find((a) => a.id === lockedAsteroidId(world) && a.alive)
    if (!rock) return false
    const ai = createAIState(player.state.pos, world.rng)
    ai.orderedSoft = { kind: 'asteroid', id: rock.id }
    ai.missileCooldown = 0
    player.ai = ai
    return true
  }

  if (lockedFixtureId(world) !== null) {
    const found = findWarBaseFixture(world.warBases, lockedFixtureId(world))
    if (!found) return false
    const ai = createAIState(player.state.pos, world.rng)
    ai.orderedSoft = { kind: 'fixture', id: found.fixture.id }
    ai.missileCooldown = 0
    player.ai = ai
    return true
  }

  const target = findShip(world, lockedShipId(world))
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

/**
 * Цель убита, а бой не кончен: взять СЛЕДУЮЩЕГО — ближайшего врага в поле зрения (`AWARENESS`).
 * Прежде автобой после первого убийства отдавал штурвал посреди свалки, и пилот, пока жал P
 * заново, ловил очередь от соседей. Новая цель встаёт и в захват — HUD показывает, кого бьём.
 * Возвращает false — врагов рядом нет, бой окончен.
 */
export function retargetAutofight(world: World, range: number = AI.AWARENESS): boolean {
  const player = world.player
  const ai = player.ai
  if (!ai || ai.orderedSoft || !player.alive) return false
  let best: ShipEntity | null = null
  let bestD = range * range
  for (const s of world.ships) {
    if (!s.alive || !isEngageable(s) || !isFoe(player, s)) continue
    const d = s.state.pos.distanceToSquared(player.state.pos)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  if (!best) return false
  ai.orderedTargetId = best.id
  ai.targetId = best.id
  lockContact(world, 'ship', best.id)
  return true
}

/**
 * Такт автобоя (зовёт слой ввода): идёт ли он дальше. Поручение второго пилота («собери»,
 * «уходим») держит штурвал, пока не исполнено; бой — пока цель жива и рядом, а «бей всех»
 * (`chainFoes`) берёт следующего врага на локаторе. Иначе штурвал возвращается.
 */
export function continueAutofight(world: World): boolean {
  const ai = world.player.ai
  if (!ai) return false
  if (!world.player.alive) {
    disengageAutofight(world)
    return false
  }
  if (ai.tasks.length > 0) return true
  if (!autofightSpent(world)) return true
  if (ai.chainFoes && retargetAutofight(world, COPILOT.SCAN_RANGE)) return true
  disengageAutofight(world)
  return false
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
    const pos = softTargetPos(world, ai.orderedSoft)
    if (!pos) return true
    return pos.distanceTo(player.state.pos) > ABORT_RANGE
  }

  const target = findShip(world, ai.orderedTargetId)
  if (!target || !target.alive) return true

  return target.state.pos.distanceTo(player.state.pos) > ABORT_RANGE
}

