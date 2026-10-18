import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { veteranWorld } from '../../testkit'
import { CALENDAR_DAY } from '../../config/contracts'
import { COPILOT, RANK } from '../../config/crew'
import { STARTER_SYSTEM, residentAcquaintances, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { applyCommand } from '../dialogue/commandBus'
import { parseModelReply } from '../dialogue/modelReply'
import { continueAutofight } from '../ai/autofight'
import { repairCost } from '../station/repair'
import { replaceInstalled, withFault, moduleFault } from '../station/moduleState'
import { refreshSpec } from '../world/factory'
import {
  copilotAttack,
  copilotCollect,
  copilotRepair,
  copilotRepairDiscount,
  copilotRepairQuote,
  copilotRepairLuck,
  copilotSalary,
  hireCopilot,
  stepCrew,
} from './copilot'
import { awardKillXp, botRank, killXp, rankOfXp, rankSkill, xpForRank } from './rank'
import { copilotBriefing } from './briefing'

/**
 * Второй пилот и ранги. Без рендера: найм, жалованье, ремонт и приказы — чистый домен.
 * Проверяем свойства («ас чинит дешевле и полнее»), а не числа конфига.
 */

function setup(faction: 'neutral' | 'hostile' = 'neutral'): { world: World; ship: ShipEntity } {
  const world = veteranWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -400], spread: 0, faction, name: 'Пилот' }],
  })
  world.calendarTime = 10_000
  const ship = world.ships[0]!
  ship.rank = 8
  // Рядом с игроком: точки патрулей в системе абсолютные, а игрок стоит у своей планеты.
  ship.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -400))
  return { world, ship }
}

function hired(rank = 8): World {
  const { world, ship } = setup()
  ship.rank = rank
  world.player.rank = rank
  expect(hireCopilot(world, ship)).toBeNull()
  return world
}

describe('ранги', () => {
  it('опыт растёт — ранг только улучшается (число падает), порог ранга даёт ровно его', () => {
    let prev: number = RANK.WORST
    for (let xp = 0; xp <= 4000; xp += 5) {
      const r = rankOfXp(xp)
      expect(r).toBeLessThanOrEqual(prev)
      prev = r
    }
    for (let r = RANK.WORST; r >= RANK.BEST; r--) expect(rankOfXp(xpForRank(r))).toBe(r)
  })

  it('лучший ранг — выше выучка: быстрее реакция и кучнее стрельба', () => {
    for (let r = RANK.WORST; r > RANK.BEST; r--) expect(rankSkill(r - 1)).toBeGreaterThan(rankSkill(r))
  })

  it('ранг бота от имени детерминирован и лежит в 1..10', () => {
    for (const name of ['Ада', 'Борис', 'Зет-7', 'Кхар']) {
      const r = botRank(name, 'hostile')
      expect(r).toBe(botRank(name, 'hostile'))
      expect(r).toBeGreaterThanOrEqual(RANK.BEST)
      expect(r).toBeLessThanOrEqual(RANK.WORST)
    }
  })

  it('за аса опыта больше, чем за новичка; опыт идёт игроку и второму пилоту', () => {
    const world = hired()
    const victim = world.ships[0] ?? world.player
    victim.rank = 1
    const ace = killXp(victim)
    victim.rank = 10
    expect(ace).toBeGreaterThan(killXp(victim))

    const before = world.copilot!.xp
    world.pilotXp = 0
    victim.rank = 1
    awardKillXp(world, victim)
    expect(world.pilotXp).toBe(ace)
    expect(world.copilot!.xp).toBe(before + ace)
    expect(world.player.rank).toBe(rankOfXp(ace))
  })
})

describe('найм второго пилота', () => {
  it('нанятый платит первый месяц вперёд, его борт уходит, в трафике он не воскресает', () => {
    const { world, ship } = setup()
    const before = world.credits
    expect(hireCopilot(world, ship)).toBeNull()
    expect(world.credits).toBe(before - copilotSalary(8))
    expect(world.copilot?.name).toBe(ship.pilotName)
    expect(ship.warpedOut || ship.warpDeparting).toBeTruthy()
    // Знакомство в этой системе, но он у тебя в кабине — не житель радара.
    world.ships.length = 0
    expect(residentAcquaintances(world).some((a) => a.id === world.copilot!.acquaintanceId)).toBe(false)
  })

  it('ас не пойдёт к новичку: лучше своего ранга больше чем на HIRE_MARGIN не нанять', () => {
    const { world, ship } = setup()
    world.player.rank = RANK.WORST
    ship.rank = RANK.WORST - COPILOT.HIRE_MARGIN - 1
    expect(hireCopilot(world, ship)).toBe('rank')
    ship.rank = RANK.WORST - COPILOT.HIRE_MARGIN
    expect(hireCopilot(world, ship)).toBeNull()
  })

  it('нечем заплатить за месяц — не идёт; враг вторым пилотом не бывает', () => {
    const { world, ship } = setup()
    world.credits = copilotSalary(ship.rank) - 1
    expect(hireCopilot(world, ship)).toBe('money')
    const hostile = setup('hostile')
    expect(hireCopilot(hostile.world, hostile.ship)).toBe('hostile')
  })

  it('найм словами: бот согласился (crew: join) — шина нанимает и кончает разговор', () => {
    const { world, ship } = setup()
    const reply = parseModelReply({ reply: 'Иду к тебе.', crew: 'join' }, [], 'bot')!
    const out = applyCommand(world, ship, reply.commands.find((c) => c.action === 'crew')!)
    expect(world.copilot).not.toBeNull()
    expect(out?.ends).toBe(true)
  })
})

describe('жалованье', () => {
  it('раз в игровой месяц списывается; нечем платить — пилот уходит с вестью', () => {
    const world = hired()
    const salary = copilotSalary(8)
    const month = COPILOT.MONTH_DAYS * CALENDAR_DAY
    const before = world.credits
    world.calendarTime += month * 0.5
    stepCrew(world)
    expect(world.credits).toBe(before)
    world.calendarTime += month * 0.6
    stepCrew(world)
    expect(world.credits).toBe(before - salary)

    world.credits = salary - 1
    world.calendarTime += month
    stepCrew(world)
    expect(world.copilot).toBeNull()
    expect(world.notices.some((n) => n.kind === 'copilot-quit')).toBe(true)
  })
})

describe('ремонт в полёте', () => {
  it('за детали дешевле мастерской, и чем выше ранг — тем дешевле и надёжнее', () => {
    for (let r = RANK.WORST; r >= RANK.BEST; r--) {
      expect(copilotRepairDiscount(r)).toBeGreaterThan(0)
      if (r < RANK.WORST) {
        expect(copilotRepairDiscount(r)).toBeGreaterThan(copilotRepairDiscount(r + 1))
        expect(copilotRepairLuck(r)).toBeGreaterThanOrEqual(copilotRepairLuck(r + 1))
      }
    }
    // Средняя скидка по шкале — около сорока процентов, как задумано.
    let sum = 0
    for (let r = RANK.WORST; r >= RANK.BEST; r--) sum += copilotRepairDiscount(r)
    expect(sum / 10).toBeCloseTo(0.4, 1)
  })

  it('корпус: полная починка дешевле мастерской, опытный чинит начисто', () => {
    const world = hired(5)
    world.player.hull = world.player.spec.hull.hull * 0.5
    const station = repairCost(world.player)
    expect(copilotRepairQuote(world, { kind: 'hull' })!.price).toBeLessThan(station)
    expect(copilotRepair(world, { kind: 'hull' }).result).toBe('repaired')
    expect(world.player.hull).toBe(world.player.spec.hull.hull)
  })

  // Пойманное: «доля за раз» чинила 100 → 40 → 16 → 6… без конца. Бросок может не довести
  // до нуля, но второй подход добивает наверняка — до нуля за один-два подхода, при любом броске.
  it('новичок доводит до нуля за один-два подхода, при любой поломке', () => {
    for (let k = 0; k < 40; k++) {
      const world = hired(10)
      world.galaxySeed = 1000 + k
      const module = world.player.loadout.internals[0]!
      replaceInstalled(world.player, module, withFault(module, 0.3 + (k % 7) * 0.1))
      refreshSpec(world.player)
      for (let pass = 0; pass < 2; pass++) {
        const broken = world.player.loadout.internals[0]!
        if (moduleFault(broken) <= 0) break
        copilotRepair(world, { kind: 'module', module: broken })
      }
      expect(moduleFault(world.player.loadout.internals[0]!)).toBe(0)
    }
  })

  it('недочинил — взял меньше, чем за полную починку', () => {
    let seen = false
    for (let k = 0; k < 40 && !seen; k++) {
      const world = hired(10)
      world.galaxySeed = 2000 + k
      world.player.hull = world.player.spec.hull.hull * 0.2
      const full = copilotRepairQuote(world, { kind: 'hull' })!.price
      const r = copilotRepair(world, { kind: 'hull' })
      if (r.result !== 'partial') continue
      seen = true
      expect(r.spent).toBeLessThan(full)
      expect(r.left).toBeGreaterThan(0)
    }
    expect(seen).toBe(true)
  })
})

describe('приказы словами', () => {
  // Пойманное: игрок сказал «отбой», модель поставила dismiss — и пилот молча сошёл с борта.
  // Расчёт теперь только вторым словом, а сошедший остаётся в системе знакомым.
  it('расчёт — только после переспроса; уволенный остаётся в системе бортом', () => {
    const world = hired()
    const id = world.copilot!.acquaintanceId
    const first = applyCommand(world, world.player, { action: 'copilot', payload: { order: 'dismiss' } })
    expect(first?.spoken?.key).toBe('copilotDismissConfirm')
    expect(world.copilot).not.toBeNull()
    // Другой приказ между ними — значит, не увольнял: вопрос снят.
    applyCommand(world, world.player, { action: 'copilot', payload: { order: 'stop' } })
    applyCommand(world, world.player, { action: 'copilot', payload: { order: 'dismiss' } })
    expect(world.copilot).not.toBeNull()
    const second = applyCommand(world, world.player, { action: 'copilot', payload: { order: 'dismiss' } })
    expect(second?.line?.key).toBe('copilotDismissed')
    expect(world.copilot).toBeNull()
    expect(world.ships.some((s) => s.alive && s.acquaintanceId === id)).toBe(true)
  })

  it('модель вытащила «бей всех» — у второго пилота это команда, у обычного бота — нет', () => {
    const copilot = parseModelReply({ reply: 'Есть!', attack: 'all', collect: true }, [], 'copilot')!
    expect(copilot.commands.map((c) => c.action)).toEqual(['copilot', 'copilot'])
    const bot = parseModelReply({ reply: 'Есть!', attack: 'all' }, [], 'bot')!
    expect(bot.commands.some((c) => c.action === 'copilot')).toBe(false)
  })

  it('«бей всех», а врагов на локаторе нет — пилот говорит правду, а не «есть»', () => {
    const world = hired()
    world.ships.length = 0
    const out = applyCommand(world, world.player, { action: 'copilot', payload: { order: 'attack', target: 'all' } })
    expect(out?.spoken?.key).toBe('copilotNoFoes')
    expect(world.player.ai).toBeNull()
  })

  it('в бою штурвал у второго пилота: выучка автобоя — его ранг', () => {
    const { world, ship } = setup('hostile')
    // Пират — враг, но нанимаем другого: подставим второго пилота напрямую.
    world.copilot = { acquaintanceId: -1, name: 'Ян', persona: { ...world.player.persona }, xp: xpForRank(3), paidUntil: 1e12 }
    expect(copilotAttack(world, 'nearest')).toBe('ok')
    expect(world.player.ai?.pilotRank).toBe(3)
    expect(world.player.ai?.orderedTargetId).toBe(ship.id)
  })

  it('«собери контейнеры» держит штурвал, пока поручение не исполнено', () => {
    const world = hired()
    world.pods.push({ id: 999, alive: true, pos: world.player.state.pos.clone().setX(300) } as never)
    expect(copilotCollect(world)).toBe('ok')
    expect(continueAutofight(world)).toBe(true)
    world.player.ai!.tasks.length = 0
    expect(continueAutofight(world)).toBe(false)
    expect(world.player.ai).toBeNull()
  })

  it('сводка нумерует сломанные детали — «почини второе» ссылается на неё', () => {
    const world = hired(5)
    const module = world.player.loadout.internals[0]!
    replaceInstalled(world.player, module, withFault(module, 0.5))
    refreshSpec(world.player)
    const brief = copilotBriefing(world)!
    expect(brief.broken[0]?.n).toBe(1)
    const out = applyCommand(world, world.player, { action: 'copilot', payload: { order: 'repair', target: 1 } })
    expect(out?.line?.key).toBe('copilotRepaired')
    expect(copilotBriefing(world)!.broken).toHaveLength(0)
  })
})
