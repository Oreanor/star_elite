import { CHARACTER } from '../../config/character'
import { FIGURINE } from '../../config/figurines'
import { HUMAN_SPECIES, PLAYABLE_SPECIES, SPECIES } from '../../config/galaxy'
import type { Rng } from '../../core/math'

/**
 * Личность пилота: кто он и как торгуется. ЧИСТЫЕ ДАННЫЕ — ни логики, ни сети.
 *
 * Персона нужна не физике, а разговору: избитый пират сдаётся охотнее, но и
 * трусливый — тоже, а волевого и умного собеседник переспорит скорее, чем
 * робкого. Иными словами, исход торга зависит не только от силы кораблей.
 *
 * Числа тут — сырьё для реплики (её сочиняет слой app через модель), а не для
 * шага симуляции. Поэтому персона раздаётся seeded-RNG ОДИН раз при рождении
 * корабля: тот же сид — тот же характер, и по сети синхронизируется как есть.
 * Внутри кадра её никто не бросает — иначе характер плыл бы от герцовки.
 */

/** Нрав: категориальная черта, задаёт тон. Числа рядом уточняют, слова — красят. */
export type Disposition =
  | 'brave' // дерзкий: стоит до последнего
  | 'cowardly' // трусливый: ломается рано
  | 'greedy' // жадный: всё меряет добычей
  | 'honorable' // честный: держит слово
  | 'hotheaded' // вспыльчивый: заводится с полуслова
  | 'calculating' // расчётливый: считает шансы

export const DISPOSITIONS: readonly Disposition[] = [
  'brave',
  'cowardly',
  'greedy',
  'honorable',
  'hotheaded',
  'calculating',
]

/**
 * Профессия ИГРОКА — публичный род занятий, которым он представляется миру. Пока это
 * ЧИСТЫЙ ЛЕЙБЛ: ни целей, ни счётчиков, ни физики. Она принимается ЗА ПРАВДУ (ты тот,
 * кем назвался — не «якобы»): собеседник видит её открыто и по ней задаёт тон и общий
 * стиль общения, а его отношение красится связкой «его ремесло → твой род занятий»
 * (пират смотрит на мирных свысока, военного остерегается, и т.п.). Это мягкая поправка
 * к реплике, не приговор — исход решает домен. Есть только у игрока (выбор при создании);
 * у NPC род занятий берётся из `originKind`. Задел под будущую карьеру (звания, цели).
 */
export type Profession = 'traveler' | 'explorer' | 'businessman' | 'military' | 'pirate'
export const PROFESSIONS: readonly Profession[] = ['traveler', 'explorer', 'businessman', 'military', 'pirate']

/**
 * Черты в шкале 1..5 (середина 3). Не 0..1: собеседнику-модели «воля 4 из 5»
 * читается вернее, чем «0.72», а сравнивать «мой 2 против его 4» — нагляднее.
 */
export interface Persona {
  /** Нрав словом. */
  disposition: Disposition
  /** Ум: считает ли последствия или живёт мгновением. */
  intellect: number
  /** Темперамент: спокоен (1) или взрывной (5). */
  temperament: number
  /** Харизма: умеет ли давить и убеждать. */
  charisma: number
  /** Воля: гнётся (1) или стоит на своём (5). */
  willpower: number
  /** Ловкость пилота: влияет на манёвренность борта (в пределах общего потолка). */
  agility: number
  /** Точность: кучность стрельбы (разброс наведения), НЕ урон. */
  accuracy: number
  /**
   * Разумный ВИД пилота (имя из `config/galaxy`: люди или один из гуманоидов). Свойство
   * пилота, а не корабля: переезжает вместе с персоной при смене борта и в реестр
   * знакомств. По нему подбирается портрет-аватар и красится реплика в разговоре.
   */
  species: string
  /**
   * ВЫБРАННЫЙ игроком портрет-аватар, 0..35. Есть только у игрока (создание
   * персонажа). У NPC поля нет — их лицо берётся хешем имени, чтобы оставаться
   * стабильным и не совпадать у всех. Живёт на персоне, значит переживает сейв
   * и попадает в реестр знакомств: твоё лицо помнят.
   */
  portrait?: number
  /**
   * Профессия-самоназвание ИГРОКА (см. `Profession`). Есть только у игрока: у NPC род
   * занятий берётся из `originKind`. Пока чистый лейбл — как ты представляешься собеседнику.
   */
  profession?: Profession
  /**
   * Отношение к статуэткам богов. У NPC бросается при рождении; у игрока обычно нет —
   * он сам решает, собирать ли.
   */
  figurineHobby?: FigurineHobby
}

/**
 * Хобби статуэток богов.
 * - `aware: false` — не в теме → статуэток нет, zeal = 0;
 * - `zeal: 0` — не собирает → статуэток нет;
 * - `zeal` ∈ (0..1] — коллекционер: от увлечённости — доля от потолка цены и охота дарить.
 *   Высокий zeal ≠ жмот: на честный обмен и деньги идёт охотно.
 */
export interface FigurineHobby {
  aware: boolean
  /** Увлечённость 0..1. Ноль — не собирает. */
  zeal: number
}

/** Собирает ли (знает и zeal > 0). */
export function collectsFigurines(hobby: FigurineHobby | undefined): boolean {
  return !!hobby?.aware && hobby.zeal > 0
}

/** Доля от потолка цены для своих статуэток; 0 — не коллекционер. */
export function figurinePriceFactor(hobby: FigurineHobby | undefined): number {
  if (!collectsFigurines(hobby)) return 0
  const z = hobby!.zeal
  const lo = FIGURINE.PRICE_AT_ZEAL_LOW
  const hi = FIGURINE.PRICE_AT_ZEAL_HIGH
  return lo + (hi - lo) * z
}

/** Насколько охотно дарит друзьям (0..1); совпадает с zeal у коллекционера. */
export function figurineGiftOpenness(hobby: FigurineHobby | undefined): number {
  return collectsFigurines(hobby) ? hobby!.zeal : 0
}

/** Бросок хобби при рождении NPC. */
export function rollFigurineHobby(rng: Rng): FigurineHobby {
  if (FIGURINE.TEST_ALL_COLLECTORS) {
    return { aware: true, zeal: 0.55 + rng() * 0.45 }
  }
  if (rng() < FIGURINE.HOBBY_UNAWARE) return { aware: false, zeal: 0 }
  if (rng() < FIGURINE.HOBBY_ZEAL_ZERO) return { aware: true, zeal: 0 }
  return { aware: true, zeal: 0.05 + rng() * 0.95 }
}

/**
 * Профиль пилота с экрана создания персонажа: имя + личность (вид, статы, нрав,
 * портрет). Корабль в профиль НЕ входит — он дефолтный у всех, отличается только
 * пилот. Отсюда и форма: `PlayerSave.persona` уже несёт всё это, значит выбор
 * игрока сохраняется и переносится сам, без отдельного канала.
 */
export interface PilotProfile {
  name: string
  persona: Persona
}

/** Ровно посередине по всем осям. Для кораблей, что рождены без RNG (тесты, дрон). */
export const DEFAULT_PERSONA: Persona = {
  disposition: 'calculating',
  intellect: 3,
  temperament: 3,
  charisma: 3,
  willpower: 3,
  agility: 3,
  accuracy: 3,
  species: HUMAN_SPECIES,
  profession: 'traveler',
  // Тесты/дроны: не коллекционеры, пока RNG не бросил.
  figurineHobby: { aware: true, zeal: 0 },
}

/** Черта 1..5 из RNG. */
function trait(rng: Rng): number {
  return 1 + Math.floor(rng() * 5)
}

/**
 * Случайная личность из seeded-RNG. Бросается при СОЗДАНИИ корабля, где RNG —
 * это `world.rng` (спавн — событие, а не шаг физики, и сдвиг генератора здесь
 * детерминирован сидом системы). Тот же сид — тот же характер у того же борта.
 */
export function makePersona(rng: Rng): Persona {
  const disposition = DISPOSITIONS[Math.floor(rng() * DISPOSITIONS.length)]!
  // Новые оси тянем ПОСЛЕ прежних (вид — последним из старых): так у уже существующих
  // персон прежние поля не меняются, сдвигается лишь поток дальше по спавну.
  // Хобби статуэток — после вида: ещё один бросок в хвосте потока.
  return {
    disposition,
    intellect: trait(rng),
    temperament: trait(rng),
    charisma: trait(rng),
    willpower: trait(rng),
    species: makeSpecies(rng),
    agility: trait(rng),
    accuracy: trait(rng),
    figurineHobby: rollFigurineHobby(rng),
  }
}

/**
 * Вид пилота. Больше половины — люди (как и в колонизации галактики), остальные —
 * равновероятно один из гуманоидов. Бросается тем же seeded-RNG при рождении борта:
 * тот же сид — тот же вид у того же пилота.
 */
function makeSpecies(rng: Rng): string {
  if (rng() < 0.55) return HUMAN_SPECIES
  return SPECIES[Math.floor(rng() * SPECIES.length)]!.name
}

/**
 * Числовые оси, в которые игрок РАЗДАЁТ очки при создании. Ровно ключи
 * `CHARACTER.COST`. Тона (`disposition/secrecy/humor`) и `temperament` сюда не
 * входят — они выбираются, но очков не стоят.
 */
export const BUYABLE_TRAITS = ['intellect', 'charisma', 'willpower', 'agility', 'accuracy'] as const
export type BuyableTrait = (typeof BUYABLE_TRAITS)[number]

/** Сколько очков стоит персона сверх базы, с учётом коэффициентов трат. */
export function personaPointsSpent(p: Persona): number {
  let spent = 0
  for (const t of BUYABLE_TRAITS) spent += Math.max(0, p[t] - CHARACTER.BASE) * CHARACTER.COST[t]
  return spent
}

/**
 * Легален ли выбор игрока: числовые оси — целые в шкале и уложились в пул очков,
 * тона — из допустимых значений. Один валидатор на экран создания И на СЕРВЕР:
 * статы нельзя накрутить правкой присланного профиля — та же авторитетность, что
 * «нельзя править HP через консоль».
 */
export function isLegalPersona(p: Persona): boolean {
  for (const t of BUYABLE_TRAITS) {
    if (!Number.isInteger(p[t]) || p[t] < CHARACTER.MIN || p[t] > CHARACTER.MAX) return false
  }
  if (!DISPOSITIONS.includes(p.disposition)) return false
  // Профессия необязательна (у NPC её нет), но если задана — только из списка.
  if (p.profession !== undefined && !PROFESSIONS.includes(p.profession)) return false
  return personaPointsSpent(p) <= CHARACTER.POOL
}

/**
 * Легален ли весь профиль новичка: имя не пустое, вид доступен, профессия выбрана из
 * списка (игрок обязан назваться кем-то), персона в правилах. Один валидатор на экран
 * И на сервер — присланный профиль не накрутить.
 */
export function isLegalProfile(profile: PilotProfile): boolean {
  if (profile.name.trim().length === 0) return false
  if (!PLAYABLE_SPECIES.includes(profile.persona.species)) return false
  if (!profile.persona.profession || !PROFESSIONS.includes(profile.persona.profession)) return false
  return isLegalPersona(profile.persona)
}
