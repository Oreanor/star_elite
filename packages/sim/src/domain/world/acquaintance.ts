import type { Persona } from './persona'
import type { SavedLoadout } from '../save/player'
import { serializeLoadout } from '../save/player'
import type { ContactPlan } from './contactPlan'
import { emptyPlan } from './contactPlan'
import type { ShipEntity, World } from './entities'

/**
 * Память знакомств. Космос населён случайными бортами, и почти все они —
 * прохожие: родились, пролетели, растворились за горизонтом событий. Но с кем
 * ты РАЗГОВАРИВАЛ — того мир запоминает. Такого пилота можно встретить снова, и
 * тогда он тебя узнает.
 *
 * Реестр — чистые данные на мире. Переживает и гибель борта (пилот — не корабль),
 * и прыжки: знакомство привязано к системе, где случилось, а встреча повторяется
 * редко, чтобы космос не стал тесным двором. По сети синхронизируется как есть.
 *
 * Живой корабль связан с записью полем `acquaintanceId`. Незнакомец — `null`:
 * его можно спокойно удалять при чистке трафика, память о нём не заводилась.
 */

/** Как пилот относится к игроку. Итог разговоров, помнится между встречами. */
export type Relationship = 'friendly' | 'neutral' | 'hostile'

/**
 * Прошедшее СОБЫТИЕ знакомства — факт из вашей общей истории, который бот обязан
 * помнить при новой встрече: когда свиделись, о чём просил, чем менялись. Зеркало
 * очереди планов компаньона, только не «что сделать», а «что уже было»: завершённое
 * стекает СЮДА и становится памятью. Отношение (`relationship`) — «как он ко мне»,
 * а журнал — «что между нами произошло»: без него бот, только что подаривший тебе
 * денег, при следующем разговоре встречает как чужого.
 *
 * Структурой, не фразой: домен языка не знает, слова собирает ui (`facts`) при показе.
 * `at` — момент общего календаря (`world.calendarTime`), из него ui выводит порядок и дату.
 */
export type AcquaintanceEvent =
  | { kind: 'met'; at: number } // свиделись впервые
  | {
      kind: 'asked' // игрок призвал к действию, и бот согласился или отказал
      at: number
      /** id темы (`Topic`): surrender/mercy/escort/plunder/greet. Строкой — домен `world` не тянет тип из `dialogue`. */
      topic: string
      agreed: boolean
    }
  | {
      kind: 'deal' // передача добра словами
      at: number
      /** true — он передал ТЕБЕ (подарил/вернул/поделился); false — ты ему. */
      toPlayer: boolean
      credits: number
      /** Имя товара, если двигался груз (как в `TransferResult`). null — только деньги. */
      commodityName: string | null
      units: number
    }
  | { kind: 'order'; at: number; order: string } // приказ нанятому эскорту (attack/hold/…)
  | { kind: 'social'; at: number; tone: 'insult' | 'flatter' } // игрок нахамил или польстил
  | { kind: 'note'; at: number; text: string } // произвольный факт, который игрок ПОПРОСИЛ запомнить

export interface Acquaintance {
  /** Стабильный id ЗНАКОМСТВА, не корабля: корабль эфемерен, знакомство — нет. */
  id: number
  /** Личное имя пилота. Появляется в момент знакомства — до него он просто «Торговец». */
  name: string
  persona: Persona
  faction: ShipEntity['faction']
  chassisId: string
  /** Каким типом встречи он был — чтобы воссоздать ту же сборку при повторной встрече. */
  kindId: string
  /**
   * В какой системе контакт СЕЙЧАС. При знакомстве — где познакомились; дальше
   * меняется: контакт живёт своей скромной жизнью и перелетает между системами
   * (`driftContacts`). Это истина о его положении, даже когда борт физически не
   * заспаунен, — по ней вкладка «Люди» и карты знают, где он, а не где ты видел его.
   */
  systemIndex: number
  /**
   * Куда контакт направляется, индекс системы, или `null` — никуда конкретно.
   * Ставится, когда он ОБЕЩАЛ куда-то лететь или игрок его туда отправил; гаснет по
   * прибытии. Пока стоит — контакт идёт к цели, а не блуждает.
   */
  boundFor: number | null
  /**
   * Волен ли бродить сам, когда никуда не направляется. По умолчанию да: у праздного
   * контакта своя жизнь, и он изредка перелетает в соседнюю систему. «Оставайся там»
   * гасит это (`holdContact`) — тогда его всегда найдёшь на месте. Отдельно от `boundFor`:
   * «стой» и «лети в X» — разные приказы, и «стой» обязан ПРИКОЛОТЬ, а не просто «без цели».
   */
  roaming: boolean
  /** Сколько раз виделись. >1 — он тебя уже знает. */
  meetings: number
  /** Отношение к игроку по итогу бесед. Хранится тут и переносится на новую встречу. */
  relationship: Relationship
  /**
   * ЛИЧНЫЙ журнал этого знакомого: что между вами было — встречи, просьбы и их исход,
   * сделки, приказы, тон, и произвольные факты, которые игрок ПОПРОСИЛ запомнить.
   * У каждого знакомого свой, не общий. Хронологически: новое добавляем в конец.
   * Это и есть память, из которой бот при новой встрече знает, кто ты ему.
   */
  history: AcquaintanceEvent[]
  /**
   * Жив ли пилот. Знакомство переживает гибель БОРТА (пилот пересаживается), но не
   * гибель самого пилота: изредка контакт нарывается вне поля зрения (`driftContacts`)
   * или его сбивают у тебя на глазах. Мёртвый не отвечает и уходит из списка живых —
   * запись держим ради истории и чтобы не «воскресить» его повторной встречей.
   */
  alive: boolean
  /** Собственные кредиты контакта (покупки на станции). */
  credits: number
  /** Сборка и оснащение — переживает прыжки и респавн борта. */
  savedLoadout: SavedLoadout | null
  /** Исполняемый план: очередь шагов и долгоживущая поза. */
  plan: ContactPlan
  /**
   * ТВОЁ ДОБРО У НЕГО НА БОРТУ. Отдал груз без денег — значит не продал, а доверил везти;
   * запись держит, СКОЛЬКО и ЧЕГО за ним числится, пока не вернёт.
   *
   * Отдельным полем, а не «где-то в журнале»: журнал показывается моделью хвостом
   * последних событий и уходит из окна, а обязательство обязано висеть, пока не закрыто.
   * Оттого и «отвези мой груз» раньше работало лишь до тех пор, пока сделка не уехала
   * из хвоста, — дальше он честно ничего не помнил.
   *
   * Это ПАМЯТЬ, а не замок: вернуть добро он должен сам, живой передачей в разговоре.
   * Отобрать силой нечем — и не должно быть, иначе доверие ничего не стоит.
   */
  entrusted: EntrustedCargo[]
}

/** Партия доверенного груза: что и сколько. Цену не храним — она не его дело. */
export interface EntrustedCargo {
  commodityId: string
  units: number
}

/** Записать, что игрок отдал ему груз на хранение/перевозку. Одинаковый товар сливаем. */
export function entrustCargo(record: Acquaintance, commodityId: string, units: number): void {
  if (units <= 0) return
  const slot = record.entrusted.find((e) => e.commodityId === commodityId)
  if (slot) slot.units += units
  else record.entrusted.push({ commodityId, units })
}

/**
 * Списать вернувшееся. Отдал больше, чем брал (свой довесок) — уходим в ноль, а не в минус:
 * долг закрыт, а лишнее — это уже подарок, и числиться за ним оно не должно.
 */
export function releaseCargo(record: Acquaintance, commodityId: string, units: number): void {
  if (units <= 0) return
  const i = record.entrusted.findIndex((e) => e.commodityId === commodityId)
  if (i < 0) return
  const slot = record.entrusted[i]!
  slot.units -= units
  if (slot.units <= 0) record.entrusted.splice(i, 1)
}

/**
 * Запомнить пилота: игрок с ним заговорил. Идемпотентно на встречу — второй раз за
 * тот же разговор запись не плодит. В этот миг у пилота появляется имя, и оно тут же
 * ложится на локатор. Событие, не шаг физики: `rng`/`ids` двигать здесь можно.
 */
/** Метка времени для журнала: общий календарь, не локальная симуляция. */
function journalTime(world: World): number {
  return world.calendarTime
}

export function rememberPilot(world: World, ship: ShipEntity): void {
  if (ship.acquaintanceId != null) return

  // Имя не сочиняем заново — оно уже есть у пилота с рождения (`pilotName`, по виду).
  // Знакомство лишь ОТКРЫВАЕТ его игроку: до сих пор на радаре был безликий «Торговец».
  const name = ship.pilotName
  const record: Acquaintance = {
    id: world.ids.next(),
    name,
    persona: ship.persona,
    faction: ship.faction,
    chassisId: ship.loadout.chassis.id,
    kindId: ship.originKind ?? 'trader',
    systemIndex: world.systemIndex,
    boundFor: null,
    roaming: true,
    meetings: 1,
    relationship: 'neutral',
    // Первая запись журнала — сам факт знакомства: с этого момента вам есть что помнить.
    history: [{ kind: 'met', at: journalTime(world) }],
    alive: true,
    credits: 4_000 + Math.floor(world.rng() * 10_000),
    savedLoadout: serializeLoadout(ship.loadout),
    plan: emptyPlan(),
    entrusted: [],
  }
  world.acquaintances.push(record)
  ship.acquaintanceId = record.id
  // Теперь он не «Торговец», а человек с именем — и в эфире, и на метке локатора.
  ship.name = name
}

/**
 * Разговор изменил отношение. Пишем его в запись знакомства — оно переживёт встречу.
 *
 * Но МЕХАНИКУ трогаем только в одну сторону: обозлить нейтрала (нейтрал→враждебный)
 * можно кого угодно — это во вред самому игроку, эксплойта нет. А вот РАЗОРУЖИТЬ
 * враждебного дружелюбием — нельзя: иначе целого пирата уболтали бы в друзья
 * бесплатно, в обход сдачи с её условиями (сначала сбей щит). Замирение — дело
 * `applyOutcome('surrender'/'mercy')`, а не доброго слова.
 */
export function applyStance(world: World, ship: ShipEntity, stance: Relationship): void {
  const record = world.acquaintances.find((a) => a.id === ship.acquaintanceId)
  if (record) record.relationship = stance

  if (stance === 'hostile' && ship.faction === 'neutral') {
    ship.faction = 'hostile'
    if (ship.ai) {
      ship.ai.escortOf = null
      ship.ai.targetId = null
      ship.ai.orderedTargetId = null
    }
  }
}

/** Как `Omit`, но ПО КАЖДОМУ члену объединения — иначе теряются поля конкретного вида. */
type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> : never

/** Верхний предел факта-заметки, символов ≈ абзац: длиннее free-модель в промпте не удержит. */
export const NOTE_MAX_CHARS = 280

/**
 * Дописать событие в журнал ЗНАКОМОГО — ЕДИНСТВЕННАЯ точка записи журнала. Все команды
 * бота (сделка, приказ, просьба, факт…) идут через шину `applyCommand`, а она — сюда;
 * отдельных `remember*` на каждый вид нет, событие описывается данными `{kind, …}`.
 *
 * Момент штампуем сами (`calendarTime`), чтобы `at` не забыли на месте вызова. С безымянным
 * прохожим память не заводится — записи у него нет, событие молча гаснет (как и
 * `rememberPilot` пропускает чужого).
 */
export function recordEvent(world: World, ship: ShipEntity, event: WithoutAt<AcquaintanceEvent>): void {
  const record = world.acquaintances.find((a) => a.id === ship.acquaintanceId)
  if (!record) return
  // Спред восстанавливает конкретный член объединения; TS этого не выводит — приводим.
  record.history.push({ ...event, at: journalTime(world) } as AcquaintanceEvent)
}

/** Знакомый и его живой борт, если он сейчас здесь. Для вкладки «Люди» и меток карт. */
export interface Contact {
  record: Acquaintance
  /** Живой борт в текущем мире, если присутствует. `null` — знакомый есть, но не в этой системе. */
  ship: ShipEntity | null
  /** Дистанция до игрока в метрах; `Infinity`, если борта тут нет. */
  distance: number
}

/**
 * Все живые знакомые: с кем говорили и кто ещё не погиб. Присутствующие в этой системе
 * идут с живым бортом и дистанцией (по ней и сортируем — ближний сверху), отсутствующие
 * — с `ship: null` (знакомство помнится, но борт в другой системе). Гибель борта здесь
 * не видна: мёртвого борта в списке `ships` уже нет, значит и в контактах он не всплывёт.
 *
 * Чистая выборка на данных мира — ни рендера, ни глобалов: годится и серверу, и картам.
 */
export function livingContacts(world: World): Contact[] {
  const out: Contact[] = []
  for (const record of world.acquaintances) {
    if (!record.alive) continue // мёртвый в списке живых не значится — только в памяти
    const ship = world.ships.find((s) => s.alive && s.acquaintanceId === record.id) ?? null
    const distance = ship ? ship.state.pos.distanceTo(world.player.state.pos) : Infinity
    out.push({ record, ship, distance })
  }
  // Ближние (присутствуют здесь) сверху, отсутствующие — следом в порядке реестра.
  return out.sort((a, b) => a.distance - b.distance)
}

/**
 * Отправить контакт в систему `systemIndex` — он обещал лететь или игрок его послал.
 * Пока `boundFor` стоит, `driftContacts` ведёт его к цели, а не даёт бродить. Цель =
 * текущая система гасит намерение сразу: он уже там, лететь некуда.
 */
export function sendContactTo(record: Acquaintance, systemIndex: number): void {
  record.boundFor = systemIndex === record.systemIndex ? null : systemIndex
}

/**
 * «Оставайся там»: снимаем и намерение лететь, и право бродить — контакт ПРИКОЛОТ к
 * своей системе, и там его всегда найдёшь. Отпустить обратно в странствия — `roamContact`.
 */
export function holdContact(record: Acquaintance): void {
  record.boundFor = null
  record.roaming = false
}

/** «Живи как знаешь»: контакт снова волен бродить сам, когда никуда не направляется. */
export function roamContact(record: Acquaintance): void {
  record.roaming = true
}

/**
 * Контакт погиб — у тебя на глазах или где-то вне поля зрения. Помечаем запись
 * мёртвой (в список живых он больше не попадёт и повторной встречей не воскреснет) и
 * шлём игроку весть: имя пропало с радара. Идемпотентно — второй раз весть не плодит.
 */
export function markContactLost(world: World, record: Acquaintance): void {
  if (!record.alive) return
  record.alive = false
  record.boundFor = null
  world.notices.push({ kind: 'contact-lost', name: record.name, at: world.time })
}

/**
 * Знакомые, которые ДОЛЖНЫ быть здесь на радаре: живые, в этой системе и ещё не
 * присутствующие бортом. Со знакомыми не бывает случайных встреч — их положение мы
 * знаем всегда с точностью до системы, а раз они в НАШЕЙ системе, у них есть место на
 * радаре, и найти их можно. Поэтому не «шанс встретить», а список тех, кого фабрика
 * обязана выставить при входе в систему (`spawnResidentContacts`). Внезапных появлений
 * из ниоткуда больше нет: контакт либо тут с самого прибытия, либо в другой системе.
 */
export function residentAcquaintances(world: World): Acquaintance[] {
  return world.acquaintances.filter(
    (a) =>
      a.alive &&
      a.systemIndex === world.systemIndex &&
      !world.ships.some((s) => s.alive && s.acquaintanceId === a.id),
  )
}
