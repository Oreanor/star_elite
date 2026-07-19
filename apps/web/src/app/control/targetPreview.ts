import { Vector3 } from 'three'
import { findShip, navTarget, type World } from '@elite/sim'
import { isHeld } from '../../platform/input/input'
import { galaxyRadar } from '../../render/scene/galaxyRadar'

/**
 * ПРЕДПРОСМОТР ЦЕЛИ. Пока УДЕРЖИВАЕШЬ Tab (контакты) или Shift+Tab (небесные), камера
 * МГНОВЕННО (без перелёта) смотрит на выбранную цель — она в центре кадра, ~⅓ по высоте.
 * Отпустил — камера так же резко возвращается к своему кораблю. Нажатия Tab при этом
 * продолжают листать цели от ближних к дальним: держишь и щёлкаешь — разглядываешь по кругу.
 *
 * Ни грамма логики мира: чистая презентация, как `cameraView`/`jumpFx`. Хаб ввода пишет сюда
 * раз в кадр (`stepTargetPreview`), а `FlightCamera` и `PlayerShip`/`Exhaust` читают.
 */
export interface TargetPreviewState {
  /** Предпросмотр реально идёт: клавиша зажата И цель существует. */
  active: boolean
  /** Мировая позиция цели (в кадре вычисления). */
  pos: Vector3
  /** Габаритный радиус цели, м — по нему камера отходит на нужную дистанцию. */
  radius: number
}

const state: TargetPreviewState = { active: false, pos: new Vector3(), radius: 1 }

export function targetPreview(): TargetPreviewState {
  return state
}

/** Снять предпросмотр (курсор отпущен, меню, док): камера возвращается к кораблю. */
export function clearTargetPreview(): void {
  state.active = false
}

/** У контейнера нет `radius` — габарит задаём вручную: обломок мелкий, но не точка. */
const POD_RADIUS = 4

/**
 * Обновить предпросмотр по удержанию Tab/Shift+Tab. В галактическом виде НЕ вмешиваемся:
 * там борт-гигант и свой режим камеры. Цель берём из ТЕХ ЖЕ полей, что метит листание:
 * Shift+Tab → нав-тело (`navTargetId`), Tab → захваченный борт или контейнер.
 */
export function stepTargetPreview(world: World): void {
  if (galaxyRadar().active || !isHeld('Tab')) {
    state.active = false
    return
  }

  if (isHeld('ShiftLeft') || isHeld('ShiftRight')) {
    // Через `navTarget`: монолиты не тела, и `findBody` их терял — Shift+Tab на статую
    // не давал предпросмотра камеры.
    const nav = navTarget(world)
    if (!nav) return void (state.active = false)
    state.pos.copy(nav.pos)
    state.radius = Math.max(nav.radius, 2)
    state.active = true
    return
  }

  if (world.lockedPodId !== null) {
    const pod = world.pods.find((p) => p.id === world.lockedPodId && p.alive)
    if (!pod) return void (state.active = false)
    state.pos.copy(pod.pos)
    state.radius = POD_RADIUS
    state.active = true
    return
  }

  if (world.lockedAsteroidId !== null) {
    const rock = world.asteroids.find((a) => a.id === world.lockedAsteroidId && a.alive)
    if (!rock) return void (state.active = false)
    state.pos.copy(rock.pos)
    state.radius = Math.max(rock.radius, 2)
    state.active = true
    return
  }

  const ship = findShip(world, world.lockedTargetId)
  if (!ship || !ship.alive) return void (state.active = false)
  state.pos.copy(ship.state.pos)
  // Меш борта масштабируется миелофоном — размер для отхода тоже: цель раздулась → отходим дальше.
  state.radius = Math.max(ship.spec.hull.radius * ship.state.scale, 2)
  state.active = true
}
