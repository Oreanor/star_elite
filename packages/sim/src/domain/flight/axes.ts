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

const _aimAxis = new Vector3()
const _aimTurn = new Quaternion()

/**
 * ЛИНИЯ ОГНЯ: нос, довёрнутый на `aimPitch` вокруг поперечной оси борта.
 *
 * Одна функция на всех, и это не удобство, а требование: стволы сводятся сюда,
 * прицел рисуется здесь же, камера смотрит туда же. Разойдись они — перекрестье
 * перестанет означать «куда попадёт», а это единственное, что оно и значит.
 *
 * Ось поворота — СВЯЗАННЫЙ «вправо», поэтому прицел ходит вместе с креном: летишь
 * вверх ногами — «вниз» для прицела там, где низ у корабля, а не у мира.
 */
export function aimDirection(q: Quaternion, aimPitch: number, out: Vector3): Vector3 {
  out.set(0, 0, -1).applyQuaternion(q)
  if (aimPitch === 0) return out
  _aimAxis.set(1, 0, 0).applyQuaternion(q)
  return out.applyQuaternion(_aimTurn.setFromAxisAngle(_aimAxis, aimPitch))
}
