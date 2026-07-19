import { HUMAN_SPECIES, SCALE, STAR_CLASSES } from '../../config/galaxy'
import { STARTER_SYSTEM } from '../world/system'
import type { Planet, StarSystem } from './types'

/**
 * Родная система в каталоге галактики.
 *
 * Она одна во всей галактике собрана руками: настоящее Солнце, настоящая Земля,
 * станция на низкой орбите. Но карта не должна знать об этом исключении — ей
 * нужна такая же `StarSystem`, как у остальных двух с половиной тысяч.
 *
 * Числа НЕ переписаны сюда второй раз. Каталог оперирует условными единицами,
 * сцена — метрами, и переводит их `SCALE`. Значит, каталожную запись можно
 * вывести из `STARTER_SYSTEM` делением — и никакой правкой сцены её больше
 * не рассинхронизировать. Именно от этого расхождения карта звала родную
 * звезду «Альовас», пока игрок стоял на причале в «Тиррионе».
 *
 * Руками задано только то, чего в `SystemDef` нет вовсе: кто здесь живёт.
 */

const G_CLASS = (() => {
  const c = STAR_CLASSES.find((s) => s.id === 'G')
  if (!c) throw new Error('в каталоге светил нет жёлтого карлика')
  return c
})()

/** Длина вектора: орбита планеты в каталожных единицах — это её удаление от звезды. */
const orbitOf = (pos: readonly [number, number, number]) =>
  Math.round(Math.hypot(pos[0], pos[1], pos[2]) / SCALE.ORBIT)

const planetsOf = (): Planet[] =>
  STARTER_SYSTEM.planets.map((p, i) => {
    // Живут только на первом мире — том, у которого висит станция.
    const home = i === 0
    const station = STARTER_SYSTEM.station
    return {
      name: p.name,
      type: p.type,
      radius: Math.round(p.radius / SCALE.PLANET_RADIUS),
      moons: [],
      orbit: orbitOf(p.pos),
      settlement: home
        ? {
            economy: 'Высокие технологии' as const,
            government: 'Демократия' as const,
            techLevel: 12,
            population: 8.6,
            species: HUMAN_SPECIES,
          }
        : null,
      station:
        home && station
          ? { name: station.name, orbit: Math.round(SCALE.STATION_ORBIT * 0.5), type: 'Кориолис' as const }
          : null,
    }
  })

/**
 * Каталожная запись родной системы. Позиция приходит извне: её задаёт `placeSystem`
 * по индексу, а не эта таблица, — иначе звезда стояла бы на карте не там, откуда
 * до неё меряют прыжки.
 */
export function homeSystem(index: number, x: number, y: number, z: number): StarSystem {
  return {
    index,
    name: STARTER_SYSTEM.name,
    x,
    y,
    z,
    star: {
      class: G_CLASS.id,
      className: G_CLASS.name,
      // Цвет берём у сцены: на карте звезда обязана быть того же оттенка,
      // каким игрок увидит её в кадре.
      color: STARTER_SYSTEM.star.color,
      radius: Math.round(STARTER_SYSTEM.star.radius / SCALE.STAR_RADIUS),
      massSolar: STARTER_SYSTEM.star.massSolar,
      scoopable: G_CLASS.scoopable,
    },
    // Родная система одиночная — как и её описание в STARTER_SYSTEM.
    companion: null,
    // Сферы Дайсона у дома нет: она метит чужие вершины прогресса, не старт.
    dyson: null,
    planets: planetsOf(),
    security: 'Высокая',
  }
}
