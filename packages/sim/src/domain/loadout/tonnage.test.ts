import { describe, expect, it } from 'vitest'
import { AURORA_MK3 } from '../../config/chassis'
import {
  ARMOUR_STEEL_3,
  CARGO_LARGE,
  CLOAK_FIELD,
  ENGINE_MILITARY,
  ENGINE_STANDARD,
  HYPERDRIVE_DEEP,
  MIELOPHONE_DEVICE,
  RCS_MILITARY,
  RCS_STANDARD,
  SHIELD_HEAVY,
  SHIELD_LIGHT,
} from '../../config/modules'
import { createLoadout, deriveShipSpec } from '.'

/**
 * Модель тоннажа: грузоподъёмность — свойство КОРПУСА (массовый бюджет под нагрузку).
 * Оборудование ест бюджет своей массой, контейнеры его расширяют, остаток — под товар.
 * Проверяем СВОЙСТВА модели, а не конкретные числа: они переживут перебалансировку.
 */
describe('грузоподъёмность корпуса (тоннаж)', () => {
  it('оборудование съедает грузоподъёмность: тяжелее обвес — меньше трюма', () => {
    const light = deriveShipSpec(createLoadout(AURORA_MK3, [ENGINE_STANDARD, RCS_STANDARD, SHIELD_LIGHT], [])).cargoCapacity
    const heavy = deriveShipSpec(createLoadout(AURORA_MK3, [ENGINE_STANDARD, RCS_STANDARD, SHIELD_HEAVY], [])).cargoCapacity
    expect(heavy).toBeLessThan(light) // тяжёлый щит отнял место у трюма
    // Отнял примерно на разницу масс (±1 т округления до целых тонн) — это ВЫЧЕТ массы, не «штраф».
    expect(Math.abs((light - heavy) - (SHIELD_HEAVY.mass - SHIELD_LIGHT.mass))).toBeLessThanOrEqual(1)
  })

  it('контейнер даёт НЕТТО прибавку: вместимость минус собственная масса', () => {
    const bare = deriveShipSpec(createLoadout(AURORA_MK3, [ENGINE_STANDARD, RCS_STANDARD], [])).cargoCapacity
    const withRack = deriveShipSpec(createLoadout(AURORA_MK3, [ENGINE_STANDARD, RCS_STANDARD, CARGO_LARGE], [])).cargoCapacity
    const gain = withRack - bare
    expect(gain).toBeGreaterThan(0) // расширять трюм он обязан, а не сжимать
    // Нетто = capacity − mass (~9× массы), с точностью до тонны округления.
    expect(Math.abs(gain - (CARGO_LARGE.capacity - CARGO_LARGE.mass))).toBeLessThanOrEqual(1)
  })

  it('свободный трюм зажимается в ноль при перегрузе обвесом, не уходит в минус', () => {
    // Набиваем корпус самым тяжёлым железом сверх бюджета (36+ т против базы 22): трюма
    // не остаётся вовсе, но отрицательной вместимости быть не может.
    const overloaded = createLoadout(
      AURORA_MK3,
      [ENGINE_MILITARY, RCS_MILITARY, SHIELD_HEAVY, ARMOUR_STEEL_3, ARMOUR_STEEL_3, HYPERDRIVE_DEEP, CLOAK_FIELD, MIELOPHONE_DEVICE],
      [],
    )
    expect(deriveShipSpec(overloaded).cargoCapacity).toBe(0)
  })

  it('аукс-ёмкость доп-отсека берётся из корпуса', () => {
    const l = createLoadout(AURORA_MK3, [ENGINE_STANDARD, RCS_STANDARD], [])
    expect(deriveShipSpec(l).power.auxCapacity).toBe(AURORA_MK3.auxCapacity)
  })

  it('прокачка оси рамы усиливает ТОЛЬКО её: HP / трюм / аукс независимы', () => {
    const l = createLoadout(AURORA_MK3, [ENGINE_STANDARD, RCS_STANDARD], [])
    const base = deriveShipSpec(l)
    // Усилили только аукс — растёт аукс, HP и трюм не трогаются.
    const aux = deriveShipSpec(l, 0, { hull: false, cargo: false, aux: true })
    expect(aux.power.auxCapacity).toBeGreaterThan(base.power.auxCapacity)
    expect(aux.hull.hull).toBe(base.hull.hull)
    expect(aux.cargoCapacity).toBe(base.cargoCapacity)
    // Усилили только HP — растёт HP, аукс и трюм на месте.
    const hp = deriveShipSpec(l, 0, { hull: true, cargo: false, aux: false })
    expect(hp.hull.hull).toBeGreaterThan(base.hull.hull)
    expect(hp.power.auxCapacity).toBe(base.power.auxCapacity)
  })
})
