import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MISSILE_PYLON, MODULE_CATALOGUE } from '../../config/modules'
import { ECM, GUNNERY } from '../../config/weapons'
import { raySphere } from '../../core/math'
import { isLaser, isMissile } from '../loadout'
import { createWorld, STARTER_SYSTEM } from '../world'
import type { MissileEntity, ShipEntity, World } from '../world/entities'
import { applyDamage, regenShield } from './damage'
import { fireEcm, regenEnergy } from './ecm'
import { stepMissiles } from './missiles'
import { fireLasers, fireMissile, missileAmmo } from './weapons'

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

/** Ставит врага ровно перед носом игрока на дистанции d. */
function enemyAhead(world: World, distance: number): ShipEntity {
  const enemy = world.ships[0]
  if (!enemy) throw new Error('нет цели')
  enemy.state.pos.set(0, 0, -distance)
  enemy.state.vel.set(0, 0, 0)
  world.player.state.pos.set(0, 0, 0)
  world.player.state.quat.copy(new Quaternion())
  return enemy
}

function withOneEnemy(): { world: World; enemy: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -500], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  return { world, enemy: world.ships[0]! }
}

describe('луч и сфера', () => {
  it('попадает по сфере впереди', () => {
    const t = raySphere(new Vector3(), new Vector3(0, 0, -1), new Vector3(0, 0, -100), 10)
    expect(t).toBeCloseTo(90)
  })

  it('не попадает по сфере позади', () => {
    expect(raySphere(new Vector3(), new Vector3(0, 0, -1), new Vector3(0, 0, 100), 10)).toBe(-1)
  })

  it('промахивается мимо сферы сбоку', () => {
    expect(raySphere(new Vector3(), new Vector3(0, 0, -1), new Vector3(50, 0, -100), 10)).toBe(-1)
  })
})

describe('лазер', () => {
  it('поражает цель прямо по курсу', () => {
    const { world, enemy } = withOneEnemy()
    enemyAhead(world, 500)
    const before = enemy.shield

    fireLasers(world, world.player, false)
    expect(enemy.shield).toBeLessThan(before)
    expect(world.tracers.length).toBe(2) // два ствола
  })

  /**
   * Регрессия. Лазер мгновенный: он попадает в тот же шаг, в котором выпущен.
   * Целиться в точку упреждения — значит систематически промахиваться.
   * Раньше ИИ так и делал и не попал ни разу за полторы минуты боя.
   */
  it('целясь с упреждением по неподвижной цели, промахивается', () => {
    const { world, enemy } = withOneEnemy()
    enemyAhead(world, 500)

    // Разворачиваем игрока на угол «упреждения» — 16 м вбок на 500 м.
    const lead = Math.atan2(16, 500)
    world.player.state.quat.setFromAxisAngle(new Vector3(0, 1, 0), -lead)

    const before = enemy.shield
    fireLasers(world, world.player, false)
    expect(enemy.shield).toBe(before) // ни одного попадания
  })

  it('на дистанции сведения оба ствола сходятся в цель', () => {
    const { world, enemy } = withOneEnemy()
    // GUNNERY.CONVERGENCE = 700: там лучи пересекаются.
    enemyAhead(world, 700)

    // Урон берём из установленных стволов, а не константой: перевооружение игрока
    // не должно ронять тест про ГЕОМЕТРИЮ сведения.
    const expected = world.player.spec.mounts.reduce(
      (sum, m) => sum + (isLaser(m.weapon) ? m.weapon.damage : 0),
      0,
    )

    const before = enemy.shield
    fireLasers(world, world.player, false)
    expect(before - enemy.shield).toBeCloseTo(expected, 0)
  })

  it('перегрев блокирует стрельбу', () => {
    const { world } = withOneEnemy()
    enemyAhead(world, 500)
    for (const gun of world.player.guns) gun.heat = 1
    expect(fireLasers(world, world.player, false)).toBe(false)
  })
})

describe('щит и корпус', () => {
  it('щит принимает урон первым', () => {
    const world = quiet()
    const p = world.player
    applyDamage(p, 30, 0)
    expect(p.shield).toBe(p.spec.hull.shield - 30)
    expect(p.hull).toBe(p.spec.hull.hull)
  })

  it('пробитие щита переносит остаток на корпус', () => {
    const world = quiet()
    const p = world.player
    applyDamage(p, p.spec.hull.shield + 10, 0)
    expect(p.shield).toBe(0)
    expect(p.hull).toBe(p.spec.hull.hull - 10)
  })

  it('корабль гибнет при нулевом корпусе', () => {
    const world = quiet()
    const p = world.player
    applyDamage(p, 1e6, 0)
    expect(p.alive).toBe(false)
    expect(p.hull).toBe(0)
  })

  it('щит не восстанавливается сразу после попадания', () => {
    const world = quiet()
    const p = world.player
    applyDamage(p, 30, 10)

    regenShield(p, 1, 11) // прошла секунда — задержка ещё идёт
    expect(p.shield).toBe(p.spec.hull.shield - 30)

    regenShield(p, 1, 20) // задержка истекла
    expect(p.shield).toBeGreaterThan(p.spec.hull.shield - 30)
  })
})

/** Пусковые ракет. Пилон может нести и контейнер БПЛА, а тот ракет не даёт. */
function launcherIndices(ship: ShipEntity): number[] {
  const out: number[] = []
  ship.spec.mounts.forEach((m, i) => {
    if (isMissile(m.weapon)) out.push(i)
  })
  return out
}

describe('ракеты на пилонах', () => {
  /**
   * Боезапас считается из данных, а не из числа пилонов: ракета сама объявляет
   * `ammo`. Раньше он был равен единице, и тест сравнивал запас с числом пилонов —
   * стоило зарядить по две, как проверка стала бы врать, ничего не заметив.
   *
   * И считать его надо по ПУСКОВЫМ, а не по подвескам: на пилоне может висеть
   * контейнер БПЛА, ракет он не несёт. Тест, считавший пилоны, сломался ровно
   * в тот день, когда последний пилон отдали беспилотникам.
   */
  it('запас ракет равен числу пусковых, помноженному на их боекомплект', () => {
    const { world, enemy } = withOneEnemy()

    const launchers = launcherIndices(world.player)
    expect(launchers.length).toBeGreaterThan(0)
    expect(missileAmmo(world.player)).toBe(launchers.length * MISSILE_PYLON.ammo)

    // Один вызов — одна ракета, независимо от того, сколько их на пилоне.
    const before = missileAmmo(world.player)
    expect(fireMissile(world, world.player, enemy.id)).toBe(true)
    expect(world.missiles.length).toBe(1)
    expect(missileAmmo(world.player)).toBe(before - 1)
  })

  /**
   * Регрессия. Пуск искал первый пилон С РАКЕТОЙ, а перезарядку проверял уже
   * после выбора — и отказывал, хотя соседние пилоны висели снаряжёнными.
   * При одной ракете на пилон баг спал: опустевший пилон выпадал из поиска сам.
   * Стоило зарядить по две — залп из четырёх превратился в одну ракету за 0.8 с.
   */
  it('залп идёт с разных пусковых, пока они свободны', () => {
    const { world, enemy } = withOneEnemy()
    const launchers = launcherIndices(world.player)

    // Ни одного шага мира: перезарядка не тикает, значит каждый пуск — новая пусковая.
    for (let i = 0; i < launchers.length; i++) {
      expect(fireMissile(world, world.player, enemy.id)).toBe(true)
    }
    expect(world.missiles.length).toBe(launchers.length)

    // Пусковые кончились, все на перезарядке — следующая ракета не уйдёт.
    expect(fireMissile(world, world.player, enemy.id)).toBe(false)
    expect(world.missiles.length).toBe(launchers.length)

    // Запас при этом остался: по второй ракете на каждой пусковой.
    expect(missileAmmo(world.player)).toBe(launchers.length * (MISSILE_PYLON.ammo - 1))
  })

  it('подвесная ракета сбивает «Сайдвиндера» одним попаданием', () => {
    const { enemy } = withOneEnemy()
    // Свойство, а не число: ракета обязана пробивать щит и корпус разом.
    expect(MISSILE_PYLON.damage).toBeGreaterThanOrEqual(enemy.hull + enemy.shield)
  })

  /**
   * Регрессия. Ракету должно быть можно сбить лазером — иначе она непобедима.
   * Но собственный залп не должен сносить свою же ракету: она уходит прямо
   * из-под стволов, и первый выстрел после пуска убивал бы её сам.
   */
  it('чужой лазер сбивает ракету, свой — нет', () => {
    const { world, enemy } = withOneEnemy()
    enemyAhead(world, 500)
    // Разворачиваем врага носом к игроку: он должен видеть ракету перед собой.
    enemy.state.quat.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)

    fireMissile(world, world.player, enemy.id)
    const mine = world.missiles[0]!
    mine.pos.set(0, 0, -300)

    // Свой залп проходит мимо неё.
    fireLasers(world, world.player, false)
    expect(mine.alive).toBe(true)

    // Чужой — сбивает.
    fireLasers(world, enemy, true)
    expect(mine.alive).toBe(false)
  })
})

describe('противоракетная система', () => {
  /** Ракета игрока рядом с врагом: для врага она чужая, значит ПРО её видит. */
  function incoming(): { world: World; victim: ShipEntity; missile: MissileEntity } {
    const { world, enemy } = withOneEnemy()
    fireMissile(world, world.player, enemy.id)
    const missile = world.missiles[0]!
    missile.pos.copy(enemy.state.pos)
    return { world, victim: enemy, missile }
  }

  it('подрывает ближайшую чужую ракету и тратит долю батарей', () => {
    const { world, victim, missile } = incoming()
    const before = victim.energy

    expect(fireEcm(world, victim)).toBe(true)
    expect(missile.alive).toBe(false)
    expect(before - victim.energy).toBeCloseTo(victim.spec.power.capacity * ECM.ENERGY_COST, 5)
  })

  /** Холостой импульс не должен стоить энергии: платим за результат. */
  it('не тратит энергию, когда сбивать нечего', () => {
    const { world } = withOneEnemy()
    const player = world.player
    const before = player.energy

    expect(fireEcm(world, player)).toBe(false)
    expect(player.energy).toBe(before)
  })

  it('не подрывает собственную ракету', () => {
    const { world, enemy } = withOneEnemy()
    const player = world.player

    fireMissile(world, player, enemy.id)
    const mine = world.missiles[0]!
    mine.pos.copy(player.state.pos)

    expect(fireEcm(world, player)).toBe(false)
    expect(mine.alive).toBe(true)
  })

  /**
   * Перезаряд задан в СЕКУНДАХ и списывается через dt, а не «раз в шаг»:
   * иначе темп ПРО зависел бы от частоты симуляции — ровно та ошибка,
   * из-за которой бот когда-то высыпал четыре ракеты за двадцать секунд.
   */
  it('одним нажатием не снести залп из двух ракет', () => {
    const { world, victim } = incoming()
    fireMissile(world, world.player, victim.id)
    world.missiles[1]!.pos.copy(victim.state.pos)
    expect(world.missiles.length).toBe(2)

    expect(fireEcm(world, victim)).toBe(true)
    expect(fireEcm(world, victim)).toBe(false) // перезаряд ещё идёт
    expect(world.missiles.filter((m) => m.alive).length).toBe(1)

    regenEnergy(victim, ECM.COOLDOWN)
    expect(fireEcm(world, victim)).toBe(true)
    expect(world.missiles.filter((m) => m.alive).length).toBe(0)
  })
})

describe('срыв наведения', () => {
  /** Ракета живёт по `world.time`; сама она его не двигает. */
  function tick(world: World, dt: number): void {
    world.time += dt
    stepMissiles(world, dt)
  }

  /** Разгоняет ракету так, чтобы она вышла на маршевую скорость и начала наводиться. */
  function letBoostFinish(world: World): void {
    const boost = world.missiles[0]!.module.boostTime
    for (let t = 0; t < boost + 0.05; t += 1 / 120) tick(world, 1 / 120)
  }

  function setup(): { world: World; player: ShipEntity; missile: MissileEntity } {
    const { world, enemy } = withOneEnemy()
    const player = world.player
    player.state.pos.set(0, 0, 0)
    player.state.vel.set(0, 0, -100)

    // Ракета летит игроку в лоб с 400 м.
    enemy.state.pos.set(0, 0, -400)
    enemy.state.quat.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    enemy.state.vel.set(0, 0, 0)
    fireMissile(world, world.player, enemy.id) // чтобы pylon был свободен — не важно
    world.missiles = []

    // Пускаем вручную от врага: у рядового пирата пилон пуст.
    world.missiles.push({
      id: world.ids.next(),
      kind: 'missile',
      pos: enemy.state.pos.clone(),
      vel: new Vector3(0, 0, 1).multiplyScalar(MISSILE_PYLON.speed),
      quat: enemy.state.quat.clone(),
      module: MISSILE_PYLON,
      ownerId: enemy.id,
      targetId: player.id,
      speed: MISSILE_PYLON.speed,
      born: world.time,
      alive: true,
    })
    return { world, player, missile: world.missiles[0]! }
  }

  /**
   * Регрессия и главный инвариант ракеты. Её боковое ускорение равно v·ω —
   * полсотни g, втрое больше корабельного, — поэтому обогнать её манёвром нельзя
   * и НЕ НАДО пытаться крутить эти числа. Промах даёт только срыв наведения.
   */
  it('летящий по прямой не срывает наведение: v⊥ = 0 на любой дистанции', () => {
    const { world, missile } = setup()
    letBoostFinish(world)
    for (let i = 0; i < 120 * 3 && missile.alive; i++) stepMissiles(world, 1 / 120)

    expect(missile.targetId).not.toBeNull()
    expect(world.player.hull + world.player.shield).toBeLessThan(
      world.player.spec.hull.hull + world.player.spec.hull.shield,
    )
  })

  it('резкий уход вбок у самого носа ракеты срывает головку навсегда', () => {
    const { world, player, missile } = setup()
    letBoostFinish(world)

    // Скорость поперёк линии визирования: угловая скорость ЛВ = v⊥/d,
    // и вблизи она обязана превысить предел слежения головки.
    player.state.vel.set(60, 0, -100)

    for (let i = 0; i < 120 * 3 && missile.alive; i++) {
      stepMissiles(world, 1 / 120)
      player.state.pos.addScaledVector(player.state.vel, 1 / 120)
    }

    expect(missile.targetId).toBeNull()
    // Ослепшая ракета цель не находит: она летит прямо, пока не самоликвидируется.
    expect(player.hull + player.shield).toBe(player.spec.hull.hull + player.spec.hull.shield)
  })

  /**
   * Регрессия. Рули включались не по `armTime`, а по концу разгона: ракета 0.55 с
   * летела по прямой, линия визирования успевала раскрутиться, и головка,
   * проснувшись, срывалась на ПЕРВОМ же кадре наведения — от той угловой скорости,
   * которую ракета накопила сама, ни разу не попробовав довернуть.
   *
   * Замер (`scratch/missile-500.ts`): срыв наступал ровно на 0.55 с, ни разу позже,
   * и с 400 м не попадало ничего, кроме неподвижной цели. Судим головку по Ω,
   * которую она получила уже с работающими рулями, — иначе судим за чужую вину.
   */
  it('головка не срывается на первом же кадре наведения', () => {
    const { world, enemy } = withOneEnemy()
    const player = world.player
    player.state.pos.set(0, 0, 0)
    player.state.vel.set(0, 0, -80)
    player.state.quat.copy(new Quaternion())

    // Цель идёт поперёк в 500 м: худший случай для головки и обычный для игрока.
    enemy.ai = null
    enemy.state.pos.set(0, 0, -500)
    enemy.state.vel.set(120, 0, 0)

    expect(fireMissile(world, player, enemy.id)).toBe(true)
    const missile = world.missiles[0]!

    let closest = Infinity
    for (let i = 0; i < 120 * 6 && missile.alive; i++) {
      tick(world, 1 / 120)
      enemy.state.pos.addScaledVector(enemy.state.vel, 1 / 120)
      closest = Math.min(closest, missile.pos.distanceTo(enemy.state.pos))
    }

    expect(missile.targetId).not.toBeNull()
    expect(closest).toBeLessThanOrEqual(GUNNERY.MISSILE_PROXIMITY + 1)
  })

  /**
   * Головка — зеркало на кардане, планер — полтонны железа. Пока было наоборот,
   * предел планера (`turnRate`) не мог проявиться НИ РАЗУ: головка срывалась
   * раньше, чем ракета успевала упереться в свой доворот.
   */
  it('у каждой ракеты головка быстрее планера', () => {
    for (const m of MODULE_CATALOGUE.filter(isMissile)) {
      expect(m.seekerRate, m.name).toBeGreaterThan(m.turnRate)
      expect(m.armTime, m.name).toBeLessThan(m.boostTime)
    }
  })

  it('пока идёт разгон, ракета не наводится и медленнее маршевой', () => {
    const { world, missile } = setup()
    missile.speed = 40
    missile.born = world.time
    missile.vel.setLength(40)

    stepMissiles(world, 1 / 120)
    expect(missile.speed).toBeGreaterThan(40)
    expect(missile.speed).toBeLessThan(MISSILE_PYLON.speed)
  })
})

/**
 * Наведение. Ракета доворачивает по ПРОПОРЦИОНАЛЬНОМУ закону: скорость доворота
 * равна N·Ω, где Ω — вращение линии визирования. Курс столкновения это Ω = 0.
 *
 * Регрессия. Раньше ракета правила нос на ТЕКУЩЕЕ положение цели — чистая погоня.
 * Она всегда отстаёт: замер (`scratch/missiles.ts`) дал 2 попадания из 4 по цели,
 * идущей поперёк, и ни скорость, ни чувствительность головки не помогали.
 */
describe('наведение ракеты', () => {
  /**
   * Гонит ракету по цели, идущей ПОПЕРЁК её курса. Мир не шагаем целиком:
   * нужен чистый закон наведения, без ИИ, тяги и столкновений.
   *
   * @returns минимальное расстояние, на которое ракета подошла к цели.
   */
  function chase(world: World, target: ShipEntity, crossSpeed: number): number {
    const dt = 1 / 120
    let closest = Infinity

    for (let i = 0; i < MISSILE_PYLON.lifetime / dt && world.missiles.length > 0; i++) {
      target.state.pos.addScaledVector(target.state.vel, dt)
      stepMissiles(world, dt)
      world.time += dt

      const m = world.missiles[0]
      if (m) closest = Math.min(closest, m.pos.distanceTo(target.state.pos))
    }
    expect(crossSpeed).toBeGreaterThan(0) // цель обязана двигаться, иначе тест пуст
    return closest
  }

  it('попадает по цели, идущей поперёк курса', () => {
    const { world, enemy } = withOneEnemy()
    world.player.state.pos.set(0, 0, 0)
    world.player.state.quat.copy(new Quaternion())
    enemy.state.pos.set(0, 0, -1200)
    enemy.state.vel.set(180, 0, 0) // строго поперёк: худший случай для погони

    expect(fireMissile(world, world.player, enemy.id)).toBe(true)
    chase(world, enemy, 180)

    // Свойство, а не число: ракета обязана ДОЙТИ до цели, а не пройти рядом.
    expect(enemy.alive).toBe(false)
    expect(world.missiles).toHaveLength(0)
  })

  /**
   * Пропорциональное наведение гасит вращение линии визирования. Значит, идущая
   * поперёк цель не должна срывать головку: срыв — это признак того, что ракета
   * упёрлась в свой `turnRate` и перестала гасить Ω.
   */
  it('не теряет захват на цели, которую догоняет', () => {
    const { world, enemy } = withOneEnemy()
    world.player.state.pos.set(0, 0, 0)
    world.player.state.quat.copy(new Quaternion())
    enemy.state.pos.set(0, 0, -1500)
    enemy.state.vel.set(60, 0, -100)

    fireMissile(world, world.player, enemy.id)
    const missile = world.missiles[0]!
    const dt = 1 / 120
    for (let i = 0; i < 200; i++) {
      enemy.state.pos.addScaledVector(enemy.state.vel, dt)
      stepMissiles(world, dt)
      world.time += dt
    }
    expect(missile.targetId).toBe(enemy.id)
  })
})
