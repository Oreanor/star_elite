import { useCallback, useEffect, useRef, useState } from 'react'
import { applyPilotProfile, interlocutor, jumpBlock, pendingHail, serializePlayer, stationInterlocutor, undock, type PilotProfile, type PlayerSave, type World } from '@elite/sim'
import { GameProvider, useSession } from './GameContext'
import { jumping, startDepart } from './control/jumpFx'
import { startUndock } from './control/undockFx'
import { negotiate, negotiatorAvailable } from './control/negotiator'
import { Game } from './Game'
import { Paused, GameOver } from './TitleScreen'
import { clearServerSave, loadServerSave, onAuthChange } from './net/account'
import { online } from './net/firebase'
import { clearPresence, publishPresence, selfPresence } from './net/presence'
import { clearSave, persistSave } from './save/saveStore'
import { input, releaseLock, requestLock } from '../platform/input/input'
import { AuthScreen } from '../ui/auth/AuthScreen'
import { Console, type ConsoleTab } from '../ui/console/Console'
import { CharacterCreation } from '../ui/create/CharacterCreation'
import { Dialogue } from '../ui/dialogue/Dialogue'
import { Dispatcher } from '../ui/dialogue/Dispatcher'
import { PlayerChat, IncomingCall } from '../ui/chat/PlayerChat'
import { subscribeInbox } from './net/chat'
import type { OnlinePlayer } from './net/presence'
import { t, useLang } from '../ui/i18n'

/**
 * Оболочка: заставка, пауза и экран гибели. Это единственное место,
 * где React вообще что-то перерисовывает.
 */
export function App() {
  // Перезапуск — новая сессия целиком. `key` пересоздаёт мир, контроллеры и сцену:
  // ни одно поле не переживёт смерть, а значит, и не привезёт с собой баг.
  const [run, setRun] = useState(0)
  const restart = () => setRun((n) => n + 1)

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
      style={{ backgroundImage: 'url(/bg.png)' }}
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
   * Чёрная пелена перехода из титула в игру. После того как корабль улетел и небо
   * секунду постояло пустым, экран гаснет в чёрное (0.4с), ПОД пеленой меняется вид
   * (титул → станция), и затем светлеет уже на игровом кадре (0.4с). Всего 0.8с.
   * Смену вида нельзя показывать «встык» — чёрный шов скрывает подмену дерева.
   */
  const [veil, setVeil] = useState(false)
  const fadeIntoGame = useCallback((swap: () => void) => {
    setVeil(true)
    window.setTimeout(() => {
      swap()
      // Под пеленой держим чёрное ещё полсекунды — не рвём переход встык, — и лишь потом
      // светлеем со следующего кадра: под пеленой уже игра, не титул.
      window.setTimeout(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => setVeil(false)))
      }, VEIL_HOLD_MS)
    }, VEIL_FADE_MS)
  }, [])

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
      if (now) setStarted(true)
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
  }, [])

  /**
   * «Полёт под меню»: открыт оверлей (карта/консоль/диалог) в ПОЛЁТЕ и окно в фокусе —
   * мир не замирает, корабль коастит (см. `session.menuFlying`). Свернул вкладку/ушёл в
   * другое окно (`blur`/hidden) — флаг гаснет, и Simulation падает в честную паузу: корабль
   * не должен лететь без присмотра. Док/гибель/титул сюда не попадают (нет `started`/есть
   * `docked`/`over`). Пересчёт и на смену оверлея, и на фокус — оба меняют условие.
   */
  useEffect(() => {
    const menuOpen = tab !== null || talking || dispatching || chatWith !== null
    const apply = () => {
      const focused = document.visibilityState === 'visible' && document.hasFocus()
      session.menuFlying = started && !over && !docked && menuOpen && focused
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
  }, [session, tab, talking, dispatching, chatWith, started, over, docked])

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
    session.world.lockedTargetId = shipId
    setTalking(true)
  }, [session])
  // «Навести» из вкладки «Люди»: захватываем борт знакомого — стрелка HUD поведёт к
  // нему. В полёте закрываем консоль, чтобы мир ожил и можно было лететь; у причала
  // лететь некуда, метку просто держим.
  const locateShip = useCallback((shipId: number) => {
    session.world.lockedTargetId = shipId
    if (!session.world.docked) closeConsole()
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
   * У причала консоль открыта всегда — M/G/I там молчат, вкладки жмут мышью. В полёте
   * та же клавиша открывает консоль на своей вкладке, при открытой переводит на неё,
   * а повторная своя — закрывает. С кем говорить, решает домен (`interlocutor`).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || over) return
      // Набор текста в поле (чат переговоров) не должен дёргать горячие клавиши:
      // «t» в реплике иначе положил бы трубку. Escape в поле пусть закрывает как всегда.
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && e.code !== 'Escape') return
      // Пока идёт кино прыжка — клавиши молчат: ни консоли, ни второго прыжка.
      if (jumping()) return

      // Браузер уже снял захват под оверлеем, так что закрыть его без Escape нечем.
      if (e.code === 'Escape') {
        if (chatWith) closeChat()
        else if (dispatching) closeDispatch()
        else if (talking) closeTalk()
        else if (!docked && tab !== null) closeConsole()
        return
      }

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
          session.world.lockedTargetId = hail.id
        }
        setTalking(true)
        releaseLock()
        return
      }

      // H — гиперпрыжок к цели, намеченной на карте галактики. Прыгать можно только
      // в полёте (у причала карта лишь метит цель), поэтому у станции клавиша молчит.
      // Точку выхода домен возьмёт из мира (`jumpArrivalPlanet`): причал или звезда.
      if (e.code === 'KeyH') {
        if (docked || talking || dispatching) return
        const target = session.world.jumpTargetIndex
        if (target == null || jumpBlock(session.world, target) !== null) return
        const planet = session.world.jumpArrivalPlanet
        startDepart(session.world, target, planet != null ? { kind: 'body', planet } : null)
        if (tab !== null) closeConsole()
        return
      }

      const wanted: ConsoleTab | null =
        e.code === 'KeyM' ? 'system' : e.code === 'KeyG' ? 'galaxy' : e.code === 'KeyI' ? 'ship' : null
      if (!wanted || talking || dispatching || docked) return

      if (tab === wanted) closeConsole()
      else if (tab === null) openConsole(wanted)
      else setTab(wanted) // консоль уже открыта, курсор отпущен — просто меняем вкладку
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, over, docked, tab, talking, dispatching, chatWith, openConsole, closeConsole, closeTalk, closeChat, closeDispatch])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Канвас — всегда: захвату курсора нужен готовый канвас уже на первом жесте.
          Тяжёлую сцену он строит только по `booted` (после нажатия СТАРТ). */}
      <Game ready={booted} />
      {/* Онлайн: раз в пару секунд шлём своё присутствие. Ничего не рисует. */}
      {online && <PresencePublisher />}
      {over ? (
        <GameOver score={session.world.score} onRestart={onRestart} />
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
        !locked && (
          <Paused
            resuming={started}
            auto={launching}
            ready={sceneReady}
            flourishRef={flourishRef}
            onFade={fadeIntoGame}
            onBoot={() => setBooted(true)}
            onDock={() => {
              setDocked(true)
              setLaunching(false)
            }}
            onNewGame={newGame}
          />
        )
      )}
      {/* Чат с живым игроком — поверх всего (консоли или разговора). Один за раз; закрыл —
          вернулся туда, откуда открыл, либо сразу поднялся ждущий входящий. */}
      {chatWith && <PlayerChat player={chatWith} onClose={closeChat} />}
      {/* Второй вызов пока занят — баннер поверх текущего окна. Заверши текущий, чтобы перейти. */}
      {waiting && <IncomingCall caller={waiting} />}

      {/* Чёрная пелена перехода из титула в игру — ПОВЕРХ всего. Под ней меняется дерево
          (титул → станция), сам шов не виден. Клики пропускает: живёт лишь 0.8с. */}
      <div
        className="pointer-events-none absolute inset-0 z-[60] bg-black"
        style={{ opacity: veil ? 1 : 0, transition: `opacity ${VEIL_FADE_MS}ms ease-in-out` }}
      />
    </div>
  )
}
