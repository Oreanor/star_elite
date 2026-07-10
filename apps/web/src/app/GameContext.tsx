import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  aiController,
  autodockController,
  createWorld,
  jump,
  type Arrival,
  type Controller,
  type World,
} from '@elite/sim'
import { createIntent, createPlayerController, type PlayerIntent } from './control/playerController'

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
  mode: PilotMode
  intent: PlayerIntent
  view: ViewMode
  /**
   * Показывать ли карту системы. Мир под ней СТОИТ: карта отпускает курсор,
   * а пауза в этой игре и есть отпущенный курсор — второго флага паузы нет.
   */
  mapOpen: boolean
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

function createSession(): Session {
  const world = createWorld()
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
    mode: 'manual',
    intent,
    view: 'chase',
    mapOpen: false,
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

export function GameProvider({ children }: { children: ReactNode }) {
  // useMemo, а не useState: сессия не должна перерождаться при перерисовке.
  const session = useMemo(createSession, [])
  return <GameContext.Provider value={session}>{children}</GameContext.Provider>
}

export function useSession(): Session {
  const session = useContext(GameContext)
  if (!session) throw new Error('useSession вне GameProvider')
  return session
}
