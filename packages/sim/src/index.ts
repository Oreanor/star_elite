/**
 * @elite/sim — чистая симуляция.
 *
 * Ни three-сцены, ни React, ни DOM. Только математика three (Vector3/Quaternion).
 * Благодаря этому пакет запускается на сервере дословно, тем же кодом,
 * когда дойдёт очередь до сетевого боя.
 */

export * from './config'
export * from './core/math'

export * from './domain/ai'
export * from './domain/cargo'
export * from './domain/combat'
export * from './domain/cruise'
export * from './domain/dialogue'
export * from './domain/flight'
export * from './domain/galaxy'
export * from './domain/loadout'
export * from './domain/save'
export * from './domain/sim'
export * from './domain/station'
export * from './domain/world'
