import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { COMMODITIES } from '../cargo/items'
import { addCommodity, freeCapacity } from '../cargo/hold'
import { spawnOrePod } from '../combat/salvage'
import { stepWorld } from '../sim'
import { createWorld, STARTER_SYSTEM } from '../world'
import type { ShipEntity, World } from '../world/entities'
import { aiController } from './pilot'
import { assignApproach, assignCollectRun, assignRendezvous, clearTasks, enqueueTask, hasTask, stepTasks } from './tasks'

/** Мир с одним ботом-компаньоном (эскорт игрока), готовым брать поручения. */
function withCompanion(): { world: World; bot: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -600], spread: 0, faction: 'neutral', name: 'Компаньон' }],
  })
  const bot = world.ships[0]!
  bot.ai!.escortOf = world.player.id
  // Компаньону нужен трюм, чтобы было куда складывать собранное.
  bot.hold.capacity = 40
  return { world, bot }
}

describe('очередь задач компаньона', () => {
  it('сбор ведёт к БЛИЖАЙШЕМУ влезающему контейнеру', () => {
    const { world, bot } = withCompanion()
    bot.state.pos.set(0, 0, 0)
    spawnOrePod(world, new Vector3(0, 0, -800), new Vector3(), 1) // дальний
    spawnOrePod(world, new Vector3(0, 0, -200), new Vector3(), 1) // ближний
    const near = world.pods[1]!

    enqueueTask(bot, { kind: 'collect-cargo', anchor: new Vector3(0, 0, -400), radius: 1000 })
    const intent = stepTasks(bot, world)

    expect(intent).not.toBeNull()
    expect(intent!.scoop).toBe(true)
    expect(intent!.target.distanceTo(near.pos)).toBeLessThan(1e-6)
  })

  it('сбор завершается, когда влезающих грузов в районе нет', () => {
    const { world, bot } = withCompanion()
    // Контейнер есть, но ДАЛЕКО за районом сбора.
    spawnOrePod(world, new Vector3(0, 0, -5000), new Vector3(), 1)
    enqueueTask(bot, { kind: 'collect-cargo', anchor: new Vector3(0, 0, 0), radius: 500 })

    expect(stepTasks(bot, world)).toBeNull() // нечего собирать — задача снята
    expect(hasTask(bot)).toBe(false)
  })

  it('сбор завершается по полному трюму, даже если груз рядом', () => {
    const { world, bot } = withCompanion()
    // Забиваем трюм под завязку.
    while (freeCapacity(bot.hold) > 0) {
      const before = freeCapacity(bot.hold)
      addCommodity(bot.hold, COMMODITIES.MINERALS, 1)
      if (freeCapacity(bot.hold) === before) break
    }
    spawnOrePod(world, new Vector3(0, 0, -100), new Vector3(), 1)
    enqueueTask(bot, { kind: 'collect-cargo', anchor: new Vector3(0, 0, -100), radius: 500 })

    expect(stepTasks(bot, world)).toBeNull()
    expect(hasTask(bot)).toBe(false)
  })

  it('возврат ведёт к нанимателю и завершается по прибытии', () => {
    const { world, bot } = withCompanion()
    world.player.state.pos.set(0, 0, 1000)

    bot.state.pos.set(0, 0, 0) // далеко от нанимателя
    enqueueTask(bot, { kind: 'return-to-escort', arriveRadius: 200 })
    const intent = stepTasks(bot, world)
    expect(intent).not.toBeNull()
    expect(intent!.target.distanceTo(world.player.state.pos)).toBeLessThan(1e-6)

    // Встал рядом — задача выполнена и снята.
    bot.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, 50))
    expect(stepTasks(bot, world)).toBeNull()
    expect(hasTask(bot)).toBe(false)
  })

  it('assignCollectRun ставит цепочку [собрать, вернуться] и она проигрывается по порядку', () => {
    const { world, bot } = withCompanion()
    world.player.state.pos.set(0, 0, 1000)
    bot.state.pos.set(0, 0, 0)

    assignCollectRun(bot, new Vector3(0, 0, 0), 500) // грузов в районе нет
    expect(bot.ai!.tasks.length).toBe(2)

    // Сбор пуст → снимается, текущей становится «вернуться»: цель — наниматель.
    const intent = stepTasks(bot, world)
    expect(intent).not.toBeNull()
    expect(intent!.target.distanceTo(world.player.state.pos)).toBeLessThan(1e-6)
    expect(bot.ai!.tasks.length).toBe(1) // сбор снят, остался возврат
  })

  it('hold ведёт к точке и НЕ завершается сам (это «жди», а не «долети»)', () => {
    const { world, bot } = withCompanion()
    bot.state.pos.set(0, 0, 0)
    const anchor = new Vector3(0, 0, -300)
    enqueueTask(bot, { kind: 'hold', anchor, radius: 150 })

    const intent = stepTasks(bot, world)
    expect(intent).not.toBeNull()
    expect(intent!.scoop).toBe(false)
    expect(intent!.target.distanceTo(anchor)).toBeLessThan(1e-6)

    // Даже стоя ВПЛОТНУЮ у точки — задача остаётся: бот ждёт, пока её не снимут.
    bot.state.pos.copy(anchor)
    expect(stepTasks(bot, world)).not.toBeNull()
    expect(hasTask(bot)).toBe(true)
  })

  it('подход к телу ведёт к точке ВНЕ его поверхности, не в центр', () => {
    const { world, bot } = withCompanion()
    const body = world.bodies.find((b) => b.kind === 'station') ?? world.bodies[0]!
    const margin = 800
    // Бот со стороны +Z от тела: подлёт обязан выйти с ЕГО стороны, а не с противоположной.
    bot.state.pos.copy(body.pos).add(new Vector3(0, 0, body.radius + 2000))

    assignApproach(bot, body.id, margin)
    const intent = stepTasks(bot, world)!
    expect(intent).not.toBeNull()
    // Целевая точка — снаружи тела: не ближе радиуса к центру (не втыкаемся в поверхность).
    expect(intent.target.distanceTo(body.pos)).toBeGreaterThan(body.radius)
    // И со стороны бота (по +Z), а не с противоположной.
    expect(intent.target.z).toBeGreaterThan(body.pos.z)

    // Долетел до точки — задача снялась (это «долети», а не «жди»).
    bot.state.pos.copy(intent.target)
    expect(stepTasks(bot, world)).toBeNull()
    expect(hasTask(bot)).toBe(false)
  })

  /**
   * СТАНЦИЯ ЛЕТИТ ПО ОРБИТЕ. Поручение обязано вести её ПО ID, пересчитывая подлёт каждый шаг:
   * с точкой-слепком бот пёр туда, где станции уже нет, и со стороны это выглядело как «летит
   * то к ней, то от неё». Проверяем поведение (цель следует за телом), а не координаты.
   */
  it('подлёт ведёт ДВИЖУЩЕЕСЯ тело, а не замороженную точку', () => {
    const { world, bot } = withCompanion()
    const body = world.bodies.find((b) => b.kind === 'station') ?? world.bodies[0]!
    bot.state.pos.copy(body.pos).add(new Vector3(0, 0, body.radius + 5000))

    assignApproach(bot, body.id)
    const before = stepTasks(bot, world)!.target.clone()

    // Тело уехало по орбите — цель обязана уехать вместе с ним.
    body.pos.add(new Vector3(4000, 0, 0))
    const after = stepTasks(bot, world)!.target.clone()

    expect(after.distanceTo(before)).toBeGreaterThan(1000)
    // И всё так же снаружи тела, а не в его центре.
    expect(after.distanceTo(body.pos)).toBeGreaterThan(body.radius)
  })

  /**
   * «Подлети ко мне» — к ЖИВОМУ игроку, а не к нав-цели. Отдельный примитив: раньше такого
   * приказа не было, и на просьбу бот брал `approach-nav` и улетал мимо игрока к станции.
   */
  it('«ко мне» ведёт живого игрока и ДЕРЖИТСЯ рядом, а не снимается по прибытии', () => {
    const { world, bot } = withCompanion()
    world.player.state.pos.set(0, 0, 0)
    bot.state.pos.set(0, 0, 6000)

    assignRendezvous(bot, world.player.id, 220)
    const first = stepTasks(bot, world)!
    expect(first.target.distanceTo(world.player.state.pos)).toBe(0)

    // Игрок улетел — цель следует за ним, а не остаётся в старой точке.
    world.player.state.pos.set(5000, 0, 0)
    expect(stepTasks(bot, world)!.target.distanceTo(world.player.state.pos)).toBe(0)

    // Долетел — поручение НЕ снимается: иначе бот уходит в свои дела, и это выглядит как
    // «подлетел и пролетел мимо». Держится рядом, пока не отставят.
    bot.state.pos.copy(world.player.state.pos)
    expect(stepTasks(bot, world)).not.toBeNull()
    expect(hasTask(bot)).toBe(true)

    // «Отставить» — единственный законный выход.
    clearTasks(bot)
    expect(stepTasks(bot, world)).toBeNull()
  })

  /**
   * Интеграция: компаньон честно набивает трюм по поручению — тем же правилом подбора,
   * что игрок (`stepScooping`). Не «числа сходятся», а само поведение: дали задачу — трюм
   * пополнился, значит бот долетел, собрал и это засчиталось миром.
   */
  it('по поручению бот долетает до груза и кладёт его в трюм', () => {
    const { world, bot } = withCompanion()
    bot.state.pos.set(0, 0, 0)
    bot.state.vel.set(0, 0, 0)
    world.player.state.pos.set(0, 0, 600)

    // Пара контейнеров у бота под носом (нос смотрит в −Z у стартовой позы).
    spawnOrePod(world, new Vector3(0, 0, -120), new Vector3(), 1)
    spawnOrePod(world, new Vector3(0, 0, -260), new Vector3(), 1)
    const before = bot.hold.items.length

    // Бота ведёт его пилот-бот: кладём aiController в мапу под его id (в бою так же).
    const controllers = new Map([[bot.id, aiController]])
    assignCollectRun(bot, new Vector3(0, 0, -190), 1000)
    for (let i = 0; i < 60 * 40 && world.pods.length > 0; i++) stepWorld(world, 1 / 60, controllers)

    expect(bot.hold.items.length).toBeGreaterThan(before) // груз реально в трюме
  })
})
