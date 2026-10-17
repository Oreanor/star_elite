import {
  fitDeltas,
  hardpointIndices,
  isWeapon,
  moduleStat,
  upgradeSteps,
  type PurchaseError,
  type ShipModule,
  type StatKey,
  type World,
} from '@elite/sim'
import { moduleName } from '../i18n/dataNames'
import { t } from '../i18n'

/**
 * Снаряжение: общие для верфи и экрана корабля чтения модуля — имя, сравнение по главной
 * характеристике, слот оружия, причина отказа в покупке. Мир не мутируют.
 */

/**
 * Сравнение по ЗАГОЛОВОЧНОЙ характеристике: КОНКРЕТНО было → станет. Берём её запись
 * из `fitDeltas`; если заголовочной оси там нет (у двигателя это тяга, а меняется
 * скорость), падаем на первую значимую — чтобы сравнение не пропало у очевидного
 * апгрейда. null — сравнивать не с чем (тот же модуль, нечего установить).
 *
 * «Лучше/хуже» берём СТРОГО из `higherBetter` домена, а не из размера числа: у
 * расхода маскировки меньше — значит лучше, и стрелка обязана это знать.
 */
export interface HeadlineCompare {
  key: StatKey
  from: number
  to: number
  better: boolean
}

export function headlineCompare(world: World, module: ShipModule, hardpointIndex?: number): HeadlineCompare | null {
  const { key } = moduleStat(module)
  const deltas = fitDeltas(world.player, module, hardpointIndex)
  // Только по ГЛАВНОЙ характеристике модуля. Чужая ось (у маскировки — «отсек» от её массы)
  // читалась как суть модуля: «КОРПУС 1288 → 1183 ▼» у любого доп. оборудования.
  const delta = deltas.find((d) => d.key === key)
  if (!delta) return null
  const better = delta.higherBetter ? delta.to > delta.from : delta.to < delta.from
  return { key: delta.key, from: delta.from, to: delta.to, better }
}

/**
 * Куда встанет оружие: первая подходящая точка подвески, пустая предпочтительнее
 * занятой. Повторяет логику `buy`/`fitFromHold` в домене, чтобы гашение кнопки и
 * само действие не разошлись в оценке слота.
 */
export function weaponSlot(world: World, module: ShipModule): number | undefined {
  if (!isWeapon(module)) return undefined
  const points = hardpointIndices(world.player.loadout, module.kind === 'missile' ? 'pylon' : 'gun')
  return points.find((i) => !world.player.loadout.weapons[i]) ?? points[0]
}

/** Ошибка покупки — на кнопке вместо цены. */
export function buyLabel(error: PurchaseError): string {
  switch (error) {
    case 'no-money':
      return t('station.noFunds')
    case 'already-installed':
      return t('station.fitted')
    case 'class-too-large':
      return t('station.wontFit')
    case 'no-hardpoint':
      return t('station.noHardpoint')
    default: // wrong-kind
      return t('station.wrongSlot')
  }
}

/**
 * Имя модуля для показа со счётом улучшений: «Щит 2C+», «+2», «+3». Само поле `name`
 * в домене не трогаем — плюс живёт только в UI.
 */
export function displayName(module: ShipModule): string {
  const name = moduleName(module)
  const steps = upgradeSteps(module)
  return steps <= 0 ? name : steps === 1 ? `${name}+` : `${name}+${steps}`
}
