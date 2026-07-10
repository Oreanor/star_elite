import { Quaternion, Vector3 } from 'three'

/**
 * Оси корабля — и ничего больше.
 *
 * Здесь когда-то жили `WORLD_UP`, `bankAngle` и `bankAuthority`: угол крена
 * относительно мировой оси Y и «насколько он осмыслен». Они существовали ради
 * автокоординации, а та подкручивала корабль к выдуманному горизонту. В космосе
 * верха нет, и симуляция о нём больше не спрашивает.
 */

/**
 * Локальные оси корабля. Вперёд — это -Z, как у камеры в three.js.
 * Пишет в переданные векторы: аллокации в горячем пути недопустимы.
 */
export function shipAxes(q: Quaternion, fwd: Vector3, right: Vector3, up: Vector3): void {
  fwd.set(0, 0, -1).applyQuaternion(q)
  right.set(1, 0, 0).applyQuaternion(q)
  up.set(0, 1, 0).applyQuaternion(q)
}

export function forward(q: Quaternion, out: Vector3): Vector3 {
  return out.set(0, 0, -1).applyQuaternion(q)
}
