import { describe, expect, it } from 'vitest'
import { DIALOGUE } from '../../config/dialogue'
import { COMMODITIES } from '../cargo'
import { addCommodity } from '../cargo/hold'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { interlocutor, linesFor, say } from './dialogue'

/**
 * Разговор — правило, а не окно. Всё проверяется без браузера: если для теста
 * понадобился бы интерфейс, значит логика утекла не в тот слой.
 */

function withShip(faction: 'hostile' | 'neutral'): { world: World; other: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction, name: 'Кто-то' }],
  })
  const other = world.ships[0]!
  other.ai = null
  world.player.state.pos.set(0, 0, 0)
  other.state.pos.set(0, 0, -200)
  world.lockedTargetId = other.id
  return { world, other }
}

/** Заставляет следующий бросок вернуть заданное число: правило важнее удачи. */
function rig(world: World, value: number): void {
  world.rng = () => value
}

describe('разговор', () => {
  it('говорить можно только с захваченным, живым и близким', () => {
    const { world, other } = withShip('hostile')
    expect(interlocutor(world)?.id).toBe(other.id)

    world.lockedTargetId = null
    expect(interlocutor(world)).toBeNull()

    world.lockedTargetId = other.id
    other.state.pos.set(0, 0, -(DIALOGUE.RANGE + 10))
    expect(interlocutor(world)).toBeNull()

    other.state.pos.set(0, 0, -200)
    other.alive = false
    expect(interlocutor(world)).toBeNull()
  })

  it('пирату предлагают одно, торговцу другое', () => {
    const pirate = withShip('hostile')
    expect(linesFor(pirate.world, pirate.other).map((l) => l.topic)).toEqual(['surrender', 'mercy'])

    const trader = withShip('neutral')
    expect(linesFor(trader.world, trader.other).map((l) => l.topic)).toEqual(['escort', 'plunder', 'greet'])
  })

  /** Невредимый пират не бросает добычу. Сначала сбей ему щит — потом требуй. */
  it('целого пирата не уговорить сдаться', () => {
    const { world, other } = withShip('hostile')
    const line = linesFor(world, other).find((l) => l.topic === 'surrender')!
    expect(line.blocked).not.toBeNull()

    // Заблокированная реплика не произносится, даже если кнопку не погасили:
    // правило живёт здесь, а не в интерфейсе.
    rig(world, 0)
    expect(say(world, other, 'surrender').agreed).toBe(false)
    expect(other.faction).toBe('hostile')
  })

  it('избитый пират сдаётся тем охотнее, чем сильнее избит', () => {
    const half = withShip('hostile')
    half.other.hull = half.other.spec.hull.hull * 0.5

    // Бросок ровно на границе шанса: 0.5 × SURRENDER_GAIN.
    rig(half.world, 0.5 * DIALOGUE.SURRENDER_GAIN - 1e-9)
    expect(say(half.world, half.other, 'surrender').agreed).toBe(true)

    const barely = withShip('hostile')
    barely.other.hull = barely.other.spec.hull.hull * 0.5
    rig(barely.world, 0.5 * DIALOGUE.SURRENDER_GAIN + 1e-9)
    expect(say(barely.world, barely.other, 'surrender').agreed).toBe(false)
  })

  /**
   * Сдавшийся перестаёт быть врагом, а не «перестаёт стрелять». Флаг «не стрелять»
   * потребовал бы второго флага, «а этому можно», и однажды сдавшийся выстрелил бы
   * в спину, потому что кто-то проверил не тот.
   */
  it('сдавшийся меняет фракцию и высыпает груз', () => {
    const { world, other } = withShip('hostile')
    other.hull = 1
    // У пирата нет трюмного отсека, вместимость нулевая: без этого груз не влезет,
    // и тест проверял бы, что пустой трюм остался пустым.
    other.hold.capacity = 10
    addCommodity(other.hold, COMMODITIES.METALS, 2)
    rig(world, 0)

    expect(say(world, other, 'surrender').agreed).toBe(true)
    expect(other.faction).toBe('neutral')
    expect(other.hold.items.length).toBe(0)
    expect(world.pods.length).toBeGreaterThan(0)
    expect(other.alive).toBe(true) // капитуляция, а не смерть
  })

  /** Умирающему не верят — его добивают. Шанс растёт с ТВОИМ здоровьем, а не падает. */
  it('пощады проще выпросить целым, чем при смерти', () => {
    const healthy = withShip('hostile')
    const dying = withShip('hostile')
    dying.world.player.hull = dying.world.player.spec.hull.hull * 0.05
    dying.world.player.shield = 0

    // Один и тот же бросок: разница только в состоянии игрока.
    const roll = DIALOGUE.MERCY_BASE + DIALOGUE.MERCY_HEALTH_GAIN * 0.5
    rig(healthy.world, roll)
    rig(dying.world, roll)

    expect(say(healthy.world, healthy.other, 'mercy').agreed).toBe(true)
    expect(say(dying.world, dying.other, 'mercy').agreed).toBe(false)
  })

  it('гружёный откупается грузом, и груз действительно уходит за борт', () => {
    const { world, other } = withShip('hostile')
    addCommodity(world.player.hold, COMMODITIES.METALS, 3)
    rig(world, 0)

    expect(say(world, other, 'mercy').agreed).toBe(true)
    expect(world.player.hold.items.length).toBe(0)
    expect(other.faction).toBe('neutral')
  })

  /** Целого торговца разбоем не запугать: станция рядом, а ты пока никто. */
  it('невредимый торговец посылает грабителя', () => {
    const { world, other } = withShip('neutral')
    rig(world, 0)

    expect(say(world, other, 'plunder').agreed).toBe(false)
    expect(other.loadout.weapons.some((w) => w !== null)).toBe(true)
  })

  it('напуганный торговец отдаёт груз и оружие', () => {
    const { world, other } = withShip('neutral')
    other.shield = 0
    other.hull = other.spec.hull.hull * 0.4
    addCommodity(other.hold, COMMODITIES.FOOD, 2)

    expect(say(world, other, 'plunder').agreed).toBe(true)
    expect(other.hold.items.length).toBe(0)
    // Стволов больше нет ФИЗИЧЕСКИ, а не «запрещено стрелять».
    expect(other.loadout.weapons.every((w) => w === null)).toBe(true)
    expect(other.spec.mounts.every((m) => m.weapon === null)).toBe(true)
    expect(other.alive).toBe(true)
  })

  it('наём стоит денег вперёд и без денег не случается', () => {
    const { world, other } = withShip('neutral')
    world.credits = DIALOGUE.ESCORT_FEE - 1
    expect(linesFor(world, other).find((l) => l.topic === 'escort')!.blocked).not.toBeNull()
    expect(say(world, other, 'escort').agreed).toBe(false)

    world.credits = DIALOGUE.ESCORT_FEE + 100
    expect(say(world, other, 'escort').agreed).toBe(true)
    expect(world.credits).toBe(100)
    expect(other.ai?.escortOf).toBe(world.player.id)
  })

  /**
   * Наёмник слаб решением, а не железом: медленнее реагирует и шире промахивается.
   * Понизить ему урон значило бы соврать про то, что физика у всех одна.
   */
  it('наёмник слабее выучкой, а не оружием', () => {
    const { world, other } = withShip('neutral')
    const guns = other.loadout.weapons.filter(Boolean).length

    say(world, other, 'escort')

    expect(other.ai!.skill).toBe(DIALOGUE.ESCORT_SKILL)
    expect(other.ai!.skill).toBeLessThan(1)
    expect(other.loadout.weapons.filter(Boolean).length).toBe(guns)
    expect(other.spec.tuning).toEqual(world.ships[0]!.spec.tuning)
  })
})
