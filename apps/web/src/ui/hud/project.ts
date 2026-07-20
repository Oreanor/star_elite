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
 * световой секунды переходим на неё: до звезды 499 св.с, и это сразу говорит,
 * сколько лететь. Так же считает Elite Dangerous, и по той же причине.
 *
 * ЕДИНСТВЕННАЯ лестница на всю игру — HUD, карта системы, панели. Раньше карта
 * считала своей функцией с тем же именем и мерила в астрономических единицах:
 * одно и то же расстояние читалось как «499 св.с» в окне и «1.00 а.е.» на карте.
 * Св.с выбраны потому, что говорят о ВРЕМЕНИ полёта, а не об устройстве системы.
 *
 * Порог перехода — ровно 1 св.с, и это не круглое число ради красоты: оно держит
 * километровую ступень в шести разрядах (максимум 299792 км). Прежний порог в 1e9 м
 * выпускал семизначные «1000000 км», а в строку HUD влезает лишь около сорока знаков.
 */
export function formatDistance(metres: number): string {
  if (metres >= LIGHT_SECOND) {
    const ls = metres / LIGHT_SECOND
    // Вблизи важна доля (3.3 св.с — это ощутимо ближе, чем 4), вдали она уже шум.
    return `${ls >= 10 ? ls.toFixed(0) : ls.toFixed(1)} ${t('unit.ls')}`
  }
  // Одна ступень километров, а не две: ветки «от миллиона» и «от ста тысяч» считали
  // ровно одно и то же выражение, и первая из них не меняла ничего.
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

/**
 * Скорость РАЗДЕЛЬНО: число и единица. Нужно HUD, где цифра рисуется крупно, а единица
 * вдвое мельче рядом, — цельная строка `formatSpeed` для этого не годится.
 */
export function speedParts(metresPerSecond: number): { value: string; unit: string } {
  if (metresPerSecond >= 0.01 * C) return { value: (metresPerSecond / C).toFixed(2), unit: 'c' }
  if (metresPerSecond >= 1000) return { value: (metresPerSecond / 1000).toFixed(1), unit: t('unit.kmps') }
  return { value: metresPerSecond.toFixed(0), unit: t('unit.mps') }
}

/** Масштаб РАЗДЕЛЬНО: разрядное число и знак «×». То же деление, что у скорости. */
export function scaleParts(scale: number): { value: string; unit: string } {
  return { value: formatScale(scale), unit: '×' }
}

/**
 * Множитель миелофона за пару десятков секунд доходит до сотен миллиардов — девять цифр
 * в строке HUD не читаются. Крупный кегль скорости/масштаба требует ещё короче: держим
 * 3–4 разряда, без дробей: 1299 · 31k · 250k · 12M · 2G.
 *
 * Суффиксы — приставки СИ (k/M/G), а не «к/млн/млрд»: это не слова, а универсальные символы
 * (как «км»), одинаковые во всех семи языках интерфейса. Так множитель не приходится держать
 * отдельным переводом в каждой локали, а немецкому/французскому игроку не мигает кириллица.
 */
export function formatScale(scale: number): string {
  if (scale < 100) return scale.toFixed(1)
  if (scale < 1e4) return Math.round(scale).toString()
  if (scale < 1e6) return `${Math.round(scale / 1e3)}k`
  // На миллионном диапазоне целая M — слишком крупная ступень управления:
  // 1.1M и 1.9M не должны выглядеть одинаково. Оставляем десятую долю миллиона.
  if (scale < 1e9) return `${(scale / 1e6).toFixed(1)}M`
  return `${Math.round(scale / 1e9)}G`
}
