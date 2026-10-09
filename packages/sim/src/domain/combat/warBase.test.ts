import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { WARBASE } from '../../config/warbase'
import { PHYSICS } from '../../config/physics'
import { stepWorld } from '../sim/step'
import { createWorld } from '../world'
import { cycleContact } from '../world/queries'
import { STARTER_SYSTEM } from '../world/system'
import { castLaser } from './raycast'
import { damageWarBase, damageWarBaseFixture, warBaseFixtureWorldPos } from './warBase'
import { warBaseIntegrity } from '../world/warBase'

/** Мир с двумя базами у причала: километровой и трёхкилометровой. */
function withBases(): ReturnType<typeof createWorld> {
  return createWorld({
    ...STARTER_SYSTEM,
    warBases: [
      { name: 'Малая', radius: 1_000, stationOffset: [8_000, 0, 0], model: 0 },
      { name: 'Большая', radius: 3_000, stationOffset: [-12_000, 0, 0], model: 1 },
    ],
  })
}

/**
 * Сбить ОДНУ деталь: считаются попадания, и трёх точных хватает любой турели. Между ударами
 * идёт время — одновременные сливаются в одно попадание.
 */
function knockOut(world: ReturnType<typeof createWorld>, base: (typeof world.warBases)[number], fix: (typeof base.fixtures)[number]): void {
  for (let i = 0; i < WARBASE.FIXTURE_HITS; i++) {
    damageWarBaseFixture(world, base, fix, 1)
    world.time += WARBASE.FIXTURE_HIT_MERGE * 2
  }
}

/** Снести базу — значит сбить ВСЕ её детали: своей прочности у корпуса нет. */
function razeBase(world: ReturnType<typeof createWorld>, base: (typeof world.warBases)[number]): void {
  for (const fix of [...base.fixtures]) knockOut(world, base, fix)
}

/** Прокрутить мир до конца агонии: каскад вспышек, затем «пух» с разлётом лома. */
function afterWreck(world: ReturnType<typeof createWorld>): void {
  for (let i = 0; i < 600; i++) stepWorld(world, PHYSICS.FIXED_DT, new Map())
}

describe('военная база', () => {
  it('луч попадает в корпус базы', () => {
    const world = withBases()
    const base = world.warBases[0]
    expect(base).toBeDefined()

    const origin = base!.pos.clone().add(new Vector3(0, 0, base!.radius + 200))
    const dir = new Vector3(0, 0, -1)
    const hit = castLaser(world, origin, dir, world.player, 5_000)

    expect(hit.warBase?.id).toBe(base!.id)
    expect(hit.asteroid).toBeNull()
  })

  it('снос сыплет подбираемые осколки с массой — после «пуха», не сразу', () => {
    const world = withBases()
    const base = world.warBases[0]!

    razeBase(world, base)
    expect(base.alive).toBe(false)
    // Каскад ещё гремит: лом не должен лежать раньше времени.
    expect(world.pods.filter((p) => p.debris).length).toBe(0)

    afterWreck(world)
    const debris = world.pods.filter((p) => p.debris)
    expect(debris.length).toBeGreaterThanOrEqual(WARBASE.SCRAP_MIN)
    expect(debris.length).toBeLessThanOrEqual(WARBASE.SCRAP_MAX)
  })

  it('крупная база сыплет не меньше осколков, чем малая', () => {
    const world = withBases()
    const small = world.warBases.reduce((a, b) => (a.radius <= b.radius ? a : b))
    const large = world.warBases.reduce((a, b) => (a.radius >= b.radius ? a : b))
    expect(large.radius).toBeGreaterThan(small.radius)

    razeBase(world, small)
    afterWreck(world)
    const smallN = world.pods.filter((p) => p.debris).length
    world.pods = []

    expect(large.alive).toBe(true)
    razeBase(world, large)
    afterWreck(world)
    const largeN = world.pods.filter((p) => p.debris).length

    expect(largeN).toBeGreaterThanOrEqual(smallN)
  })

  it('удар в обшивку не наносит урона: база держится на деталях', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const before = base.fixtures.filter((f) => f.alive).length

    damageWarBase(world, base, 1e9)

    expect(base.alive).toBe(true)
    expect(base.fixtures.filter((f) => f.alive).length).toBe(before)
  })

  /**
   * Полоска цели показывает ДОЛЮ живых деталей — это и есть живучесть базы. Скрытого
   * запаса нет: сбил турель, полоска шагнула ровно на 1/N.
   */
  it('живучесть базы — доля уцелевших деталей', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const total = base.fixtures.length

    expect(warBaseIntegrity(base)).toBe(1)
    knockOut(world, base, base.fixtures[0]!)
    expect(warBaseIntegrity(base)).toBeCloseTo((total - 1) / total, 6)

    razeBase(world, base)
    expect(warBaseIntegrity(base)).toBe(0)
    expect(base.alive).toBe(false)
  })
})

describe('отстрел деталей базы', () => {
  it('база рождается с башней и разбросом деталей', () => {
    const world = withBases()
    const base = world.warBases[0]!
    expect(base.fixtures.length).toBeGreaterThanOrEqual(WARBASE.FIXTURES_MIN)
    expect(base.fixtures.length).toBeLessThanOrEqual(WARBASE.FIXTURES_MAX)
    // Ровно одна башня (model 0), и она на полюсе.
    const towers = base.fixtures.filter((f) => f.model === 0)
    expect(towers).toHaveLength(1)
    expect(towers[0]!.dir.y).toBeCloseTo(1, 5)
  })

  it('луч бьёт по ДЕТАЛИ, а не по корпусу, целясь в неё', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const fix = base.fixtures.find((f) => f.model !== 0)!
    const _p = new Vector3()
    warBaseFixtureWorldPos(base, fix, world.time, _p)
    // Стреляем в деталь снаружи, по радиали к центру базы.
    const dir = _p.clone().sub(base.pos).normalize()
    const origin = _p.clone().addScaledVector(dir, fix.size + 500)
    const hit = castLaser(world, origin, dir.clone().negate(), world.player, 5_000)
    expect(hit.warBaseFixture?.fixture.id).toBe(fix.id)
    expect(hit.warBase).toBeNull()
  })

  it('отстрел детали не трогает корпус базы', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const fix = base.fixtures.find((f) => f.model !== 0)!
    const before = base.fixtures.filter((f) => f.alive).length

    knockOut(world, base, fix)

    expect(fix.alive).toBe(false)
    expect(base.alive).toBe(true)
    expect(base.fixtures.filter((f) => f.alive).length).toBe(before - 1)
    // Мёртвую деталь луч больше не ловит.
    const _p = new Vector3()
    warBaseFixtureWorldPos(base, fix, world.time, _p)
    const dir = _p.clone().sub(base.pos).normalize()
    const origin = _p.clone().addScaledVector(dir, fix.size + 500)
    const hit = castLaser(world, origin, dir.clone().negate(), world.player, 5_000)
    expect(hit.warBaseFixture?.fixture.id).not.toBe(fix.id)
  })

  /**
   * Деталь — ТАКАЯ ЖЕ ЦЕЛЬ, как борт: Tab её берёт, и захват ложится в своё поле. Раньше
   * пушку можно было только расстрелять, водя прицелом, — навестись на неё было нечем.
   */
  it('Tab берёт деталь базы целью, разбитая — снимается', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const fix = base.fixtures.find((f) => f.model !== 0)!
    const _p = new Vector3()
    warBaseFixtureWorldPos(base, fix, world.time, _p)

    // Игрок у самой детали и смотрит на неё: круг сортирует «перед носом, потом ближе».
    world.player.state.pos.copy(_p).add(new Vector3(0, 0, 300))
    world.ships.length = 0
    world.asteroids.length = 0
    world.pods.length = 0

    cycleContact(world)
    expect(world.lockedFixtureId).toBe(fix.id)
    // Захват ровно один: борт/обломок/камень при этом пусты.
    expect(world.lockedTargetId).toBeNull()
    expect(world.lockedAsteroidId).toBeNull()

    // Отстрелили — рамка не должна остаться висеть на том, чего нет.
    knockOut(world, base, fix)
    stepWorld(world, PHYSICS.FIXED_DT, new Map())
    expect(world.lockedFixtureId).toBeNull()
  })

  /**
   * Разбитая деталь ОСТАЁТСЯ в списке базы, лишь помеченная мёртвой. На этом держится
   * картинка: рендер ставит на её место обломок и считает его место по тем же `dir` и
   * `roll`, что были у целой. Вычисти мёртвых из `fixtures` «на всякий случай» — и следы
   * обстрела пропадут вместе с ними.
   */
  it('отстреленная деталь остаётся в списке, помеченная мёртвой', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const fix = base.fixtures.find((f) => f.model !== 0)!
    const before = base.fixtures.length

    knockOut(world, base, fix)
    stepWorld(world, PHYSICS.FIXED_DT, new Map())

    expect(base.fixtures.length).toBe(before)
    expect(base.fixtures.find((f) => f.id === fix.id)?.alive).toBe(false)
  })

  /**
   * Регрессия: многодульный лазер и луч из нескольких сопел бьют в ОДНО мгновение, и каждый
   * их болт считался отдельным попаданием — турель снималась единственным нажатием, а «три
   * точных» теряли смысл. Удары одного мгновения — одно попадание; разнесённые во времени
   * считаются все.
   */
  it('залп нескольких стволов в одно мгновение — одно попадание', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const fix = base.fixtures.find((f) => f.model !== 0)!

    for (let i = 0; i < WARBASE.FIXTURE_HITS * 2; i++) damageWarBaseFixture(world, base, fix, 1)
    expect(fix.alive).toBe(true)
    expect(fix.hitsLeft).toBe(WARBASE.FIXTURE_HITS - 1)

    knockOut(world, base, fix)
    expect(fix.alive).toBe(false)
  })

  /**
   * ПОРЯДОК СНОСА: сперва каскад вспышек, и только когда он отгремит — «пух» ударной
   * волны с разлётом лома. Сложи их в один кадр, и километровый шар просто исчезнет
   * во вспышке; ради этой паузы у базы и появилась фаза агонии.
   */
  it('снос идёт по порядку: каскад вспышек, потом волна с ломом', () => {
    const world = withBases()
    const base = world.warBases[0]!
    razeBase(world, base)

    // Сразу после сноса: очаги уже заказаны, но волны и лома ещё нет.
    expect(world.explosions.length).toBeGreaterThanOrEqual(WARBASE.BLASTS)
    expect(world.blastwaves.length).toBe(0)
    expect(world.pods.filter((p) => p.debris).length).toBe(0)
    // Очаги зажигаются НЕ разом: у каждого свой момент старта.
    const starts = new Set(world.explosions.map((e) => e.born))
    expect(starts.size).toBeGreaterThan(1)

    afterWreck(world)
    expect(world.blastwaves.length + world.pods.filter((p) => p.debris).length).toBeGreaterThan(0)
    expect(world.pods.filter((p) => p.debris).length).toBeGreaterThanOrEqual(WARBASE.SCRAP_MIN)
  })
})
