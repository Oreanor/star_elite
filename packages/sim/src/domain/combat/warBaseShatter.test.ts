import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { WARBASE } from '../../config/warbase'
import { systemDefFor } from '../galaxy/jump'
import { SHARED_START_INDEX } from '../galaxy/sharedStart'
import { createWorld, enterSystem } from '../world/index'
import type { World } from '../world/entities'
import { spawnPulse, stepPulses } from './cosmic'
import { applyStructHitAtHost } from '../world/remote'
import { stepWarBaseWrecks, stepWarShards, warBaseStanding, warBaseWreckDone } from './warBase'

/**
 * Снос военной базы разрушающим шаром: «быдыщ-быдыщ-быдыщ» по обшивке, затем общий взрыв и
 * разлёт турелей с огрызками. Держим порядок событий, а не числа: корпус стоит, пока рвутся
 * очаги, детали рвутся по очереди, осколки — только в миг общего взрыва.
 */
function startWorld(): World {
  const def = { ...systemDefFor(SHARED_START_INDEX, GALAXY.SEED), patrols: [] }
  const world = createWorld({ ...def, belt: null })
  enterSystem(world, def, SHARED_START_INDEX)
  return world
}

function fireAtBase(world: World): void {
  const base = world.warBases[0]!
  // С пяти километров: издалека шар упёрся бы в планету на пути — её он разнёс бы первой.
  const dir = base.pos.clone().sub(world.player.state.pos).normalize()
  const from = base.pos.clone().addScaledVector(dir, -(base.radius + 5_000))
  spawnPulse(world, world.player, from, dir, 1e9)
  for (let i = 0; i < 120 * 30 && world.pulses.length > 0; i++) {
    world.time += 1 / 120
    stepPulses(world, 1 / 120)
  }
}

describe('снос военной базы разрушающим шаром', () => {
  it('шар сносит базу: очаги разгораются, корпус стоит до общего взрыва', () => {
    const world = startWorld()
    const base = world.warBases[0]!
    world.explosions.length = 0
    fireAtBase(world)
    expect(base.alive).toBe(false)
    expect(base.violent).toBe(true)
    const hit = world.time
    // Корпус стоит, пока разгорается огонь, и пропадает в общем взрыве.
    expect(warBaseStanding(base, hit)).toBe(true)
    expect(warBaseStanding(base, hit + base.wreckSpan! + 0.01)).toBe(false)
    // Детали рвутся вместе с очагами, что до них дошли, — и все до общего взрыва.
    const blows = base.fixtures.flatMap((f) => (f.blowAt === undefined ? [] : [f.blowAt]))
    expect(blows.length).toBeGreaterThan(0)
    expect(Math.max(...blows)).toBeLessThan(hit + base.wreckSpan!)
  })

  it('очаг — ком из десятка клубов вокруг одной точки; очаги растут к общему взрыву', () => {
    // Прежде очаги были обычными вспышками на 0.55 с с осколками — у базы они читались
    // крупными искрами, отскакивающими от обшивки, а не разгорающимся огнём.
    const world = startWorld()
    world.firePuffs.length = 0
    fireAtBase(world)
    const hit = world.time
    const S = WARBASE.SHATTER
    // Клубы очагов — без жара; раскалённые (heat) — вспышка попадания, у неё своя короткая жизнь.
    const build = world.firePuffs.filter((f) => f.born < hit + S.BUILD && f.heat === undefined)
    expect(build.length).toBeGreaterThanOrEqual(S.FOCI_MIN * S.PUFFS)
    // Клубы живут долго — клубятся, а не мелькают.
    expect(build.every((f) => f.life >= S.PUFF_LIFE_MIN)).toBe(true)
    // Рождаются со сдвигом, а не разом.
    expect(new Set(build.map((f) => f.born)).size).toBeGreaterThan(build.length / 2)
    // Поздние очаги крупнее ранних: огонь набирает силу.
    const half = hit + S.BUILD / 2
    const mean = (list: typeof build) => list.reduce((sum, f) => sum + f.size, 0) / list.length
    expect(mean(build.filter((f) => f.born >= half))).toBeGreaterThan(mean(build.filter((f) => f.born < half)))
  })

  it('осколки — в миг общего взрыва: турели и огрызки летят прочь и гаснут', () => {
    const world = startWorld()
    const base = world.warBases[0]!
    fireAtBase(world)
    const end = world.time + base.wreckSpan!
    while (world.time < end - 0.05) {
      world.time += 1 / 60
      stepWarBaseWrecks(world)
    }
    expect(world.warShards.length).toBe(0)
    world.time = end + 0.01
    stepWarBaseWrecks(world)
    expect(world.warShards.some((s) => s.kind === 'detail')).toBe(true)
    expect(world.warShards.some((s) => s.kind === 'trash')).toBe(true)
    // Листы обшивки — крупнее огрызков и летят медленнее мелочи: тяжёлое кувыркается широко.
    const panels = world.warShards.filter((s) => s.kind === 'panel')
    const trash = world.warShards.filter((s) => s.kind === 'trash')
    expect(panels.length).toBeGreaterThan(0)
    const mean = (l: typeof panels, f: (s: (typeof panels)[number]) => number) => l.reduce((a, s) => a + f(s), 0) / l.length
    expect(mean(panels, (s) => s.size)).toBeGreaterThan(mean(trash, (s) => s.size))
    expect(mean(panels, (s) => s.vel.length())).toBeLessThan(mean(trash, (s) => s.vel.length()))
    // Летят наружу от центра базы.
    const s = world.warShards[0]!
    const away = s.pos.clone().sub(base.pos).normalize().dot(s.vel.clone().normalize())
    expect(away).toBeGreaterThan(0)
    world.time += WARBASE.WAVE_LIFE + 1
    expect(warBaseWreckDone(base, world.time)).toBe(true)
    world.time += WARBASE.SHATTER.SHARD_LIFE * 2
    stepWarShards(world, 1 / 60)
    expect(world.warShards.length).toBe(0)
  })

  it('у не-хозяина шар не сносит сам — удар уходит хозяину системы', () => {
    const world = startWorld()
    world.trafficRole = 'mirror'
    fireAtBase(world)
    expect(world.warBases[0]!.alive).toBe(true)
    expect(world.structHits).toContainEqual({ kind: 'shatter', base: 0 })
    // Вспышку попадания видит и он: прежде там был взрыв размером с шар — на базе не виден.
    const base = world.warBases[0]!
    expect(world.firePuffs.some((f) => f.size >= base.radius * WARBASE.SHATTER.IMPACT_SIZE * 0.5)).toBe(true)
  })

  it('удар из сети находит базу по месту в описании, даже когда снесённую уже вынесли', () => {
    // Пойманная дыра: базы адресовались номером в `world.warBases`, а снесённую из списка
    // выносят — номера сдвигались, и удар (и маска хозяина) уходил соседней базе.
    const world = startWorld()
    const second = world.warBases[1]!
    world.warBases.splice(0, 1)
    applyStructHitAtHost(world, { kind: 'shatter', base: second.slot })
    expect(second.alive).toBe(false)
    expect(world.warBases.filter((b) => b.alive).length).toBe(world.warBases.length - 1)
  })

  it('лучи из ядра прорываются один за другим и все — до общего взрыва', () => {
    const world = startWorld()
    const base = world.warBases[0]!
    fireAtBase(world)
    const rays = base.rays ?? []
    expect(rays.length).toBe(WARBASE.SHATTER.RAYS)
    expect(new Set(rays.map((r) => r.at)).size).toBe(rays.length)
    expect(Math.max(...rays.map((r) => r.at))).toBeLessThan(base.wreckAt! + base.wreckSpan!)
  })

  it('выросший стрелок бьёт в базу того размера, что видит, а не в невидимую полную сферу', () => {
    // Пойманное: шар мерил честный радиус — на ×10 гигант сносил базу, пролетая мимо
    // нарисованной (ужатой) сферы на её полном радиусе.
    const world = startWorld()
    const base = world.warBases[0]!
    world.player.state.scale = 10
    const dir = base.pos.clone().sub(world.player.state.pos).normalize()
    const side = new Vector3(0, 1, 0).cross(dir).normalize()
    // Мимо центра на полрадиуса: в полную сферу попал бы, в ужатую (R/10) — нет.
    const from = base.pos.clone().addScaledVector(dir, -(base.radius + 5_000)).addScaledVector(side, base.radius * 0.5)
    spawnPulse(world, world.player, from, dir, 1e9)
    for (let i = 0; i < 120 * 30 && world.pulses.length > 0; i++) {
      world.time += 1 / 120
      stepPulses(world, 1 / 120)
    }
    expect(base.alive).toBe(true)
  })
})
