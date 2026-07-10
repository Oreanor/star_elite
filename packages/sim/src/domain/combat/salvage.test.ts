import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SCORE } from '../../config/world'
import { SALVAGE } from '../../config/weapons'
import { cargoMass } from '../cargo/hold'
import { stepWorld, type Controller } from '../sim'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { applyDamage } from './damage'
import { canScoopAt, scoopBlock, scoopReadiness, spawnWreckage, tryScoop } from './salvage'

/**
 * Мир без пояса, но с одним пиратом: астероиды тут только мешают, а обломок
 * взять неоткуда — трофеи рождаются из корабля.
 */
function quiet(): World {
  const patrol = STARTER_SYSTEM.patrols[0]
  if (!patrol) throw new Error('в стартовой системе нет патрулей')
  return createWorld({ ...STARTER_SYSTEM, patrols: [patrol], belt: null })
}

/** Ставит одного пирата рядом с игроком и возвращает его. */
function withPirate(world: World) {
  const pirate = world.ships[0]
  if (!pirate) throw new Error('в мире нет корабля')
  return pirate
}

describe('награда за пирата', () => {
  /**
   * Кредиты начисляются в момент ГИБЕЛИ, ровно один раз. Раньше сбитый пират
   * приносил только очки, и экономика держалась на одних трофеях.
   */
  it('сбитый пират платит награду и очки, и только один раз', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null })
    const pirate = withPirate(world)
    expect(pirate.faction).toBe('hostile')

    const credits = world.credits
    applyDamage(pirate, 1e6, 0)
    expect(pirate.alive).toBe(false)

    stepWorld(world, 1 / 60, new Map())
    expect(world.credits).toBe(credits + SCORE.HOSTILE_BOUNTY)
    expect(world.score).toBe(SCORE.HOSTILE_KILL)

    // Обломок живёт ещё секунду, пока отыгрывает взрыв: платить второй раз не за что.
    for (let i = 0; i < 30; i++) stepWorld(world, 1 / 60, new Map())
    expect(world.credits).toBe(credits + SCORE.HOSTILE_BOUNTY)
    expect(world.score).toBe(SCORE.HOSTILE_KILL)
  })
})

describe('трофеи', () => {
  /** Обломок обязан что-то оставить: лом падает всегда, добыча — по шансу. */
  it('из обломка выпадают контейнеры', () => {
    const world = quiet()
    const pirate = withPirate(world)

    spawnWreckage(world, pirate)
    expect(world.pods.length).toBeGreaterThan(0)
  })

  /**
   * Добыча берётся из номенклатуры товаров, а не из одного лома. Свойство, а не
   * число: сколько именно выпадет, решает `LOOT_CHANCE`, и это балансировщик крутит.
   */
  it('среди трофеев встречается товар, отличный от лома', () => {
    const world = quiet()
    const pirate = withPirate(world)

    // Двадцать обломков: при шансе 0.7 промахнуться двадцать раз практически нельзя,
    // а зерно фиксировано — тест детерминирован.
    for (let i = 0; i < 20; i++) spawnWreckage(world, pirate)

    const kinds = new Set(
      world.pods.filter((p) => p.item.kind === 'commodity').map((p) => (p.item.kind === 'commodity' ? p.item.commodity.id : '')),
    )
    expect(kinds.size).toBeGreaterThan(1)
  })

  /** Одно зерно — один набор трофеев. Сломается — не будет ни сохранений, ни сети. */
  it('дроп детерминирован по зерну мира', () => {
    const a = quiet()
    const b = quiet()
    spawnWreckage(a, withPirate(a))
    spawnWreckage(b, withPirate(b))

    expect(a.pods.map((p) => p.item.kind)).toEqual(b.pods.map((p) => p.item.kind))
    expect(a.pods.length).toBe(b.pods.length)
  })
})

describe('подбор контейнера', () => {
  /**
   * Ставит контейнер в зону МЯГКОГО захвата и гасит относительную скорость.
   *
   * Не вплотную: внутри габарита корпуса действует правило столкновения, которое
   * забирает груз невзирая на скорость. Здесь проверяется подлёт, а не таран.
   */
  function podAtPlayer(world: World) {
    spawnWreckage(world, withPirate(world))
    const pod = world.pods[0]
    if (!pod) throw new Error('обломок не оставил контейнеров')

    const soft = world.player.spec.hull.radius + SALVAGE.SCOOP_RADIUS / 2
    pod.pos.copy(world.player.state.pos).add(new Vector3(0, 0, soft))
    pod.vel.copy(world.player.state.vel)
    return pod
  }

  it('рядом и медленно — можно взять', () => {
    const world = quiet()
    const pod = podAtPlayer(world)
    expect(scoopBlock(world.player, pod)).toBeNull()
    expect(canScoopAt(world.player, pod)).toBe(true)
  })

  /**
   * Причина отказа названа, а не спрятана в булев `false`: HUD обязан объяснить
   * пилоту, тормозить ему или разгружаться.
   */
  it('на скорости — не взять, и причина названа', () => {
    const world = quiet()
    const pod = podAtPlayer(world)
    pod.vel.copy(world.player.state.vel).add(new Vector3(0, 0, SALVAGE.SCOOP_MAX_REL_SPEED + 5))

    expect(scoopBlock(world.player, pod)).toBe('speed')
    expect(tryScoop(world.player, pod)).toBeNull()
    expect(pod.alive).toBe(true)
  })

  it('далеко — не взять', () => {
    const world = quiet()
    const pod = podAtPlayer(world)
    pod.pos.addScaledVector(new Vector3(0, 0, 1), SALVAGE.SCOOP_RADIUS * 10)

    expect(scoopBlock(world.player, pod)).toBe('range')
  })

  it('трюм полон — не взять, и причина другая', () => {
    const world = quiet()
    const pod = podAtPlayer(world)
    world.player.hold.capacity = 0

    expect(scoopBlock(world.player, pod)).toBe('full')
    expect(tryScoop(world.player, pod)).toBeNull()
  })

  /**
   * Регрессия. `sellCargo` пересобирал spec при выгрузке, а подбор — нет:
   * набранные тонны не доходили до физики, и корабль вёз груз-призрак.
   * Проверяется СВОЙСТВО «масса выросла ⇒ ускорение упало», не числа.
   */
  it('подобранный груз утяжеляет корабль и режет манёвренность', () => {
    const world = quiet()
    const player = world.player
    const pod = podAtPlayer(world)

    const pitchBefore = player.spec.tuning.PITCH_ACCEL
    const massBefore = player.spec.mass

    expect(tryScoop(player, pod)).not.toBeNull()
    expect(cargoMass(player.hold)).toBeGreaterThan(0)
    expect(player.spec.mass).toBeGreaterThan(massBefore)
    expect(player.spec.tuning.PITCH_ACCEL).toBeLessThan(pitchBefore)
  })

  /** Шаг мира подбирает сам, без клавиши: подлетел тихо и близко — груз в трюме. */
  it('шаг мира подбирает контейнер при подлёте', () => {
    const world = quiet()
    const pod = podAtPlayer(world)
    world.player.state.vel.set(0, 0, 0)
    pod.vel.set(0, 0, 0)

    stepWorld(world, 1 / 60, new Map())
    expect(pod.alive).toBe(false)
    expect(world.player.hold.items.length).toBeGreaterThan(0)
  })
})

/**
 * Тяговый луч. Ловить контейнер в тридцатиметровый радиус, да ещё и на
 * подходящей относительной скорости, руками невозможно — луч делает грубую часть.
 */
describe('тяговый луч', () => {
  /** Контроллер, который только и умеет, что держать луч. */
  const tractoring: Controller = {
    update: () => {},
    wantsFire: () => false,
    wantsTractor: () => true,
  }

  function podAhead(world: World, distance: number, drift: Vector3) {
    spawnWreckage(world, withPirate(world))
    world.pods.length = 1
    const pod = world.pods[0]!

    // Нос игрока смотрит в −Z: ставим контейнер прямо по курсу.
    world.player.state.quat.identity()
    world.player.state.vel.set(0, 0, 0)
    world.player.state.pos.set(0, 0, 0)
    pod.pos.set(0, 0, -distance)
    pod.vel.copy(drift)
    return pod
  }

  it('тянет контейнер, который держат по курсу', () => {
    const world = quiet()
    const pod = podAhead(world, 200, new Vector3())
    const before = pod.pos.distanceTo(world.player.state.pos)

    for (let i = 0; i < 30; i++) stepWorld(world, 1 / 60, new Map([[world.player.id, tractoring]]))

    expect(pod.pos.distanceTo(world.player.state.pos)).toBeLessThan(before)
    expect(pod.tractored).toBe(true)
  })

  /** Луч не работает по тому, что за спиной: это луч, а не пылесос. */
  it('не тянет то, что позади', () => {
    const world = quiet()
    const pod = podAhead(world, 200, new Vector3())
    pod.pos.set(0, 0, 200) // за кормой
    const before = pod.pos.distanceTo(world.player.state.pos)

    for (let i = 0; i < 30; i++) stepWorld(world, 1 / 60, new Map([[world.player.id, tractoring]]))

    expect(pod.pos.distanceTo(world.player.state.pos)).toBeGreaterThanOrEqual(before)
    expect(pod.tractored).toBe(false)
  })

  it('не тянет дальше своей дальности', () => {
    const world = quiet()
    const pod = podAhead(world, SALVAGE.TRACTOR_RANGE * 2, new Vector3())

    stepWorld(world, 1 / 60, new Map([[world.player.id, tractoring]]))
    expect(pod.tractored).toBe(false)
  })

  it('без зажатой клавиши луч не светит', () => {
    const world = quiet()
    const pod = podAhead(world, 200, new Vector3())

    stepWorld(world, 1 / 60, new Map())
    expect(pod.tractored).toBe(false)
  })

  /**
   * Главное свойство: луч уравнивает скорости, поэтому SCOOP_MAX_REL_SPEED
   * перестаёт быть препятствием сам собой — порог трогать не пришлось.
   * Контейнер, уносящийся быстрее порога, всё равно оказывается в трюме.
   */
  it('догоняет и подбирает контейнер, уходящий быстрее порога захвата', () => {
    const world = quiet()
    const drift = new Vector3(0, 0, -(SALVAGE.SCOOP_MAX_REL_SPEED + 20))
    const pod = podAhead(world, 150, drift)
    expect(scoopReadiness(world.player, pod)).toBe('speed')

    const controllers = new Map([[world.player.id, tractoring]])
    for (let i = 0; i < 60 * 12 && pod.alive; i++) stepWorld(world, 1 / 60, controllers)

    expect(pod.alive).toBe(false)
    expect(world.player.hold.items.length).toBeGreaterThan(0)
  })
})

describe('подбор столкновением', () => {
  /**
   * «Либо если налетел на них просто». Контейнер размером с бочку проваливается
   * в грузовой люк, и спрашивать про относительную скорость поздно: столкновение
   * уже состоялось. Порог скорости остаётся для мягкого захвата на подлёте.
   */
  it('влетел корпусом — забрал, как бы быстро ни шёл', () => {
    const world = quiet()
    spawnWreckage(world, withPirate(world))
    const pod = world.pods[0]!

    // Внутри габарита корпуса, относительная скорость много выше порога.
    pod.pos.copy(world.player.state.pos)
    pod.vel.copy(world.player.state.vel).add(new Vector3(0, 0, 300))

    expect(scoopReadiness(world.player, pod)).toBe('speed')
    expect(scoopBlock(world.player, pod)).toBeNull()
    expect(tryScoop(world.player, pod)).not.toBeNull()
  })

  /** Но полный трюм не резиновый: тут столкновение ничего не решает. */
  it('в полный трюм не влезет даже тараном', () => {
    const world = quiet()
    spawnWreckage(world, withPirate(world))
    const pod = world.pods[0]!
    pod.pos.copy(world.player.state.pos)
    world.player.hold.capacity = 0

    expect(scoopBlock(world.player, pod)).toBe('full')
  })
})

/**
 * Регрессия. Контейнер наследовал ВСЮ скорость обломка, а пират под форсажем
 * уходит на 260 м/с при потолке «Кобры» в 202. Замер показал: четыре трофея
 * из четырёх недостижимы — не «трудно догнать», а нельзя в принципе.
 */
describe('дрейф контейнера', () => {
  /** Пират, уходящий быстрее, чем игрок вообще способен лететь. */
  function fleeing(world: World) {
    const pirate = withPirate(world)
    pirate.state.vel.set(0, 0, -(world.player.spec.tuning.MAX_SPEED + 60))
    return pirate
  }

  it('контейнер с уходящего обломка догоняем', () => {
    const world = quiet()
    const pirate = fleeing(world)
    spawnWreckage(world, pirate)
    expect(world.pods.length).toBeGreaterThan(0)

    // Свойство, а не число: догнать можно только то, что медленнее твоего потолка.
    for (const pod of world.pods) {
      expect(pod.vel.length()).toBeLessThan(world.player.spec.tuning.MAX_SPEED)
    }
  })

  /** Дальше контейнер летит по Ньютону: тормозит его отстрел, а не трение о вакуум. */
  it('в полёте скорость контейнера не меняется', () => {
    const world = quiet()
    const pirate = fleeing(world)
    pirate.state.pos.set(0, 0, -5_000) // далеко: подбирать нечего, только считать
    spawnWreckage(world, pirate)

    const pod = world.pods[0]!
    const before = pod.vel.clone()
    for (let i = 0; i < 5 * 60; i++) stepWorld(world, 1 / 60, new Map())

    expect(pod.vel.distanceTo(before)).toBeLessThan(1e-6)
  })

  /** Но и в слипшуюся кучу не сбиваются: разлёт добавляется поверх наследованного хода. */
  it('контейнеры разлетаются друг от друга', () => {
    const world = quiet()
    const pirate = withPirate(world)
    pirate.state.vel.set(0, 0, -200)
    spawnWreckage(world, pirate)

    const [a, b] = world.pods
    expect(a && b).toBeTruthy()
    expect(a!.vel.distanceTo(b!.vel)).toBeGreaterThan(1)
  })
})
