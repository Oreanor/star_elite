import { Vector3 } from 'three'

const _oc = new Vector3()

/**
 * Пересечение луча со сферой.
 * @param dir должен быть нормализован.
 * @returns расстояние вдоль луча, либо -1. Начало внутри сферы даёт 0.
 */
export function raySphere(origin: Vector3, dir: Vector3, center: Vector3, radius: number): number {
  _oc.copy(origin).sub(center)
  const b = _oc.dot(dir)
  const c = _oc.lengthSq() - radius * radius

  if (c < 0) return 0 // начало внутри сферы — попадание в упор
  if (b > 0) return -1 // сфера позади луча

  const disc = b * b - c
  if (disc < 0) return -1

  const t = -b - Math.sqrt(disc)
  return t >= 0 ? t : -1
}

/**
 * Время до столкновения снаряда с движущейся целью.
 * Решает |relPos + relVel·t| = speed·t относительно t.
 * @returns наименьшее положительное t, либо -1 если не догнать.
 */
export function interceptTime(
  relPos: Vector3,
  relVel: Vector3,
  projectileSpeed: number,
): number {
  const a = relVel.lengthSq() - projectileSpeed * projectileSpeed
  const b = 2 * relPos.dot(relVel)
  const c = relPos.lengthSq()

  // Вырожденный случай: снаряд летит ровно со скоростью сближения.
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return -1
    const t = -c / b
    return t > 0 ? t : -1
  }

  const disc = b * b - 4 * a * c
  if (disc < 0) return -1

  const sq = Math.sqrt(disc)
  const t1 = (-b - sq) / (2 * a)
  const t2 = (-b + sq) / (2 * a)

  if (t1 > 0 && t2 > 0) return Math.min(t1, t2)
  const t = Math.max(t1, t2)
  return t > 0 ? t : -1
}
