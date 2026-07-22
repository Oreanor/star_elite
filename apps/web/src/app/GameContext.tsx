import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { Vector3 } from 'three'
import {
  addItem,
  aiController,
  autodockController,
  flyToController,
  applyPlayerSave,
  createWorld,
  enterSystem,
  findModule,
  fitFromHold,
  placeShowcaseFleet,
  spawnResidentContacts,
  spawnSlovo,
  startDocked,
  jump,
  commitPreparedJump,
  systemDefFor,
  createBushTravel,
  generateUniverse,
  CORE_INDEX,
  GALAXY,
  WORLD,
  type Arrival,
  type JumpOptions,
  type Controller,
  type BushTravel,
  type PlayerSave,
  type Universe,
  type World,
} from '@elite/sim'
import { createIntent, createPlayerController, type PlayerIntent } from './control/playerController'
import { createBushController } from './control/bushController'
import { placeTorusAtVertex } from '../render/scene/HypertorusLayer'
import { vertexOfNode } from '../render/scene/torusNodes'
import { online } from './net/firebase'
import { loadSave } from './save/saveStore'

export type PilotMode = 'manual' | 'autodock' | 'flyto' | 'bush'

/**
 * Мир живёт в обычном мутируемом объекте и НИКОГДА не попадает в состояние React.
 * React здесь только собирает дерево один раз; кадры рисует three.
 */

/** То, что меняется в кадре, но не должно вызывать перерисовку. */
export interface Session {
  world: World
  controllers: Map<number, Controller>
  /** Контроллер игрока. Автопилот его временно подменяет — и только его. */
  pilot: Controller
  /** Штурвал на кусте: газ + осмотр мышью. Читает ввод, как и `pilot` (слой приложения). */
  bushPilot: Controller
  /** Новая игра (сейва не было): UI покажет экран создания персонажа перед стартом. */
  isNewGame: boolean
  mode: PilotMode
  /**
   * Куст галактик и место на нём. Живут в СЕССИИ, а не в мире: `World` — это одна система,
   * а куст стоит над всеми ими. Вселенная строится один раз из слова и больше не меняется.
   */
  universe: Universe
  bush: BushTravel
  /**
   * Мировая точка креста в КОМНАТЕ МОНУМЕНТА, пока `bush.inMonument`. Живёт в сессии, а не
   * в домене: `BushTravel` — чистое состояние рельса, а место креста в комнате — уже рендер
   * (куда его поставили относительно игрока на входе). `null` — мы не в комнате.
   */
  monumentCross: Vector3 | null
  intent: PlayerIntent
  /**
   * Шагнул ли мир в этом кадре. Не второй флаг паузы: решение принимает один
   * `Simulation`, остальные его читают. Всё, что движется по `dt` реального
   * времени, а не по `world.time` — камера-пружина и мерцание факелов, — обязано
   * замереть вместе с миром. Иначе под открытым меню камера продолжает наезжать
   * на корабль, а сопла дышат: пауза перестаёт быть паузой.
   */
  running: boolean
  /**
   * Курсор отпущен под ОТКРЫТЫМ МЕНЮ (карта/консоль/диалог), а не под честной паузой
   * (титул, Escape, сворачивание вкладки). Тогда мир НЕ замирает — корабль летит по
   * инерции прежним курсом, но пилот не за штурвалом: без боя, слежения и роста. Выбор
   * игрока: глянуть карту «на ходу», подрулив к звезде, а не останавливая всё. Ставит App
   * по состоянию оверлеев и фокуса окна; читает Simulation. Сворачивание окна гасит флаг —
   * там честная пауза, иначе корабль улетел бы без присмотра.
   */
  menuFlying: boolean
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

/** Тот же контекст для второй полноценной R3F-сцены портала. */
export function SessionScope({ session, children }: { session: Session; children: ReactNode }) {
  return <GameContext.Provider value={session}>{children}</GameContext.Provider>
}

/**
 * Случайная обитаемая система из нагенерированных — новая игра начинается не дома,
 * а в незнакомом месте галактики.
 *
 * Офлайн-новичок: случайная система со станцией (ядро — не система).
 * Math.random здесь уместен: слой приложения, не детерминированная симуляция.
 */
function randomStartIndex(): number {
  let fallback: number = WORLD.SHARED_START_INDEX
  for (let tries = 0; tries < 64; tries++) {
    const index = Math.floor(Math.random() * GALAXY.COUNT)
    if (index === CORE_INDEX) continue
    fallback = index
    if (systemDefFor(index, GALAXY.SEED).station) return index
  }
  return fallback
}

/** Сеть: все новички в Люриларе. */
function sharedStartIndex(): number {
  return WORLD.SHARED_START_INDEX
}

function createSession(initialSave?: PlayerSave | null): Session {
  // `undefined` — офлайн-путь: сейв берём из localStorage. Иначе (в т.ч. `null`) — тот,
  // что дали снаружи: онлайн уже загрузил серверный сейв (null = новичок без прогресса).
  const save = initialSave !== undefined ? initialSave : loadSave()
  const world = createWorld()

  // DEV/ВРЕМЕННО: старт в КОМНАТЕ тора — ОТДЕЛЬНЫЙ ПУСТОЙ мир (ни системы, ни тел, ни трафика,
  // ни звезды). Систему не строим вовсе: корабль летает в пустоте, вокруг только решётка
  // галактик. Это НЕ звёздная система и нигде ею не рендерится. Снять флаг — обычный старт.
  const TORUS_START = false

  if (!TORUS_START) {
  // Повторный вход — в СВОЮ сохранённую систему своим сидом. Новичок: в сети — ОБЩАЯ
  // точка сбора, офлайн — случайная. Систему строим по (сид, индекс).
  const index = save
    ? save.systemIndex
    : online
      ? sharedStartIndex()
      : randomStartIndex()
  const seed = save ? save.galaxySeed : world.galaxySeed
  enterSystem(world, systemDefFor(index, seed), index)
  // Пилота накладываем ПОСЛЕ enterSystem: тот пересобирает окружение, но борт игрока
  // не трогает — значит восстановленные корабль/кошелёк/личность не затрутся.
  if (save) applyPlayerSave(world, save)
  // DEV: миелофон стоит СРАЗУ — впаян в аукс-слот, а не валяется в трюме. И у новичка, и
  // у вернувшегося (по сейву мог потеряться). Аукс-слот один: маскировка при этом вытесняется
  // в трюм (игрок вернёт её на верфи). Временно, для отладки; в релизе — артефакт добывается.
  const hasMieloInstalled = world.player.loadout.internals.some((m) => m.kind === 'mielophone')
  if (!hasMieloInstalled) {
    let idx = world.player.hold.items.findIndex((it) => it.kind === 'module' && it.module.kind === 'mielophone')
    if (idx < 0) {
      const mielophone = findModule('mielophone_1')
      if (mielophone) {
        addItem(world.player.hold, { kind: 'module', module: mielophone })
        idx = world.player.hold.items.length - 1
      }
    }
    if (idx >= 0) fitFromHold(world.player, idx)
  }
  // Старт В ДОКЕ: игра открывается консолью станции, а не километром пустоты рядом с ней.
  // Это и точка возврата (там же оказываешься после стыковки), и безопасное начало — мир
  // на паузе, пока не отчалишь. `startDocked` ставит борт вплотную и стыкует общим путём.
  startDocked(world)

  /**
   * ЗНАКОМЫЕ живут в системе с первого кадра — как и после прыжка.
   *
   * Раньше их воскрешал ТОЛЬКО `jump`, а на входе в игру не звал никто: журнал знакомств
   * приезжает из сейва (`applyPlayerSave`) уже ПОСЛЕ `enterSystem`, и жители системы не
   * заводились вовсе. Оттого встреченный борт выглядел знакомым (тот же сид — то же имя и
   * лицо), но памяти о тебе не имел: это был ДРУГОЙ корабль, свежий трафик без записи.
   * Зовём после `startDocked` — игрок уже у причала, и знакомые заходят от него, а не от
   * точки выхода из гипера. Контроллеры им раздаст сборка ниже: она идёт по `world.ships`.
   */
  spawnResidentContacts(world)

  /**
   * И БОГА перецепляем к его записи — по той же причине. Он садится внутри `enterSystem`, когда
   * журнал знакомств ещё не приехал из сейва, и остаётся без `acquaintanceId`: без памяти и без
   * отношения. Разозлил бога, перезашёл — а он снова нейтрален. Повторный вызов идемпотентен
   * (двойников не плодит) и лишь чинит связь задним числом.
   */
  spawnSlovo(world)

  // DEV/ВРЕМЕННО: смотровой парад у станции — пара десятков мелких бортов строем и
  // несколько «Атласов», чтобы облететь и рассмотреть модели. Снять флаг перед релизом.
  const SHOWCASE_FLEET = false
  if (SHOWCASE_FLEET) placeShowcaseFleet(world)
  } // конец обычного старта; в комнате тора система не строится

  const intent = createIntent()
  const pilot = createPlayerController(intent)
  const bushPilot = createBushController(intent)

  const controllers = new Map<number, Controller>()
  controllers.set(world.player.id, pilot)
  // Все боты делят один контроллер: он не хранит состояния, оно живёт в ship.ai.
  for (const ship of world.ships) controllers.set(ship.id, aiController)

  const bush = createBushTravel()
  if (TORUS_START) {
    bush.active = true
    // Домой — в узел своей галактики: `createBushTravel` ставит корень куста (монумент), а
    // мы стартуем не с креста. Отсюда же берётся имя дома на HUD.
    bush.node = GALAXY.HOME_NODE
    // ПУСТАЯ КОМНАТА: `createWorld` насыпал стартер-систему (звезда, планеты, патрули) —
    // вычищаем всё сталкиваемое и рендерящееся. Иначе корабль врезается в невидимые тела.
    world.bodies = []
    world.ships = []
    world.asteroids = []
    world.pods = []
    world.missiles = []
    world.bolts = []
    world.titans = []
    world.monoliths = []
    world.figurines = []
    world.scenicRocks = []
    world.platforms = []
    // Пусто НАВСЕГДА: `desolate` глушит спавн трафика (traffic.ts), иначе пираты налетят
    // в пустоту и начнут стрелять. Комната математическая — в ней никого, кроме игрока.
    world.desolate = true
    // Корабль в центре проекции: стоит и вертится мышью, полёт — поток S³ сквозь него.
    world.player.state.pos.set(0, 0, 0)
    world.player.state.vel.set(0, 0, 0)
    world.player.controls.throttle = 0
    // Стоим В СВОЁМ узле, а не в безымянной точке между узлами: соседи вокруг — настоящие соседи.
    placeTorusAtVertex(vertexOfNode(bush.node))
  }

  return {
    world,
    controllers,
    pilot,
    bushPilot,
    isNewGame: save === null,
    // В торе штурвал — bushPilot: мышь вертит корабль, тяга в физику ноль (борт стоит в центре).
    // Полёт — поток S³ сквозь игрока (torusFlight). `bush.active` включает рендер решётки.
    mode: TORUS_START ? 'bush' : 'manual',
    universe: generateUniverse(GALAXY.WORD),
    bush,
    monumentCross: null,
    intent,
    running: false,
    menuFlying: false,
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
  // Тот же выбор штурвала по режиму, что и в `helmController` (Simulation): пересборка карты
  // при смене трафика не должна ронять автопилот, рельсы куста или свободный полёт в комнате.
  const atTheHelm =
    session.mode === 'autodock'
      ? autodockController
      : session.mode === 'flyto'
        ? flyToController
        : session.mode === 'bush'
          ? session.bush.inMonument
            ? session.pilot
            : session.bushPilot
          : session.pilot
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
  // Один корабль мог исчезнуть и другой родиться в том же шаге: размер Map тогда тот
  // же, но новый id навсегда остался бы без пилота. Проверяем идентичность набора, не длину.
  if (
    session.controllers.size === session.world.ships.length + 1
    && session.controllers.has(session.world.player.id)
    && session.world.ships.every((ship) => session.controllers.has(ship.id))
  ) return
  bindControllers(session)
}



/**
 * Прыжок из слоя приложения. Правила — в домене (`jump`), здесь только последствия
 * для сессии: старых кораблей больше нет, их контроллеры обязаны уйти вместе с ними.
 *
 * Возвращает false, если домен не пустил: причину спрашивают у `jumpBlock`.
 */
export function jumpTo(
  session: Session,
  index: number,
  arrival: Arrival | null = null,
  options: JumpOptions = {},
): boolean {
  if (!jump(session.world, index, arrival, options)) return false

  // Режим сбрасываем ДО раздачи: автопилот стыковки вёл к причалу, которого
  // в новой системе нет, а `bindControllers` сажает за штурвал того, кто в режиме.
  session.mode = 'manual'
  bindControllers(session)
  session.onSystemChange?.(session.world.epoch)
  return true
}

/** Принять уже отрендеренный портальный World без повторного enterSystem. */
export function adoptPreparedJumpWorld(
  session: Session,
  destination: World,
  index: number,
  options: JumpOptions = {},
): boolean {
  if (!commitPreparedJump(session.world, destination, index, options)) return false
  session.world = destination
  session.mode = 'manual'
  bindControllers(session)
  session.onSystemChange?.(destination.epoch)
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
