import { Vector3 } from 'three'
import { SPAWN } from '../../config/world'
import { signed, type Rng } from '../../core/math'
import type { World } from './entities'

/**
 * Где родиться новичку. Правило из ТЗ: случайная точка в окрестности старта, но
 * ОБЯЗАТЕЛЬНО свободная — не внутри станции, не в астероиде, не на чужом борту.
 * Двое зашедших одновременно не должны появиться друг на друге, а «случайная
 * точка в радиусе» без проверки однажды воткнёт пилота в корпус станции.
 *
 * Детерминизм от переданного `Rng`: тот же сид — та же точка, как всё в домене.
 */

// Горячего пути тут нет (спавн — разовое событие), но векторы всё равно модульные:
// правило дома — ноль аллокаций в доменных хелперах, чтобы не заводить исключений.
const _dir = new Vector3()
const _cand = new Vector3()

/** Единичный вектор в случайную сторону из seeded-RNG. Пишет в `out`. */
function randomUnit(rng: Rng, out: Vector3): Vector3 {
  do {
    out.set(signed(rng), signed(rng), signed(rng))
  } while (out.lengthSq() < 1e-6)
  return out.normalize()
}

/**
 * Свободно ли место под спавн: ни тела, ни живого астероида, ни живого борта в
 * зазоре `CLEARANCE` сверх их радиуса. Рождаемого игрока в мире ещё нет, поэтому
 * проверять «сам себя» не нужно — а вот другие игроки уже лежат в `world.ships`
 * (как удалённые борта), и эта же проверка бережёт от спавна поверх друга.
 */
export function isFreeSpawn(world: World, p: Vector3): boolean {
  for (const b of world.bodies) {
    if (p.distanceTo(b.pos) < b.radius + SPAWN.CLEARANCE) return false
  }
  for (const a of world.asteroids) {
    if (a.alive && p.distanceTo(a.pos) < a.radius + SPAWN.CLEARANCE) return false
  }
  for (const s of world.ships) {
    if (s.alive && p.distanceTo(s.state.pos) < s.spec.hull.radius + SPAWN.CLEARANCE) return false
  }
  return true
}

/**
 * Свободная точка рождения вокруг `origin`. Пробуем случайные точки на кольце; если
 * всё кольцо занято — расширяем радиус и пробуем снова. Число колец ограничено
 * (`RINGS`), поэтому поиск всегда завершается: на радиусе в десятки км пустота
 * практически гарантирована. Результат пишется в `out` и возвращается.
 */
export function pickFreeSpawn(world: World, origin: Vector3, rng: Rng, out: Vector3): Vector3 {
  let radius = SPAWN.RADIUS
  for (let ring = 0; ring < SPAWN.RINGS; ring++) {
    for (let i = 0; i < SPAWN.ATTEMPTS; i++) {
      randomUnit(rng, _dir)
      // 0.35..1 радиуса: не жмёмся к самому центру опоры (там как раз станция),
      // но и не только по кромке — разброс по объёму кольца.
      _cand.copy(origin).addScaledVector(_dir, radius * (0.35 + 0.65 * rng()))
      if (isFreeSpawn(world, _cand)) return out.copy(_cand)
    }
    radius *= SPAWN.GROWTH
  }
  // Вырожденный случай (мир забит на всех кольцах) — отдаём последнюю точку, а не
  // зависаем: на предельном радиусе она почти наверняка свободна и без проверки.
  return out.copy(_cand)
}
