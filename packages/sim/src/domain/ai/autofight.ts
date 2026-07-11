import { AI } from '../../config/ai'
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
 * Отличие одно: цель ему НАЗНАЧЕНА (`orderedTargetId`), а не выбрана. Приказ
 * исходит от игрока, и менять его пилот не вправе.
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
 * Взять цель в автобой. Возвращает false, если брать нечего: цель не захвачена,
 * мертва или это не враг. Молчаливый отказ хуже — HUD обязан сказать почему.
 */
export function engageAutofight(world: World): boolean {
  const player = world.player
  if (!player.alive) return false

  const target = findShip(world, world.lockedTargetId)
  if (!target || !target.alive) return false
  // Захватить Tab-ом можно кого угодно (чтобы окликнуть или приказать), но АВТОБОЙ
  // открывает огонь лишь по врагу: случайно натравить бота на союзника/нейтрала нельзя.
  // Хочешь ударить не-врага — стреляй вручную, по прицелу; это твой осознанный выстрел.
  if (target.faction !== 'hostile') return false

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

  const target = findShip(world, ai.orderedTargetId)
  if (!target || !target.alive) return true

  return target.state.pos.distanceTo(player.state.pos) > ABORT_RANGE
}
