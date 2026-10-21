import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  armAutoland,
  releaseLanding,
  autodockController,
  canEngageAutodock,
  autofightActive,
  canEngageFlyTo,
  copilotRank,
  disengageAutofight,
  engageAutofight,
  flyToArrived,
  flyToController,
  cycleContact,
  cycleCelestial,
  retargetNearestContact,
  retargetNearestCelestial,
  findCloak,
  findMielophone,
  hasBomb,
  hasEcm,
  droneAmmo,
  isDrone,
  isLaser,
  isMissile,
  missileStock,
  serializePlayer,
  stepWorld,
  aiController,
  type TickHook,
  enterBush,
  leaveBush,
  enterSystem,
  enterVoid,
  systemDefFor,
  emptyDelta,
  CORE_INDEX,
  UNIVERSE,
  MONUMENT_SYSTEM,
  GALAXY,
  type Controller,
  type World,
} from '@elite/sim'
import { cycleGalaxyStar, galaxyRadar, retargetNearestGalaxyStar } from './galaxyRadar'
import { syncControllers, useSession, type Session } from '../../session/GameContext'
import { coastController } from '../../session/playerController'
import { stepCameraView } from '../../session/cameraView'
import { cycleHull, rigEditorActive, stepRigEditor, toggleRigEditor } from '../dev/rigEditor'
import { stepWarBaseEditor } from '../dev/warBaseEditor'
import { resetTorusFlight, stepTorusFlight } from '../../session/torusFlight'
import { resetBushTraffic, stepBushTraffic } from '../../session/bushTraffic'
import {
  consumeTorusArrival,
  cycleTorusTarget,
  disengageTorusAutopilot,
  resetTorusAutopilot,
  toggleTorusAutopilot,
  torusAutopilotActive,
} from '../../session/torusAutopilot'
import {
  beginBushExit,
  bushExitActive,
  bushExitVertex,
  resetBushExit,
  stepBushExit,
} from '../../session/bushExit'
import { placeTorusAtVertex, torusNearest } from './HypertorusLayer'
import { nodeOfVertex, vertexOfNode } from './torusNodes'
import { TORUS } from '../config'
import { persistSave } from '../../session/save/saveStore'
import { clearPresses, consumePress, input, isHeld, releaseLock } from '../../platform/input/input'
import { gameTimeSec } from '../../session/net/worldClock'
import { clearWarnings, pushWarning } from '../../session/warnings'

/** Миелофон «есть у игрока», если он в аукс-слоте ИЛИ лежит в трюме: дев-выдача кладёт
 *  его в ТРЮМ, а не в слот, поэтому проверка только по слоту давала ложное «прибор не
 *  установлен», пока держишь E для роста. */
function ownsMielophone(player: World['player']): boolean {
  if (findMielophone(player.loadout)) return true
  return player.hold.items.some((it) => it.kind === 'module' && it.module.kind === 'mielophone')
}

/**
 * Ведущий кадра. Приоритет -100 гарантирует шаг мира раньше постановщиков и рендера,
 * независимо от порядка монтирования React-компонентов.
 *
 * Ничего не рисует.
 */

/**
 * Автостыковка — это подмена ОДНОЙ ссылки в карте контроллеров. Ни симуляция,
 * ни физика не знают, что за штурвалом сменился пилот: ровно ради этого
 * `Controller` и существует.
 */
/**
 * Кто за штурвалом по режиму сессии. `coasting` — под открытым меню-полётом (курсор
 * отпущен): пилота нет, корабль коастит, НО автопилоты (стыковка, полёт-к-цели) ведут и
 * там — иначе, глянув карту, ты бы ронял их с полпути.
 */
function helmController(session: Session, coasting: boolean): Controller {
  if (session.mode === 'autodock') return autodockController
  if (session.mode === 'flyto') return flyToController
  // На кусте манёвров нет — газ и осмотр мышью (`bushPilot`). Но в КОМНАТЕ МОНУМЕНТА полёт
  // свободный: там пустое пространство с крестом, вокруг которого летаешь, — штурвал пилоту.
  if (session.mode === 'bush') return session.bush.inMonument ? session.pilot : session.bushPilot
  return coasting ? coastController : session.pilot
}

function setPilot(session: Session, mode: Session['mode']): void {
  session.mode = mode
  session.controllers.set(session.world.player.id, helmController(session, false))

  // Допуск в створ станции выдаётся вместе с АВТОСТЫКОВКОЙ и снимается вместе с ней.
  // Он живёт в МИРЕ, а не в сессии: по нему решает ИИ, а тот про сессию не знает.
  // Полёт-к-цели допуска не даёт — он не заходит в створ, а тормозит поодаль.
  session.world.player.clearance = mode === 'autodock'
}

/**
 * Дверь на куст — чёрная дыра. Влетел внутрь её сферы → едешь по вселенной.
 *
 * По замыслу дверь одна на галактику и стоит в ЯДРЕ; шарик у причала в Люриларе —
 * временный вход для разработки. Поэтому ищем любое тело `blackhole`, а не конкретное:
 * уедет временный — правило не поменяется.
 */
function touchedDoor(world: World): boolean {
  for (const body of world.bodies) {
    // Дверь — всякая чёрная дыра, и дыра ядра тоже: она приезжает телом `blackhole`
    // (`SystemDef.star.blackHole`), особого случая для ядра больше нет.
    if (body.kind !== 'blackhole') continue
    if (world.player.state.pos.distanceTo(body.pos) <= body.radius) return true
  }
  return false
}

/**
 * Вход в ГИПЕРТОР и удержание в нём.
 *
 * Перемещение между галактиками показано как полёт сквозь замкнутую решётку-S³ (стереопроекция).
 * Двигается игрок ПО-НАСТОЯЩЕМУ, но не здесь: позу пилота в S³ копит `stepTorusNav` от WASD+мыши,
 * а применяет её слой рендера. Домену остаётся лишь ввести в режим и держать корабль недвижным
 * (он стоит в начале координат — едет вся вселенная).
 */
function stepBush(session: Session): void {
  const { world, bush, universe } = session

  if (!bush.active) {
    if (session.mode === 'bush' || !touchedDoor(world)) return
    // Влетев в дыру, оказываемся В СВОЁМ узле, а не в случайной точке вселенной: галактику
    // узнаём по зерну мира (оно и есть её удостоверение), а поза полёта ставит этот узел
    // ровно под игрока. Не нашли (чужое зерно, дев-старт) — считаем домом узел из конфига.
    // Из Крестов — в узел Крестов: комната вне галактик, её узел — корень, а не зерно мира.
    const homeNode = world.inMonument
      ? UNIVERSE.MONUMENT_NODE
      : universe.nodes.findIndex((n) => n.seed === world.galaxySeed)
    enterBush(bush, homeNode >= 0 ? homeNode : GALAXY.HOME_NODE)
    resetBushTraffic()
    session.monumentCross = null
    placeTorusAtVertex(vertexOfNode(bush.node))
    // Цель, намеченную на карте «Мир» ещё снаружи, не стираем — сбрасываем лишь ведение.
    disengageTorusAutopilot()
    // Влетели снова, не досмотрев прошлый выход (успел долететь до дыры за полторы секунды) —
    // старый переход не должен доигрывать поверх новой комнаты.
    resetBushExit()
    // Систему покидаем по-настоящему: под задником она не живёт (см. `enterVoid`).
    enterVoid(world)
    session.onSystemChange?.(world.epoch)
    setPilot(session, 'bush')
    pushWarning('bushEnter', world.time, {
      label: universe.nodes[bush.node]?.name ?? '',
      repeat: 0,
    })
    return
  }

  // ПРИБЫЛИ в узел — выпадаем из комнаты в ту самую галактику. Прыжка отсюда нет и быть не
  // может: комната — внутренность дыры, а выход — та же дыра с другой стороны. Поэтому
  // появляемся в ЯДРЕ (`CORE_INDEX`) — системе с чёрной дырой в центре, в её окрестностях.
  // Прибыли — не подменяем мир на месте, а ЗАПУСКАЕМ ПЕРЕХОД (`bushExit`): тор разлетается,
  // экран гаснет, и уже под чернотой меняется мир. Подмену делает шаг перехода ниже.
  const arrivedVertex = consumeTorusArrival()
  // В Кресты — тем же переходом: там комната-монумент (`MONUMENT_SYSTEM`), а не галактика.
  if (arrivedVertex !== null && !bushExitActive()) beginBushExit(arrivedVertex)

  // Корабль СТОИТ В ЦЕНТРЕ проекции и только вертится мышью (bushPilot глушит тягу). Полёт —
  // это поток S³ сквозь него (`stepTorusFlight` в такте мира), а не перемещение борта. Держим борт в
  // начале координат: любой снос сдвинул бы центр проекции и «уронил» бы выворот.
  const s = world.player.state
  s.pos.set(0, 0, 0)
  s.vel.set(0, 0, 0)
}

/**
 * В КОМНАТЕ корабль стоит в нуле и ПОСЛЕ шага мира. Система, из которой влетел, под тёмным
 * задником живёт дальше: опорное тело едет по орбите, и такт переносит игрока вместе с ним, а
 * сдвиг отдаёт камере (`originShift`). Борт `stepBush` прибивал к нулю лишь ДО шага, а камеру
 * не возвращал никто — её уносило орбитой, пружина держала на пределе отставания (полтора км),
 * и вход в дыру выглядел как пустота с решёткой где-то вдали. В комнате этого переноса нет.
 */
function holdInRoom(session: Session): void {
  if (!session.bush.active) return
  const s = session.world.player.state
  s.pos.set(0, 0, 0)
  s.vel.set(0, 0, 0)
  session.world.originShift.set(0, 0, 0)
}

/**
 * ФАКТЫ МИРА пишутся в сейв СРАЗУ, а не на следующей стыковке. Гибель знакомого, сданное или
 * проваленное дело — это уже случилось: пилот сбил Дэвида Дэвиса в полёте, перезагрузился, не
 * заходя на станцию, — и тот был жив, ведь сейв помнил его живым. Сейв хранит систему, а не
 * точку в ней, поэтому писать его посреди полёта безопасно: вход всё равно на станции.
 */
const FACT_NOTICES = new Set(['contact-lost', 'contract-done', 'contract-failed'])

function saveFacts(world: World, lastAt: { value: number }): void {
  // Новый мир (загрузка, смена галактики) начинает часы заново — отсечку сбрасываем.
  if (world.time < lastAt.value) lastAt.value = -Infinity
  let newest = lastAt.value
  for (const n of world.notices) if (FACT_NOTICES.has(n.kind) && n.at > newest) newest = n.at
  if (newest > lastAt.value) {
    lastAt.value = newest
    persistSave(serializePlayer(world))
  }
}

/**
 * ВЫХОД ИЗ ДЫРЫ В ГАЛАКТИКУ, к которой привёл навигатор.
 *
 * Галактика — это ЗЕРНО (`GalaxyNode.seed`): подменяем его миру, и все 2500 систем выводятся
 * заново, ничего не храня. Выходим в ядро — единственную систему, которая есть у КАЖДОЙ
 * галактики и в которой стоит дыра-дверь; так дорога симметрична: влетел в дыру одной,
 * вылетел из дыры другой.
 *
 * Крест — не галактика, а корень куста: из него выпадаем в КОМНАТУ-МОНУМЕНТ (`exitBushToMonument`).
 * Возвращает: вышли ли на самом деле.
 */
function exitBushInto(session: Session, vertex: number): boolean {
  const { world, universe, bush } = session
  const node = nodeOfVertex(vertex)
  if (node === UNIVERSE.MONUMENT_NODE) return exitBushToMonument(session)
  const galaxy = universe.nodes[node]
  if (!galaxy) return false

  world.galaxySeed = galaxy.seed
  // Правки бога принадлежали ТОЙ галактике: перенести их в новую значило бы переставить
  // звёзды у чужого зерна. Уходим — забываем; новая галактика подтянет СВОЙ журнал правок
  // из сети (`sharedGalaxy` переподпишется по зерну), вернёмся — подтянется наш.
  world.galaxyDelta = emptyDelta()
  world.galaxyEpoch += 1

  const def = systemDefFor(CORE_INDEX, galaxy.seed)
  /**
   * ОКРЕСТНОСТИ ДЫРЫ, а не стандартная точка выхода в двух астроединицах: вылетел — она
   * перед носом. Ближе нельзя честно: дыра ядра — 12 солнечных масс при радиусе 152 000 км,
   * и её тяга падает как 1/d². Дыра вдвое плотнее звезды того же радиуса (`bodyMass`): на
   * сотне радиусов это ~14 м/с² — заметный тянущий фон, из которого корабль (шестнадцать g)
   * выгребает. На десятке было бы ~1400 м/с² — падение без шансов, каким бы ни был двигатель.
   */
  const holeR = def.star.radius
  enterSystem(world, def, CORE_INDEX, [0, 0, -holeR * BUSH_EXIT_RADII])
  // Дыра — единственный ориентир в ядре: делаем её нав-целью, чтобы стрелка вела назад к двери.
  world.navTargetId = world.bodies.find((b) => b.kind === 'star' || b.kind === 'blackhole')?.id ?? null

  leaveBush(bush)
  resetTorusFlight()
  resetTorusAutopilot()
  setPilot(session, 'manual')
  session.onSystemChange?.(world.epoch)
  pushWarning('bushArrive', world.time, { label: galaxy.name, repeat: 0 })
  return true
}

/**
 * ВЫХОД В КРЕСТЫ — комнату-монумент вне галактик: крест «Вечность» (дом Слова), вдали Люцифер,
 * рядом Дверь назад в клубок. Зерно галактики не трогаем: комната не принадлежит ни одной, а
 * вернувшись в клубок, окажешься у Крестов. Номер системы кадра оставляем прежним — галактическое
 * присутствие в комнате молчит (`world.inMonument`).
 */
function exitBushToMonument(session: Session): boolean {
  const { world, universe, bush } = session
  enterSystem(world, MONUMENT_SYSTEM, world.systemIndex, MONUMENT_SYSTEM.playerStart)
  world.navTargetId = world.bodies.find((b) => b.kind === 'station')?.id ?? null
  leaveBush(bush)
  resetTorusFlight()
  resetTorusAutopilot()
  setPilot(session, 'manual')
  session.onSystemChange?.(world.epoch)
  pushWarning('bushArrive', world.time, { label: universe.nodes[UNIVERSE.MONUMENT_NODE]?.name ?? MONUMENT_SYSTEM.name, repeat: 0 })
  return true
}

/** Во скольких радиусах дыры выпадает корабль. Обоснование — в `exitBushInto`. */
const BUSH_EXIT_RADII = 100

/**
 * Окно второго J, с. То же, что у бочки: в более короткое палец не всегда попадал,
 * а длиннее одиночное нажатие заметно тупит, потому что автопилот ждёт, не второе ли это.
 */
const J_TAP_WINDOW = 0.3

export function Simulation() {
  const session = useSession()
  // Отсечка уже сохранённых фактов мира (см. `saveFacts`): время последнего записанного.
  const lastFact = useRef({ value: -Infinity })
  /**
   * Жест J. 0 — не начат. Плюс — ждём второе нажатие, минус — глушим остаток дроби
   * после отмены, чтобы она не включила автопилот заново.
   */
  const jTap = useRef(0)
  const camera = useThree((state) => state.camera)
  // Полёт сквозь гипертор идёт по часам мира — в каждом такте, а не раз в кадр из слоя
  // рендера: на паузе он стоит вместе с миром, а темп не зависит от частоты монитора.
  const torusTick = useMemo<TickHook>(
    () => (dt) => {
      if (!session.bush.active) return
      stepTorusFlight(session.world.player.state.quat, dt)
      stepBushTraffic(session.world, dt)
    },
    [session],
  )

  useFrame((_, dt) => {
    const { world, controllers, intent } = session
    // Показание общих часов; календарь мира идёт тактами и лишь подтягивается к нему.
    world.calendarClock = gameTimeSec()

    /**
     * Кадр начинается с «мир стоит». Любой ранний выход ниже — гибель, док, карта,
     * меню клавиш — оставит его стоящим, и всё, что движется по реальному времени,
     * замрёт само. Один флаг, выставляемый в одном месте: искать причины паузы
     * по всему дереву компонентов значит однажды забыть одну из них.
     */
    session.running = false

    // Гибель: отпускаем курсор и останавливаем мир. Ровно один раз — дальше
    // сессия просто стоит, пока React не смонтирует новую.
    if (!world.player.alive && !session.over) {
      session.over = true
      releaseLock()
      session.onOver?.()
    }
    if (session.over) {
      jTap.current = 0
      return
    }

    // Стыковка и отчаливание — события, а не состояния кадра: сообщаем о переходе.
    if (world.docked !== session.dockedShown) {
      session.dockedShown = world.docked
      if (world.docked) {
        // Редактор сопел держит правку выхлопа в реестре рендера — на стыковке закрываем его,
        // чтобы дев-раскладка не пережила заход на станцию незамеченной.
        if (rigEditorActive()) toggleRigEditor(world)
        if (session.mode === 'autodock') setPilot(session, 'manual')
        releaseLock()
        // Плашки полёта на станцию не переходят: их время встало бы вместе с миром.
        clearWarnings()
        // Автосейв — на станции (ТЗ): пристыковался → прогресс записан. Онлайн — на сервер,
        // офлайн — в кэш.
        persistSave(serializePlayer(world))
      } else {
        // И на отчаливании: заход пишет сейв ДО покупок, и без этой записи всё купленное,
        // проданное и оговорённое у причала откатывалось рефрешем к моменту стыковки.
        persistSave(serializePlayer(world))
      }
      session.onDockChange?.(world.docked)
    }
    // В доке мир стоит, живёт только причал — это решает stepWorld. Курсор отпущен (экран
    // станции), поэтому зовём его здесь, до проверки захвата ниже.
    if (world.docked) {
      jTap.current = 0
      stepWorld(world, dt, controllers, { unassigned: aiController })
      return
    }

    /**
     * Курсор отпущен. Два случая:
     *  — ЧЕСТНАЯ ПАУЗА (титул, Escape, свёрнутая вкладка): мир замирает.
     *  — ОТКРЫТО МЕНЮ при живом фокусе (`menuFlying`): мир ЛЕТИТ ДАЛЬШЕ — можно глянуть
     *    карту «на ходу». Пилота за штурвалом нет: корабль коастит по инерции прежним
     *    курсом, без боя, слежения и роста (см. `coastController`). Свернул окно —
     *    `menuFlying` гаснет в App, и мы падаем в честную паузу выше.
     */
    if (!input.pointerLocked) {
      // Жест J не должен дозреть автопилотом, пока смотришь карту: окно сгорело вместе с курсором.
      jTap.current = 0
      clearPresses()
      if (!session.menuFlying) return

      session.running = true
      syncControllers(session)
      // Штурвал — коастящему контроллеру (или автопилоту стыковки/полёта-к-цели, если он вёл):
      // мышь на меню, пилот не рулит. Ставим ПОСЛЕ syncControllers, чтобы пересборка не вернула ввод.
      controllers.set(world.player.id, helmController(session, true))
      stepWorld(world, dt, controllers, { onTick: torusTick, unassigned: aiController })
      holdInRoom(session)
      saveFacts(world, lastFact.current)
      camera.position.add(world.originShift)
      return
    }

    // Курсор захвачен — штурвал у пилота. Мог остаться коастинг-контроллер от меню-полёта:
    // возвращаем управление (автопилоты сохраняем — их ставят L/J, а не этот кадр).
    controllers.set(world.player.id, helmController(session, false))

    // Тумблеры читаются один раз за кадр, до шага симуляции.
    //
    // Карты (`KeyM`) здесь нет намеренно: она открывается, отпуская курсор, а мир
    // без курсора не шагает — до этой строки кадр уже не доходит. Её тумблер живёт
    // в Shell, на обычном слушателе окна.
    // Пытаешься применить прибор, которого нет (или пустую обойму) — плашка объясняет,
    // почему клавиша молчит. Иначе «нажал — ничего» читается как баг, а не как «не куплено».
    // R — пилон. Тип один за раз: обычная ракета или дрон-ракета (что экипировано).
    if (consumePress('KeyR')) {
      // Пока идут четыре секунды, ракеты уже садятся на пилоны — пуск всё равно закрыт.
      const rackReady = world.player.missileReload <= 0 && world.player.missileReady > 0
      if (rackReady || droneAmmo(world.player) > 0) intent.missile = true
      else if (world.player.missileReload > 0 || missileStock(world.player) > 0) pushWarning('reloading', world.time)
      else {
        // Пусковая стоит, трюм пуст — это не «ракет нет»: модуль на месте, покупать на станции.
        const loaded = world.player.spec.mounts.some((m) => isMissile(m.weapon) || isDrone(m.weapon))
        pushWarning(loaded ? 'magEmpty' : 'noRockets', world.time)
      }
    }
    // Аукс-слот ОДИН — значит и клавиша одна: E активирует то, что в нём стоит.
    // Раньше bomb/cloak/ecm висели на B/X/E порознь, и две из трёх всегда били в
    // пустоту («прибор не установлен»). Миелофон на E работает УДЕРЖАНИЕМ (см.
    // playerController), тап-действия у него нет — поэтому если он экипирован ИЛИ лежит
    // в трюме (дев-выдача), молчим, а не выдаём ложное «не установлен».
    if (consumePress('KeyE')) {
      const l = world.player.loadout
      if (hasBomb(l)) intent.bomb = true
      else if (findCloak(l)) intent.cloak = true
      else if (hasEcm(l)) intent.ecm = true
      else if (!ownsMielophone(world.player)) pushWarning('noAux', world.time)
    }

    // Жмёшь гашетку без единого лазера на борту — то же напоминание (ракеты — своя
    // клавиша). Держание, а не тап: плашка сама не частит, её гасит кулдаун очереди.
    if (input.firing && !world.player.spec.mounts.some((m) => isLaser(m.weapon))) {
      pushWarning('noLaser', world.time)
    }
    // ДВА КРУГА листания, оба ПО УДАЛЕНИЮ (ближний первым):
    //  • Tab — КОНТАКТЫ: живые борта (персонажи) и обломки-контейнеры (останки) → захват.
    //  • Shift+Tab — НЕБЕСНЫЕ: звёзды, планеты, спутники, станции → нав-цель (станция ещё и
    //    на связь). Круги независимы: контакт и точка навигации не сбивают друг друга.
    // Когда галактика ПРОЯВИЛАСЬ (слой активен), листаются ЗВЁЗДЫ галактики (jumpTargetIndex) —
    // это единственное, что там перечислимо, поэтому берём их на любой Tab, с шифтом и без.
    // Q / Shift+Q — ближайшая из того же круга, что Tab / Shift+Tab (на галактике — звезда слоя).
    // Галактическая ветка НЕ тупиковая: улетев за сферу локатора (4–14 св.г) или оставшись
    // без соседей в дальности привода, `cycleGalaxyStar` возвращает false — и нажатие
    // достаётся обычному кругу. Иначе Tab вдали от галактики не делал ровно ничего.
    if (consumePress('Tab')) {
      // В комнате тора Tab переключает цель автопилота: выкл → дом → крест → выкл.
      // В комнате тора Tab листает БЛИЖАЙШИЕ галактики (те, что подписаны), затем крест, затем выкл.
      if (session.bush.active) cycleTorusTarget(torusNearest, TORUS.MONUMENT_NODE)
      else if (!galaxyRadar().active || !cycleGalaxyStar(world)) {
        if (isHeld('ShiftLeft') || isHeld('ShiftRight')) cycleCelestial(world)
        else cycleContact(world)
      }
    }
    if (consumePress('KeyQ')) {
      if (galaxyRadar().active) retargetNearestGalaxyStar(world)
      else if (isHeld('ShiftLeft') || isHeld('ShiftRight')) retargetNearestCelestial(world)
      else retargetNearestContact(world)
    }

    // Дев-редакторы — только в дев-сборке: у игрока «0» был бесплатной сменой корпуса мимо
    // верфи и класса, а «8» сносил базу без боя, вынимая из неё детали.
    if (import.meta.env.DEV) {
      // O — редактор ОСНАСТКИ: дула, сопла и размер корпуса за один обход. Двигаем модификатором
      // со стрелками, лазер и факел показывают правку вживую. Здесь же, у прочих тумблеров, —
      // без захваченного курсора править нечего.
      if (consumePress('KeyO')) toggleRigEditor(world)
      // 0 — следующий корпус из каталога: рама, габарит и меш меняются целиком.
      // Обойти все модели за один заход, не летая на верфь.
      if (consumePress('Digit0')) console.log('корпус:', cycleHull(world))

      // 5–9 — редактор ВОЕННОЙ БАЗЫ, что сейчас в нав-цели: диаметр, набивка деталями и
      // печать готового конфига. Без выбранной базы молчит, поэтому режима не заводим.
      stepWarBaseEditor(world)
    }

    // Пользовательский ракурс: облёт (←/→) и наезд (↑/↓), V — сброс. Чистая камера,
    // мир не трогает. Здесь, до clearPresses, чтобы тап V сработал.
    // Стрелки С МОДИФИКАТОРОМ забирает редактор оснастки — облёт остаётся на голых стрелках,
    // иначе точки пришлось бы ставить, не видя их сбоку.
    if (!stepRigEditor(dt)) stepCameraView(dt)

    if (consumePress('KeyL')) {
      /**
       * ВРЕМЕННЫЙ ВЫХОД С КУСТА. Пока нет ни рендера, ни настоящего прибытия в галактику,
       * режим куста — ловушка: манёвры отключены, и вернуть штурвал нечем. Убрать, когда
       * появится честный выход (въезд в узел → влёт в галактику).
       */
      if (session.mode === 'bush') {
        leaveBush(session.bush)
        setPilot(session, 'manual')
      }
      // L: отмена стыковки → отлип с поверхности → автопосадка → автостыковка.
      else if (session.mode === 'autodock') setPilot(session, 'manual')
      else if (world.player.landedOn) releaseLanding(world.player, world)
      else if (armAutoland(world)) { /* автопосадка пошла — ведёт домен, штурвал вернётся сам */ }
      else if (canEngageAutodock(world)) setPilot(session, 'autodock')
    }

    // J — штурвал второго пилота. Летит он: без него клавиша молчит.
    // Одно нажатие — автопилот к цели (в клубке — к выбранной галактике). Двойное — автобой.
    // Уже ведёт — одно J отдаёт штурвал и глотает второе нажатие той же дроби, чтобы
    // отмена не читалась как новый приказ. Бить нечего (планета, звезда, пустой захват) —
    // двойное нажатие не ругается, а просто летит.
    // Знак jTap: плюс — ждём, не будет ли второго нажатия; минус — глушим остаток дроби после отмены.
    const jPressed = consumePress('KeyJ')
    const copilotFlying = session.mode === 'flyto' || autofightActive(world) || (session.bush.active && torusAutopilotActive())
    if (jPressed && copilotFlying) {
      jTap.current = -J_TAP_WINDOW
      if (autofightActive(world)) disengageAutofight(world)
      if (session.mode === 'flyto') setPilot(session, 'manual')
      if (session.bush.active && torusAutopilotActive()) disengageTorusAutopilot()
    } else if (jPressed && jTap.current > 0) {
      jTap.current = 0
      if (world.copilot) {
        if (session.bush.active) {
          if (!toggleTorusAutopilot()) pushWarning('noTarget', world.time)
        } else if (engageAutofight(world)) {
          const ai = world.player.ai
          if (ai) ai.pilotRank = copilotRank(world.copilot)
        } else if (canEngageFlyTo(world)) setPilot(session, 'flyto')
        else pushWarning('noTarget', world.time)
      }
    } else if (jPressed && jTap.current < 0) {
      jTap.current = 0
    } else if (jPressed) {
      jTap.current = J_TAP_WINDOW
    } else if (jTap.current !== 0) {
      const arming = jTap.current > 0
      jTap.current = Math.abs(jTap.current) - dt
      if (jTap.current <= 0) {
        jTap.current = 0
        if (arming && world.copilot) {
          if (session.bush.active) {
            if (!toggleTorusAutopilot()) pushWarning('noTarget', world.time)
          } else if (canEngageFlyTo(world)) setPilot(session, 'flyto')
          else pushWarning('noTarget', world.time)
        }
      } else if (!arming) jTap.current = -jTap.current
    }
    // Просьба второго пилота к штурвалу: «веду к цели» или «отдаю управление». Домен режимов
    // сессии не знает — оставляет просьбу, сессия исполняет и гасит.
    if (world.helmRequest) {
      if (world.helmRequest === 'flyto' && canEngageFlyTo(world)) setPilot(session, 'flyto')
      else if (session.mode === 'flyto' || session.mode === 'autodock') setPilot(session, 'manual')
      world.helmRequest = null
    }
    // Долетели (или цель пропала) — возвращаем штурвал: автопилот-к-цели не залипает.
    if (session.mode === 'flyto' && flyToArrived(world)) setPilot(session, 'manual')

    stepBush(session)

    // ПЕРЕХОД ВЫХОДА: сам считает время, а нам сообщает единственный важный миг — «пора
    // менять мир». Экран в этот кадр чёрный, поэтому шва не видно. Идёт по реальному `dt`,
    // а не по времени мира: мир под ним как раз и пересобирается.
    if (stepBushExit(dt)) exitBushInto(session, bushExitVertex())

    // Отсюда и до конца кадра мир живёт: камера может догонять, факелы — дышать.
    session.running = true

    // Торговцы могли улететь, а новые — прилететь: у каждого должен быть пилот.
    syncControllers(session)

    // Накопитель и фиксированный шаг — внутри stepWorld.
    stepWorld(world, dt, controllers, { onTick: torusTick, unassigned: aiController })
    holdInRoom(session)
    saveFacts(world, lastFact.current)

    // Мир мог сдвинуться (плавающее начало координат). Камера живёт в мировых
    // координатах, и без этой поправки пружина преследования полсекунды тащит её
    // с четырёх километров — кадр разворачивается, и корабль влетает в него заново.
    camera.position.add(world.originShift)

    clearPresses()
  }, -100)

  return null
}
