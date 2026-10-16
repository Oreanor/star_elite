import { STARTER_SYSTEM, type SystemDef } from './domain/world/system'
import { auroraVeteranLoadout } from './config/loadouts'
import { createWorld } from './domain/world'
import type { World } from './domain/world'

/**
 * ОБЩИЕ ФИКСТУРЫ ТЕСТОВ. Не часть игры: сюда не импортируется ничего, кроме сборки мира,
 * и наружу (`src/index.ts`) этот файл не экспортируется.
 *
 * Заведён потому, что «тихий мир» был выписан СЕМНАДЦАТЬ раз под тремя разными именами
 * (`quiet`, `emptyWorld`, `withPirate`) — одна и та же строка в семнадцати файлах. Это не
 * про экономию: разные имена читались как разные миры, хотя мир был один и тот же, а любая
 * правка формы `World` заставляла править семнадцать мест вместо одного.
 *
 * Тесты, которым нужен СВОЙ особенный мир (система со статуей, база у причала, пара баз),
 * по-прежнему строят его у себя: общей эта фикстура быть не обязана, а тащить в общий файл
 * всё подряд — тот же рост энтропии, только с другой стороны.
 */

/**
 * Мир без чужих: ни патрулей, ни пояса. Именно то, что нужно почти всякому тесту, —
 * сцена, где действует только тот, кого проверяют, и никто не стреляет в спину.
 */
export function quietWorld(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

/**
 * Мир с игроком на «Авроре» в ПОЛНОЙ боевой сборке (маскировка, «Клинок», четыре пилона).
 * Стартуют теперь на дешёвой «Афине», а тестам боя, маскировки и ракет нужно железо, которого
 * у новичка нет. По умолчанию — стартовая система с патрулями, как у `createWorld()`.
 */
export function veteranWorld(def: SystemDef = STARTER_SYSTEM): World {
  return createWorld(def, undefined, auroraVeteranLoadout())
}

/** То же, но без чужих — `quietWorld` на «Авроре». */
export function quietVeteranWorld(): World {
  return veteranWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}
