import { describe, expect, it } from 'vitest'
import { DIALOGUE } from '../../config/dialogue'
import { createAIState } from '../ai/types'
import type { ContractOffer } from '../contracts/types'
import { DEFAULT_PERSONA } from '../world/persona'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { escortFee, moodTo } from './dialogue'
import { applyCommand } from './commandBus'
import { react, reactionCard, reactionTo, stepTension } from './temper'

/**
 * Нрав в разговоре: реплика → речевой акт → реакция. Проверяем свойства, а не числа: угроза
 * рвёт разговор, хамство — не с первого раза, трус бежит там, где храбрец дерётся, прочитанное
 * моделью совпадает с исполненным, и словесная обида остывает разговорным темпом.
 */

function neutralShip(): { world: World; other: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -2000], spread: 0, faction: 'neutral', name: 'Кто-то' }],
  })
  const other = world.ships[0]!
  other.ai = createAIState(other.state.pos, world.rng)
  other.persona = { ...DEFAULT_PERSONA }
  world.docked = false
  return { world, other }
}

/** Бот на таком же корабле, что и игрок: сравниваем нрав, а не железо. */
function evenShip(): { world: World; other: ShipEntity } {
  const t = neutralShip()
  t.other.spec = t.world.player.spec
  t.other.hull = t.other.spec.hull.hull
  t.other.shield = t.other.spec.hull.shield
  return t
}

/** Решимость в крайностях: трус и слабак против храбреца на взводе. */
const COWARD = { ...DEFAULT_PERSONA, disposition: 'cowardly' as const, willpower: 1, temperament: 1 }
const HOTHEAD = { ...DEFAULT_PERSONA, disposition: 'brave' as const, willpower: 5, temperament: 5 }

describe('нрав в разговоре', () => {
  /**
   * Пойманный баг: бот, которому сказали «я тебя убью», продолжал предлагать услуги — угроза
   * ничего не меняла в мире. Теперь угроза — разрыв с первого раза: бегство или бой.
   */
  it('угроза рвёт разговор сразу: бот уходит или становится врагом', () => {
    const { world, other } = neutralShip()
    const reaction = react(world, other, 'threat')
    expect(['flee', 'fight']).toContain(reaction)
    if (reaction === 'fight') expect(other.faction).toBe('hostile')
    else expect(other.ai!.mode).toBe('evade')
  })

  /**
   * Слабость честная — характером и силой, а не броском: трус бежит, храбрец на взводе дерётся.
   * Корабли уравнены: в тестовом мире у бота «Икар» (угроза 0.48) против вооружённой «Ники»
   * игрока (3.28) — всемеро слабее, и от такого уходит и храбрец. Это честно, но проверяем нрав.
   */
  it('трус уходит, храбрец принимает бой — при равных кораблях', () => {
    const coward = evenShip()
    coward.other.persona = COWARD
    expect(reactionTo(coward.world, coward.other, 'threat')).toBe('flee')

    const hothead = evenShip()
    hothead.other.persona = HOTHEAD
    expect(reactionTo(hothead.world, hothead.other, 'threat')).toBe('fight')
  })

  /** Перевес сил двигает решение: избитого командира не боятся. */
  it('против избитого командира решимости больше', () => {
    const a = neutralShip()
    const b = neutralShip()
    b.world.player.hull = b.world.player.spec.hull.hull * 0.05
    b.world.player.shield = 0
    const resolveA = reactionTo(a.world, a.other, 'threat')
    const resolveB = reactionTo(b.world, b.other, 'threat')
    // Если бот дерётся с целым — с избитым тем более.
    if (resolveA === 'fight') expect(resolveB).toBe('fight')
  })

  it('хамство — не с первого раза: сперва насторожён, на третьем — разрыв', () => {
    const { world, other } = evenShip()
    expect(react(world, other, 'insult')).toBe('bristle')
    expect(moodTo(world, other)).toBe('wary')
    // Насторожённый услуг не продаёт: тому, кто хамит, эскорт не предлагают.
    expect(escortFee(world, other)).toBeNull()
    expect(react(world, other, 'insult')).toBe('bristle')
    expect(['flee', 'fight']).toContain(react(world, other, 'insult'))
  })

  it('лесть и извинение гасят напряжение и обиду', () => {
    const { world, other } = neutralShip()
    react(world, other, 'insult')
    other.ai!.grievance = 1
    expect(react(world, other, 'apology')).toBe('soften')
    expect(other.ai!.tension).toBe(0)
    expect(other.ai!.grievance).toBe(0)
    expect(moodTo(world, other)).toBe('neutral')
  })

  /** Таблица в промпте — та же функция, что исполняет реакцию: слова модели и мир не расходятся. */
  it('прочитанное моделью совпадает с исполненным', () => {
    const { world, other } = neutralShip()
    other.ai!.tension = 1
    const card = reactionCard(world, other)
    expect(react(world, other, 'insult')).toBe(card.insult)
  })

  it('у причала не дерутся и не бегут — только огрызаются', () => {
    const { world, other } = neutralShip()
    other.ai!.dock = 'berthed'
    other.persona = HOTHEAD
    expect(reactionTo(world, other, 'threat')).toBe('bristle')
    other.ai!.dock = null
    world.docked = true
    expect(reactionTo(world, other, 'threat')).toBe('bristle')
  })

  /** Тому, кто грозит убить, дел не поручают: разрыв снимает оферту. */
  it('разрыв снимает оферту бота', () => {
    const { world, other } = neutralShip()
    other.offer = { kind: 'escort' } as unknown as ContractOffer
    react(world, other, 'threat')
    expect(other.offer).toBeNull()
  })

  /**
   * Пойманный баг: словесная обида жила в счётчике попаданий — гасла за 8 с, пока игрок
   * печатал. Разговорная остывает минутами и в такте: от частоты шага не зависит.
   */
  it('напряжение остывает минутами, а не секундами боя, и не зависит от шага', () => {
    const a = neutralShip()
    const b = neutralShip()
    react(a.world, a.other, 'insult')
    react(b.world, b.other, 'insult')
    // Пока игрок пишет ответ (~20 с), бот ещё насторожён.
    for (let i = 0; i < 20 * 60; i++) stepTension(a.world, 1 / 60)
    expect(moodTo(a.world, a.other)).toBe('wary')
    // Через пару минут — отпустило.
    for (let i = 0; i < 120 * 60; i++) stepTension(a.world, 1 / 60)
    expect(moodTo(a.world, a.other)).toBe('neutral')
    // Тот же интервал крупным шагом даёт то же.
    for (let i = 0; i < 140 * 30; i++) stepTension(b.world, 1 / 30)
    expect(b.other.ai!.tension).toBeCloseTo(a.other.ai!.tension, 6)
    expect(DIALOGUE.TENSION.DECAY).toBeGreaterThan(0)
  })

  it('команда `act` из ответа модели исполняет реакцию и обрывает разговор на разрыве', () => {
    const { world, other } = neutralShip()
    other.persona = COWARD
    const out = applyCommand(world, other, { action: 'act', payload: { act: 'threat' } })
    expect(out?.reaction).toBe('flee')
    expect(out?.ends).toBe(true)
  })
})
