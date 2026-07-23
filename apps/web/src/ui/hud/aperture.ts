import { Quaternion, Vector3, type Camera } from 'three'
import type { World } from '@elite/sim'
import { projectPoint } from './project'

/**
 * Апертура открытого портала прыжка в координатах HUD.
 *
 * HUD рисуется на 2D-канвасе, поэтому stencil-маска портала на него не действует:
 * подписи своей системы ложились поверх чужого неба в кольце, а у тел системы
 * назначения подписей не было вовсе. Дырку приходится считать заново — здесь.
 */

/** Что известно про кольцо и мир за ним. Заполняется композицией, не отрисовкой. */
export interface PortalAperture {
  /** Центр кольца в кадре ОСНОВНОГО мира (floating origin уже вычтен). */
  pos: Vector3
  quat: Quaternion
  /** Радиус кольца, м. Ноль — портал только открылся, дырки ещё нет. */
  radius: number
  /** Мир за кольцом и его камера. null, пока система назначения не построена. */
  world: World | null
  camera: Camera | null
}

/**
 * Круг в перспективе — эллипс. Храним его центром и двумя полуосями в пикселях:
 * они не обязаны быть перпендикулярны на экране, и это как раз то, что нужно,
 * когда кольцо повёрнуто к пилоту боком.
 */
export interface ApertureEllipse {
  cx: number
  cy: number
  ax: number
  ay: number
  bx: number
  by: number
  det: number
}

const _edge = new Vector3()
const _axisX = new Vector3()
const _axisY = new Vector3()

/**
 * Спроецировать кольцо на HUD. null — рисовать нечего: портала нет, он за спиной
 * или виден ровно с ребра.
 */
export function apertureEllipse(
  aperture: PortalAperture | null,
  camera: Camera,
  width: number,
  height: number,
): ApertureEllipse | null {
  if (!aperture || aperture.radius <= 0) return null

  // projectPoint отдаёт переиспользуемый объект — числа снимаем сразу после вызова.
  const c = projectPoint(aperture.pos, camera, width, height)
  if (c.behind) return null
  const cx = c.x
  const cy = c.y

  // Полуоси берём НЕ по дальнему краю кольца, а по производной проекции у центра.
  // Иначе на большом кольце (подлетел вплотную, оно во весь экран) точка `центр+радиус`
  // уходит ЗА камеру, projectPoint кричит «behind», и апертура возвращала null — клип
  // пропадал, и подписи ПЕРВОГО мира лезли в дырку. Пробуем малой долей радиуса (она
  // заведомо перед камерой) и линейно масштабируем обратно.
  const EPS = 0.01
  _axisX.set(1, 0, 0).applyQuaternion(aperture.quat).multiplyScalar(aperture.radius * EPS)
  _axisY.set(0, 1, 0).applyQuaternion(aperture.quat).multiplyScalar(aperture.radius * EPS)

  const a = projectPoint(_edge.copy(aperture.pos).add(_axisX), camera, width, height)
  if (a.behind) return null
  const ax = (a.x - cx) / EPS
  const ay = (a.y - cy) / EPS

  const b = projectPoint(_edge.copy(aperture.pos).add(_axisY), camera, width, height)
  if (b.behind) return null
  const bx = (b.x - cx) / EPS
  const by = (b.y - cy) / EPS

  const det = ax * by - bx * ay
  // Вырожденный эллипс — кольцо строго в профиль: сквозь него ничего не видно,
  // и «внутри» не определено. Отсечения в этот кадр не делаем.
  if (Math.abs(det) < 1e-6) return null

  return { cx, cy, ax, ay, bx, by, det }
}

/**
 * Насколько точка удалена от центра дырки в долях её радиуса: 0 — центр, 1 — кромка.
 * Раскладываем смещение по полуосям и меряем единичный круг — для проекции окружности
 * это точно, а не «вписанным квадратом».
 */
export function apertureRadius(e: ApertureEllipse, x: number, y: number): number {
  const dx = x - e.cx
  const dy = y - e.cy
  const u = (e.by * dx - e.bx * dy) / e.det
  const v = (e.ax * dy - e.ay * dx) / e.det
  return Math.hypot(u, v)
}

/** Точка внутри дырки? */
export function insideAperture(e: ApertureEllipse, x: number, y: number): boolean {
  return apertureRadius(e, x, y) <= 1
}
