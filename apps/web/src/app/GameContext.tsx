import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  aiController,
  autodockController,
  applyPlayerSave,
  createWorld,
  enterSystem,
  startDocked,
  jump,
  systemDefFor,
  CORE_INDEX,
  GALAXY,
  WORLD,
  type Arrival,
  type Controller,
  type PlayerSave,
  type World,
} from '@elite/sim'
import { createIntent, createPlayerController, type PlayerIntent } from './control/playerController'
import { online } from './net/firebase'
import { loadSave } from './save/saveStore'

export type PilotMode = 'manual' | 'autodock'

/**
 * Мир живёт в обычном мутируемом объекте и НИКОГДА не попадает в состояние React.
 * React здесь только собирает дерево один раз; кадры рисует three.
 */

export type ViewMode = 'chase' | 'cockpit'

/** То, что меняется в кадре, но не должно вызывать перерисовку. */
export interface Session {
  world: World
  controllers: Map<number, Controller>
  /** Контроллер игрока. Автопилот его временно подменяет — и только его. */
  pilot: Controller
  /** Новая игра (сейва не было): UI покажет экран создания персонажа перед стартом. */
  isNewGame: boolean
  mode: PilotMode
  intent: PlayerIntent
  view: ViewMode
  /**
   * Шагнул ли мир в этом кадре. Не второй флаг паузы: решение принимает один
   * `Simulation`, остальные его читают. Всё, что движется по `dt` реального
   * времени, а не по `world.time` — камера-пружина и мерцание факелов, — обязано
   * замереть вместе с миром. Иначе под открытым меню камера продолжает наезжать
   * на корабль, а сопла дышат: пауза перестаёт быть паузой.
   */
  running: boolean
  /**
   * Игрок погиб: мир больше не шагает, курсор отпущен.
   * Перезапуск — это новая сессия, а не сброс полей: половина «сброшенного»
   * мира — источник тонких багов, которые всплывают через полчаса игры.
   */
  over: boolean
  /** Зовётся ровно один раз, в кадре гибели. Сюда React вешает экран. */
  onOver: (() => void) | null
  /** Зовётся в кадре стыковки и отчаливания: React показывает и убирает меню. */
  onDockChange: ((docked: boolean) => void) | null
  /** Что уже показано React: без него событие стыковки повторялось бы каждый кадр. */
  dockedShown: boolean
  /**
   * Зовётся после прыжка. Сцена пересобирается целиком: меши планет, пояса и
   * неба строятся один раз при монтировании, и подменённый под ними мир они
   * не заметят. Это не костыль React — миры до и после прыжка не связаны ничем.
   */
  onSystemChange: ((epoch: number) => void) | null
}

const GameContext = createContext<Session | null>(null)

/**
 * Случайная обитаемая система из нагенерированных — новая игра начинается не дома,
 * а в незнакомом месте галактики.
 *
 * Ядро (чёрная дыра) и дом исключены намеренно: ядро — не система, а дом мы как раз
 * и хотим оставить позади. Станция обязательна: игрок стартует с торговым трюмом, и
 * забросить его в беззаконную пустоту без причала и рынка — это отнять смысл старта.
 * Math.random здесь уместен: это слой приложения, а не детерминированная симуляция.
 */
function randomStartIndex(): number {
  let fallback = CORE_INDEX
  for (let tries = 0; tries < 64; tries++) {
    const index = Math.floor(Math.random() * GALAXY.COUNT)
    if (index === CORE_INDEX || index === WORLD.HOME_INDEX) continue
    fallback = index
    if (systemDefFor(index, GALAXY.SEED).station) return index
  }
  // Не нашли со станцией за разумное число попыток — берём последнюю годную.
  return fallback === CORE_INDEX ? WORLD.HOME_INDEX : fallback
}

/**
 * ОБЩАЯ стартовая система для новичков в СЕТИ: все начинают у одной станции, чтобы
 * встречаться, а не искать друг друга по всей галактике. Детерминированно (без
 * Math.random): первая от начала обитаемая система со станцией, кроме ядра и дома.
 * Один сид — одна точка сбора для всех.
 */
function sharedStartIndex(): number {
  for (let index = 0; index < GALAXY.COUNT; index++) {
    if (index === CORE_INDEX || index === WORLD.HOME_INDEX) continue
    if (systemDefFor(index, GALAXY.SEED).station) return index
  }
  return WORLD.HOME_INDEX
}

function createSession(initialSave?: PlayerSave | null): Session {
  // `undefined` — офлайн-путь: сейв берём из localStorage. Иначе (в т.ч. `null`) — тот,
  // что дали снаружи: онлайн уже загрузил серверный сейв (null = новичок без прогресса).
  const save = initialSave !== undefined ? initialSave : loadSave()
  const world = createWorld()
  // Повторный вход — в СВОЮ сохранённую систему своим сидом. Новичок: в сети — ОБЩАЯ
  // точка сбора (чтоб встречаться), офлайн — случайная. Систему строим по (сид, индекс).
  const index = save ? save.systemIndex : online ? sharedStartIndex() : randomStartIndex()
  const seed = save ? save.galaxySeed : world.galaxySeed
  enterSystem(world, systemDefFor(index, seed), index)
  // Пилота накладываем ПОСЛЕ enterSystem: тот пересобирает окружение, но борт игрока
  // не трогает — значит восстановленные корабль/кошелёк/личность не затрутся.
  if (save) applyPlayerSave(world, save)
  // Начинаем ПРИСТЫКОВАННЫМИ у причала — и новичок, и вернувшийся: станция и точка
  // возврата, и безопасный старт. Не в открытом космосе за тысячу километров.
  startDocked(world)

  const intent = createIntent()
  const pilot = createPlayerController(intent)

  const controllers = new Map<number, Controller>()
  controllers.set(world.player.id, pilot)
  // Все боты делят один контроллер: он не хранит состояния, оно живёт в ship.ai.
  for (const ship of world.ships) controllers.set(ship.id, aiController)

  return {
    world,
    controllers,
    pilot,
    isNewGame: save === null,
    mode: 'manual',
    intent,
    view: 'chase',
    running: false,
    over: false,
    onOver: null,
    onDockChange: null,
    dockedShown: false,
    onSystemChange: null,
  }
}

/**
 * Раздать контроллеры: игроку — его, всем ботам — общий, без состояния.
 *
 * За штурвалом игрока может сидеть автопилот стыковки. Пересборка обязана его
 * сохранить: иначе торговец, улетевший за горизонт, молча отбирал бы управление
 * у автопилота на подходе к причалу.
 */
function bindControllers(session: Session): void {
  session.controllers.clear()
  const atTheHelm = session.mode === 'autodock' ? autodockController : session.pilot
  session.controllers.set(session.world.player.id, atTheHelm)
  for (const ship of session.world.ships) session.controllers.set(ship.id, aiController)
}

/**
 * Симуляция сама рождает и убирает корабли — торговцы прилетают и улетают. Пилота
 * новичку раздаёт слой приложения: домен не знает ни про ИИ, ни про ввод (DIP),
 * а без контроллера корабль достаётся `NULL_CONTROLLER` и молча дрейфует.
 *
 * Раз в кадр и почти бесплатно: сверяем размер, и только при расхождении
 * пересобираем карту целиком. Точечная вставка оставляла бы в ней мертвецов,
 * а карта, растущая на каждого убитого пирата, — это утечка.
 */
export function syncControllers(session: Session): void {
  if (session.controllers.size === session.world.ships.length + 1) return
  bindControllers(session)
}



/**
 * Прыжок из слоя приложения. Правила — в домене (`jump`), здесь только последствия
 * для сессии: старых кораблей больше нет, их контроллеры обязаны уйти вместе с ними.
 *
 * Возвращает false, если домен не пустил: причину спрашивают у `jumpBlock`.
 */
export function jumpTo(session: Session, index: number, arrival: Arrival | null = null): boolean {
  if (!jump(session.world, index, arrival)) return false

  // Режим сбрасываем ДО раздачи: автопилот стыковки вёл к причалу, которого
  // в новой системе нет, а `bindControllers` сажает за штурвал того, кто в режиме.
  session.mode = 'manual'
  bindControllers(session)
  session.onSystemChange?.(session.world.epoch)
  return true
}

export function GameProvider({
  children,
  initialSave,
}: {
  children: ReactNode
  /** Уже загруженный сейв (онлайн) или `undefined` — тогда возьмём из localStorage (офлайн). */
  initialSave?: PlayerSave | null
}) {
  // useMemo, а не useState: сессия не должна перерождаться при перерисовке. initialSave
  // фиксируется на монтировании — новая сессия (вход, перезапуск) приходит через key.
  const session = useMemo(() => createSession(initialSave), [])
  return <GameContext.Provider value={session}>{children}</GameContext.Provider>
}

export function useSession(): Session {
  const session = useContext(GameContext)
  if (!session) throw new Error('useSession вне GameProvider')
  return session
}
