import { BODY_FADE, GALAXY_LAYER } from './config'

/**
 * Визуальное сжатие мира с 1×: worldR ∝ 1/scale — синхронно с ростом борта и отводом
 * камеры. С порога галактики (`BODY_FADE.START` = FADE_IN слоя) системных тел нет:
 * планеты/станции исчезают сразу, кадр отдаётся точкам галактики.
 */
export function worldShrink(scale: number): number {
  const s = Math.max(scale, 1)
  if (s >= BODY_FADE.START) return 0
  return 1 / s
}

/**
 * Множитель видимого радиуса звезды к честному R. Одна кривая на всю дорогу роста:
 * системное тело и шар слоя.
 *
 * До STAR_INFLATE — полка 1 (вблизи солнце не прыгает вслед за первыми ×).
 * Дальше INFLATE/scale и без потолка: на пороге галактики шар не возвращается
 * к честному R, иначе только что сжатая в точку звезда снова закрывает кадр.
 */
export function starRadiusFactor(scale: number): number {
  const s = Math.max(scale, 1)
  const inflate = GALAXY_LAYER.STAR_INFLATE
  if (inflate <= 1) return 1 / s
  return s < inflate ? 1 : inflate / s
}

/**
 * Системная звезда гаснет на пороге слоя (`BODY_FADE`): дальше её рисует слой,
 * тем же `starRadiusFactor`, уже как точку.
 */
export function starWorldShrink(scale: number): number {
  if (Math.max(scale, 1) >= BODY_FADE.START) return 0
  return starRadiusFactor(scale)
}

/**
 * Радиус шара слоя в св.г его группы. Мировой размер = это × layerScale
 * = R·`starRadiusFactor`, не честный R.
 */
export function starLayerRadiusLy(radiusMeters: number, layerScale: number): number {
  if (layerScale <= 0) return 0
  const scale = GALAXY_LAYER.LY_TO_M / layerScale
  return (radiusMeters * starRadiusFactor(scale)) / layerScale
}

/**
 * Метров КАДРА на св.год для слоя галактики. Домен держит L/scale (`metersPerLy`), а вид
 * сверх того сжат вокруг борта степенью: от 1 на FADE_IN_START до TOP_VIEW_M_PER_LY на
 * LOCK_SCALE. Камера упёрта в потолок отъезда — без этого зум галактики на глаз стоял бы.
 * Сжатие вокруг борта не трогает ни направлений с него, ни локуса: только картинку.
 */
export function galaxyViewMetersPerLy(scale: number): number {
  const fade = GALAXY_LAYER.FADE_IN_START
  const lock = GALAXY_LAYER.LOCK_SCALE
  const s = Math.min(Math.max(scale, 1), lock)
  const domain = GALAXY_LAYER.LY_TO_M / s
  if (s <= fade) return domain
  const atLock = GALAXY_LAYER.LY_TO_M / lock
  const p = Math.log(GALAXY_LAYER.TOP_VIEW_M_PER_LY / atLock) / Math.log(fade / lock)
  return domain * (fade / s) ** p
}

/**
 * Во сколько раз шар звезды слоя меньше, чем на пороге галактики. Видимый радиус тела
 * системы идёт как `starRadiusFactor` (10/scale) при НЕсжатых расстояниях; в слое расстояния
 * сжаты вместе с ростом, и тот же 10/scale в сжатых метрах давал постоянный угловой размер —
 * звезда переставала уменьшаться, а пиксельные полы превращали это в ступеньки. Множитель
 * продолжает кривую тела: угловой размер звезды ∝ 1/scale на всей дороге роста.
 */
export function galaxyStarSizeMul(scale: number): number {
  const fade = GALAXY_LAYER.FADE_IN_START
  const s = Math.min(Math.max(scale, fade), GALAXY_LAYER.LOCK_SCALE)
  return starRadiusFactor(s) / starRadiusFactor(fade)
}

