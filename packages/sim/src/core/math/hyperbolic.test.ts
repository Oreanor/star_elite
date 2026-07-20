import { describe, expect, it } from 'vitest'
import {
  ORIGIN,
  applyMat,
  boost,
  distanceH,
  expMapOrigin,
  geodesicMidpoint,
  identity,
  invertLorentz,
  mdot,
  mulMat,
  normalizeH,
  toBall,
  vec4,
} from './hyperbolic'

/**
 * H³ — фундамент куста галактик. Проверяем СВОЙСТВА геометрии, а не числа: они
 * переживут любую перенастройку куста, а числа сломаются от первой же правки.
 */
describe('гиперболоид H³', () => {
  it('буст сохраняет точку НА гиперболоиде', () => {
    const p = applyMat(boost(0.3, 0.5, -0.8, 1.7), ORIGIN, vec4())
    // Определяющее равенство поверхности: mdot(p,p) = −1.
    expect(mdot(p, p)).toBeCloseTo(-1, 9)
    expect(p.w).toBeGreaterThan(0)
  })

  it('буст туда-обратно возвращает в начало координат', () => {
    const there = boost(0, 0, 1, 1.3)
    const back = boost(0, 0, 1, -1.3)
    const p = applyMat(mulMat(back, there), ORIGIN, vec4())
    expect(distanceH(p, ORIGIN)).toBeCloseTo(0, 9)
  })

  it('буст уносит ровно на заданное расстояние', () => {
    const d = 2.4
    const p = applyMat(boost(1, 0, 0, d), ORIGIN, vec4())
    expect(distanceH(ORIGIN, p)).toBeCloseTo(d, 9)
  })

  /**
   * КРИВИЗНА, а не баг. Бусты в разных направлениях не коммутируют, поэтому обход
   * «прямоугольника» не замыкается: возврат по петле даёт сдвиг и поворот (голономия).
   * Именно из этого само собой берётся «непонятность соединения» куста — программировать
   * её отдельно не надо. Сломается это равенство — куст выродится в плоский граф.
   */
  it('бусты по разным осям НЕ коммутируют — пространство искривлено', () => {
    const xy = mulMat(boost(1, 0, 0, 1), boost(0, 1, 0, 1))
    const yx = mulMat(boost(0, 1, 0, 1), boost(1, 0, 0, 1))
    const a = applyMat(xy, ORIGIN, vec4())
    const b = applyMat(yx, ORIGIN, vec4())
    expect(distanceH(a, b)).toBeGreaterThan(0.1)
  })

  /**
   * Инверсия кадра — то, чем «смотрят на куст из своего узла»: применив её ко всем
   * позициям, текущий узел сажают в начало координат. Значит L⁻¹·L обязана быть
   * тождеством, а L⁻¹, приложенная к позиции узла, — вернуть его в ORIGIN.
   */
  it('обратное преобразование возвращает узел в начало координат', () => {
    const frame = mulMat(boost(0.4, -0.2, 0.7, 1.1), boost(0, 1, 0, 0.6))
    const nodePos = applyMat(frame, ORIGIN, vec4())
    const centered = applyMat(invertLorentz(frame), nodePos, vec4())
    expect(distanceH(centered, ORIGIN)).toBeCloseTo(0, 9)

    // L⁻¹·L = единица: точка проходит цепочку туда-обратно без сдвига.
    const round = applyMat(mulMat(invertLorentz(frame), frame), nodePos, vec4())
    expect(distanceH(round, nodePos)).toBeCloseTo(0, 9)
  })

  it('единичная матрица не двигает точку', () => {
    const p = expMapOrigin(0.2, -0.4, 0.9, 1.1)
    const q = applyMat(identity(), p, vec4())
    expect(distanceH(p, q)).toBeCloseTo(0, 12)
  })

  it('экспонента из начала координат даёт точку на заданном удалении', () => {
    const p = expMapOrigin(0, 1, 0, 0.8)
    expect(distanceH(ORIGIN, p)).toBeCloseTo(0.8, 9)
    expect(mdot(p, p)).toBeCloseTo(-1, 9)
  })

  it('середина геодезической равноудалена от концов', () => {
    const a = expMapOrigin(1, 0, 0, 0.9)
    const b = expMapOrigin(0, 0, 1, 1.6)
    const m = geodesicMidpoint(a, b)
    expect(distanceH(a, m)).toBeCloseTo(distanceH(b, m), 9)
    // И лежит МЕЖДУ ними: сумма плеч равна всей геодезической.
    expect(distanceH(a, m) + distanceH(m, b)).toBeCloseTo(distanceH(a, b), 9)
  })

  /** Копящуюся ошибку float обязана лечить нормировка — иначе `acosh` однажды даст NaN. */
  it('нормировка возвращает сползшую точку на поверхность', () => {
    const p = vec4(1.5, 0.3, 0.4, 0.5) // w заведомо неверный
    normalizeH(p)
    expect(mdot(p, p)).toBeCloseTo(-1, 12)
  })

  /**
   * Шар Пуанкаре — только проекция для экрана, и вся бесконечность обязана уместиться
   * внутри радиуса 1. Дальняя точка подходит к границе, но не пересекает её.
   */
  it('проекция в шар Пуанкаре не выходит за единичный радиус', () => {
    const out = { x: 0, y: 0, z: 0 }
    for (const t of [0.1, 1, 5, 20]) {
      toBall(expMapOrigin(1, 1, 1, t), out)
      expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(1)
    }
    // Чем дальше точка, тем ближе к границе — это и есть «скучивание» у края.
    toBall(expMapOrigin(1, 0, 0, 1), out)
    const near = Math.hypot(out.x, out.y, out.z)
    toBall(expMapOrigin(1, 0, 0, 6), out)
    expect(Math.hypot(out.x, out.y, out.z)).toBeGreaterThan(near)
  })
})
