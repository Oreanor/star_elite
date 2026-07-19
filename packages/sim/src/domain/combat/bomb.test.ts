import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MISSILE_PYLON } from '../../config/modules'
import { ASTEROID } from '../../config/world'
import { BOMB } from '../../config/weapons'
import { stepWorld } from '../sim'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { AsteroidEntity, MissileEntity, ShipEntity } from '../world/entities'
import { aiController } from '../ai'
import { bombReady, fireBomb } from './bomb'
import { regenAux } from './ecm'
import { applyDamage } from './damage'

/**
 * Энергетическая бомба. Питается от батареи ДОП-ОТСЕКА (аукс) — общего запаса всех
 * аукс-устройств. Подрывается любым накопленным запасом: мощность равна доле заряда.
 * Купить её негде — значит каждое её свойство обязано быть правилом, а не случайностью.
 */

/** Полная ёмкость батареи доп-отсека этого борта. */
const cap = (s: ShipEntity): number => s.spec.power.auxCapacity

/** Мир с одним пиратом и одним мирным. Оба в двухстах метрах, ИИ выключен. */
function withCrowd(): { world: World; pirate: ShipEntity; neutral: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [
      { count: 1, at: [0, 0, -200], spread: 0, faction: 'hostile', name: 'Пират' },
      { count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'Торговец' },
    ],
  })
  const [pirate, neutral] = world.ships as [ShipEntity, ShipEntity]
  world.player.state.pos.set(0, 0, 0)
  for (const s of [pirate, neutral]) {
    s.ai = null
    s.state.pos.set(0, 0, -200)
  }
  return { world, pirate, neutral }
}

function missile(id: number, ownerId: number, pos: Vector3): MissileEntity {
  return {
    id,
    kind: 'missile',
    pos,
    vel: new Vector3(0, 0, -1),
    quat: new Quaternion(),
    module: MISSILE_PYLON,
    ownerId,
    targetId: null,
    speed: MISSILE_PYLON.speed,
    born: 0,
    alive: true,
  }
}

describe('энергетическая бомба', () => {
  it('сжигает враждебных в радиусе и не достаёт за его границу', () => {
    const { world, pirate, neutral } = withCrowd()
    pirate.state.pos.set(0, 0, -BOMB.RADIUS * 0.5)

    // Второго пирата ставим сразу ЗА границей: радиус обязан быть границей, а не намёком.
    neutral.faction = 'hostile'
    neutral.state.pos.set(0, 0, -(BOMB.RADIUS + 50))

    expect(fireBomb(world, world.player)).toBe(true)
    expect(pirate.alive).toBe(false)
    expect(neutral.alive).toBe(true)
  })

  /**
   * Расстрелять мирного можно только осознанно, лазером. Оружие массового
   * поражения не должно делать этот выбор за пилота.
   */
  it('не трогает нейтралов и самого пилота', () => {
    const { world, pirate, neutral } = withCrowd()

    expect(fireBomb(world, world.player)).toBe(true)
    expect(pirate.alive).toBe(false)
    expect(neutral.alive).toBe(true)
    expect(world.player.alive).toBe(true)
    expect(world.player.hull).toBe(world.player.spec.hull.hull)
  })

  it('бомба выгребает доп-отсек досуха: пустая не подрывается и волны не рождает', () => {
    const { world } = withCrowd()
    expect(bombReady(world.player)).toBe(true) // старт с полной батареи доп-отсека

    expect(fireBomb(world, world.player)).toBe(true)
    expect(world.player.auxEnergy).toBe(0)

    expect(fireBomb(world, world.player)).toBe(false)
    // Отказ не должен рождать волну: она обещает поражение, которого не будет.
    expect(world.shockwaves.length).toBe(1)
  })

  /**
   * Полный заряд — гарантированная смерть, и это не назначено числом: урон равен
   * `щит + корпус` того, в кого попал. Магической константы «урон бомбы» нет,
   * иначе новый, более крепкий корабль однажды пережил бы залп, который обещали
   * смертельным.
   */
  it('полный заряд убивает любого, каким бы крепким он ни был', () => {
    const { world, pirate } = withCrowd()
    // Делаем пирата вдвое крепче — бомба обязана справиться и с ним.
    pirate.spec = { ...pirate.spec, hull: { ...pirate.spec.hull, hull: 9999, shield: 9999 } }
    pirate.hull = 9999
    pirate.shield = 9999

    fireBomb(world, world.player)
    expect(pirate.alive).toBe(false)
  })

  /** Подорвать можно любой запас: мощность — ровно та доля, что успела набраться. */
  it('половинный заряд не убивает целого, но добивает раненого', () => {
    const tough = withCrowd()
    const fullShield = tough.pirate.spec.hull.shield
    tough.world.player.auxEnergy = cap(tough.world.player) * 0.5
    fireBomb(tough.world, tough.world.player)
    expect(tough.pirate.alive).toBe(true)
    // Половина полного пула — тяжёлый, но не смертельный удар: щит надкушен, целого не убить.
    expect(tough.pirate.shield).toBeLessThan(fullShield)

    const wounded = withCrowd()
    wounded.pirate.shield = 0
    wounded.pirate.hull = wounded.pirate.spec.hull.hull * 0.2
    wounded.world.player.auxEnergy = cap(wounded.world.player) * 0.5
    fireBomb(wounded.world, wounded.world.player)
    expect(wounded.pirate.alive).toBe(false)
  })

  /**
   * Доля меряется от ПОЛНОГО запаса цели, а не от текущего. Иначе бомба никогда
   * никого не добивала бы: половина от остатка — это всегда остаток.
   */
  it('доля считается от полного запаса, а не от текущего', () => {
    const { world, pirate } = withCrowd()
    // Корпусу нужен запас БОЛЬШЕ половины полного пула, иначе удар его перекрывает
    // и цель гибнет — измерять вычитание не на чем. Даём корпусу «щит+корпус» брони.
    pirate.spec = { ...pirate.spec, hull: { ...pirate.spec.hull, hull: pirate.spec.hull.shield + pirate.spec.hull.hull } }
    const full = pirate.spec.hull.shield + pirate.spec.hull.hull
    pirate.shield = 0
    pirate.hull = pirate.spec.hull.hull

    world.player.auxEnergy = cap(world.player) * 0.5
    fireBomb(world, world.player)

    // Урон 0.5 × полный запас, а не 0.5 × текущий корпус.
    expect(pirate.hull).toBeCloseTo(pirate.spec.hull.hull - full * 0.5, 4)
  })

  /**
   * Батарея доп-отсека — свой пул: копится сама, БЕЗ оглядки на щит (в отличие от
   * прежнего накопителя бомбы). Заряд для бомбы теперь общий с ПРО и маскировкой.
   */
  it('доп-отсек копится сам и упирается в полную ёмкость', () => {
    const { world } = withCrowd()
    const player = world.player
    player.auxEnergy = 0

    // Щит наполовину — на восполнение доп-отсека это больше не влияет.
    player.shield = player.spec.hull.shield * 0.5
    regenAux(player, 1)
    expect(player.auxEnergy).toBeGreaterThan(0)

    regenAux(player, 1e6)
    expect(player.auxEnergy).toBe(cap(player))
    expect(bombReady(player)).toBe(true)
  })

  /**
   * Набранный заряд неприкосновенен попаданием: доп-отсек — не щит, его не разбить
   * ударом. Тратит его только пилот (бомбой/ПРО/маскировкой), а не входящий урон.
   */
  it('попадание не разряжает батарею доп-отсека', () => {
    const { world } = withCrowd()
    const player = world.player
    const full = cap(player)
    expect(player.auxEnergy).toBe(full)

    applyDamage(player, player.spec.hull.shield + 20, world.time)
    expect(player.shield).toBe(0)
    expect(player.auxEnergy).toBe(full)

    player.auxEnergy = full * 0.6
    applyDamage(player, 30, world.time)
    expect(player.auxEnergy).toBe(full * 0.6)
  })

  /**
   * Бомба у бота не срабатывает не потому, что физика ему отказывает: игрок и бот
   * неразличимы, и `fireBomb` сработал бы у пирата, будь у того бомба-модуль и решение.
   * Разница в одном — `wantsBomb` есть только у контроллера игрока, а `aiController`
   * про бомбу не знает вовсе. Привилегия живёт в решении, а не в законах мира.
   */
  it('решение о бомбе принимает не физика: у бота нет намерения её жать', () => {
    const { world, pirate } = withCrowd()
    // Доп-отсек у пирата полон — он питает его ПРО; но бомбу за него жать некому.
    expect(pirate.auxEnergy).toBe(cap(pirate))
    expect(aiController.wantsBomb).toBeUndefined()

    // Позови подрыв руками — правило отработает и для пирата (физика неотличима).
    expect(fireBomb(world, pirate)).toBe(true)
    expect(world.player.alive).toBe(true) // игрок ему не «hostile»: он сам hostile
  })

  /** Импульс жжёт электронику: чужие ракеты гибнут, своя — нет, её пустил ты. */
  it('подрывает чужие ракеты в радиусе, но не свои', () => {
    const { world, pirate } = withCrowd()
    const mine = missile(900, world.player.id, new Vector3(0, 0, -100))
    const theirs = missile(901, pirate.id, new Vector3(0, 0, -100))
    world.missiles.push(mine, theirs)

    fireBomb(world, world.player)
    expect(mine.alive).toBe(true)
    expect(theirs.alive).toBe(false)
  })

  /**
   * Бомба не убивает своей рукой: она обнуляет корпус, а гибель оформляет тот же
   * `cleanup`, что и после лазера. Иначе обломки и трофеи высыпались бы во втором
   * месте — и однажды там про них забыли бы.
   */
  it('оставляет останки и трофеи, как обычная смерть', () => {
    const { world, pirate } = withCrowd()
    const podsBefore = world.pods.length
    const creditsBefore = world.credits

    fireBomb(world, world.player)
    expect(pirate.wreckAt).toBeNull() // гибель ещё не оформлена: это работа шага мира

    stepWorld(world, 1 / 60, new Map())

    expect(pirate.wreckAt).not.toBeNull()
    expect(world.pods.length).toBeGreaterThan(podsBefore)
    expect(world.credits).toBeGreaterThan(creditsBefore)
  })

  /**
   * Поражение МГНОВЕННО: урон наносится в том же кадре, в котором нажата клавиша.
   * Фронт его не догоняет и догонять не обязан — он рисованный.
   */
  it('дальний враг гибнет в тот же кадр, задолго до прихода фронта', () => {
    const { world, pirate } = withCrowd()
    pirate.state.pos.set(0, 0, -(BOMB.RADIUS - 10))

    fireBomb(world, world.player)
    expect(pirate.alive).toBe(false)
    expect(world.shockwaves[0]!.born).toBe(world.time) // вспышка только-только родилась
  })

  /**
   * У вспышки нет ни места в мире, ни радиуса, ни скорости фронта. Это зрелище
   * на пару секунд, а не тело: пересекать ей нечего, урон уже нанесён.
   */
  it('вспышка помнит только мощность и время рождения', () => {
    const { world } = withCrowd()
    world.player.auxEnergy = cap(world.player) * 0.4
    fireBomb(world, world.player)

    const wave = world.shockwaves[0]!
    expect(wave.power).toBeCloseTo(0.4, 5)
    expect(wave.born).toBe(world.time)
    expect(Object.keys(wave).sort()).toEqual(['born', 'power'])
  })

  /** Живёт она ровно `WAVE_LIFE` и убирается шагом мира, а не таймером в рендере. */
  it('вспышка исчезает сама по истечении срока', () => {
    const { world } = withCrowd()
    fireBomb(world, world.player)
    expect(world.shockwaves.length).toBe(1)

    world.time += BOMB.WAVE_LIFE + 0.1
    stepWorld(world, 1 / 60, new Map())
    expect(world.shockwaves.length).toBe(0)
  })

  function putRock(world: World, radius: number, z: number): AsteroidEntity {
    const a: AsteroidEntity = {
      id: world.ids.next(),
      kind: 'asteroid',
      pos: new Vector3(0, 0, z),
      vel: new Vector3(),
      quat: world.player.state.quat.clone(),
      spin: new Vector3(),
      radius,
      hull: ASTEROID.HULL,
      shape: 0,
      alive: true,
    }
    world.asteroids.push(a)
    return a
  }

  /** Камни: надвое floor(r/2); один импульс не дробит уже рождённые половинки. */
  it('дробит каждый камень в радиусе надвое с округлением вниз', () => {
    const { world } = withCrowd()
    const big = putRock(world, 40, -200)
    const mid = putRock(world, 25, -300)

    expect(fireBomb(world, world.player)).toBe(true)
    expect(big.alive).toBe(false)
    expect(mid.alive).toBe(false)

    const live = world.asteroids.filter((a) => a.alive)
    expect(live).toHaveLength(4) // 2+2
    expect(live.every((a) => a.radius === 20 || a.radius === 12)).toBe(true)
    expect(live.filter((a) => a.radius === 20)).toHaveLength(2)
    expect(live.filter((a) => a.radius === 12)).toHaveLength(2)
  })

  it('мельче 10 м уничтожает, а не оставляет осколки', () => {
    const { world } = withCrowd()
    const pebble = putRock(world, 9, -200)
    const edge = putRock(world, 19, -250) // floor(19/2)=9 → тоже уничтожение

    expect(fireBomb(world, world.player)).toBe(true)
    expect(pebble.alive).toBe(false)
    expect(edge.alive).toBe(false)
    expect(world.asteroids.filter((a) => a.alive)).toHaveLength(0)
    expect(world.pods.length).toBeGreaterThanOrEqual(2)
  })
})
