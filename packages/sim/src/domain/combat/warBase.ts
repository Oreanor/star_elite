import { Vector3 } from 'three'
import { MONOLITH } from '../../config/monoliths'
import { COMMODITIES } from '../cargo/items'
import { WARBASE } from '../../config/warbase'
import { randomUnit } from '../../core/math'
import type { WarBaseEntity, WarBaseFixture, WarShard, World } from '../world/entities'
import { livingFixtures, warBaseFixtureWorldPos } from '../world/warBase'
import { spawnBlastwave, spawnExplosion } from './effects'
import { spawnRockDebrisPod } from './salvage'
import { blastKick } from './blastKick'
import { COSMIC } from '../../config/weapons'

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
function detonate(world: World, base: WarBaseEntity, startAt = world.time, step: number = WARBASE.BLAST_STEP): void {
  for (let i = 0; i < WARBASE.BLASTS; i++) {
    randomUnit(world.rng, _blastAt)
    // Кубический корень равномерно набивает ОБЪЁМ шара: иначе очаги липнут к центру.
    const depth = Math.cbrt(world.rng()) * WARBASE.BLAST_SPREAD
    _blastAt.multiplyScalar(base.radius * depth).add(base.pos)
    const scale =
      base.radius * (WARBASE.BLAST_SCALE_MIN + world.rng() * (WARBASE.BLAST_SCALE_MAX - WARBASE.BLAST_SCALE_MIN))
    spawnExplosion(world, _blastAt, _still, scale, startAt + i * step, base.pos)
  }
}

/** Поле лома вокруг снесённой базы: подбирается трюмом, тараном не бьёт. */
function scatterScrap(world: World, base: WarBaseEntity): void {
  const n = WARBASE.SCRAP_MIN + Math.floor(world.rng() * (WARBASE.SCRAP_MAX - WARBASE.SCRAP_MIN + 1))
  for (let i = 0; i < n; i++) {
    // Куски вылетают из объёма, а не из одной точки: иначе поле лома выглядит фонтаном.
    randomUnit(world.rng, _scrapDir)
    _blastAt.copy(_scrapDir).multiplyScalar(base.radius * Math.cbrt(world.rng())).add(base.pos)
    // База — железо, не камень: из неё сыплется лом, а изредка и уцелевший металл.
    spawnRockDebrisPod(
      world,
      _blastAt,
      _still,
      base.shape,
      MONOLITH.ROCK_DEBRIS_RADIUS * (0.7 + world.rng() * 0.9),
      WARBASE.SCRAP_MASS,
      WARBASE.SCRAP_SPEED,
      world.rng() < WARBASE.SCRAP_METAL_SHARE ? COMMODITIES.METALS : COMMODITIES.SCRAP,
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
    if (world.time - base.wreckAt < wreckSpan(base)) continue
    base.scattered = true
    // Осколки и волна — зрелище, у всех свои; лом — общие контейнеры, его сыплет хозяин.
    // Прежде и волна стояла за проверкой хозяина — у остальных игроков её не было вовсе.
    if (base.violent) {
      flingShards(world, base)
      // Общий взрыв от разбивающего шара толкает и трясёт корабли вокруг — у каждого свой.
      blastKick(world, base.pos, base.radius, false, COSMIC.KICK.BASE_REACH)
    }
    spawnBlastwave(world, base.pos, base.radius * (base.violent ? WARBASE.SHATTER.WAVE_REACH : WARBASE.WAVE_REACH))
    if (world.trafficRole === 'mirror') continue
    scatterScrap(world, base)
  }
}

/** Отгремело ли всё: волна прошла и лом разлетелся — базу можно вынести из мира. */
export function warBaseWreckDone(base: WarBaseEntity, now: number): boolean {
  if (base.alive) return false
  if (base.wreckAt === null) return true
  return base.scattered && now - base.wreckAt >= wreckSpan(base) + WARBASE.WAVE_LIFE
}

/** Сколько длится гибель до общего взрыва: у сноса шаром — свой счёт очагов. */
function wreckSpan(base: WarBaseEntity): number {
  return base.violent ? (base.wreckSpan ?? 0) : cascadeTime()
}

/**
 * Стоит ли ещё корпус: жива — да; снесена шаром — пока рвутся очаги, до общего взрыва. Рендер
 * держит её видимой ровно столько: база рвётся на глазах, а не пропадает в миг удара.
 */
export function warBaseStanding(base: WarBaseEntity, now: number): boolean {
  if (base.alive) return true
  return base.violent === true && base.wreckAt !== null && now - base.wreckAt < (base.wreckSpan ?? 0)
}

/**
 * СНОС РАЗРУШАЮЩИМ ШАРОМ — «быдыщ-быдыщ-быдыщ»: по очереди рвутся детали в разных местах
 * обшивки (у каждой свой миг `blowAt` — с него рендер рисует огрызок), затем вдох — и грохает
 * весь шар: огромная вспышка, каскад внутри, волна шире обычной. Турели и огрызки оснований
 * разлетаются осколками (`flingShards`) в миг общего взрыва.
 */
export function shatterWarBase(world: World, base: WarBaseEntity, impact?: Vector3): void {
  if (!base.alive) return
  const S = WARBASE.SHATTER
  const rng = world.rng
  base.alive = false
  base.violent = true
  base.wreckAt = world.time
  base.scattered = false

  const final = S.BUILD + S.FINAL_DELAY
  base.wreckSpan = final
  base.rays = []
  const foci = S.FOCI_MIN + Math.floor(rng() * (S.FOCI_MAX - S.FOCI_MIN + 1))
  // Сторона удара: к месту попадания, а без него (удар пришёл по сети) — к своему кораблю.
  _hitDir.copy(impact ?? world.player.state.pos).sub(base.pos)
  if (_hitDir.lengthSq() < 1e-6) randomUnit(rng, _hitDir)
  _hitDir.normalize()
  for (let k = 0; k < foci; k++) {
    // Очаги — по отрезку разгара с разбросом; каждый следующий крупнее: огонь набирает силу.
    const u = foci > 1 ? k / (foci - 1) : 1
    const start = Math.min(S.BUILD - S.PUFF_SPREAD_TIME, (u * 0.85 + rng() * 0.15) * (S.BUILD - S.PUFF_SPREAD_TIME))
    const radius = base.radius * (S.FOCUS_START + (S.FOCUS_END - S.FOCUS_START) * u)
    coneDir(rng, _hitDir, S.FOCI_SPREAD * Math.sqrt(rng()), _spotDir)
    _focus.copy(_spotDir).multiplyScalar(base.radius * (1 + S.FOCI_LIFT)).add(base.pos)
    // Первые очаги прорываются и лучом из ядра — через себя, в миг своего разгара.
    if (k < S.RAYS) base.rays.push({ dir: _spotDir.clone(), at: world.time + start })
    for (let n = 0; n < S.PUFFS; n++) {
      randomUnit(rng, _puffDir).multiplyScalar(radius * S.PUFF_OFFSET * Math.cbrt(rng()))
      world.firePuffs.push({
        pos: _focus.clone().add(_puffDir),
        born: world.time + start + rng() * S.PUFF_SPREAD_TIME,
        life: S.PUFF_LIFE_MIN + rng() * (S.PUFF_LIFE_MAX - S.PUFF_LIFE_MIN),
        size: radius * (S.PUFF_SIZE_MIN + rng() * (S.PUFF_SIZE_MAX - S.PUFF_SIZE_MIN)),
        seed: rng() * 100,
        zoomAt: base.pos.clone(),
      })
    }
    // Детали у очага рвутся вместе с ним: с этого мига они — огрызки.
    for (const fix of base.fixtures) {
      if (!fix.alive || fix.blowAt !== undefined) continue
      warBaseFixtureWorldPos(base, fix, world.time + start, _blastAt)
      if (_blastAt.distanceTo(_focus) <= radius * S.BLOW_REACH) fix.blowAt = world.time + start
    }
  }
  // Общий взрыв: раскалённое ядро и огненный ком по объёму шара — клубится на месте; резко
  // летят лишь осколки.
  coreFlash(world, base, world.time + final)
  for (let n = 0; n < S.FINAL_PUFFS; n++) {
    randomUnit(rng, _puffDir).multiplyScalar(base.radius * S.FINAL_SPREAD * Math.cbrt(rng()))
    world.firePuffs.push({
      pos: base.pos.clone().add(_puffDir),
      born: world.time + final + rng() * 0.25,
      life: S.FINAL_LIFE_MIN + rng() * (S.FINAL_LIFE_MAX - S.FINAL_LIFE_MIN),
      size: base.radius * S.FINAL_PUFF_SIZE * (0.6 + 0.6 * rng()),
      seed: rng() * 100,
      zoomAt: base.pos.clone(),
    })
  }
}

/**
 * Раскалённое ядро общего взрыва: сперва слепящая вспышка «реактора» (белые клубы на весь шар
 * за полсекунды), под ней — клубы ядра, ярче и крупнее прочих, долго тлеющие.
 */
/**
 * Вспышка попадания шара в базу — у всех, кто видел шар (не только у хозяина, который сносит).
 * Без `world.rng`: у зеркала и хозяина число бросков разное, а зрелище от этого не зависит —
 * разброс клубов — от номера клуба.
 */
export function warBaseImpactFlash(world: World, base: WarBaseEntity, point: Vector3): void {
  const S = WARBASE.SHATTER
  // Чуть над обшивкой, со стороны удара: корпус не съедает нижнюю половину вспышки.
  _puffDir.copy(point).sub(base.pos).setLength(base.radius * (1 + S.FOCI_LIFT))
  for (let n = 0; n < S.IMPACT_PUFFS; n++) {
    const a = n * 2.399
    const r = base.radius * S.IMPACT_SIZE * 0.3 * Math.sqrt(n / S.IMPACT_PUFFS)
    world.firePuffs.push({
      pos: base.pos.clone().add(_puffDir).add(_blastAt.set(Math.cos(a) * r, Math.sin(a * 1.7) * r, Math.sin(a) * r)),
      born: world.time + n * 0.04,
      life: S.IMPACT_LIFE * (0.85 + 0.1 * n),
      size: base.radius * S.IMPACT_SIZE * (1 - 0.12 * n),
      seed: (base.slot * 17 + n * 31) % 100,
      heat: S.FLASH_HEAT,
      zoomAt: base.pos.clone(),
    })
  }
}

function coreFlash(world: World, base: WarBaseEntity, at: number): void {
  const S = WARBASE.SHATTER
  const rng = world.rng
  for (let n = 0; n < S.FLASH_PUFFS; n++) {
    randomUnit(rng, _puffDir).multiplyScalar(base.radius * 0.15 * rng())
    world.firePuffs.push({
      pos: base.pos.clone().add(_puffDir),
      born: at,
      life: S.FLASH_LIFE * (0.8 + 0.4 * rng()),
      size: base.radius * S.FLASH_SIZE * (0.8 + 0.4 * rng()),
      seed: rng() * 100,
      heat: S.FLASH_HEAT,
      zoomAt: base.pos.clone(),
    })
  }
  for (let n = 0; n < S.CORE_PUFFS; n++) {
    randomUnit(rng, _puffDir).multiplyScalar(base.radius * 0.25 * Math.cbrt(rng()))
    world.firePuffs.push({
      pos: base.pos.clone().add(_puffDir),
      born: at + rng() * 0.12,
      life: S.FINAL_LIFE_MIN + rng() * (S.FINAL_LIFE_MAX - S.FINAL_LIFE_MIN),
      size: base.radius * S.CORE_SIZE * (0.7 + 0.5 * rng()),
      seed: rng() * 100,
      heat: S.CORE_HEAT,
      zoomAt: base.pos.clone(),
    })
  }
}

const _spotDir = /* @__PURE__ */ new Vector3()
const _puffDir = /* @__PURE__ */ new Vector3()
const _focus = /* @__PURE__ */ new Vector3()
const _hitDir = /* @__PURE__ */ new Vector3()
const _side = /* @__PURE__ */ new Vector3()

/** Направление в конусе `angle` (рад) вокруг `axis` — под случайным азимутом. */
function coneDir(rng: () => number, axis: Vector3, angle: number, out: Vector3): Vector3 {
  _side.set(1, 0, 0)
  if (Math.abs(axis.x) > 0.9) _side.set(0, 1, 0)
  _side.cross(axis).normalize()
  _side.applyAxisAngle(axis, rng() * Math.PI * 2)
  return out.copy(axis).multiplyScalar(Math.cos(angle)).addScaledVector(_side, Math.sin(angle)).normalize()
}

/** Клубы огня гаснут по возрасту — такт мира, не кадр. */
export function stepFirePuffs(world: World): void {
  const list = world.firePuffs
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i]!
    if (world.time - f.born > f.life) list.splice(i, 1)
  }
}

const _shardDir = /* @__PURE__ */ new Vector3()

/**
 * Один осколок: из точки `from` наружу от центра базы, с разбросом скорости и вращения.
 * `pace` — доля обычной скорости и вращения: тяжёлый кусок летит и крутится медленнее.
 */
function shard(
  world: World,
  base: WarBaseEntity,
  from: Vector3,
  kind: WarShard['kind'],
  model: number,
  seed: number,
  size: number,
  pace = 1,
): void {
  const S = WARBASE.SHATTER
  const rng = world.rng
  _shardDir.copy(from).sub(base.pos)
  if (_shardDir.lengthSq() < 1e-6) randomUnit(rng, _shardDir)
  _shardDir.normalize()
  // Не строго по радиали: лёгкий веер, иначе осколки летят идеальным ежом.
  _blastAt.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.6)
  _shardDir.add(_blastAt).normalize()
  const speed = pace * base.radius * (S.SHARD_SPEED_MIN + rng() * (S.SHARD_SPEED_MAX - S.SHARD_SPEED_MIN))
  world.warShards.push({
    pos: from.clone(),
    vel: _shardDir.clone().multiplyScalar(speed),
    axis: randomUnit(rng, new Vector3()),
    spin: pace * S.SHARD_SPIN * (0.4 + rng() * 0.8) * (rng() < 0.5 ? -1 : 1),
    kind,
    model,
    seed,
    size,
    born: world.time,
    life: S.SHARD_LIFE * (0.7 + rng() * 0.6),
    zoomAt: base.pos.clone(),
  })
}

/**
 * Разлёт в миг общего взрыва: уцелевшие турели — целиком, рванувшие и сбитые — огрызками
 * оснований, поверх — куски обшивки (тоже огрызки, крупнее) и гнутые листы самого корпуса.
 */
function flingShards(world: World, base: WarBaseEntity): void {
  const S = WARBASE.SHATTER
  for (const fix of base.fixtures) {
    warBaseFixtureWorldPos(base, fix, world.time, _fixWorld)
    const whole = fix.alive && (fix.blowAt === undefined || fix.blowAt > world.time)
    shard(world, base, _fixWorld, whole ? 'detail' : 'trash', fix.model, fix.id, whole ? fix.size : fix.size * 0.62)
  }
  for (let i = 0; i < S.HULL_SHARDS; i++) {
    randomUnit(world.rng, _fixWorld).multiplyScalar(base.radius * 0.9).add(base.pos)
    const size = base.radius * (S.HULL_SHARD_MIN + world.rng() * (S.HULL_SHARD_MAX - S.HULL_SHARD_MIN))
    shard(world, base, _fixWorld, 'trash', 0, Math.floor(world.rng() * 1e6), size)
  }
  // Листы — с самой поверхности: корпус лопается и сбрасывает обшивку кусками.
  for (let i = 0; i < S.PANELS; i++) {
    randomUnit(world.rng, _fixWorld).multiplyScalar(base.radius).add(base.pos)
    const size = base.radius * (S.PANEL_MIN + world.rng() * (S.PANEL_MAX - S.PANEL_MIN))
    shard(world, base, _fixWorld, 'panel', base.shape, Math.floor(world.rng() * 1e6), size, S.PANEL_PACE)
  }
}

/** Осколки летят и гаснут — такт мира, не кадр. */
export function stepWarShards(world: World, dt: number): void {
  const list = world.warShards
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i]!
    s.pos.addScaledVector(s.vel, dt)
    if (world.time - s.born > s.life) list.splice(i, 1)
  }
}

/**
 * Отстрел ДЕТАЛИ. Считаются ПОПАДАНИЯ, а не урон: три точных снимают любую турель, каким
 * бы слабым ни был ствол. Гибнет она отдельной вспышкой в своей точке; сбитая последняя
 * забирает с собой базу — держаться ей больше не на чем.
 *
 * Удары одного мгновения — залп нескольких стволов, тик луча из нескольких сопел — это
 * ОДНО попадание: иначе многодульный лазер снимал турель единственным нажатием.
 */
export function damageWarBaseFixture(world: World, base: WarBaseEntity, fix: WarBaseFixture, _amount: number): void {
  if (!fix.alive || !base.alive) return
  if (world.time - fix.lastHitAt < WARBASE.FIXTURE_HIT_MERGE) return
  fix.lastHitAt = world.time
  fix.hitsLeft -= 1
  if (fix.hitsLeft > 0) return
  fix.alive = false
  warBaseFixtureWorldPos(base, fix, world.time, _fixWorld)
  spawnExplosion(world, _fixWorld, _still, fix.size * 1.2, undefined, base.pos)
  if (livingFixtures(base) === 0) destroyWarBase(world, base)
}

/**
 * У НЕ-ХОЗЯИНА: деталь базы погибла у хозяина — погасить её и здесь (вспышка, и база рушится,
 * если это была последняя). Счёт попаданий не нужен: исход уже решён.
 */
export function killWarBaseFixture(world: World, base: WarBaseEntity, fix: WarBaseFixture): void {
  if (!fix.alive || !base.alive) return
  fix.hitsLeft = 0
  fix.alive = false
  warBaseFixtureWorldPos(base, fix, world.time, _fixWorld)
  spawnExplosion(world, _fixWorld, _still, fix.size * 1.2, undefined, base.pos)
  if (livingFixtures(base) === 0) destroyWarBase(world, base)
}
