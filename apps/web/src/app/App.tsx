import { useCallback, useEffect, useRef, useState } from 'react'
import { applyPilotProfile, interlocutor, jumpBlock, pendingHail, serializePlayer, stationInterlocutor, undock, type JumpBlock, type PilotProfile, type PlayerSave, type World } from '@elite/sim'
import { GameProvider, useSession } from './GameContext'
import { closePortal, freshPortalKeyDown, jumpPortal, openPortal, portalActive, portalOpen, portalRetargetRequested } from './control/jumpPortal'
import { disposeJumpPortalWorld, resetJumpPortalWorlds } from '../render/scene/jumpPortalWorld'
import { startUndock } from './control/undockFx'
import { negotiate, negotiatorAvailable } from './control/negotiator'
import { Game } from './Game'
import { Paused, GameOver } from './TitleScreen'
import { clearServerSave, loadServerSave, onAuthChange, signOut } from './net/account'
import { online } from './net/firebase'
import { clearPresence, publishPresence, selfPresence } from './net/presence'
import { clearSave, persistSave } from './save/saveStore'
import { input, releaseLock, requestLock } from '../platform/input/input'
import { AuthScreen } from '../ui/auth/AuthScreen'
import { BushExitVeil } from '../ui/BushExitVeil'
import { Console, type ConsoleTab } from '../ui/console/Console'
import { CharacterCreation } from '../ui/create/CharacterCreation'
import { Dialogue } from '../ui/dialogue/Dialogue'
import { Dispatcher } from '../ui/dialogue/Dispatcher'
import { PlayerChat, IncomingCall } from '../ui/chat/PlayerChat'
import { subscribeInbox } from './net/chat'
import type { OnlinePlayer } from './net/presence'
import { t, useLang } from '../ui/i18n'
import { pushWarning } from '../ui/hud/warnings'

const JUMP_BLOCK_LABEL: Record<JumpBlock, Parameters<typeof t>[0]> = {
  'no-drive': 'map.block.noDrive',
  'out-of-range': 'map.block.range',
  'out-of-charge': 'map.block.charge',
  'same-system': 'map.block.here',
  docked: 'map.block.docked',
  cruising: 'map.block.cruising',
  scaled: 'map.block.scaled',
}

/**
 * Оболочка: заставка, пауза и экран гибели. Это единственное место,
 * где React вообще что-то перерисовывает.
 */
export function App() {
  // Перезапуск — новая сессия целиком. `key` пересоздаёт мир, контроллеры и сцену:
  // ни одно поле не переживёт смерть, а значит, и не привезёт с собой баг.
  const [run, setRun] = useState(0)
  const restart = () => {
    // Прогретые миры портала живут в модульных переменных и `key` их не сносит: без
    // сброса принятая после прыжка комната (World + Scene) осталась бы под ссылкой
    // навсегда, а новая сессия — с чужим прошлым за спиной.
    resetJumpPortalWorlds()
    setRun((n) => n + 1)
  }

  // Офлайн (Supabase не настроен) — сразу в игру, сейв из localStorage. Онлайн — через
  // гейт входа: сперва аккаунт, потом серверный сейв, и лишь затем мир.
  if (!online) {
    return (
      <GameProvider key={run}>
        <Shell onRestart={restart} />
      </GameProvider>
    )
  }
  return <OnlineBoot key={run} onRestart={restart} />
}

/** Простой экран-заставка с одной строкой: ждём сессию или грузим сейв. */
function BootSplash({ label }: { label: string }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black bg-cover bg-center font-mono text-[#7fd6ff]"
      style={{ backgroundImage: 'url(/bg.webp)' }}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative text-sm tracking-[0.3em]">{label}</div>
    </div>
  )
}

/**
 * Онлайн-путь: аккаунт → серверный сейв → мир. Сессию слушаем через `onAuthChange`
 * (первым событием прилетает восстановленная из куки), сейв тянем, как узнали
 * пользователя. Пока не готовы — заставка; нет входа — форма. Один источник правды о
 * входе: форму убирает не она сама, а смена сессии, которую видит эта подписка.
 */
function OnlineBoot({ onRestart }: { onRestart: () => void }) {
  useLang() // заставка/форма — на выбранном языке
  // undefined — ещё не знаем (ждём первую весть о сессии); null — не залогинен; string — id.
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  // 'loading' — тянем сейв; иначе результат (PlayerSave или null = новичок).
  const [save, setSave] = useState<PlayerSave | null | 'loading'>('loading')

  useEffect(() => onAuthChange(setUserId), [])

  useEffect(() => {
    if (!userId) {
      setSave('loading')
      return
    }
    let alive = true
    setSave('loading')
    loadServerSave()
      .then((s) => alive && setSave(s))
      .catch(() => alive && setSave(null)) // сеть подвела — считаем новичком, чем падать
    return () => {
      alive = false
    }
  }, [userId])

  if (userId === undefined) return <BootSplash label={t('auth.loading')} />
  if (userId === null) return <AuthScreen />
  if (save === 'loading') return <BootSplash label={t('auth.loading')} />

  // Ключ по пользователю: сменился аккаунт — мир пересобирается с его сейвом с нуля.
  return (
    <GameProvider key={userId} initialSave={save}>
      <Shell onRestart={onRestart} />
    </GameProvider>
  )
}

/**
 * Транслирует присутствие игрока (имя, система, место, позиция) раз в пару секунд, пока
 * идёт игра. Ничего не рисует. Позиция — абсолютная (`state.pos + originOffset`), чтобы
 * у всех сходилась. onDisconnect на стороне RTDB уберёт метку, если вкладку закрыли резко;
 * размонтирование (выход в меню) снимает её сразу через `clearPresence`.
 */
function PresencePublisher() {
  const session = useSession()
  useEffect(() => {
    const push = () => {
      const w = session.world
      // «Отошёл» = мир не идёт (курсор отпущен: меню/разговор). Но при враге рядом — нет:
      // паузой нельзя исчезать из боя (чит). Тогда остаёшься в игре, метка не гаснет.
      const paused = !input.pointerLocked && !threatened(w)
      void publishPresence(selfPresence(w, paused))
    }
    push()
    const id = window.setInterval(push, 2000)
    return () => {
      window.clearInterval(id)
      void clearPresence()
    }
  }, [session])
  return null
}

/**
 * Есть ли рядом враг, при котором «отойти» (пауза-исчезновение) запрещено. Радиус щедрый:
 * любой живой враждебный — или затаивший обиду — борт в этих пределах держит тебя в игре.
 * Пока рендера чужих бортов нет, флаг лишь гасит аватар; правило заведено на будущее, чтобы
 * поведение было верным, когда борта появятся. Тогда этой проверке место в домене.
 */
const AWAY_BLOCK_RANGE = 20_000 // м
function threatened(w: World): boolean {
  const p = w.player.state.pos
  return w.ships.some(
    (s) => s.alive && (s.faction === 'hostile' || (s.ai?.grievance ?? 0) > 0) && s.state.pos.distanceTo(p) < AWAY_BLOCK_RANGE,
  )
}

/** Затемнение/просветление перехода из титула в игру, мс каждое. */
const VEIL_FADE_MS = 400
/** Держим чёрное между затемнением и просветлением, мс: переход не рвётся встык. */
const VEIL_HOLD_MS = 500

function Shell({ onRestart }: { onRestart: () => void }) {
  const session = useSession()
  const [locked, setLocked] = useState(false)
  const [over, setOver] = useState(false)
  const [docked, setDocked] = useState(false)
  /**
   * Игра уже начиналась. Тогда та же заставка — это ПАУЗА, и кнопка на ней
   * возвращает в игру, а не начинает её. Экран один, смысл разный.
   */
  const [started, setStarted] = useState(false)
  /**
   * Открытая вкладка консоли, или `null` — консоль закрыта. У причала открыта всегда;
   * в полёте её раскрывают M/G/I на нужной вкладке. Оверлей ставит мир на паузу
   * (отпускает курсор), поэтому одно состояние на всю панель.
   */
  const [tab, setTab] = useState<ConsoleTab | null>(null)
  /**
   * Меню паузы раскрыто ЯВНО. В полёте оно не нужно как состояние: Escape отбирает у
   * браузера захват курсора, и меню всплывает по `locked`. У ПРИЧАЛА захвата нет —
   * отпускать нечего, и без этого флага Escape на станции не делал ничего.
   */
  const [menu, setMenu] = useState(false)
  /** Открыт ли канал связи. Отдельный оверлей: ни вкладок, ни причала у него нет. */
  const [talking, setTalking] = useState(false)
  /** Сбрасывает вкладку «Люди» после разговора — знакомство и фильтр дублей. */
  const [peopleRefresh, setPeopleRefresh] = useState(0)
  /** Открыта ли связь с ДИСПЕТЧЕРОМ станции. Свой оверлей, как разговор с бортом. */
  const [dispatching, setDispatching] = useState(false)
  /** Живой игрок, с кем СЕЙЧАС открыт чат. Ровно один за раз — как разговор по T. */
  const [chatWith, setChatWith] = useState<OnlinePlayer | null>(null)
  /** Второй вызов, пришедший пока ты занят: висит баннером, пока не освободишься. */
  const [waiting, setWaiting] = useState<OnlinePlayer | null>(null)
  // Читаем актуальные «занят?» и «с кем чат» из стабильного колбэка инбокса без пересборки
  // подписки: иначе onChildAdded переигрывал бы при каждом изменении состояния.
  const busyRef = useRef(false)
  const chatUidRef = useRef<string | null>(null)
  const waitingRef = useRef<OnlinePlayer | null>(null)
  useEffect(() => {
    busyRef.current = talking || chatWith !== null || dispatching
    chatUidRef.current = chatWith?.uid ?? null
    waitingRef.current = waiting
  }, [talking, chatWith, waiting, dispatching])

  /**
   * Сцена строится по нажатию СТАРТ, а не при загрузке страницы.
   *
   * Сборка занимает одну задачу на секунду с лишним: небо в полмиллиона пикселей,
   * геометрия планет, компиляция шейдеров. Всё это время главный поток занят, а
   * значит браузер НЕ ОБРАБАТЫВАЕТ движение мыши — и форма курсора, и `:hover`
   * пересчитываются только по нему. Кнопка «СТАРТ» выглядела мёртвой ровно
   * столько, сколько строилась сцена, которую под ней всё равно не видно:
   * заставка непрозрачна.
   *
   * Теперь секунда ожидания приходится на ПОСЛЕ нажатия, где она читается как
   * загрузка, а не как поломка. Захват курсора в это время не даётся (канваса
   * ещё нет), и кнопка сама повторяет запрос, пока сцена не встанет.
   */
  const [booted, setBooted] = useState(false)
  // Сцена реально ПОСТРОЕНА — по этому сигналу титул даёт «вжух». `booted` лишь запускает
  // сборку (тяжёлый рендер сцены), а этот эффект срабатывает уже ПОСЛЕ её коммита: два кадра
  // rAF гарантируют, что сцена собрана и отрисована, а не «помечена к сборке». Надёжнее, чем
  // useFrame внутри Canvas (тот мог не тикать до захвата курсора) — оттого «вжуха» и не было.
  const [sceneReady, setSceneReady] = useState(false)
  useEffect(() => {
    if (!booted) return
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setSceneReady(true))
    })
    // Подстраховка: если rAF почему-то не отработал (был заморожен сборкой и т.п.), всё равно
    // объявляем готовность — иначе «вжуха» и перехода не будет вовсе («не улетает»).
    const fallback = window.setTimeout(() => setSceneReady(true), 2000)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(fallback)
    }
  }, [booted])

  /**
   * Новичок только что слепил пилота и запускается: Paused проигрывает флориш взлёта
   * (корабль улетает), затем строит сцену и сажает игрока на станцию. Флаг живёт лишь
   * этот переход — гаснет, как только показан док.
   */
  const [launching, setLaunching] = useState(false)
  // Пока идёт ФЛОРИШ взлёта (титул, до «вжуха» и перехода) — стартовую стыковку из сима
  // ИГНОРИРУЕМ, иначе станция всплыла бы панелью и накрыла улетающий корабль. Управляет
  // флагом сам Paused: взводит на старте флориша, снимает на переходе.
  const flourishRef = useRef(false)

  /**
   * Чёрная пелена перехода из титула в игру. После улёта корабля экран гаснет,
   * ПОД пеленой титул снимается (иначе после fade снова пустая заставка — захват
   * курсора ещё не пришёл), светлеем уже на игре.
   */
  const [veil, setVeil] = useState(false)
  /** Под пеленой / пока ждём lock после интро — титул не монтируем. */
  const [enterPlay, setEnterPlay] = useState(false)
  const enterPlayRef = useRef(false)
  enterPlayRef.current = enterPlay

  /**
   * Poll захвата живёт в Shell, не в TitleScreen: под пеленой Paused размонтируется,
   * и его таймер умирал — мир замирал без lock, пока не кликнешь по канвасу.
   */
  const lockPollRef = useRef<number | null>(null)
  const stopLockPoll = useCallback(() => {
    if (lockPollRef.current !== null) {
      window.clearTimeout(lockPollRef.current)
      lockPollRef.current = null
    }
  }, [])
  const startLockPoll = useCallback(() => {
    stopLockPoll()
    const deadline = performance.now() + 8000
    const tick = () => {
      lockPollRef.current = null
      void requestLock().then((ok) => {
        if (ok || input.pointerLocked) {
          stopLockPoll()
          return
        }
        if (performance.now() >= deadline) {
          stopLockPoll()
          // Уже в игре — не выкидываем на титул; клик по канвасу доберёт захват.
          if (enterPlayRef.current) return
          setEnterPlay(false)
          setStarted(false)
          return
        }
        lockPollRef.current = window.setTimeout(tick, 200)
      })
    }
    void requestLock().then((ok) => {
      if (ok || input.pointerLocked) return
      lockPollRef.current = window.setTimeout(tick, 200)
    })
  }, [stopLockPoll])

  useEffect(() => () => stopLockPoll(), [stopLockPoll])

  const fadeIntoGame = useCallback(
    (swap: () => void) => {
      setVeil(true)
      window.setTimeout(() => {
        // Сразу под чёрным: игра началась, заставку убрать — не ждать pointer lock.
        setStarted(true)
        setLaunching(false)
        // Если START уже дал lock, после снятия титула сразу живём как обычная игра.
        // enterPlay нужен только когда lock не пришёл и следующий клик должен добрать его.
        setEnterPlay(!input.pointerLocked)
        swap()
        // Paused сейчас снимется — его poll умер бы; продолжаем здесь.
        if (!session.world.docked) startLockPoll()
        window.setTimeout(() => {
          requestAnimationFrame(() => requestAnimationFrame(() => setVeil(false)))
        }, VEIL_HOLD_MS)
      }, VEIL_FADE_MS)
    },
    [session, startLockPoll],
  )

  /**
   * Персонаж уже создан. Новичку (сейва не было) сперва показываем экран создания —
   * до всякого старта сцены; вернувшемуся игроку создавать нечего. Экран — не пауза:
   * он живёт вместо титульного меню, пока личность не выбрана.
   */
  const [created, setCreated] = useState(!session.isNewGame)

  /**
   * Захват курсора браузер снимает не только по `pointerlockchange`: уход фокуса
   * и скрытие вкладки делают это молча. Не переспросив, оверлей паузы остался бы
   * невидимым — а мир при этом стоит, и игра выглядит намертво зависшей.
   */
  useEffect(() => {
    const sync = () => {
      const now = input.pointerLocked
      setLocked(now)
      if (now) {
        // START берёт lock заранее, пока титульный корабль ещё дрожит/улетает. До fade
        // это всё ещё титул: смена resuming оборвала бы эффект, который ждёт ready.
        if (!flourishRef.current) {
          setStarted(true)
          setEnterPlay(false)
        }
        stopLockPoll()
      }
    }
    document.addEventListener('pointerlockchange', sync)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      document.removeEventListener('pointerlockchange', sync)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
    }
  }, [stopLockPoll])

  /**
   * «Полёт под меню»: открыт оверлей (карта/консоль/диалог) в ПОЛЁТЕ и окно в фокусе —
   * мир не замирает, корабль коастит (см. `session.menuFlying`). Свернул вкладку/ушёл в
   * другое окно (`blur`/hidden) — флаг гаснет, и Simulation падает в честную паузу: корабль
   * не должен лететь без присмотра. Док/гибель/титул сюда не попадают (нет `started`/есть
   * `docked`/`over`).
   *
   * `enterPlay` — то же: после интро титул снят, а pointer lock ещё может не прийти
   * (жест клика сгорел). Без флага мир стоял бы мёртвым, пока не кликнешь по канвасу.
   */
  useEffect(() => {
    const menuOpen = tab !== null || talking || dispatching || chatWith !== null
    const apply = () => {
      const focused = document.visibilityState === 'visible' && document.hasFocus()
      session.menuFlying =
        started && !over && !docked && focused && (menuOpen || enterPlay)
    }
    apply()
    window.addEventListener('focus', apply)
    window.addEventListener('blur', apply)
    document.addEventListener('visibilitychange', apply)
    return () => {
      window.removeEventListener('focus', apply)
      window.removeEventListener('blur', apply)
      document.removeEventListener('visibilitychange', apply)
      session.menuFlying = false
    }
  }, [session, tab, talking, dispatching, chatWith, started, over, docked, enterPlay])

  // Симуляция сообщает о событиях один раз, из кадра. React узнаёт о них отсюда.
  useEffect(() => {
    session.onOver = () => setOver(true)
    session.onDockChange = (d) => {
      // Во время флориша взлёта (новая игра И «продолжить») стыковку из сима ИГНОРИРУЕМ:
      // док покажем сами, ПОСЛЕ «вжуха». Иначе станция накрывает панелью улетающий корабль.
      if (d && flourishRef.current) return
      setDocked(d)
      // Пристыковались — консоль открыта на планете; отчалили — закрыта.
      setTab(d ? 'planet' : null)
    }
    return () => {
      session.onOver = null
      session.onDockChange = null
    }
  }, [session])

  // Раскрыть консоль — отпустить курсор: без него кадр до чтения клавиш не доходит
  // (пауза это и есть отпущенный курсор). Закрыть — вернуть захват, мир оживает.
  const openConsole = useCallback((next: ConsoleTab) => {
    setTab(next)
    releaseLock()
  }, [])
  const closeConsole = useCallback(() => {
    setTab(null)
    void requestLock()
  }, [])
  const closeTalk = useCallback(() => {
    setTalking(false)
    setPeopleRefresh((n) => n + 1)
    // Пока говорил с ботом, позвал живой игрок — сразу поднимаем его окно (курсор так и
    // отпущен). Иначе у причала возвращаемся в консоль, в полёте — забираем захват.
    const next = waitingRef.current
    if (next) {
      setWaiting(null)
      setChatWith(next)
      return
    }
    if (!session.world.docked) void requestLock()
  }, [session])

  // Закрыть связь с диспетчером: разговор со станцией всегда в полёте (в доке T молчит),
  // поэтому просто возвращаем захват. Отдельно от `closeTalk` — это другой оверлей.
  const closeDispatch = useCallback(() => {
    setDispatching(false)
    void requestLock()
  }, [])
  // Открыть разговор с живым игроком — ровно как с ботом по T: окно на весь экран, курсор
  // отпущен (значит мир на паузе). Занят (говоришь с ботом или уже в чате) — новый вызов не
  // перебивает текущий, а встаёт баннером «входящий»: закончишь один — перейдёшь к другому.
  // Стабильна (без deps): актуальное состояние читаем через ref-ы, чтобы подписку инбокса
  // не пересобирать. Тот же путь и для клика «СВЯЗАТЬСЯ», и для входящего пинга.
  const hail = useCallback((player: OnlinePlayer) => {
    if (chatUidRef.current === player.uid) return
    if (busyRef.current) {
      setWaiting(player)
      return
    }
    setChatWith(player)
    releaseLock()
  }, [])
  // Положить трубку: есть входящий — сразу поднимаем его (окно не гаснет, курсор так и
  // отпущен); нет — закрываем и в полёте возвращаем захват, мир оживает.
  const closeChat = useCallback(() => {
    const next = waitingRef.current
    if (next) {
      setWaiting(null)
      setChatWith(next)
      return
    }
    setChatWith(null)
    if (!session.world.docked) void requestLock()
  }, [session])

  // Входящие вызовы: живой игрок написал — окно всплывает само, как разговор по T (или
  // встаёт баннером, если занят). Подписываемся на инбокс ТОЛЬКО когда вход подтверждён:
  // firebase восстанавливает сессию асинхронно, а subscribeInbox без uid тихо не слушает —
  // раньше из-за этого входящие «не выпрыгивали», пока сам не откроешь. `hail` стабильна.
  useEffect(() => {
    if (!online) return
    let stop = () => {}
    const off = onAuthChange((uid) => {
      stop()
      stop = uid ? subscribeInbox(hail) : () => {}
    })
    return () => {
      stop()
      off()
    }
  }, [hail])

  // Клик по пристыкованному пилоту в доке: наводимся на него и открываем канал.
  // Курсор у причала уже свободен, мир стоит — только показать окно разговора.
  const talkTo = useCallback((shipId: number) => {
    const w = session.world
    w.navTargetId = null
    w.lockedStationId = null
    w.lockedPodId = null
    w.lockedAsteroidId = null
    w.lockedTargetId = shipId
    w.targetFocus = 'contact'
    setTalking(true)
  }, [session])
  // «Навести» из вкладки «Люди»: захватываем борт знакомого — стрелка HUD поведёт к
  // нему. В полёте закрываем консоль, чтобы мир ожил и можно было лететь; у причала
  // лететь некуда, метку просто держим.
  const locateShip = useCallback((shipId: number) => {
    const w = session.world
    w.navTargetId = null
    w.lockedStationId = null
    w.lockedPodId = null
    w.lockedAsteroidId = null
    w.lockedTargetId = shipId
    w.targetFocus = 'contact'
    if (!w.docked) closeConsole()
  }, [session, closeConsole])
  // «Проложить курс» к знакомому в другой системе: метим её целью прыжка и переводим
  // на карту галактики — там виден маршрут, а H в полёте прыгнет по этой метке.
  const routeTo = useCallback((systemIndex: number) => {
    session.world.jumpTargetIndex = systemIndex
    setTab('galaxy')
  }, [session])
  // У причала кнопка шапки отчаливает: отойдя от кольца, корабль оживает захватом.
  // Вместе с доменным отчаливанием запускаем кино вылета — тоннель и обгон камеры.
  const undockAndResume = useCallback(() => {
    undock(session.world)
    startUndock()
    void requestLock()
  }, [session])
  // Создание пилота завершено: накладываем профиль на борт игрока и пишем стартовый
  // сейв (личность + начальная позиция), чтобы вернувшийся игрок не создавал заново.
  // Дальше прогресс сохраняется по стыковке. Мутирует мир слой app, не ui-форма.
  const createPilot = useCallback(
    (profile: PilotProfile) => {
      applyPilotProfile(session.world.player, profile)
      persistSave(serializePlayer(session.world))
      session.isNewGame = false
      setCreated(true)
      // Дальше — тот же старт, что по «Продолжить»: корабль срывается и улетает (флориш
      // титульного экрана), а как сцена построится — новичок садится на станцию. `launching`
      // включает у Paused авто-старт; захват курсора не берём — новичок ПРИСТЫКОВАН.
      setLaunching(true)
    },
    [session],
  )

  // «Новая игра»: стираем сейв — и локальный кэш, и серверную правду (иначе загрузка
  // снова подтянула бы старого пилота) — и пересобираем сессию с нуля. `onRestart`
  // бампает key всей сессии: чистый мир → новичок → экран создания персонажа.
  const newGame = useCallback(async () => {
    clearSave()
    if (online) await clearServerSave().catch((e) => console.warn('Сброс серверного сейва не удался:', e))
    onRestart()
  }, [onRestart])

  /**
   * Оверлеи переключаются ЗДЕСЬ, а не в кадре симуляции: тумблер, живущий внутри
   * того, что он останавливает, закрыть себя не сможет. Раскрыт всегда РОВНО ОДИН
   * оверлей (консоль ИЛИ канал связи): два флага паузы однажды разошлись бы, и мир
   * остался бы стоять под закрытым окном.
   *
   * M/G/I — карта системы / галактики / корабль (верфь у причала) — одинаково и в доке,
   * и в полёте. У причала консоль всегда открыта: клавиша только меняет вкладку; повтор
   * своей — назад на «станция». В полёте: открыть / переключить / повтор — закрыть.
   * С кем говорить — `interlocutor`.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || over) return
      // Набор текста в поле (чат переговоров) не должен дёргать горячие клавиши:
      // «t» в реплике иначе положил бы трубку. Escape в поле пусть закрывает как всегда.
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && e.code !== 'Escape') return
      // Браузер уже снял захват под оверлеем, так что закрыть его без Escape нечем.
      if (e.code === 'Escape') {
        if (portalOpen()) {
          closePortal()
          disposeJumpPortalWorld()
          return
        }
        if (chatWith) closeChat()
        else if (dispatching) closeDispatch()
        else if (talking) closeTalk()
        else if (menu) setMenu(false)
        // У ПРИЧАЛА консоль закрывать некуда (она и есть станция), поэтому Escape там
        // означает ровно то же, что в полёте, — меню паузы. Второй Escape его закроет.
        else if (docked) setMenu(true)
        else if (tab !== null) closeConsole()
        return
      }
      // Под раскрытым меню паузы горячие клавиши молчат: игра стоит, и M/G/I/T/H не должны
      // менять её из-под заставки. Escape выше — единственный выход, он уже обработан.
      if (menu) return

      if (e.code === 'KeyT') {
        if (docked || tab !== null || talking || chatWith || dispatching) return
        // Захвачена СТАНЦИЯ — T вызывает её диспетчера (свой оверлей). Проверяем первой:
        // при захвате станции `lockedTargetId` пуст, так что с бортами это не конфликтует.
        if (stationInterlocutor(session.world)) {
          setDispatching(true)
          releaseLock()
          return
        }
        // Иначе говорим с ЗАХВАЧЕННЫМ бортом. Но если по связи вызывает обиженный (ты его
        // задел), T отвечает ему — наводимся на него и открываем канал, чтобы разрядить
        // претензию, пока она не перелилась во враги.
        if (!interlocutor(session.world)) {
          const hail = pendingHail(session.world)
          if (!hail) return
          const w = session.world
          w.navTargetId = null
          w.lockedStationId = null
          w.lockedPodId = null
          w.lockedAsteroidId = null
          w.lockedTargetId = hail.id
          w.targetFocus = 'contact'
        }
        setTalking(true)
        releaseLock()
        return
      }

      // H — удерживаемое раскрытие портала. Отпустил и удержал снова — сжатие;
      // другая цель заменяет прежнюю пару, Esc остаётся аварийным мгновенным закрытием.
      if (e.code === 'KeyH') {
        // Размер читает покадровое состояние isHeld. Браузерный key-repeat здесь нельзя
        // считать новой командой: выбранная цель ещё не очищена, и каждый повтор заново
        // создавал тот же портал с нулевого радиуса — визуально H иногда «не реагировала».
        if (!freshPortalKeyDown(e.repeat)) return
        if (docked || talking || dispatching) return
        // Из КОМНАТЫ прыжка нет: она внутренность дыры, и выход из неё один — долететь
        // навигатором до галактики. Карта галактики там открыта как обзор, и без этой
        // проверки намеченная на ней цель уводила бы порталом мимо всей дороги.
        if (session.bush.active) {
          pushWarning('noJump', session.world.time, { label: t('hud.noJumpInRoom'), repeat: 0 })
          return
        }
        const target = session.world.jumpTargetIndex
        const active = portalActive()
        if (active) {
          if (jumpPortal().committing) return
          // Повтор H к УЖЕ ВЫБРАННОЙ цели — не приказ, а продолжение раскрытия того же
          // кольца: `openPortal` не чистит `jumpTargetIndex`, и без этой проверки каждое
          // нажатие пересобирало бы готовую пару заново. Любая ДРУГАЯ цель — приказ.
          if (!portalRetargetRequested(target)) return
        }
        if (target == null) {
          pushWarning('noTarget', session.world.time, {
            label: t('hud.noJumpTarget'),
            repeat: 0,
          })
          return
        }
        const blocked = jumpBlock(session.world, target)
        if (blocked !== null) {
          // Явное нажатие обязано отвечать каждый раз: общий cooldown `noJump` не должен
          // превращать новую причину отказа после выбора системы в молчание.
          pushWarning('noJump', session.world.time, {
            label: t(JUMP_BLOCK_LABEL[blocked]),
            repeat: 0,
          })
          return
        }
        if (active) {
          closePortal()
          disposeJumpPortalWorld()
        }
        const planet = session.world.jumpArrivalPlanet
        openPortal(
          session.world,
          target,
          planet != null ? { kind: 'body', planet } : null,
          performance.now() / 1000,
        )
        if (tab !== null) closeConsole()
        return
      }

      // M/G/I — система / галактика / корабль (у причала — та же верфь). И там, и там:
      // открыть вкладку; повтор своей — назад (в доке на «станцию», в полёте — закрыть).
      const wanted: ConsoleTab | null =
        e.code === 'KeyM' ? 'system' : e.code === 'KeyG' ? 'galaxy' : e.code === 'KeyI' ? 'ship' : null
      if (!wanted || talking || dispatching || chatWith) return

      if (docked) {
        // Консоль уже на экране: только вкладка. `tab` после флориша может быть null, хотя
        // рисуется «станция» (`tab ?? 'planet'`) — сравниваем с тем, что видит игрок.
        const current = tab ?? 'planet'
        if (current === wanted) setTab('planet')
        else setTab(wanted)
        return
      }

      if (tab === wanted) closeConsole()
      else if (tab === null) openConsole(wanted)
      else setTab(wanted)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, over, docked, menu, tab, talking, dispatching, chatWith, openConsole, closeConsole, closeTalk, closeChat, closeDispatch])

  /**
   * Меню паузы — ОДНА панель на три случая: титул, пауза в полёте (курсор отпущен) и
   * пауза у причала (`menu`). Собрано в переменную, а не написано дважды: два экземпляра
   * с разными пропсами однажды разъехались бы по поведению кнопок.
   *
   * «Продолжить» у причала возвращает в консоль станции — сцена уже построена, захват
   * курсора там не нужен, поэтому весь возврат и есть закрытие меню в `onBoot`.
   */
  const pauseMenu = (
    <Paused
      resuming={started}
      auto={launching}
      ready={sceneReady}
      flourishRef={flourishRef}
      onFade={fadeIntoGame}
      onBoot={() => {
        setBooted(true)
        setMenu(false)
      }}
      onDock={() => {
        setDocked(true)
        // Как при обычной стыковке: консоль на вкладке станции (не null — иначе M/G
        // сравнивают с пустым tab и ведут себя непредсказуемо).
        setTab('planet')
        setLaunching(false)
        setEnterPlay(false) // док уже на экране — подавлять титул больше нечем
      }}
      onLockFailed={() => {
        // Сдались, пока титул ещё на экране. Уже в enterPlay — Shell.poll / клик.
        if (enterPlayRef.current) return
        setEnterPlay(false)
        setStarted(false)
      }}
      onNewGame={newGame}
      onSignOut={
        online
          ? () => {
              void signOut().then(onRestart).catch((e) => console.warn('Выход не удался:', e))
            }
          : undefined
      }
    />
  )

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Канвас — всегда: захвату курсора нужен готовый канвас уже на первом жесте.
          Тяжёлую сцену он строит только по `booted` (после нажатия СТАРТ). */}
      <Game ready={booted} />
      {/* Онлайн: раз в пару секунд шлём своё присутствие. Ничего не рисует. */}
      {online && <PresencePublisher />}
      {over ? (
        <GameOver score={session.world.score} onRestart={onRestart} />
      ) : menu ? (
        // Пауза, вызванная Escape (у причала — единственный способ её увидеть): меню
        // накрывает станцию целиком, как накрывает полёт отпущенный курсор.
        pauseMenu
      ) : talking ? (
        <Dialogue onClose={closeTalk} negotiate={negotiate} chatAvailable={negotiatorAvailable()} />
      ) : dispatching ? (
        <Dispatcher world={session.world} onClose={closeDispatch} />
      ) : docked || tab !== null ? (
        // Одна консоль и в полёте, и у причала: планета, корабль, груз, карты (плюс
        // верфь и магазин у причала). «Открыть карту» — раскрыть эту панель на нужной
        // вкладке, а не окно поверх окна.
        <Console
          world={session.world}
          docked={docked}
          tab={tab ?? 'planet'}
          onTab={setTab}
          onClose={docked ? undockAndResume : closeConsole}
          onTalk={talkTo}
          onLocate={locateShip}
          onRoute={routeTo}
          onChat={hail}
          peopleRefresh={peopleRefresh}
        />
      ) : !created ? (
        // Новичок сначала лепит пилота — экран стоит вместо титульного меню, до старта.
        <CharacterCreation world={session.world} onSubmit={createPilot} />
      ) : (
        // Первый клик берёт pointer lock до конца титульного флориша. Сам по себе lock
        // не должен размонтировать Paused: его эффект ещё ждёт ready и запускает fade.
        // После интро enterPlay скрывает титул, если lock так и не пришёл.
        (!locked || flourishRef.current) && !enterPlay && pauseMenu
      )}
      {/* Чат с живым игроком — поверх всего (консоли или разговора). Один за раз; закрыл —
          вернулся туда, откуда открыл, либо сразу поднялся ждущий входящий. */}
      {chatWith && <PlayerChat player={chatWith} onClose={closeChat} />}
      {/* Второй вызов пока занят — баннер поверх текущего окна. Заверши текущий, чтобы перейти. */}
      {waiting && <IncomingCall caller={waiting} />}

      {/* Выход из комнаты вселенной: тор разлетается, экран гаснет, и из растущей круглой
          прорези проявляется галактика. Мир под пеленой подменяется в самой её черноте. */}
      <BushExitVeil />

      {/* Чёрная пелена перехода из титула в игру — ПОВЕРХ всего. Под ней меняется дерево
          (титул → станция), сам шов не виден. Клики пропускает: живёт лишь 0.8с. */}
      <div
        className="pointer-events-none absolute inset-0 z-[60] bg-black"
        style={{ opacity: veil ? 1 : 0, transition: `opacity ${VEIL_FADE_MS}ms ease-in-out` }}
      />
    </div>
  )
}
