import type { StatKey } from '@elite/sim'
import { t, type Key } from '../i18n'

/**
 * Форматирование характеристик — одна точка на весь интерфейс.
 *
 * Список модулей, дельты установки и экран корабля показывают одни и те же числа;
 * если каждый форматирует по-своему, «2.6 рад/с²» и «2.60» разойдутся в соседних
 * строках. Поэтому подпись и единицу подставляет только этот файл.
 */

/**
 * Идентификатор характеристики для интерфейса. Доменные ключи (`StatKey`) плюс те,
 * что домен не отдаёт отдельным типом, — оси, масса, энергия: их считает и
 * подписывает только UI, симуляции они как «характеристика» не нужны.
 */
export type StatId = StatKey | 'mass' | 'pitch' | 'yaw' | 'roll' | 'maneuver' | 'energy' | 'aux'

/** Единица измерения на характеристику. Отсутствует — величина безразмерная (щит, урон, класс). */
const STAT_UNIT: Partial<Record<StatId, Key>> = {
  speed: 'unit.mps',
  turn: 'unit.rads',
  pitch: 'unit.rads',
  yaw: 'unit.rads',
  roll: 'unit.rads',
  maneuver: 'unit.rads',
  cargo: 'unit.t',
  mass: 'unit.t',
  jump: 'unit.ly',
  thrust: 'unit.kn',
  ammo: 'unit.units',
  drain: 'unit.units',
  energy: 'unit.units',
  aux: 'unit.units',
}

/** Где доли важны: угловые ускорения и дальность прыжка. Прочее округляем — целое читается быстрее. */
const STAT_DECIMALS: Partial<Record<StatId, number>> = { turn: 2, jump: 2, pitch: 2, yaw: 2, roll: 2, maneuver: 2 }

/**
 * Только число характеристики, без единицы: левая часть «1.40 → 1.02 рад/с²», где единица
 * пишется один раз — в конце, у нового значения.
 */
export function statNumber(id: StatId, value: number, decimals = STAT_DECIMALS[id] ?? 0): string {
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value))
}

/**
 * «значение единица» на языке интерфейса.
 * @param decimals Знаков после запятой вместо принятых для характеристики — там, где
 *   сравнивают соседние строки (справочник: масса линий различается десятыми).
 */
export function formatStat(id: StatId, value: number, decimals = STAT_DECIMALS[id] ?? 0): string {
  const num = decimals > 0 ? value.toFixed(decimals) : String(Math.round(value))
  const unit = STAT_UNIT[id]
  return unit ? `${num} ${t(unit)}` : num
}

/** Подпись характеристики: `stat.*` из словаря. */
export function statLabel(id: StatId): string {
  return t(`stat.${id}` as Key)
}

