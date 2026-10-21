import type { SystemDef } from '../world/system'
import { UNIVERSE } from './universe'

/**
 * КРЕСТЫ — комната-монумент, корень вселенной. Не галактика и не её система: вылетаешь в неё из
 * клубка у узла Крестов, возвращаешься — Дверью рядом. Одна на всех игроков, ни к какому зерну
 * галактики не привязана.
 *
 * Здесь крест-станция «Вечность», дом Слова: он сидит на ней по своему расписанию
 * (`slovoAtHome`), к нему можно пристыковаться и поговорить. Вдали светит Люцифер — без него
 * комната была бы чёрной (свет сцены — от светила). Трафика нет: это храм, а не перекрёсток.
 */

/** Радиус Люцифера, м: десять солнечных — ярчайшая звезда, но здесь она лишь светит. */
const LUCIFER_RADIUS = 6_963_400_000
/**
 * Крест в пяти радиусах от центра звезды — высота четыре радиуса: дальше притяжения
 * (`GRAVITY.REACH_RADII` = 1.5) и жара короны (`STAR_HEAT.SAFE_RATIO` = 1.2).
 */
const CROSS_DIST = LUCIFER_RADIUS * 5

export const MONUMENT_SYSTEM: SystemDef = {
  name: UNIVERSE.MONUMENT_NAME,
  seed: 0x5107_0001,
  room: 'monument',
  playerStart: [0, 0, CROSS_DIST + 14_000],
  star: { pos: [0, 0, 0], radius: LUCIFER_RADIUS, color: 0xfff6e8, massSolar: 10 },
  companion: null,
  dyson: null,
  planets: [],
  station: { name: 'Крест «Вечность»', pos: [0, 0, CROSS_DIST], radius: 6_000, style: 'cross' },
  // Дверь назад в клубок — чёрный шарик в стороне от причала, как у стартового причала.
  blackHoles: [{ name: 'Дверь', radius: 300, stationOffset: [0, 0, 60_000] }],
  belt: null,
  patrols: [],
  desolate: true,
}
