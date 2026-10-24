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
  turn: 'unit.degs',
  pitch: 'unit.degs',
  yaw: 'unit.degs',
  roll: 'unit.degs',
  maneuver: 'unit.degs',
  cargo: 'unit.t',
  mass: 'unit.t',
  jump: 'unit.ly',
  thrust: 'unit.kn',
  torque: 'unit.knm',
  ammo: 'unit.units',
  drain: 'unit.units',
  energy: 'unit.units',
  aux: 'unit.units',
}

/**
 * Всё — ЦЕЛЫМИ: дробь в характеристике читается хуже и ничего не добавляет. Угловые ускорения
 * в радианах — единицы (2.49 рад/с² округлилось бы в «2»), поэтому их показываем в градусах:
 * 143 °/с² — то же самое, но целым.
 */
const STAT_SCALE: Partial<Record<StatId, number>> = {
  turn: 180 / Math.PI,
  pitch: 180 / Math.PI,
  yaw: 180 / Math.PI,
  roll: 180 / Math.PI,
  maneuver: 180 / Math.PI,
}

/**
 * Только число характеристики, без единицы: левая часть «1.40 → 1.02 рад/с²», где единица
 * пишется один раз — в конце, у нового значения.
 */
export function statNumber(id: StatId, value: number): string {
  return String(Math.round(value * (STAT_SCALE[id] ?? 1)))
}

/**
 * «значение единица» на языке интерфейса.
 * @param decimals Знаков после запятой вместо принятых для характеристики — там, где
 *   сравнивают соседние строки (справочник: масса линий различается десятыми).
 */
export function formatStat(id: StatId, value: number): string {
  const num = statNumber(id, value)
  const unit = STAT_UNIT[id]
  return unit ? `${num} ${t(unit)}` : num
}

/** Подпись характеристики: `stat.*` из словаря. */
export function statLabel(id: StatId): string {
  return t(`stat.${id}` as Key)
}

