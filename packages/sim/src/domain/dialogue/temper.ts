import { DIALOGUE } from '../../config/dialogue'
import { WARP } from '../../config/ai'
import { clamp } from '../../core/math'
import { healthFraction, shieldFraction } from '../combat/damage'
import { defuseGrievance, escalateToHostile } from '../combat/grievance'
import { assessThreat } from '../combat/threat'
import { isBerthed } from '../combat/cloak'
import type { ShipEntity, World } from '../world/entities'
import type { Persona } from '../world/persona'

/**
 * НРАВ В РАЗГОВОРЕ: что делает собеседник, когда ему грубят, грозят, льстят или извиняются.
 *
 * Раньше реакцию угадывала языковая модель — в той же реплике, где писала ответ, и ДО того,
 * как мир что-то посчитал. Бот, которому сказали «я тебя убью», продолжал торговать: модель
 * не пометила угрозу, домен ничего не узнал, а цена найма висела в промпте у самого текста.
 *
 * Теперь путь один: «реплика → речевой акт → реакция → ответ».
 *  - Модель лишь РАСПОЗНАЁТ акт (`act` в JSON) — закрытый список ниже.
 *  - Реакцию считает домен по нраву и обстановке (`reactionTo`) — детерминированно.
 *  - Таблица реакций на все акты кладётся в промпт ЗАРАНЕЕ (`reactionCard`): ответ модели
 *    сразу в характере, и это всё ещё один запрос.
 *  - После ответа домен применяет реакцию (`react`), что бы модель ни написала: слова и
 *    мир не расходятся.
 *
 * Новый акт или новая реакция — строка в таблицах, а не `if` в парсере.
 */

/** Что игрок СДЕЛАЛ словами — то, что домен из текста не вычленит сам. */
export type SpeechAct = 'threat' | 'insult' | 'flatter' | 'apology'

export const SPEECH_ACTS: readonly SpeechAct[] = ['threat', 'insult', 'flatter', 'apology']

/**
 * Что собеседник делает в ответ.
 *  - `bristle` — огрызается и предупреждает, но разговор не рвёт (насторожён, услуг не продаёт).
 *  - `flee` — не связывается: уходит в отрыв и, если есть привод, прыжком.
 *  - `fight` — принимает вызов: враг, берёт обидчика на прицел.
 *  - `soften` — оттаивает: напряжение и обида гаснут.
 */
export type Reaction = 'bristle' | 'flee' | 'fight' | 'soften'

/** Насколько акт двигает напряжённость. Данные, а не ветки. */
const ACT_WEIGHT: Record<SpeechAct, number> = {
  threat: DIALOGUE.TENSION.THREAT,
  insult: DIALOGUE.TENSION.INSULT,
  flatter: DIALOGUE.TENSION.FLATTER,
  apology: DIALOGUE.TENSION.APOLOGY,
}

export function coerceSpeechAct(v: unknown): SpeechAct | null {
  return typeof v === 'string' && (SPEECH_ACTS as readonly string[]).includes(v) ? (v as SpeechAct) : null
}

/** Полное здоровье: щит и корпус вместе. Именно его и видит собеседник. */
export const vigour = (e: ShipEntity): number => (shieldFraction(e) + healthFraction(e)) / 2

/**
 * Стойкость собеседника −1..+1: насколько он НЕ склонен сломаться. Волевой и
 * храбрый держится (плюс), трус и слабовольный подаётся (минус). Двигает шансы
 * сдачи и сопротивления — честно характером, а не заниженным здоровьем.
 */
export function nerve(p: Persona): number {
  const will = (p.willpower - 3) / 2 // 1..5 → −1..+1
  const grit = p.disposition === 'brave' ? 0.5 : p.disposition === 'cowardly' ? -0.5 : 0
  return clamp(will + grit, -1, 1)
}

/**
 * Решимость на разрыве: стойкость + перевес сил + вспыльчивость. Больше нуля — примет бой,
 * меньше — уйдёт. Перевес — по той же оценке угрозы, что показывает локатор (`assessThreat`),
 * с поправкой на то, насколько каждый сейчас цел: избитый храбрец тоже думает о шкуре.
 */
function resolve(world: World, ship: ShipEntity): number {
  const player = world.player
  const mine = assessThreat(ship, player).score * (0.5 + vigour(ship) / 2)
  const theirs = assessThreat(player, ship).score * (0.5 + vigour(player) / 2)
  const odds = Math.log2(Math.max(mine, 1e-3) / Math.max(theirs, 1e-3))
  const temper = (ship.persona.temperament - 3) / 2 // 1..5 → −1..+1
  return nerve(ship.persona) + odds * DIALOGUE.ODDS_SWING + temper * DIALOGUE.TEMPER_SWING
}

/**
 * Реакция на акт ПРИ ТЕКУЩЕМ состоянии — чистая функция, мир не трогает. Её же видит модель
 * (`reactionCard`), и её же исполняет `react`: прочитанное в промпте и случившееся совпадают.
 */
export function reactionTo(world: World, ship: ShipEntity, act: SpeechAct): Reaction {
  const weight = ACT_WEIGHT[act]
  if (weight <= 0) return 'soften'
  // Богу угрозы смертного не страшны: он не бежит и не дерётся — лишь холодеет.
  if (ship.divine) return 'bristle'
  const tension = (ship.ai?.tension ?? 0) + weight
  if (tension < DIALOGUE.TENSION.BREAK_AT) return 'bristle'
  // У причала ни драться, ни удирать некуда: станция под охраной, борт внутри.
  if (isBerthed(ship) || world.docked) return 'bristle'
  // Уже враг — угрозы ему не новость: он и так дерётся (или уже бежит).
  if (ship.faction === 'hostile') return 'bristle'
  return resolve(world, ship) >= 0 ? 'fight' : 'flee'
}

/** Таблица «акт → реакция» на эту реплику — для промпта. */
export function reactionCard(world: World, ship: ShipEntity): Record<SpeechAct, Reaction> {
  return {
    threat: reactionTo(world, ship, 'threat'),
    insult: reactionTo(world, ship, 'insult'),
    flatter: reactionTo(world, ship, 'flatter'),
    apology: reactionTo(world, ship, 'apology'),
  }
}

/** Уйти от обидчика: отрыв, огонь гаснет, есть привод — заряд прыжка-побега. */
export function startFleeing(ship: ShipEntity): void {
  const ai = ship.ai
  if (!ai) return
  ai.mode = 'evade'
  ai.targetId = null
  ai.wantsFire = false
  ai.wantsMissile = false
  ai.escortOf = null
  if (ship.spec.jumpRange > 0 && ai.warpTimer < 0) ai.warpTimer = WARP.CHARGE
}

/**
 * Исполнить реакцию на акт: сдвинуть напряжённость и сделать то, что решил нрав.
 * Возвращает реакцию — по ней лента и разговор (разрыв кончает беседу).
 *
 * Оферту разрыв снимает: тому, кто грозит убить или с кем дерёшься, дел не поручают.
 */
export function react(world: World, ship: ShipEntity, act: SpeechAct): Reaction {
  const reaction = reactionTo(world, ship, act)
  const ai = ship.ai
  if (!ai) return reaction
  ai.tension = Math.max(0, ai.tension + ACT_WEIGHT[act])
  switch (reaction) {
    case 'soften':
      defuseGrievance(ship)
      break
    case 'bristle':
      break
    case 'flee':
      startFleeing(ship)
      withdrawOffer(world, ship)
      break
    case 'fight':
      escalateToHostile(world, ship)
      withdrawOffer(world, ship)
      break
  }
  return reaction
}

/** Снять оферту молча: это не отказ командира (тот журналится в `declineOffer`), а разрыв. */
function withdrawOffer(world: World, ship: ShipEntity): void {
  ship.offer = null
  if (world.offerHailShipId === ship.id) world.offerHailShipId = null
}

/** Разговорное напряжение остывает в такте — темп в секундах, от частоты кадров не зависит. */
export function stepTension(world: World, dt: number): void {
  const decay = DIALOGUE.TENSION.DECAY * dt
  for (const ship of world.ships) {
    const ai = ship.ai
    if (ai && ai.tension > 0) ai.tension = Math.max(0, ai.tension - decay)
  }
}
