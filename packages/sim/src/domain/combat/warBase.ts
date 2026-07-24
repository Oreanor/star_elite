import { Vector3 } from 'three'
import { MONOLITH } from '../../config/monoliths'
import { WARBASE } from '../../config/warbase'
import { randomUnit } from '../../core/math'
import type { WarBaseEntity, WarBaseFixture, World } from '../world/entities'
import { livingFixtures, warBaseFixtureWorldPos } from '../world/warBase'
import { spawnBlastwave, spawnExplosion } from './effects'
import { spawnRockDebrisPod } from './salvage'

// Место детали — геометрия мира (`world/warBase`), но бой и его тесты привыкли брать её
// отсюда: снаружи «деталь базы» одно понятие, а не два файла в соседних папках.
export { warBaseFixtureWorldPos }

/** База не дрейфует — вспышки гибели без унаследованной скорости. */
const _still = /* @__PURE__ */ new Vector3()
const _fixWorld = /* @__PURE__ */ new Vector3()
const _blastAt = /* @__PURE__ */ new Vector3()
const _scrapDir = /* @__PURE__ */ new Vector3()

/**
 * РАСКАТЫВАЮЩАЯСЯ ДЕТОНАЦИЯ: десятки очагов по объёму шара, зажигающихся не разом.
 *
 * Одна вспышка километрового масштаба — это плоская заливка экрана: билборд всегда
 * развёрнут к камере, объёма в нём нет. Очаги же разнесены по глубине (при движении
 * камеры расходятся параллаксом) и стартуют со сдвигом: `born` в БУДУЩЕМ, а рендер
 * пропускает то, чему ещё не время. Оттого в кадре одновременно живут разные фазы
 * флипбука, и снос читается как серия детонаций, а не как один хлопок.
 */
function detonate(world: World, base: WarBaseEntity): void {
  for (let i = 0; i < WARBASE.BLASTS; i++) {
    randomUnit(world.rng, _blastAt)
    // Кубический корень равномерно набивает ОБЪЁМ шара: иначе очаги липнут к центру.
    const depth = Math.cbrt(world.rng()) * WARBASE.BLAST_SPREAD
    _blastAt.multiplyScalar(base.radius * depth).add(base.pos)
    const scale =
      base.radius * (WARBASE.BLAST_SCALE_MIN + world.rng() * (WARBASE.BLAST_SCALE_MAX - WARBASE.BLAST_SCALE_MIN))
    spawnExplosion(world, _blastAt, _still, scale, world.time + i * WARBASE.BLAST_STEP)
  }
}

/** Поле лома вокруг снесённой базы: подбирается трюмом, тараном не бьёт. */
function scatterScrap(world: World, base: WarBaseEntity): void {
  const n = WARBASE.SCRAP_MIN + Math.floor(world.rng() * (WARBASE.SCRAP_MAX - WARBASE.SCRAP_MIN + 1))
  for (let i = 0; i < n; i++) {
    // Куски вылетают из объёма, а не из одной точки: иначе поле лома выглядит фонтаном.
    randomUnit(world.rng, _scrapDir)
    _blastAt.copy(_scrapDir).multiplyScalar(base.radius * Math.cbrt(world.rng())).add(base.pos)
    spawnRockDebrisPod(
      world,
      _blastAt,
      _still,
      base.shape,
      MONOLITH.ROCK_DEBRIS_RADIUS * (0.7 + world.rng() * 0.9),
      WARBASE.SCRAP_MASS,
      WARBASE.SCRAP_SPEED,
    )
  }
}

/**
 * Снести базу. Гибнет она НЕ мгновенно: сперва по объёму раскатывается каскад детонаций
 * (`detonate`), и лишь когда он отгремит — бьёт ударная волна и разлетается лом
 * (`stepWarBaseWrecks`). Оттого снос читается как событие с началом и концом, а не как
 * одна вспышка, после которой километровый шар просто исчез.
 */
export function destroyWarBase(world: World, base: WarBaseEntity): void {
  if (!base.alive) return
  base.alive = false
  base.wreckAt = world.time
  base.scattered = false
  detonate(world, base)
}

/** Сколько длится каскад: последняя вспышка зажигается на этой секунде. */
const cascadeTime = (): number => WARBASE.BLASTS * WARBASE.BLAST_STEP

/**
 * Агония снесённых баз: дождаться конца каскада и дать «пух» — сферическую волну и разлёт
 * лома. Раз в кадр, по секундам, как трафик и киты: это не физика, а сценарий гибели.
 *
 * Флаг `scattered` нужен, потому что шаг зовётся каждый кадр, а высыпать лом надо однажды.
 */
export function stepWarBaseWrecks(world: World): void {
  for (const base of world.warBases) {
    if (base.alive || base.scattered || base.wreckAt === null) continue
    if (world.time - base.wreckAt < cascadeTime()) continue
    base.scattered = true
    spawnBlastwave(world, base.pos, base.radius * WARBASE.WAVE_REACH)
    scatterScrap(world, base)
  }
}

/** Отгремело ли всё: волна прошла и лом разлетелся — базу можно вынести из мира. */
export function warBaseWreckDone(base: WarBaseEntity, now: number): boolean {
  if (base.alive) return false
  if (base.wreckAt === null) return true
  return base.scattered && now - base.wreckAt >= cascadeTime() + WARBASE.WAVE_LIFE
}

/**
 * Удар в ОБШИВКУ базы урона не наносит: живучесть базы — это её детали.
 *
 * Так снос перестаёт быть измором невидимой копилки и становится счётом: полсотни турелей —
 * полсотни точных выстрелов, и полоска цели показывает, сколько осталось. Стрелять по
 * корпусу можно (искру рисует `bolts`), но толку нет — бей по тому, что торчит.
 */
export function damageWarBase(_world: World, _base: WarBaseEntity, _amount: number): void {}

/**
 * Отстрел ДЕТАЛИ. Сбивается ОДНИМ попаданием, какой бы слабой ни была пушка: у детали нет
 * своей копилки прочности. Гибнет отдельной вспышкой в своей точке; сбитая последняя
 * забирает с собой базу — держаться ей больше не на чем.
 */
export function damageWarBaseFixture(world: World, base: WarBaseEntity, fix: WarBaseFixture, _amount: number): void {
  if (!fix.alive || !base.alive) return
  fix.alive = false
  warBaseFixtureWorldPos(base, fix, world.time, _fixWorld)
  spawnExplosion(world, _fixWorld, _still, fix.size * 1.2)
  if (livingFixtures(base) === 0) destroyWarBase(world, base)
}
