import { HUMAN_SPECIES } from '../../config/galaxy'
import { TIME } from '../../config/time'
import { SLOVO_ROTA } from '../../config/world'
import type { Persona } from './persona'

/**
 * СЛОВО — особый персонаж-бог. Не трафик и не случайный знакомый: он вписан в мир вручную
 * и ЖИВЁТ на Крестах, а по мирам ходит трафиком. У бога нет ни расы, ни корабля — но домену для
 * разговора нужен борт-собеседник (диалог и оба списка находят собеседника по `world.ships`).
 * Поэтому он существует ShipEntity'ю, только КИНЕМАТИЧЕСКОЙ: физика, рендер и столкновения
 * её не трогают — он не летает, а сидит в станции, всегда в списке пристыкованных.
 *
 * Здесь — только ДАННЫЕ бога (имя, тип, личность). Собирает борт `spawnSlovo` в фабрике,
 * рядом с `makeShip`: так этот файл ни от чего не зависит и импортируется в одну сторону.
 */

/** Имя бога. Стабильно: по нему и по `originKind: 'god'` его узнают все системы и списки. */
export const SLOVO_NAME = 'Слово'

/**
 * Тип «встречи» бога. НЕ из `ENCOUNTERS`: его выставляет руками `spawnSlovo`, а не трафик.
 * По этому ярлыку реестр знакомств и воскрешение резидентов знают, что борт особый.
 */
export const SLOVO_KIND = 'god'

/**
 * Личность Слова — бог-философ, невозмутимый и проницательный. Вид формально людской:
 * его облик и род занятий несут флаг `divine` (аватар dude) и `originKind: 'god'` («бог»),
 * а не `species`, — так ни один справочник по виду (портрет, реплика) на нём не спотыкается.
 */
export const SLOVO_PERSONA: Persona = {
  disposition: 'calculating',
  intellect: 5,
  temperament: 1,
  charisma: 5,
  willpower: 5,
  agility: 3,
  accuracy: 3,
  species: HUMAN_SPECIES,
  // Главный коллекционер статуэток богов: знает всех, zeal на потолке.
  figurineHobby: { aware: true, zeal: 1 },
}

/** Игровые сутки в единицах `calendarTime`: календарь при показе ускорен ×TIME.SCALE. */
const GAME_DAY = 86_400 / TIME.SCALE

/**
 * Дома ли Слово (на Крестах) в этот момент календаря. Чистая функция зерна и общего
 * календаря — у всех игроков и на сервере ответ один, хранить и синхронизировать нечего.
 *
 * Отрезок календаря (SEGMENT_DAYS) делится одной сменой в день из [SWITCH_MIN, SWITCH_MAX]:
 * первая часть — дома или нет (монета от зерна), вторая — наоборот. Отсюда пласты от недели
 * до месяца и поровну дома и в отлучке.
 */
export function slovoAtHome(galaxySeed: number, calendarTime: number): boolean {
  const segment = SLOVO_ROTA.SEGMENT_DAYS * GAME_DAY
  const k = Math.floor(calendarTime / segment)
  const h = (galaxySeed ^ Math.imul(k + 1, 0x9e3779b1) ^ 0x51a7e) >>> 0
  const firstHome = hashUnit(h) < 0.5
  const span = SLOVO_ROTA.SWITCH_MAX_DAYS - SLOVO_ROTA.SWITCH_MIN_DAYS
  const switchAt = (SLOVO_ROTA.SWITCH_MIN_DAYS + hashUnit(h ^ 0x85ebca6b) * span) * GAME_DAY
  return calendarTime - k * segment < switchAt ? firstHome : !firstHome
}

/** Хеш целого в [0, 1) — шаг mulberry32 без замыкания: зовётся каждый такт. */
function hashUnit(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

