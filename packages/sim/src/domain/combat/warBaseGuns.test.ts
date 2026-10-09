import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { WARBASE } from '../../config/warbase'
import { createWorld } from '../world'
import { STARTER_SYSTEM } from '../world/system'
import { warBaseFixtureWorldPos } from '../world/warBase'
import { stepWarBaseTurrets } from './warBaseGuns'

/** Мир с одной базой у причала. */
function withBase(): ReturnType<typeof createWorld> {
  return createWorld({
    ...STARTER_SYSTEM,
    patrols: [],
    belt: null,
    warBases: [{ name: 'База', radius: 1_000, stationOffset: [8_000, 0, 0], model: 0 }],
  })
}

/** Поставить игрока вплотную к первой стреляющей детали. */
function standAtTurret(world: ReturnType<typeof createWorld>) {
  const base = world.warBases[0]!
  const fix = base.fixtures.find((f) => WARBASE.TURRET_BURST[f.model] !== undefined && f.alive)!
  const at = new Vector3()
  warBaseFixtureWorldPos(base, fix, world.time, at)
  world.player.state.pos.copy(at).add(new Vector3(0, 0, WARBASE.TURRET_RANGE * 0.5))
  return { base, fix }
}

describe('турели военной базы', () => {
  /**
   * Темп задан ПЕРЕЗАРЯДОМ В СЕКУНДАХ. Бросок кости за шаг физики стрелял бы вдвое чаще
   * на 120 Гц, чем на 60, и бой менялся бы вместе с герцовкой монитора.
   */
  it('молчат вдалеке и бьют очередью вблизи, раз в перезаряд', () => {
    const world = withBase()
    const { fix } = standAtTurret(world)
    const burst = WARBASE.TURRET_BURST[fix.model]!

    // Вдалеке — тишина.
    world.player.state.pos.set(1e7, 0, 0)
    for (let i = 0; i < 200; i++) stepWarBaseTurrets(world, 0.05)
    expect(world.bolts.length).toBe(0)

    // Вплотную — ровно одна очередь за перезаряд, не больше.
    standAtTurret(world)
    for (let i = 0; i < 40; i++) {
      stepWarBaseTurrets(world, 0.05)
      world.time += 0.05
    }
    expect(world.bolts.length).toBeGreaterThanOrEqual(burst)
    expect(world.bolts.length).toBeLessThanOrEqual(burst * 2)
  })

  /** Сбитая деталь не стреляет: снёс турель — снял её огонь, в этом и смысл отстрела. */
  it('сбитая турель молчит', () => {
    const world = withBase()
    const { base } = standAtTurret(world)
    for (const f of base.fixtures) f.alive = false

    for (let i = 0; i < 200; i++) {
      stepWarBaseTurrets(world, 0.05)
      world.time += 0.05
    }
    expect(world.bolts.length).toBe(0)
  })

  /** Ствол ВЕДЁТ цель: разворот идёт со своей скоростью, а не прыгает на неё разом. */
  it('турель доворачивается к цели постепенно', () => {
    const world = withBase()
    const { fix } = standAtTurret(world)
    fix.roll = 0
    const first = fix.roll

    stepWarBaseTurrets(world, 0.05)
    const afterOne = fix.roll
    for (let i = 0; i < 100; i++) {
      stepWarBaseTurrets(world, 0.05)
      world.time += 0.05
    }

    // За один шаг — не больше положенного угла; за сотню — доворот состоялся.
    expect(Math.abs(afterOne - first)).toBeLessThanOrEqual(WARBASE.TURRET_TURN_RATE * 0.05 + 1e-9)
    expect(fix.roll).not.toBe(first)
  })

  /**
   * Регрессия: прицел был ОДИН на модуль. Цель уходила посреди очереди, турель её больше не
   * вела, а доигрывала залп по вектору той детали, что доворачивалась последней, — болты
   * летели вдоль чужого ствола. Очередь обязана идти вдоль СВОЕГО ствола.
   */
  it('очередь, брошенная целью, идёт вдоль своего ствола, а не чужого', () => {
    const world = withBase()
    const base = world.warBases[0]!
    const guns = base.fixtures.filter((f) => (WARBASE.TURRET_BURST[f.model] ?? 0) >= 2)
    const at = (f: (typeof guns)[number]) => warBaseFixtureWorldPos(base, f, world.time, new Vector3())
    // B раньше A в обходе и далеко от неё: B доворачивается ПЕРЕД тем, как A доигрывает очередь.
    let pair: [typeof guns[number], typeof guns[number]] | null = null
    for (let i = 0; i < guns.length && !pair; i++)
      for (let j = i + 1; j < guns.length && !pair; j++)
        if (at(guns[i]!).distanceTo(at(guns[j]!)) > WARBASE.TURRET_RANGE * 3) pair = [guns[i]!, guns[j]!]
    expect(pair).not.toBeNull()
    const [b, a] = pair!
    // B направлен заведомо не туда, куда A.
    b.roll = a.roll + Math.PI / 2
    // A заряжена, B в перезаряде: её дело в этом тесте — только доворот.
    a.cooldown = 0
    b.cooldown = 1e3

    world.player.state.pos.copy(at(a)).add(new Vector3(0, 0, WARBASE.TURRET_RANGE * 0.5))
    // Первый вызов заряжает очередь, второй выпускает её первый импульс.
    stepWarBaseTurrets(world, 0.05)
    stepWarBaseTurrets(world, 0.01)
    expect(world.bolts.length).toBe(1)
    const first = world.bolts[0]!.vel.clone().normalize()

    world.player.state.pos.copy(at(b)).add(new Vector3(0, 0, WARBASE.TURRET_RANGE * 0.5))
    stepWarBaseTurrets(world, WARBASE.TURRET_BURST_GAP + 0.01)
    expect(world.bolts.length).toBe(2)
    const second = world.bolts[1]!.vel.clone().normalize()

    // Ствол A не двигался — расхождение только от разброса, а не на четверть оборота.
    expect(second.angleTo(first)).toBeLessThan(WARBASE.TURRET_SPREAD * 4)
  })
})
