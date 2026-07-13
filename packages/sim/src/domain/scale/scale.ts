import { MIELOPHONE } from '../../config/mielophone'
import { clamp } from '../../core/math'
import type { ShipEntity } from '../world/entities'

/**
 * Миелофон: непрерывный масштаб борта. Чистый домен — ни рендера, ни камеры, только
 * число `state.scale` и то, как оно растёт и как меняет физику столкновений.
 *
 * `scale` живёт в состоянии корабля (не в камере): иначе «огромный» был бы лишь
 * картинкой, сквозной для мира и несинхронной по сети. Раз он в состоянии — коллизии,
 * сервер и чужой клиент видят один и тот же размер.
 */

/** Радиус корпуса с учётом масштаба: во столько раз больше силуэт для столкновений. */
export function effectiveRadius(e: ShipEntity): number {
  return e.spec.hull.radius * e.state.scale
}

/**
 * Масса с учётом масштаба. Растёт как ОБЪЁМ — куб масштаба: гигант почти не сдвигается
 * от лёгких тел, а лёгкое отлетает от него. Отсюда же «сам почти цел»: в разделе импульса
 * по массе на гиганта достаётся ничтожная доля.
 */
export function effectiveMass(e: ShipEntity): number {
  return e.spec.mass * e.state.scale ** 3
}

/**
 * Шаг масштаба от сигнала `controls.grow`. Экспоненциально: постоянный сигнал = постоянная
 * скорость «зума» на глаз. Домен не спрашивает, ЕСТЬ ли артефакт, — он лишь исполняет
 * команду; право расти выдаёт тот, кто заполняет controls (позже — наличие модуля).
 */
export function stepScale(e: ShipEntity, dt: number): void {
  // Право расти даёт УСТРОЙСТВО: нет миелофона в слоте — сигнал роста игнорируется.
  // Гейт в домене (не в клиенте) — значит и сервер, и чужой клиент согласны, кто может расти.
  if (!e.spec.hasMielophone) return
  const grow = e.controls.grow
  if (grow > 0) {
    // РОСТ питается от батареи доп-отсека. Расход — по логарифму (масштаб множится):
    // полного заряда хватает на ln(GROW_FULL_FACTOR) лог-единиц. Кончился аукс — рост встал,
    // жди подзарядки. Растём ровно на столько, на сколько хватило заряда (частичный шаг).
    const perLog = e.spec.power.auxCapacity / Math.log(MIELOPHONE.GROW_FULL_FACTOR)
    const wantLog = grow * MIELOPHONE.GROW_RATE * dt
    const doLog = perLog > 0 ? Math.min(wantLog, e.auxEnergy / perLog) : wantLog
    if (doLog > 0) {
      e.state.scale *= Math.exp(doLog)
      e.auxEnergy = Math.max(0, e.auxEnergy - doLog * perLog)
    }
  } else if (grow < 0) {
    // Сжатие обратно — бесплатно: возвращать размер батарея не мешает.
    e.state.scale *= Math.exp(grow * MIELOPHONE.GROW_RATE * dt)
  }
  e.state.scale = clamp(e.state.scale, MIELOPHONE.MIN_SCALE, MIELOPHONE.MAX_SCALE)
}

/**
 * Насколько борт ЕЩЁ присутствует в единичном мире: 1 до PHASE_START, к PHASE_END → 0.
 * Кривая ease-in (`1 − t^FADE_EXP`): почти до конца плотный, потом гаснет рывком — так
 * полупрозрачных «призраков» в кадре мало. Рендер берёт это как opacity, домен — как «ещё
 * взаимодействует ли». Чистая функция от одного числа: и клиент, и сервер считают одинаково.
 */
export function phasePresence(scale: number): number {
  if (scale <= MIELOPHONE.PHASE_START) return 1
  if (scale >= MIELOPHONE.PHASE_END) return 0
  const t = (scale - MIELOPHONE.PHASE_START) / (MIELOPHONE.PHASE_END - MIELOPHONE.PHASE_START)
  return 1 - t ** MIELOPHONE.FADE_EXP
}

/** Ушёл в «большой мир»: за PHASE_END борт не взаимодействует с мелочью единичного мира. */
export function phasedOut(scale: number): boolean {
  return scale >= MIELOPHONE.PHASE_END
}
