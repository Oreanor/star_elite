export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Двигает `cur` к `target` со скоростью не выше `maxDelta`. */
export function approach(cur: number, target: number, maxDelta: number): number {
  const d = target - cur
  if (Math.abs(d) <= maxDelta) return target
  return cur + Math.sign(d) * maxDelta
}

/**
 * Кадронезависимое экспоненциальное затухание.
 * `rate` — сколько «постоянных времени» проходит за секунду.
 */
export function damp(value: number, rate: number, dt: number): number {
  return value * Math.exp(-rate * dt)
}

/** Приводит угол в (-π, π]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (Math.PI * 2)
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI
}

/**
 * Ближайший к `center` представитель `value` по решётке с шагом `box`:
 * результат всегда лежит в [center − box/2, center + box/2].
 *
 * Модульная, а не пошаговая: вычитание одного `box` за вызов возвращает точку
 * лишь за ⌈d/box⌉ кадров, и при скачке начала координат на километры это видно
 * глазом. Здесь любое расстояние сворачивается за один вызов.
 */
export function wrapAround(value: number, center: number, box: number): number {
  return value - Math.round((value - center) / box) * box
}

/**
 * Мёртвая зона ручки: `magnitude` ниже порога — ноль, выше — остаток, растянутый
 * обратно на полный диапазон. Возвращает МНОЖИТЕЛЬ для вектора отклонения,
 * поэтому зона получается круглой, а не квадратной.
 *
 * Растяжение обязательно: без него команда на выходе из зоны прыгает с нуля
 * до порога. Полное отклонение остаётся полным — ручка не теряет верхний край.
 */
export function deadzoneScale(magnitude: number, threshold: number): number {
  if (magnitude <= threshold) return 0
  if (threshold >= 1) return 0
  return (magnitude - threshold) / (1 - threshold) / magnitude
}
