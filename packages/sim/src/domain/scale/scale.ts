import { Vector3 } from 'three'
import { GALAXY_FLIGHT } from '../../config/galaxy'
import { MIELOPHONE } from '../../config/mielophone'
import { clamp } from '../../core/math'
import type { ShipEntity, World } from '../world/entities'

/**
 * Миелофон: непрерывный масштаб борта. Чистый домен — ни рендера, ни камеры, только
 * число `state.scale` и то, как оно растёт и как меняет физику столкновений.
 *
 * `scale` живёт в состоянии корабля (не в камере): иначе «огромный» был бы лишь
 * картинкой, сквозной для мира и несинхронной по сети. Раз он в состоянии — коллизии,
 * сервер и чужой клиент видят один и тот же размер.
 */

const _anchor = new Vector3()
const _offset = new Vector3()

/** Радиус корпуса с учётом масштаба: во столько раз больше силуэт для столкновений. */
export function effectiveRadius(e: ShipEntity): number {
  return e.spec.hull.radius * e.state.scale
}

/**
 * Во сколько раз боевая скорость и тяга выше паспортных при данном масштабе.
 * Без этого гигант ползёт теми же 220 м/с, и «ехать по звёздам на газу» нельзя —
 * остаётся только крейсер, задуманный для единичного борта в системе.
 */
export function speedScaleFactor(scale: number): number {
  return Math.max(1, scale / MIELOPHONE.SPEED_SCALE_REF)
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
 * Метров кадра в одном св.году при данном росте — та же формула, что у галактического
 * слоя и аима J. Единый источник: иначе зум, локатор и автопилот разъедутся.
 */
export function metersPerLy(scale: number): number {
  return GALAXY_FLIGHT.LY_TO_M / Math.min(Math.max(scale, 1), MIELOPHONE.MAX_SCALE)
}

/**
 * Якорь галактики в ЛОКАЛЬНЫХ метрах кадра (true − originOffset).
 * Тот же выбор, что у `jumpStarDestination`: слой → своя звезда → pos борта.
 */
export function galaxyAnchorLocal(world: World, out: Vector3): Vector3 {
  if (world.galaxyAnchorTrue) {
    return out.copy(world.galaxyAnchorTrue).sub(world.originOffset)
  }
  const home = world.bodies.find((b) => b.kind === 'star')
  if (home) return out.copy(home.pos)
  return out.copy(world.player.state.pos)
}

/**
 * Сохранить галактический локус при смене масштаба: ly = (pos−anchor)/m(S) неподвижен.
 * Полёт двигает pos (и локус); зум лишь перепроецирует текущий локус в новые метры.
 * Ниже GHOST_BODY — системные метры, ремап к якорю ломал бы орбиты.
 */
export function preserveGalaxyLocus(
  ship: ShipEntity,
  world: World,
  oldScale: number,
  newScale: number,
): void {
  if (oldScale === newScale) return
  if (Math.min(oldScale, newScale) < MIELOPHONE.GHOST_BODY_SCALE) return
  const mOld = metersPerLy(oldScale)
  const mNew = metersPerLy(newScale)
  if (mOld === mNew || mOld <= 0) return
  galaxyAnchorLocal(world, _anchor)
  _offset.copy(ship.state.pos).sub(_anchor).multiplyScalar(mNew / mOld)
  ship.state.pos.copy(_anchor).add(_offset)
}

/**
 * Шаг масштаба от сигнала `controls.grow`. Экспоненциально: постоянный сигнал = постоянная
 * скорость «зума» на глаз. Домен не спрашивает, ЕСТЬ ли артефакт, — он лишь исполняет
 * команду; право расти выдаёт тот, кто заполняет controls (позже — наличие модуля).
 *
 * `world` нужен, чтобы при росте/усадке в галактическом режиме не «уплывать» сквозь
 * звёзды: позиция пересчитывается под неизменный локус в св.г.
 */
export function stepScale(e: ShipEntity, dt: number, world?: World): void {
  // Право расти даёт УСТРОЙСТВО: нет миелофона в слоте — сигнал роста игнорируется.
  // Гейт в домене (не в клиенте) — значит и сервер, и чужой клиент согласны, кто может расти.
  if (!e.spec.hasMielophone) return
  const oldScale = e.state.scale
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

  if (world && e.state.scale !== oldScale) {
    preserveGalaxyLocus(e, world, oldScale, e.state.scale)
  }

  // Скорость ∝ scale (потолок и тяга). При смене масштаба держим ДОЛЮ от потолка:
  // иначе сжатие оставляет гиперскорость с крупного ×, а рост с газом — FA догоняет
  // новый потолок рывком («внезапно большая» на спидометре).
  // Без тяги при РОСТЕ vel не надуваем: иначе на нулевом газе скорость сама ползёт вверх.
  const oldF = speedScaleFactor(oldScale)
  const newF = speedScaleFactor(e.state.scale)
  if (oldF > 0 && newF !== oldF) {
    const thrusting = Math.abs(e.controls.throttle) > 1e-3
    if (newF < oldF || thrusting) e.state.vel.multiplyScalar(newF / oldF)
  }
}

/** Ушёл в «большой мир»: за PHASE_END борт не взаимодействует с мелочью единичного мира. */
export function phasedOut(scale: number): boolean {
  return scale >= MIELOPHONE.PHASE_END
}
