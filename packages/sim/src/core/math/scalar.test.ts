import { describe, expect, it } from 'vitest'
import { makeRng } from './random'
import { deadzoneScale, wrapAround } from './scalar'

/**
 * Регрессия рендера, пойманная в полёте. Ближняя пыль оборачивается вокруг игрока
 * в кубе со стороной 700 м, а плавающее начало координат телепортирует игрока на
 * 4 км разом. Пошаговая обёртка (`if (rel > half) value -= BOX`) возвращала частицу
 * за шесть кадров: всё это время единственный источник ощущения скорости висел вне
 * куба и рывками полз обратно. Читалось как удар о невидимую стену раз в 20 секунд.
 *
 * Поэтому проверяется СВОЙСТВО «за один вызов, с любого расстояния», а не числа.
 */
describe('wrapAround', () => {
  const BOX = 700
  const half = BOX / 2

  it('сворачивает в полукуб за один вызов с любого расстояния', () => {
    const rng = makeRng(0x5eed)

    for (let i = 0; i < 1000; i++) {
      // Расстояния до сотен кубов: сдвиг начала координат бывает любым.
      const center = (rng() - 0.5) * 1e6
      const value = center + (rng() - 0.5) * 200 * BOX

      const wrapped = wrapAround(value, center, BOX)
      expect(Math.abs(wrapped - center)).toBeLessThanOrEqual(half + 1e-9)
    }
  })

  it('переносит точку на целое число кубов — решётка не сбивается', () => {
    const value = 4000
    const wrapped = wrapAround(value, 0, BOX)

    const steps = (value - wrapped) / BOX
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9)
  })

  /** Внутри полукуба точка не двигается вовсе: обёртка не должна дрожать. */
  it('не трогает то, что уже рядом с центром', () => {
    expect(wrapAround(120, 0, BOX)).toBe(120)
    expect(wrapAround(-340, 0, BOX)).toBe(-340)
    expect(wrapAround(1_000_120, 1_000_000, BOX)).toBe(1_000_120)
  })
})

/**
 * Мёртвая зона ручки. Измерено: отклонение 0.005 — это два пикселя мыши —
 * уводило нос корабля на 13° за минуту. Дрожь руки не должна командовать.
 */
describe('deadzoneScale', () => {
  const DZ = 0.02

  it('внутри зоны команда ровно нулевая', () => {
    expect(deadzoneScale(0, DZ)).toBe(0)
    expect(deadzoneScale(DZ / 2, DZ)).toBe(0)
    expect(deadzoneScale(DZ, DZ)).toBe(0)
  })

  /** Без растяжения команда на выходе из зоны прыгала бы с нуля до порога. */
  it('на границе зоны команда трогается с нуля, а не со ступеньки', () => {
    const justOutside = DZ + 1e-6
    expect(justOutside * deadzoneScale(justOutside, DZ)).toBeLessThan(1e-5)
  })

  /** Верхний край ручки не теряется: полное отклонение остаётся полным. */
  it('полное отклонение остаётся полным', () => {
    expect(1 * deadzoneScale(1, DZ)).toBeCloseTo(1, 12)
  })

  it('команда растёт вместе с отклонением', () => {
    let previous = 0
    for (let m = DZ + 1e-3; m <= 1; m += 0.01) {
      const command = m * deadzoneScale(m, DZ)
      expect(command).toBeGreaterThan(previous)
      expect(command).toBeLessThanOrEqual(1 + 1e-9)
      previous = command
    }
  })
})
