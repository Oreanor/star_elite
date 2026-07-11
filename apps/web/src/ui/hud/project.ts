import { Vector3, type Camera } from 'three'
import { t } from '../i18n'

/**
 * Проекция мира на экран HUD.
 *
 * Координаты возвращаются в пикселях ВНУТРЕННЕГО буфера — того же, в котором
 * рисуется 3D. Благодаря общей пиксельной сетке прицел и рамки целей не «плавают»
 * на полпикселя относительно кораблей.
 */

const _projected = new Vector3()

export interface ScreenPoint {
  x: number
  y: number
  /** Позади камеры. Такие точки нельзя рисовать: проекция их зеркалит. */
  behind: boolean
  /** Расстояние до точки, метры. */
  distance: number
}

const _result: ScreenPoint = { x: 0, y: 0, behind: false, distance: 0 }

/**
 * @returns переиспользуемый объект. Копируй, если нужно сохранить.
 */
export function projectPoint(world: Vector3, camera: Camera, width: number, height: number): ScreenPoint {
  _projected.copy(world).project(camera)

  // z > 1 после проекции означает «за камерой»: там x/y уже перевёрнуты.
  _result.behind = _projected.z > 1
  _result.x = (_projected.x * 0.5 + 0.5) * width
  _result.y = (-_projected.y * 0.5 + 0.5) * height
  _result.distance = camera.position.distanceTo(world)
  return _result
}

/** Угловой размер объекта, радианы. По нему решаем, рисовать тело или метку. */
export function angularSize(radius: number, distance: number): number {
  return Math.atan2(radius, Math.max(distance, 1)) * 2
}

/** Скорость света, м/с. Единственная константа, которая не подлежит балансировке. */
const C = 299_792_458
/** Световая секунда, м. Пилот меряет систему временем, а не нулями. */
const LIGHT_SECOND = C

/**
 * Форматирует дистанцию так, как её читает пилот, а не программист.
 *
 * В системе настоящего масштаба «149597870700 м» не сообщает ничего. Дальше
 * миллиона километров переходим на световые секунды: до звезды 499 св.с, и это
 * сразу говорит, сколько лететь. Так же считает Elite Dangerous, и по той же причине.
 */
export function formatDistance(metres: number): string {
  if (metres >= 1e9) return `${(metres / LIGHT_SECOND).toFixed(0)} ${t('unit.ls')}`
  if (metres >= 1e6) return `${(metres / 1000).toFixed(0)} ${t('unit.km')}`
  if (metres >= 100_000) return `${(metres / 1000).toFixed(0)} ${t('unit.km')}`
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} ${t('unit.km')}`
  return `${metres.toFixed(0)} ${t('unit.m')}`
}

/** Крейсер идёт быстрее света, и мерить его в км/с — писать девять знаков. */
export function formatSpeed(metresPerSecond: number): string {
  if (metresPerSecond >= 0.01 * C) return `${(metresPerSecond / C).toFixed(2)}c`
  if (metresPerSecond >= 1000) return `${(metresPerSecond / 1000).toFixed(1)} ${t('unit.kmps')}`
  return `${metresPerSecond.toFixed(0)} ${t('unit.mps')}`
}
