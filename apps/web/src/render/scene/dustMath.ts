import { DUST } from '../config'

/**
 * Чистая математика ближней пыли — без three, DOM и React, чтобы её можно было
 * гонять тестами (в т.ч. на ПРЕДЕЛЬНЫХ скоростях и масштабах). `Dust.tsx` зовёт ровно
 * эти функции, поэтому тест проверяет то, что и рисуется.
 */

export interface DustExtents {
  /** Размер куба вокруг игрока, м. В покое — `DUST.BOX`, на ходу растёт со скоростью; ×grow. */
  box: number
  /** Длина штриха (следа), м; ×grow. Ограничена долей куба, чтобы не пробивать стенку. */
  streak: number
  /** Множитель хвоста: конец штриха = позиция − velocity·tail. Ноль в покое. */
  tail: number
  /**
   * Делитель «пролёта» пыли — БАЗОВЫЙ куб (без grow). Частица за кадр сдвигается на
   * `реальный_путь / rate`, поэтому темп проноса НЕ зависит от масштаба: иначе при
   * большом кубе иголки стоят на месте, а не несутся.
   */
  rate: number
}

/**
 * Размеры куба и штриха для текущей скорости, шага и масштаба борта (миелофон).
 *
 * `grow` (масштаб) растит видимый куб и штрих — иначе у гигантского борта, от которого
 * камера отъезжает на ×scale, поле пыли схлопывается в точку. Но `rate` от grow НЕ зависит:
 * темп проноса частиц держим как при обычном размере.
 */
export function dustExtents(speed: number, dt: number, grow: number): DustExtents {
  const baseBox = Math.max(DUST.BOX, speed * DUST.BOX_SECONDS)
  const box = baseBox * grow
  const streak = Math.min(speed * DUST.STREAK_SCALE * dt * grow, box * DUST.STREAK_FRACTION)
  const tail = speed > 1e-3 ? streak / speed : 0
  return { box, streak, tail, rate: baseBox }
}

/** В долю от −0.5 до 0.5. Обёртка модульная, а не пошаговая: скачок начала координат. */
export const wrapUnit = (u: number): number => u - Math.round(u)
