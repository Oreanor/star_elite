import { describe, expect, it } from 'vitest'
import { DIALOGUE } from '../../config/dialogue'
import { GRIEVANCE } from '../../config/ai'
import { COMMODITIES } from '../cargo'
import { addCommodity } from '../cargo/hold'
import { createAIState } from '../ai/types'
import { rememberPilot } from '../world/acquaintance'
import { DEFAULT_PERSONA } from '../world/persona'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { applyOutcome, applySocial, escortFee, interlocutor, linesFor, moodTo, say } from './dialogue'

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
  // Нейтральная персона (воля 3, расчётливый) → nerve=0: границы шансов считаются
  // от здоровья, как и раньше. Нрав/волю проверяем отдельно, задавая персону явно.
  other.persona = { ...DEFAULT_PERSONA }
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
  it('говорить можно с любым захваченным живым — дистанция не важна (связь по радио)', () => {
    const { world, other } = withShip('hostile')
    expect(interlocutor(world)?.id).toBe(other.id)

    world.lockedTargetId = null
    expect(interlocutor(world)).toBeNull()

    // Далеко — не помеха: захватил и говоришь, хоть за полсистемы.
    world.lockedTargetId = other.id
    other.state.pos.set(0, 0, -(DIALOGUE.RANGE + 5000))
    expect(interlocutor(world)?.id).toBe(other.id)

    // А вот с мёртвым — не поговорить.
    other.alive = false
    expect(interlocutor(world)).toBeNull()
  })

  it('пирату предлагают одно, торговцу другое', () => {
    const pirate = withShip('hostile')
    expect(linesFor(pirate.world, pirate.other).map((l) => l.topic)).toEqual(['surrender', 'mercy'])

    const trader = withShip('neutral')
    expect(linesFor(trader.world, trader.other).map((l) => l.topic)).toEqual(['escort', 'plunder', 'greet'])
  })

  /**
   * В доке станции реакции «из боя» отпадают: ты под охраной, вокруг закон. Грабёж
   * (`plunder`) и требования уходят, остаётся мирный разговор — иначе у причала
   * торговцу предлагали бы «сбрось груз и оружие», что абсурдно. Регрессия: заметили
   * ровно это — угрозу из боя в мирном доке.
   */
  it('на станции нет боевых реакций — только мирный разговор', () => {
    const trader = withShip('neutral')
    trader.world.docked = true
    expect(linesFor(trader.world, trader.other).map((l) => l.topic)).toEqual(['escort', 'greet'])

    const pirate = withShip('hostile')
    pirate.world.docked = true
    // У пирата обе реплики боевые — в доке не остаётся ничего механического.
    expect(linesFor(pirate.world, pirate.other)).toEqual([])
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

  /**
   * Свободный чат: согласие принял характер собеседника (через модель), не кость.
   * `applyOutcome` меняет мир ровно как кнопка, но без броска — и всё равно
   * стережёт жёсткие правила домена.
   */
  describe('исход без броска (чат)', () => {
    it('избитый пират сдаётся без всякого броска', () => {
      const { world, other } = withShip('hostile')
      other.hull = other.spec.hull.hull * 0.5 // не >99%, значит реплика не заблокирована
      // Бросок гарантированно провалил бы кнопку, но чат кости не кидает.
      rig(world, 1)
      expect(applyOutcome(world, other, 'surrender')).toBe(true)
      expect(other.faction).toBe('neutral')
    })

    it('невредимого пирата не уговорить и словами: домен стережёт', () => {
      const { world, other } = withShip('hostile') // полный корпус → surrender заблокирован
      expect(applyOutcome(world, other, 'surrender')).toBe(false)
      expect(other.faction).toBe('hostile')
    })

    it('эскорт словами всё равно требует денег вперёд', () => {
      const poor = withShip('neutral')
      poor.world.credits = DIALOGUE.ESCORT_FEE - 1
      expect(applyOutcome(poor.world, poor.other, 'escort')).toBe(false)

      const rich = withShip('neutral')
      rich.world.credits = DIALOGUE.ESCORT_FEE + 50
      expect(applyOutcome(rich.world, rich.other, 'escort')).toBe(true)
      expect(rich.world.credits).toBe(50)
      expect(rich.other.ai?.escortOf).toBe(rich.world.player.id)
    })

    it('разбой словами берёт даже целого торговца: не только с позиции силы', () => {
      const { world, other } = withShip('neutral') // невредим — кнопка послала бы
      other.hold.capacity = 10
      addCommodity(other.hold, COMMODITIES.FOOD, 2)
      expect(applyOutcome(world, other, 'plunder')).toBe(true)
      expect(other.hold.items.length).toBe(0)
      expect(other.loadout.weapons.every((w) => w === null)).toBe(true)
    })
  })

  /**
   * Движок отношений — В ДОМЕНЕ. Настроение считается из данных (фракция, претензия,
   * память знакомства), реакции читают его, а угроза словом двигает отношение ровно
   * как выстрел. Языковая модель тут не участвует: её дело — разнообразить слова.
   */
  describe('движок отношений', () => {
    it('настроение читается из фракции, претензии и памяти', () => {
      const enemy = withShip('hostile')
      expect(moodTo(enemy.world, enemy.other)).toBe('hostile')

      const t = withShip('neutral')
      expect(moodTo(t.world, t.other)).toBe('neutral')

      // Открытая претензия — насторожён, даже если ещё нейтрал.
      t.other.ai = createAIState(t.other.state.pos, t.world.rng)
      t.other.ai.grievance = 1
      expect(moodTo(t.world, t.other)).toBe('wary')

      // Память знакомства перебивает нейтраль в обе стороны.
      t.other.ai.grievance = 0
      rememberPilot(t.world, t.other)
      const rec = t.world.acquaintances.find((a) => a.id === t.other.acquaintanceId)!
      rec.relationship = 'friendly'
      expect(moodTo(t.world, t.other)).toBe('warm')
      rec.relationship = 'hostile'
      expect(moodTo(t.world, t.other)).toBe('hostile')
    })

    /**
     * Суть жалобы: послал грабителя — а на «привет» желает чистого неба. Теперь тон
     * приветствия следует за настроением, а не живёт сам по себе.
     */
    it('приветствие меняет тон по настроению, а не желает всем доброго пути', () => {
      const { world, other } = withShip('neutral')
      expect(say(world, other, 'greet')).toEqual({ text: 'ЧИСТОГО НЕБА, ПИЛОТ.', agreed: true })

      // Пригрозили — стал насторожен, и «привет» уже не радушный.
      other.ai = createAIState(other.state.pos, world.rng)
      other.ai.grievance = 1
      expect(say(world, other, 'greet').agreed).toBe(false)
    })

    /**
     * Требование груза к целому торговцу — угроза: он копит претензию тем же счётчиком,
     * что и попадания, и на пороге встаёт на бой честно. Слова провоцируют так же, как выстрел.
     */
    it('повторная угроза грабежом переводит нейтрала во враги', () => {
      const { world, other } = withShip('neutral')
      other.ai = createAIState(other.state.pos, world.rng) // обижаться может лишь борт с ИИ

      // THREAT_WEIGHT=2, HOSTILE_HITS=4 → две наглые попытки, и он враг.
      const need = Math.ceil(GRIEVANCE.HOSTILE_HITS / DIALOGUE.THREAT_WEIGHT)
      for (let i = 0; i < need - 1; i++) {
        expect(say(world, other, 'plunder').agreed).toBe(false)
        expect(other.faction).toBe('neutral') // ещё терпит, но уже насторожён
        expect(moodTo(world, other)).toBe('wary')
      }
      say(world, other, 'plunder')
      expect(other.faction).toBe('hostile')
    })

    /**
     * Стойкость характера двигает исход честно: волевой храбрец держится там, где
     * трус ломается, — при одном и том же здоровье и одном и том же броске.
     */
    it('волевой храбрец сдаётся реже труса при равном уроне', () => {
      const brave = withShip('hostile')
      brave.other.hull = brave.other.spec.hull.hull * 0.5
      brave.other.persona = { ...DEFAULT_PERSONA, disposition: 'brave', willpower: 5 }

      const coward = withShip('hostile')
      coward.other.hull = coward.other.spec.hull.hull * 0.5
      coward.other.persona = { ...DEFAULT_PERSONA, disposition: 'cowardly', willpower: 1 }

      // Один бросок 0.5: по здоровью шанс 0.45; нрав уводит его в разные стороны.
      rig(brave.world, 0.5)
      rig(coward.world, 0.5)
      expect(say(brave.world, brave.other, 'surrender').agreed).toBe(false)
      expect(say(coward.world, coward.other, 'surrender').agreed).toBe(true)
    })

    /**
     * Соц-тон распознаёт модель, а следствие считает движок: оскорбление копит обиду
     * тем же счётчиком (повторишь — враг и эскорт врозь), лесть её гасит. Дружбы лесть
     * не даёт — расположить можно делом, не словом.
     */
    it('оскорбление копит обиду и рвёт эскорт, лесть её гасит', () => {
      const { world, other } = withShip('neutral')
      other.ai = createAIState(other.state.pos, world.rng)
      other.ai.escortOf = world.player.id // как будто нанят

      // INSULT_WEIGHT=2, HOSTILE_HITS=4 → два оскорбления, и он враг, эскорт отменён.
      applySocial(world, other, 'insult')
      expect(other.faction).toBe('neutral')
      expect(moodTo(world, other)).toBe('wary')
      applySocial(world, other, 'insult')
      expect(other.faction).toBe('hostile')
      expect(other.ai.escortOf).toBeNull() // договорённость отменилась сама

      // Лесть гасит открытую претензию (успокаивает насторожённого), но не роднит.
      const t = withShip('neutral')
      t.other.ai = createAIState(t.other.state.pos, t.world.rng)
      t.other.ai.grievance = 1
      applySocial(t.world, t.other, 'flatter')
      expect(t.other.ai.grievance).toBe(0)
      expect(moodTo(t.world, t.other)).toBe('neutral') // не подружились, просто отпустило
    })

    /**
     * Наём — это ТОРГ: цену двигает нрав, а согласие — отношение. Жадный дерёт больше;
     * обиженный не наймётся ни за какие деньги, пока не помиришься. Договор = цена И согласие.
     */
    it('наём — торг: жадный дерёт больше, обиженный не идёт вовсе', () => {
      const greedy = withShip('neutral')
      greedy.other.persona = { ...DEFAULT_PERSONA, disposition: 'greedy' }
      const fee = escortFee(greedy.world, greedy.other)!
      expect(fee).toBeGreaterThan(DIALOGUE.ESCORT_FEE)
      // Ценник в реплике — торгованный, не базовый.
      expect(linesFor(greedy.world, greedy.other).find((l) => l.topic === 'escort')!.say).toContain(String(fee))

      // Насторожённый (ты ему грозил) не наймётся даже при полном кошельке.
      const wary = withShip('neutral')
      wary.other.ai = createAIState(wary.other.state.pos, wary.world.rng)
      wary.other.ai.grievance = 1
      wary.world.credits = 1_000_000
      expect(escortFee(wary.world, wary.other)).toBeNull()
      expect(linesFor(wary.world, wary.other).find((l) => l.topic === 'escort')!.blocked).not.toBeNull()
      expect(say(wary.world, wary.other, 'escort').agreed).toBe(false)
    })
  })
})
