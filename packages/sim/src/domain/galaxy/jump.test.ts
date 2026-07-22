import { describe, expect, it } from 'vitest'
import { HYPERDRIVE_DEEP } from '../../config/modules'
import { CORE_INDEX, GALAXY } from '../../config/galaxy'
import { WORLD } from '../../config/world'
import { isHyperdrive } from '../loadout'
import { COMMODITIES, addCommodity } from '../cargo'
import { refreshSpec, createWorld, rememberPilot, STARTER_SYSTEM, type World } from '../world'
import { emptyPlan } from '../world/contactPlan'
import type { Acquaintance } from '../world/acquaintance'
import { generateGalaxy, generateSystem } from './generate'
import { commitPreparedJump, jump, jumpBlock, jumpDistance, systemDefFor } from './jump'
import { placeSystem, distanceLy } from './shape'
import { stepWorld } from '../sim'

/**
 * Прыжок — правило, а не кнопка. Всё проверяется без рендера: если для теста
 * понадобился бы браузер, значит логика утекла не в тот слой.
 */

/** Ближайшая к дому система, до которой достаёт базовый привод. */
function neighbourWithin(world: World, range: number): number {
  for (let i = 1; i < GALAXY.COUNT; i++) {
    if (i === world.systemIndex) continue
    if (jumpDistance(world, i) <= range) return i
  }
  throw new Error('у дома нет соседей в пределах прыжка — расстановка звёзд сломана')
}

describe('гиперпривод', () => {
  it('у стартового корабля привод стоит с завода', () => {
    const world = createWorld()
    expect(world.player.spec.jumpRange).toBe(GALAXY.BASE_JUMP_RANGE)
    expect(world.player.loadout.internals.some(isHyperdrive)).toBe(true)
  })

  /** Свойство, а не число: снял привод — заперт в системе, сколько ни жми. */
  it('без привода прыжок невозможен вовсе', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    world.player.loadout.internals = world.player.loadout.internals.filter((m) => !isHyperdrive(m))
    refreshSpec(world.player)

    expect(world.player.spec.jumpRange).toBe(0)
    expect(jumpBlock(world, target)).toBe('no-drive')
    expect(jump(world, target)).toBe(false)
  })

  /** Дальность покупается массой: тяжёлый привод режет манёвренность, как тяжёлый щит. */
  it('дальний привод дальше летит и хуже вертится', () => {
    const world = createWorld()
    const pitchBefore = world.player.spec.tuning.PITCH_ACCEL
    const rangeBefore = world.player.spec.jumpRange

    world.player.loadout.internals = [
      ...world.player.loadout.internals.filter((m) => !isHyperdrive(m)),
      HYPERDRIVE_DEEP,
    ]
    refreshSpec(world.player)

    expect(world.player.spec.jumpRange).toBeGreaterThan(rangeBefore)
    expect(world.player.spec.tuning.PITCH_ACCEL).toBeLessThan(pitchBefore)
  })
})

describe('прыжок', () => {
  it('дальше дальности привода не прыгнуть, и причина названа', () => {
    const world = createWorld()
    const range = world.player.spec.jumpRange

    // Люрилар близко к ядру — ищем любую систему за пределом привода.
    let far = -1
    for (let i = 0; i < GALAXY.COUNT; i++) {
      if (i === world.systemIndex) continue
      if (jumpDistance(world, i) > range) {
        far = i
        break
      }
    }
    expect(far).toBeGreaterThanOrEqual(0)
    expect(jumpBlock(world, far)).toBe('out-of-range')
    expect(jump(world, far)).toBe(false)
    expect(world.systemIndex).toBe(WORLD.HOME_INDEX)
  })

  // Баг карты: клик честно писал дальнюю цель, а cleanup симуляции стирал её в том
  // же кадре. Дальность запрещает ПРЫЖОК, но не прокладку маршрута и осмотр системы.
  it('дальняя цель карты переживает шаг мира', () => {
    const world = createWorld()
    let far = -1
    for (let i = 0; i < GALAXY.COUNT; i++) {
      if (i !== world.systemIndex && jumpDistance(world, i) > world.player.spec.jumpRange) {
        far = i
        break
      }
    }
    expect(far).toBeGreaterThanOrEqual(0)

    world.jumpTargetIndex = far
    stepWorld(world, 0, new Map())

    expect(world.jumpTargetIndex).toBe(far)
    expect(jumpBlock(world, far)).toBe('out-of-range')
  })

  it('в себя не прыгают, и из дока тоже', () => {
    const world = createWorld()
    expect(jumpBlock(world, world.systemIndex)).toBe('same-system')

    const target = neighbourWithin(world, world.player.spec.jumpRange)
    world.docked = true
    expect(jumpBlock(world, target)).toBe('docked')
  })

  /**
   * На крейсерском ходу прыжок заперт: сначала сбрось скорость. Иначе привод бьёт
   * из разгона в семьдесят тысяч км за шаг — кино прыжка не за что зацепить.
   */
  it('на крейсерском ходу не прыгнуть, пока не сбросишь ход', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    world.player.cruise.factor = 20
    expect(jumpBlock(world, target)).toBe('cruising')
    expect(jump(world, target)).toBe(false)

    world.player.cruise.factor = 1
    expect(jumpBlock(world, target)).toBeNull()
  })

  it('коррекция масштаба запрещает гиперпрыжок вне 1×', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    world.player.state.scale = 2
    expect(jumpBlock(world, target)).toBe('scaled')
    expect(jump(world, target)).toBe(false)

    world.player.state.scale = 1
    expect(jumpBlock(world, target)).toBeNull()
  })

  it('прыжок в пределах дальности меняет систему', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    expect(jump(world, target)).toBe(true)
    expect(world.systemIndex).toBe(target)
    expect(world.epoch).toBe(1)
    expect(world.systemIndex).not.toBe(WORLD.HOME_INDEX)
    // Звезда обязана быть: система без светила — это дыра в мосте.
    expect(world.bodies.some((b) => b.kind === 'star')).toBe(true)
  })

  it('переход принимает заранее построенный мир без повторной генерации окружения', () => {
    const source = createWorld()
    const target = neighbourWithin(source, source.player.spec.jumpRange)
    const destination = createWorld()
    expect(jump(destination, target)).toBe(true)

    const bodies = destination.bodies
    const ships = destination.ships
    const chargeBefore = source.player.jumpCharge
    const spent = jumpDistance(source, target)
    source.credits = 4242

    expect(commitPreparedJump(source, destination, target)).toBe(true)
    expect(destination.bodies).toBe(bodies)
    expect(destination.ships).toBe(ships)
    expect(destination.credits).toBe(4242)
    expect(destination.player.jumpCharge).toBeCloseTo(chargeBefore - spent)
    expect(destination.epoch).toBe(source.epoch + 1)
  })

  it('обратный проход через уже оплаченную пару не требует второго заряда', () => {
    const world = createWorld()
    const source = world.systemIndex
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    expect(jump(world, target)).toBe(true)
    world.player.jumpCharge = 0
    expect(jump(world, source)).toBe(false)
    expect(jump(world, source, null, { establishedPortal: true })).toBe(true)
    expect(world.player.jumpCharge).toBe(0)
  })

  /**
   * Выход из прыжка НЕ внутри тела. Точку выхода и `stepOrbits` считают по одному
   * `calendarTime`; за долгую игру планета уходит далеко — корабль не должен
   * материализоваться внутри неё. Касание тверди мгновенно смертельно.
   */
  it('корабль не выныривает внутри тела, как бы далеко ни ушли орбиты', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)
    // Уводим орбиты далеко: имитируем долгую игру до прыжка (~5e7 физических секунд).
    world.calendarTime = 5e7

    expect(jump(world, target)).toBe(true)

    const p = world.player
    for (const body of world.bodies) {
      if (body.kind === 'station') continue // об станцию задевают, а не гибнут
      const reach = body.radius + p.spec.hull.radius
      expect(body.pos.distanceTo(p.state.pos)).toBeGreaterThan(reach)
    }
  })

  /**
   * Прыгает ПИЛОТ, а не вселенная. Корабль, кредиты, трюм и очки переживают
   * смену системы; чужой бой — трассы, ракеты, обломки — остаётся позади.
   */
  it('корабль и кошелёк переживают прыжок, а чужой бой — нет', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    world.credits = 4242
    world.score = 7
    addCommodity(world.player.hold, COMMODITIES.SCRAP, 1)
    refreshSpec(world.player)
    const cargo = world.player.hold.items.length

    world.player.hull = 33
    world.missiles.push({} as never)
    world.tracers.push({} as never)

    expect(jump(world, target)).toBe(true)
    expect(world.credits).toBe(4242)
    expect(world.score).toBe(7)
    expect(world.player.hull).toBe(33)
    expect(world.player.hold.items.length).toBe(cargo)
    expect(world.missiles).toHaveLength(0)
    expect(world.tracers).toHaveLength(0)
  })

  /** Одно зерно — одна галактика. Прыжок туда-обратно приводит в ту же систему. */
  it('система детерминирована: вернулся — застал ту же', () => {
    const a = createWorld()
    const b = createWorld()
    const target = neighbourWithin(a, a.player.spec.jumpRange)

    jump(a, target)
    jump(b, target)
    expect(a.systemName).toBe(b.systemName)
    expect(a.bodies.map((x) => x.name)).toEqual(b.bodies.map((x) => x.name))
  })

  /** Дом — Люрилар: улететь и вернуться в ту же систему. */
  it('домой возвращаются в Люрилар', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    jump(world, target)
    world.player.jumpCharge = world.player.spec.jumpRange
    expect(jump(world, WORLD.HOME_INDEX)).toBe(true)
    expect(world.systemName).toBe('Люрилар')
    // Причал тут обычный: крест уехал в центр вселенной. Важно, что он ЕСТЬ — домой
    // возвращаются к причалу, а не в пустоту.
    expect(world.bodies.find((b) => b.kind === 'station')).toBeDefined()
  })

  /**
   * Карта читает каталог (`generateSystem`), сцена — `SystemDef`. Имя и причал
   * общего спавна обязаны совпасть (Люрилар / Кресты).
   */
  it('каталог и сцена описывают Люрилар одинаково', () => {
    const catalogue = generateSystem(WORLD.HOME_INDEX, GALAXY.SEED)
    const def = systemDefFor(WORLD.HOME_INDEX, GALAXY.SEED)

    expect(catalogue.name).toBe('Люрилар')
    expect(catalogue.name).toBe(def.name)
    expect(catalogue.planets.length).toBe(def.planets.length)
    expect(catalogue.planets.map((p) => p.name)).toEqual(def.planets.map((p) => p.name))
    expect(catalogue.planets.map((p) => p.type)).toEqual(def.planets.map((p) => p.type))

    const capital = catalogue.planets.find((p) => p.station)
    // Имя причала не задаём — важно, что каталог и сцена называют его ОДИНАКОВО.
    // Разойдись они, и карта показывала бы один причал, а сцена — другой.
    expect(capital?.station?.name).toBeDefined()
    expect(capital?.station?.name).toBe(def.station?.name)
    expect(catalogue.star.color).toBe(def.star.color)
  })

  /** Имя спавна занято до разведения коллизий — в галактике ровно один Люрилар. */
  it('в галактике ровно одна система Люрилар', () => {
    const named = generateGalaxy(GALAXY.SEED).filter((s) => s.name === 'Люрилар')
    expect(named.map((s) => s.index)).toEqual([WORLD.HOME_INDEX])
  })

  /**
   * Ядро — не система, а ворота. Прыжок в него меняет ЗЕРНО галактики (а с ним и
   * все 2500 систем разом), и корабль выходит у чёрной дыры уже НОВОЙ галактики.
   * Проверяем переход, а не топливо, поэтому доливаем бак и ставим дальний привод.
   */
  it('прыжок в ядро уводит в другую галактику через чёрную дыру', () => {
    const world = createWorld()
    world.player.spec.jumpRange = 1e6
    world.player.jumpCharge = 1e6
    const seedBefore = world.galaxySeed

    expect(jump(world, CORE_INDEX)).toBe(true)
    expect(world.galaxySeed).not.toBe(seedBefore) // галактика сменилась целиком
    expect(world.systemIndex).toBe(CORE_INDEX) // вышли у чёрной дыры новой галактики
    // В чужой галактике индекс 1 — обычная звезда, не наш Люрилар.
    expect(systemDefFor(WORLD.HOME_INDEX, world.galaxySeed).name).not.toBe('Люрилар')
  })

  /** Цепочка галактик детерминирована: тот же старт — то же следующее зерно. */
  it('следующая галактика за дырой одна и та же при том же старте', () => {
    const mk = () => {
      const w = createWorld()
      w.player.spec.jumpRange = 1e6
      w.player.jumpCharge = 1e6
      return w
    }
    const a = mk()
    const b = mk()
    jump(a, CORE_INDEX)
    jump(b, CORE_INDEX)
    expect(a.galaxySeed).toBe(b.galaxySeed)
  })

  it('расстояние симметрично и считается по трём осям', () => {
    const world = createWorld()
    const a = placeSystem(WORLD.HOME_INDEX, GALAXY.SEED)
    const b = placeSystem(7, GALAXY.SEED)
    expect(jumpDistance(world, 7)).toBeCloseTo(distanceLy(a, b))
    expect(distanceLy(a, b)).toBeCloseTo(distanceLy(b, a))
  })
})

/**
 * СОПРОВОЖДЕНИЕ ЛЕТИТ С ТОБОЙ. Борт физически не переносится — `enterSystem` пересобирает
 * окружение целиком, — поэтому за игроком едет ЗАПИСЬ знакомства, а борт ему выставляет
 * `spawnResidentContacts` уже на месте.
 *
 * Раньше `syncLiveContactsFromShips` записывала контакту ПОКИНУТУЮ систему, и нанятый эскорт
 * молча оставался позади (а дрейф уводил его ещё дальше). С контрактами это ломало всё, где
 * кого-то надо КУДА-ТО ДОВЕЗТИ: клиент терялся на первом же прыжке.
 */
describe('попутчики', () => {
  it('сопровождение переезжает в систему прибытия, а посторонний знакомый — нет', () => {
    // Стартовая система населена одним богом, а его трафик нарочно не воскрешает — берём
    // мир с обычным патрульным бортом, из которого и выйдет попутчик.
    const world = createWorld({
      ...STARTER_SYSTEM,
      patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'Кто-то' }],
    })
    const home = world.systemIndex
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    // Бог Слово не годится: трафик его нарочно не воскрешает (его сажает `spawnSlovo`).
    const ship = world.ships.find((s) => s.originKind !== 'god')
    if (!ship) throw new Error('в стартовой системе некого взять в сопровождение')
    rememberPilot(world, ship)
    const escortRec = world.acquaintances[world.acquaintances.length - 1]!
    escortRec.plan.posture = 'escort'
    escortRec.plan.patronId = world.player.id

    // Второй знакомый — сам по себе, в другой системе: он ехать с тобой не обязан.
    const stranger: Acquaintance = { ...escortRec, id: world.ids.next(), plan: emptyPlan() }
    stranger.systemIndex = home
    world.acquaintances.push(stranger)

    expect(jump(world, target)).toBe(true)
    expect(escortRec.systemIndex).toBe(target)
    // Приехал не только записью: на месте он снова живой борт рядом с игроком.
    expect(world.ships.some((s) => s.acquaintanceId === escortRec.id)).toBe(true)
    expect(stranger.systemIndex).not.toBe(target)
  })
})
