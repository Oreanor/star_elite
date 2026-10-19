import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CHASSIS_CATALOGUE, createLoadout, Modules } from '@elite/sim'

// Сетка слотов тянет словарь, а тот при загрузке читает localStorage.
let buildSlots: typeof import('./ShipSlots').buildSlots
beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'ru', setItem: () => {} })
  vi.stubGlobal('navigator', { language: 'ru' })
  ;({ buildSlots } = await import('./ShipSlots'))
})

describe('плитка ракет', () => {
  // Пойманный баг: карточка брала паспорт обоймы (module.ammo), а клавиша пуска смотрит
  // guns.ammo. Расстрелянные на прошлом корпусе ракеты на экране всё ещё «есть».
  it('показывает остаток в пусковых, а не полный паспорт', () => {
    const chassis = CHASSIS_CATALOGUE.find((c) => c.hardpoints.some((h) => h.kind === 'pylon'))!
    const weapons = chassis.hardpoints.map((hp) => (hp.kind === 'pylon' ? Modules.MISSILE_PYLON : null))
    const loadout = createLoadout(chassis, [], weapons)
    const passport = buildSlots(loadout).find((s) => s.key === 'missiles')!.ammoTotal!
    expect(passport).toBeGreaterThan(0)
    expect(buildSlots(loadout, () => 0).find((s) => s.key === 'missiles')!.ammoTotal).toBe(0)
  })
})
