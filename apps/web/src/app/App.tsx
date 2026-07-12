import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { applyPilotProfile, interlocutor, jumpBlock, pendingHail, serializePlayer, stationInterlocutor, undock, type PilotProfile, type PlayerSave, type World } from '@elite/sim'
import { GameProvider, useSession } from './GameContext'
import { jumping, startDepart } from './control/jumpFx'
import { negotiate, negotiatorAvailable } from './control/negotiator'
import { Game } from './Game'
import { clearServerSave, loadServerSave, onAuthChange } from './net/account'
import { online } from './net/firebase'
import { clearPresence, publishPresence, selfPresence } from './net/presence'
import { clearSave, persistSave } from './save/saveStore'
import { TitleStars } from './TitleStars'
import { input, releaseLock, requestLock } from '../platform/input/input'
import { AuthScreen } from '../ui/auth/AuthScreen'
import { Console, type ConsoleTab } from '../ui/console/Console'
import { CharacterCreation } from '../ui/create/CharacterCreation'
import { Dialogue } from '../ui/dialogue/Dialogue'
import { Dispatcher } from '../ui/dialogue/Dispatcher'
import { PlayerChat, IncomingCall } from '../ui/chat/PlayerChat'
import { subscribeInbox } from './net/chat'
import type { OnlinePlayer } from './net/presence'
import { setLang, t, useLang, type Key, type Lang } from '../ui/i18n'
import { Tabs } from '../ui/station/chrome'

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

  // Симуляция сообщает о событиях один раз, из кадра. React узнаёт о них отсюда.
  useEffect(() => {
    session.onOver = () => setOver(true)
    session.onDockChange = (d) => {
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
  const undockAndResume = useCallback(() => {
    undock(session.world)
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
        />
      ) : !created ? (
        // Новичок сначала лепит пилота — экран стоит вместо титульного меню, до старта.
        <CharacterCreation onSubmit={createPilot} />
      ) : (
        !locked && <Paused resuming={started} onBoot={() => setBooted(true)} onNewGame={newGame} />
      )}
      {/* Чат с живым игроком — поверх всего (консоли или разговора). Один за раз; закрыл —
          вернулся туда, откуда открыл, либо сразу поднялся ждущий входящий. */}
      {chatWith && <PlayerChat player={chatWith} onClose={closeChat} />}
      {/* Второй вызов пока занят — баннер поверх текущего окна. Заверши текущий, чтобы перейти. */}
      {waiting && <IncomingCall caller={waiting} />}
    </div>
  )
}

/**
 * Таблица клавиш — из словаря и СГРУППИРОВАНА по смыслу: пилотирование, бой,
 * корабль и мир. Пары «клавиша / что делает» по ключам `key.X` и `key.X.what`.
 * Группы разложены по вкладкам: показываем один блок за раз, а не три колонки
 * сразу — так на экране один связный список, а не стена из семнадцати строк.
 */
const KEY_GROUPS: { title: Key; rows: [Key, Key][] }[] = [
  {
    title: 'keys.group.flight',
    rows: [
      ['key.mouse', 'key.mouse.what'],
      ['key.throttle', 'key.throttle.what'],
      ['key.rmb', 'key.rmb.what'],
      ['key.roll', 'key.roll.what'],
      ['key.barrel', 'key.barrel.what'],
      ['key.loop', 'key.loop.what'],
      ['key.reversal', 'key.reversal.what'],
      ['key.retro', 'key.retro.what'],
      ['key.cruise', 'key.cruise.what'],
    ],
  },
  {
    title: 'keys.group.combat',
    rows: [
      ['key.fire', 'key.fire.what'],
      ['key.target', 'key.target.what'],
      ['key.autofight', 'key.autofight.what'],
      ['key.missile', 'key.missile.what'],
      ['key.ecm', 'key.ecm.what'],
      ['key.bomb', 'key.bomb.what'],
      ['key.cloak', 'key.cloak.what'],
      ['key.drone', 'key.drone.what'],
    ],
  },
  {
    title: 'keys.group.ship',
    rows: [
      ['key.tractor', 'key.tractor.what'],
      ['key.dock', 'key.dock.what'],
      ['key.ship', 'key.ship.what'],
      ['key.system', 'key.system.what'],
      ['key.galaxy', 'key.galaxy.what'],
      ['key.talk', 'key.talk.what'],
      ['key.view', 'key.view.what'],
      ['key.pause', 'key.pause.what'],
    ],
  },
]

/**
 * `onPointerDown`, а не `onClick`. Клик приходит по ОТПУСКАНИЮ кнопки, и между
 * нажатием и стартом игры лежит вся длина движения пальца вверх — кнопка кажется
 * тугой. Захвату курсора нажатия достаточно: это тот же жест пользователя.
 */
/**
 * Голубоватая панель-модалка заставки — общая для меню, клавиш и настроек. Размер
 * фиксированный и с запасом: переключение экранов не должно её ресайзить, а на бликах
 * корабля тексту нужна ровная подложка. Полупрозрачна, с размытием и скруглением;
 * корабль просвечивает, но шрифт держится на своём фоне. Самый высокий экран (клавиши)
 * влезает целиком, оттого высота задана заранее, а не тянется по содержимому.
 */
function MenuPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-[29rem] w-[34rem] max-w-[92vw] flex-col items-center justify-center gap-4
                 overflow-y-auto rounded-2xl border p-8 backdrop-blur-md"
      style={{ borderColor: 'rgba(63,115,145,0.7)', background: 'rgba(20,44,74,0.38)' }}
    >
      {children}
    </div>
  )
}

function MenuButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={onClick}
      // Заливка и размытие — как у стеклянной плашки (rgba(20,44,74,0.38)): на пёстром
      // фоне титула 8%-я муть тонула, а эта читается. Наведение по-прежнему заливает целиком.
      className="w-56 cursor-pointer border border-[#7fd6ff] bg-[#142c4a]/[0.38] px-8 py-3 text-base
                 backdrop-blur-md tracking-[0.3em] text-[#7fd6ff] transition-colors
                 hover:bg-[#7fd6ff] hover:text-black
                 disabled:cursor-wait disabled:border-[#3f7391] disabled:bg-transparent
                 disabled:text-[#3f7391]"
    >
      {children}
    </button>
  )
}

/**
 * Заставка и пауза. Кликаются только КНОПКИ, а не весь экран.
 *
 * Раньше оверлей целиком был одной кнопкой: захват курсора просил канвас под ним,
 * и промахнуться было нельзя. Но экран-кнопка ловит и случайный клик по тексту.
 *
 * Таблица клавиш живёт за отдельной кнопкой: на первом экране она загораживала
 * логотип и требовала прочесть семнадцать строк раньше, чем взлететь.
 *
 * Фон НЕПРОЗРАЧНЫЙ. Полупрозрачный показывал живую сцену под меню, и логотип
 * читался поверх летящих звёзд. Чёрный цвет задан под картинкой: не загрузится
 * небо — экран останется чёрным, а не станет окном в игру.
 *
 * Браузер отказывает в захвате курсора около секунды после выхода из него, поэтому
 * отказ виден на самой кнопке: она сообщает, что надо подождать, а не молчит.
 */
/**
 * Через сколько повторять запрос захвата после отказа, мс, и сколько всего ждать.
 * Потолок щедрый: первое нажатие ещё и строит сцену, а на слабой машине это секунды.
 *
 * Частота повторов здесь ничего не решает: до браузера доходит один запрос за
 * его собственный откат — дросселем в `requestLock`. Пятьдесят отказанных
 * запросов подряд оставляли систему с прижатым курсором, который переживал
 * закрытие вкладки.
 */
const LOCK_RETRY_MS = 200
const LOCK_GIVE_UP_MS = 8000
/** Полная длительность запуска по СТАРТУ, мс: дрожь 0.8с + улёт 0.25с (см. `title-ship-*`). */
const TITLE_LAUNCH_MS = 1050

/** Какой экран паузы раскрыт: главный, таблица клавиш или настройки. */
type PauseScreen = 'main' | 'keys' | 'settings'

/** Перезапуск CSS-анимации на том же элементе: сброс + форс reflow + назначение снова. */
function restartAnimation(el: HTMLElement | null, animation: string): void {
  if (!el) return
  el.style.animation = 'none'
  void el.offsetWidth
  el.style.animation = animation
}

/**
 * Логотип с живым светом. В покое раз в 5–7с (интервал случайный, чтобы не тикало метрономом)
 * играет ОДНО из двух: иногда по буквам пробегает БЛИК (1–3 прохода), иногда буквы плавно
 * РАЗГОРАЮТСЯ и гаснут (1 раз). По СТАРТУ (`launching`) логотип разом вспыхивает бело-раскалённым.
 * Свечение/вспышка — filter самого раста; блик — маскированная по форме логотипа накладка.
 */
function TitleLogo({
  launching,
  imgRef,
  onReady,
}: {
  launching: boolean
  imgRef: React.RefObject<HTMLImageElement | null>
  onReady: () => void
}) {
  const glintRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // На старте управление растром отдаём классу вспышки — снимаем возможный inline-пульс.
    if (launching) {
      if (imgRef.current) imgRef.current.style.animation = ''
      return
    }
    let id: number
    const tick = () => {
      if (Math.random() < 0.6) {
        // Блик: один проход полосы по буквам.
        restartAnimation(glintRef.current, 'logo-glint 0.7s ease-in-out')
      } else {
        // Свечение: разгорелись-погасли один раз.
        restartAnimation(imgRef.current, 'logo-pulse 1s ease-in-out')
      }
      id = window.setTimeout(tick, 5000 + Math.random() * 2000) // 5–7с
    }
    id = window.setTimeout(tick, 5000 + Math.random() * 2000)
    return () => window.clearTimeout(id)
  }, [launching])

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[6vh] mx-auto w-full max-w-[54rem] px-8">
      <div className="relative">
        <img
          ref={imgRef}
          src="/logo.png"
          alt="STAR ELITE"
          onLoad={onReady}
          className={`block w-full ${launching ? 'title-logo-flash' : ''}`}
        />
        <div ref={glintRef} className="title-logo-glint" aria-hidden />
      </div>
    </div>
  )
}

/**
 * Корабль с дюзами на титуле. Три струи — ЗА корпусом (в DOM раньше корабля → он их
 * перекрывает): базы прячутся за кормой, плюмажи торчат сверху. Режим screen гасит чёрный
 * фон струи в свечение над тёмным небом. Центральная — быстрый нервный «пых» (≈0.8 c) и
 * чуть ниже боковых; боковые крупнее, период ≈2 c, синхронно и с лёгким сносом к центру.
 *
 * Весь узел (корабль + струи) медленно покачивается — иллюзия полёта. Слои разделены,
 * чтобы transform-ы не спорили: внешний div держит позицию (`-translate-y-1/2`), внутренний
 * `relative` качается своей анимацией, а струи внутри него дышат каждая своей.
 */
/**
 * Звёздная пыль титула: редкие крупинки летят снизу вверх к точке схода ЗА и НАД кораблём,
 * ужимаясь и гаснут — иллюзия, что корабль несётся вперёд. Точка схода ≈ (50vw, 24vh), выше
 * корабля (тот на ~55%). Стартовые точки и тайминги фиксируем на монтировании (`useMemo`),
 * дальше всё крутит CSS-анимация — ноль ре-рендеров и ноль работы в кадре.
 */
function TitleDust({ launching, vanishY }: { launching: boolean; vanishY: number }) {
  const bits = useMemo(() => {
    const VANISH_X = 50 // vw
    const VANISH_Y = vanishY // vh — центр звезды логотипа
    return Array.from({ length: 26 }, () => {
      // Старт по всему нижнему полю И бокам, не только вдоль низа: тогда пыль сносит
      // и по краям кадра, а не единой струёй по центру. Все ниже точки схода — летят вверх.
      const startX = -6 + Math.random() * 112 // vw, включая самые края
      const startY = 40 + Math.random() * 70 // vh, от середины боков до ниже низа
      const dur = 1.7 + Math.random() * 1.7 // с — быстрый снос, «летим»
      return {
        startX,
        startY,
        dx: VANISH_X - startX + (Math.random() * 8 - 4), // немного разброса у точки схода
        dy: VANISH_Y - startY,
        dur,
        delay: -Math.random() * dur, // отрицательная задержка — часть уже в полёте с первого кадра
        size: 2 + Math.random() * 2.4, // px — минимум 2, иначе 1px не видно
        peak: 0.35 + Math.random() * 0.5,
      }
    })
  }, [vanishY])
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      // По срыву (0.8с — момент, когда корабль стартует) дрейф гаснет: его сменяют
      // варп-штрихи (TitleWarp). `forwards` держит погасшим до перехода в игру.
      style={launching ? { animation: 'title-dust-out 0.25s ease-in 0.8s forwards' } : undefined}
    >
      {bits.map((b, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={
            {
              left: `${b.startX}vw`,
              top: `${b.startY}vh`,
              width: b.size,
              height: b.size,
              '--dx': `${b.dx}vw`,
              '--dy': `${b.dy}vh`,
              '--peak': b.peak,
              animation: `title-dust ${b.dur}s linear ${b.delay}s infinite`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

/**
 * Разгон пыли на «срыве с места»: в момент старта корабля (0.8с) та же пыль летит по ТЕМ
 * ЖЕ траекториям к общей точке схода (≈50vw,24vh), но быстрее, гуще и оставляя за собой
 * СЛЕД — голова тянет градиентный хвост. Траектория идентична пыли (dx/dy те же), иначе
 * штрихи разбегались бы каждый в свою сторону. Много разом, очень резко (ease-in), затем
 * гаснут с дальнего конца — небо пустеет к переходу в игру. Параметры фиксируем на монтаже.
 */
function TitleWarp({ vanishY }: { vanishY: number }) {
  const streaks = useMemo(() => {
    const VANISH_Y = vanishY // vh — центр звезды логотипа; по X это центр (50vw)
    return Array.from({ length: 110 }, () => {
      // Горизонталь — в vh ОТ ЦЕНТРА (не vw!), чтобы вся геометрия была в одних единицах.
      // Иначе dx(vw) и длина(vh) при изотропном rotate не сходятся в точку: по вертикали
      // штрихи сойдутся, по горизонтали промахнутся — и пересекутся. Здесь схода — идеальный.
      const offX = -90 + Math.random() * 180 // vh от центра — по всей ширине поля и краям
      const startY = -6 + Math.random() * 120 // vh — по ВСЕЙ высоте: сыплются и с боков, и сверху
      // Вектор к точке схода (центр по X, VANISH_Y по Y), ОБА в vh. Никакого джиттера:
      // все линии целятся точно в одну точку, поэтому не пересекаются.
      const dx = -offX
      const dy = VANISH_Y - startY
      // Линия рисуется НА ВСЮ дистанцию полёта (start→сход): её длина = длине вектора, в vh.
      const dist = Math.hypot(dx, dy)
      // Ось линии (её локальный «верх») кладём вдоль вектора (dx,dy): rot = atan2(dx, −dy).
      const rot = (Math.atan2(dx, -dy) * 180) / Math.PI
      return {
        offX,
        startY,
        dist,
        rot,
        dur: 0.5 + Math.random() * 0.35, // с — успеть увидеть полную линию, потом гаснет
        delay: 0.8 + Math.random() * 0.2, // от срыва корабля, с разбросом — «поток», а не залп
        peak: 0.7 + Math.random() * 0.3,
      }
    })
  }, [vanishY])
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {streaks.map((s, i) => (
        <span
          key={i}
          className="absolute"
          style={
            {
              // Центр по X (50vw) плюс смещение в vh — та же изотропная система, что и длина.
              left: `calc(50vw ${s.offX >= 0 ? '+' : '-'} ${Math.abs(s.offX)}vh)`,
              top: `${s.startY}vh`,
              width: 1.6,
              height: `${s.dist}vh`, // длина = вся дистанция полёта
              marginLeft: -0.8,
              marginTop: `-${s.dist}vh`, // низ элемента — в точке старта (хвост), верх — голова
              transformOrigin: '50% 100%', // якорь у старта: линия прочерчивается ОТ него к сходу
              // Голова (верх/дальний конец) яркая, старт — прозрачный: точка тянет за собой след.
              background: 'linear-gradient(to top, rgba(255,255,255,0), rgba(255,255,255,0.95))',
              opacity: 0,
              '--rot': `${s.rot}deg`,
              '--peak': s.peak,
              animation: `title-dust-warp ${s.dur}s ease-out ${s.delay}s both`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

function TitleShip({ launching }: { launching: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const shineRef = useRef<HTMLDivElement>(null)

  // Инверсный параллакс: корабль чуть смещается ПРОТИВ курсора — до ±20 px вбок и ±10 px
  // по вертикали (вбок вдвое, чтобы это читалось смещением, а не только креном),
  // плюс небольшой skewX растра по горизонтали, будто кренится в сторону хода. Пишем прямо
  // в style по pointermove, без ре-рендера. Отдельная обёртка под параллакс, чтобы не спорить
  // с качкой (`title-ship-float`) и улётом на внутреннем div — трансформы вкладываются.
  //
  // Заодно возим блики по корпусу: их центры — CSS-переменные, сдвигаемые тем же курсором.
  // Разные слои едут с РАЗНОЙ силой (глубина), оттого при сползании корабля свет «перетекает»
  // по нему — иллюзия наклона и смены освещения. Блики замаскированы силуэтом (см. разметку).
  useEffect(() => {
    const AMPLITUDE = 10 // px вертикаль
    const AMPLITUDE_X = 20 // px вбок — вдвое больше вертикали: корабль СМЕЩАЕТСЯ, а не только кренится
    const SKEW = 4 // градусов на самом краю экрана — «небольшой» крен
    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth - 0.5 // −0.5..0.5
      const ny = e.clientY / window.innerHeight - 0.5
      const el = ref.current
      if (el) el.style.transform = `translate(${-nx * AMPLITUDE_X * 2}px, ${-ny * AMPLITUDE * 2}px) skewX(${-nx * SKEW * 2}deg)`
      const sh = shineRef.current
      if (sh) {
        // Центр большого блика ходит по корпусу против курсора — свет «перетекает» при сдвиге.
        sh.style.setProperty('--sx', `${nx * 30}%`)
        sh.style.setProperty('--sy', `${ny * 18}%`)
      }
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(55%+50px)] mx-auto w-full max-w-[43.2rem] -translate-y-1/2 px-8">
      {/* Хлопок-«пуф» на срыве: большой взрыв ЗА кораблём. В проекции он позади ДЛИННОГО
          корпуса, поэтому центр чуть ВЫШЕ середины корабля. Диск — лёгкий эллипс 4:3, рост
          равномерный. Кольцо светится СИЛЬНЕЕ по бокам: два ярких «капа» на краях поверх обода —
          там ринг к нам ребром. РЕЗКО раздувается из точки аж за края экрана и там же
          растворяется, никуда не улетая (см. keyframe title-ship-clap). screen красит чёрный. */}
      {launching && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[40%] mix-blend-screen"
          style={{
            width: '16vw',
            height: '12vw', // 4:3 — лёгкий эллипс
            borderRadius: '50%',
            background: [
              // Боковые «капы» — ТУГИЕ яркие сгустки ровно на кончиках (ринг к нам ребром там).
              // Почти белые, гаснут к 13% — горят именно два края, не подсвечивая нутро.
              'radial-gradient(circle at 3% 50%, rgba(255,255,255,1) 0%, rgba(185,228,255,0.85) 5%, rgba(150,215,255,0) 13%)',
              'radial-gradient(circle at 97% 50%, rgba(255,255,255,1) 0%, rgba(185,228,255,0.85) 5%, rgba(150,215,255,0) 13%)',
              // Обод — яркое кольцо у самого КРАЯ (пик на 94%), затухает СИММЕТРИЧНО в обе
              // стороны: к центру (87%) и к краю (100%). Нутро прозрачно, не пузырь. Почти
              // белое для видимости. farthest-side сажает градиент ровно на кромку эллипса.
              'radial-gradient(ellipse farthest-side at 50% 50%, transparent 87%, rgba(232,246,255,1) 94%, transparent 100%)',
            ].join(','),
            transform: 'translate(-50%, -50%) scale(0.12)',
            opacity: 0,
            animation: 'title-ship-clap 0.55s ease-out 0.8s both', // резкий «пуф», потом растворяется
          }}
        />
      )}
      <div ref={ref} style={{ transition: 'transform 0.25s ease-out' }}>
        <div
          className="relative"
          style={{
            // Запуск перекрывает качку двумя тактами: сперва дрожь 0.5с (нарастающий
            // тремор), затем — с задержкой 0.5с — резкий срыв и улёт вниз с ускорением.
            // `forwards` держит финальный кадр улёта.
            animation: launching
              ? 'title-ship-shake 0.8s linear, title-ship-launch 0.25s cubic-bezier(0.85, 0, 1, 1) 0.8s forwards'
              : 'title-ship-float 7s ease-in-out infinite',
          }}
        >
        <img
          src="/flame_left.png"
          alt=""
          aria-hidden
          className="absolute bottom-[82%] left-[39.8%] w-[13%] origin-bottom mix-blend-screen"
          style={{ animation: 'title-flame-left 1.5s ease-in-out infinite, flame-flicker 0.42s linear infinite' }}
        />
        <img
          src="/flame_right.png"
          alt=""
          aria-hidden
          className="absolute bottom-[82%] left-[60.2%] w-[13%] origin-bottom mix-blend-screen"
          style={{ animation: 'title-flame-right 1.5s ease-in-out infinite, flame-flicker 0.35s linear infinite' }}
        />
        <img
          src="/flame_center.png"
          alt=""
          aria-hidden
          className="absolute bottom-[80%] left-1/2 w-[9%] origin-bottom mix-blend-screen"
          style={{ animation: 'title-flame-center 0.8s ease-in-out infinite, flame-flicker 0.3s linear infinite' }}
        />
          <div className="relative w-full">
            <img src="/ship.png" alt="" aria-hidden className="block w-full" />
            {/* Вертикальная растушёвка корпуса: верх чуть темнее, низ чуть светлее — пара
                процентов объёма. Режим overlay: над чёрным даёт чёрное (тени целы), а средние
                тона гнёт — тёмный верх гасит, светлый низ поднимает. Статична, маска по силуэту. */}
            <div
              className="pointer-events-none absolute inset-0 mix-blend-overlay"
              style={{
                WebkitMaskImage: 'url(/ship.png)',
                maskImage: 'url(/ship.png)',
                WebkitMaskSize: '100% 100%',
                maskSize: '100% 100%',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                background:
                  'linear-gradient(to bottom, rgba(0,0,0,0.28), rgba(0,0,0,0) 42%, rgba(255,255,255,0) 58%, rgba(255,255,255,0.30))',
              }}
            />
            {/* Блик: крупный подвижный, режим OVERLAY. screen красил бы весь чёрный в серый
                (над нулём его итог равен цвету блика), поэтому большой блик убивал черноту.
                overlay же над чёрным даёт чёрное (в тенях — умножение), а светлеет лишь там,
                где под ним уже металл: свет перетекает по корпусу, чёрный цел.
                Центр двигает параллакс (см. onMove) — блик ездит по корпусу при сдвиге. */}
            <div
              ref={shineRef}
              className="pointer-events-none absolute inset-0 mix-blend-overlay"
              style={{
                WebkitMaskImage: 'url(/ship.png)',
                maskImage: 'url(/ship.png)',
                WebkitMaskSize: '100% 100%',
                maskSize: '100% 100%',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                background:
                  'radial-gradient(176% 88% at calc(50% + var(--sx, 0%)) calc(30% + var(--sy, 0%)), rgba(226,240,255,0.85), rgba(210,232,255,0.28) 34%, rgba(200,224,255,0) 56%)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function Paused({ resuming, onBoot, onNewGame }: { resuming: boolean; onBoot: () => void; onNewGame: () => void }) {
  useLang() // подписка: смена языка перерисует меню
  const session = useSession()
  const [waiting, setWaiting] = useState(false)
  // «Новая игра» стирает прогресс — жмётся в два клика: первый взводит подтверждение.
  const [confirmNew, setConfirmNew] = useState(false)
  const [screen, setScreen] = useState<PauseScreen>('main')
  const [keyGroup, setKeyGroup] = useState(0)
  const timer = useRef<number | null>(null)

  // Захват получен — Paused размонтируется, и таймер обязан уйти вместе с ним.
  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), [])

  /**
   * Точка схода пыли и варп-штрихов — центр ЗВЕЗДЫ логотипа. По X это центр экрана (лого
   * центрировано), по Y — зависит от отрендеренного размера лого, поэтому картинку МЕРЯЕМ
   * в рантайме. Звезда сидит почти в центре PNG — на ~10 из его 492 пикселей выше середины.
   */
  const logoRef = useRef<HTMLImageElement>(null)
  const [vanishY, setVanishY] = useState(14) // vh — разумное значение до первого замера
  const measureVanish = useCallback(() => {
    const img = logoRef.current
    if (!img || img.clientHeight < 1) return
    const rect = img.getBoundingClientRect()
    const starY = rect.top + rect.height * (0.5 - 10 / 492)
    setVanishY((starY / window.innerHeight) * 100)
  }, [])
  useLayoutEffect(() => {
    measureVanish()
    window.addEventListener('resize', measureVanish)
    return () => window.removeEventListener('resize', measureVanish)
  }, [measureVanish])

  /**
   * Браузер отказывает в захвате примерно секунду после выхода из него — защита
   * от игр, крадущих Escape. Одного нажатия поэтому не хватало: кнопка молча
   * съедала клик, и приходилось жать ещё раз. Теперь запрос ПОВТОРЯЕТСЯ сам,
   * пока запрет не спадёт: нажатие обязано срабатывать с первого раза.
   *
   * Отсчёт до сдачи — от первого нажатия, а не от последней попытки: иначе цикл
   * крутился бы вечно, если окно потеряло фокус (там захват не дают никогда).
   */
  const poll = (deadline: number) => {
    timer.current = null
    void requestLock().then((ok) => {
      if (ok) return // захват получен: Paused сейчас размонтируется
      if (performance.now() >= deadline) {
        setWaiting(false) // сдались — пусть кнопка снова принимает нажатие
        return
      }
      timer.current = window.setTimeout(() => poll(deadline), LOCK_RETRY_MS)
    })
  }

  /**
   * Пока ждём захвата, меню НЕ ПРИНИМАЕТ нажатий: кнопка сообщила, что нужна
   * секунда, и обязана эту секунду держать. Иначе второе нажатие уходит в тот же
   * `take` и заводит второй цикл повторов, а «КЛАВИШИ» под ним раскрывают таблицу
   * поверх уже начавшейся игры.
   *
   * Сборка сцены откладывается на макрозадачу. Она занимает главный поток на
   * секунду с лишним, и запущенная прямо здесь не дала бы React отрисовать
   * «СЕКУНДУ…»: надпись появилась бы ровно тогда, когда ждать уже нечего.
   */
  const take = () => {
    if (waiting) return
    setWaiting(true)
    // На ПЕРВОМ старте корабль срывается и улетает — игра начинается не раньше, чем он
    // уйдёт, плюс секунда пустого неба. На «продолжить» (пауза) корабля нет и ждать нечего.
    const delay = resuming ? 0 : TITLE_LAUNCH_MS + 1000
    window.setTimeout(() => {
      // Строит сцену. Пока её нет, захват не даётся, и цикл повторов дожидается
      // канваса — специально для этого он и заведён.
      onBoot()
      poll(performance.now() + LOCK_GIVE_UP_MS)
    }, delay)
  }

  return (
    <div
      // Форма курсора задаётся ЯВНО, а не наследуется: под оверлеем лежит канвас
      // с прицелом, и до первого движения мыши браузер продолжает рисовать его.
      className="absolute inset-0 cursor-default overflow-hidden bg-black bg-cover bg-center font-mono text-[#7fd6ff]"
      style={{ backgroundImage: 'url(/bg.png)' }}
    >
      {/* Затемнение ради читаемости фосфорного текста поверх звёзд bg.png.
          Слабее прежнего: bg.png сам тёмный, топить его в черноте незачем. */}
      <div className="absolute inset-0 bg-black/45" />

      {/* Мерцание неба — ПОВЕРХ затемнения, иначе scrim гасит его в невидимость. Точки
          редкие и мелкие, лягут в пустотах между логотипом и кнопками, не мешая тексту. */}
      <TitleStars />

      {/* Корабль с дюзами — часть фона, но ПОВЕРХ звёзд: по центру, чуть ниже, ловит провал
          звёздного поля в bg.png и заслоняет собой мерцание. Курсор не трогает, кнопки поверх.
          Пламя — ТРИ струи ПОД корпусом (в DOM раньше корабля → он их перекрывает): базы
          прячутся за кормой, плюмажи торчат сверху. Режим screen делает чёрный фон струи
          прозрачным и превращает её в свечение над тёмным небом. Позиции в % от корабля —
          правь bottom/left/w, если сопла окажутся не на месте.
          Корабль — только на ПЕРВОЙ заставке (не на паузе: там пустое небо). По СТАРТУ
          (`waiting`) он срывается и улетает, а затем уходит с экраном паузы. */}
      {!resuming && <TitleDust launching={waiting} vanishY={vanishY} />}
      {/* Варп-штрихи — только в момент срыва (по СТАРТУ): пыль слилась в линии. */}
      {!resuming && waiting && <TitleWarp vanishY={vanishY} />}
      {!resuming && <TitleShip launching={waiting} />}

      {/* Логотип — СВОЙ контейнер, вне общего потока: сдвинуть его нечем, что бы
          ни выросло ниже. Растр, поэтому у него собственная ширина. Заголовок
          остаётся для тех, кто читает страницу не глазами. */}
      <h1 className="sr-only">STAR ELITE</h1>
      <TitleLogo launching={waiting} imgRef={logoRef} onReady={measureVanish} />

      {/* Главное меню — просто кнопки на фоне корабля, без плашки: обводка тут ни к чему.
          Клавиши и настройки не живут на этом экране, а всплывают поверх отдельной панелью. */}
      <div className="absolute inset-0 flex flex-col items-center justify-start pt-[calc(32vh+40px)]">
        <div className="flex flex-col items-center gap-4">
          {/* На первом старте кнопка (уже «СЕКУНДУ…») плавно уезжает к середине экрана —
              пока прочие растворяются, остаётся один центрованный индикатор загрузки. На
              паузе не двигаем. Сдвиг = от места кнопки (≈32vh) к центру (50vh) за вычетом
              её половины; transform не трогает вёрстку соседей. */}
          <div
            className="transition-transform duration-700 ease-out"
            style={{ transform: waiting && !resuming ? 'translateY(calc(18vh - 3rem))' : 'none' }}
          >
            <MenuButton onClick={take} disabled={waiting}>
              {waiting ? t('menu.wait') : resuming ? t('menu.resume') : t('menu.start')}
            </MenuButton>
          </div>
          {/* Прочие кнопки РАСТВОРЯЮТСЯ только на первом СТАРТЕ (где улёт корабля): на экране
              остаются лишь «СЕКУНДУ…» и улетающий корабль. На ПАУЗЕ (`resuming`) корабля нет и
              «Продолжить» мгновенно — там кнопки не гасим, все нужные остаются на месте.
              Не размонтируем, а гасим прозрачность (и снимаем клики) — уход плавный. */}
          <div
            className="flex flex-col items-center gap-4 transition-opacity duration-500"
            style={{
              opacity: waiting && !resuming ? 0 : 1,
              pointerEvents: waiting && !resuming ? 'none' : 'auto',
            }}
          >
            {/* «Новая игра» стирает прогресс, поэтому в ДВА клика: первый показывает
                предупреждение, второй исполняет. Прочие кнопки сбрасывают подтверждение. */}
            <MenuButton onClick={() => (confirmNew ? onNewGame() : setConfirmNew(true))}>
              {confirmNew ? t('menu.newGameConfirm') : t('menu.newGame')}
            </MenuButton>
            <MenuButton onClick={() => { setConfirmNew(false); setScreen('keys') }}>
              {t('menu.keys')}
            </MenuButton>
            <MenuButton onClick={() => { setConfirmNew(false); setScreen('settings') }}>
              {t('menu.settings')}
            </MenuButton>
          </div>
        </div>
      </div>

      {/* Панель клавиш/настроек — оверлей ПОВЕРХ меню: всплыла, прочитал, закрыл и вернулся.
          Клик мимо неё (по затемнению) или «назад» возвращает к кнопкам старта. */}
      {(screen === 'keys' || screen === 'settings') && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 px-8"
          onClick={() => setScreen('main')}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <MenuPanel>
              {screen === 'keys' ? (
                <>
                  <Tabs
                    tabs={KEY_GROUPS.map((g) => t(g.title))}
                    active={t(KEY_GROUPS[keyGroup]!.title)}
                    onSelect={(label) => setKeyGroup(KEY_GROUPS.findIndex((g) => t(g.title) === label))}
                  />
                  {/* Высота ФИКСИРОВАНА под самый длинный блок (9 строк): у групп
                      разное число клавиш, и без этого при переключении вкладок список
                      менял высоту, а центрирование дёргало вкладки и кнопку вверх-вниз. */}
                  <dl className="h-[14rem] w-full max-w-md content-start space-y-1 text-left text-sm">
                    {KEY_GROUPS[keyGroup]!.rows.map(([keyLabel, keyWhat]) => (
                      <div key={keyLabel} className="flex gap-3">
                        <dt className="w-24 shrink-0 text-right text-[#7fd6ff]">{t(keyLabel)}</dt>
                        <dd className="flex-1 truncate text-[#3f7391]">{t(keyWhat)}</dd>
                      </div>
                    ))}
                  </dl>
                  <MenuButton onClick={() => setScreen('main')}>{t('menu.back')}</MenuButton>
                </>
              ) : (
                <Settings session={session} onBack={() => setScreen('main')} />
              )}
            </MenuPanel>
          </div>
        </div>
      )}
    </div>
  )
}

const ASSIST_STORAGE_KEY = 'elite.assist'

/**
 * Настройки: язык интерфейса и лётный компьютер.
 *
 * Язык живёт в модульной переменной i18n (его читает и HUD вне React), поэтому
 * кнопки зовут `setLang`, а `useLang` в родителе перерисовывает меню. Лётный
 * компьютер — поле `intent`, общее для всей сессии; его выбор запоминается в
 * localStorage и подхватывается при следующем старте (см. createIntent).
 */
function Settings({ session, onBack }: { session: ReturnType<typeof useSession>; onBack: () => void }) {
  const lang = useLang()
  const [assist, setAssist] = useState(session.intent.flightAssist)

  const pickLang = (next: Lang) => setLang(next)
  const toggleAssist = (on: boolean) => {
    session.intent.flightAssist = on
    localStorage.setItem(ASSIST_STORAGE_KEY, on ? 'on' : 'off')
    setAssist(on)
  }

  // Возвращаем СОДЕРЖИМОЕ панели, а не свой оверлей: рамку, фон и центрирование даёт
  // общий MenuPanel заставки — настройки такой же экран на нём, как меню и клавиши.
  return (
    <>
      <div className="flex w-full max-w-md flex-col gap-8">
        <Choice label={t('menu.language')}>
          <Toggle active={lang === 'ru'} onClick={() => pickLang('ru')}>Русский</Toggle>
          <Toggle active={lang === 'en'} onClick={() => pickLang('en')}>English</Toggle>
        </Choice>

        <Choice label={t('menu.assist')} hint={t('menu.assist.hint')}>
          <Toggle active={assist} onClick={() => toggleAssist(true)}>{t('menu.on')}</Toggle>
          <Toggle active={!assist} onClick={() => toggleAssist(false)}>{t('menu.off')}</Toggle>
        </Choice>
      </div>
      <MenuButton onClick={onBack}>{t('menu.back')}</MenuButton>
    </>
  )
}

/** Строка настройки: подпись слева, варианты справа, необязательная сноска снизу. */
function Choice({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm tracking-[0.2em] text-[#7fd6ff]">{label}</span>
        <div className="flex gap-2">{children}</div>
      </div>
      {hint && <p className="mt-2 text-xs text-[#3f7391]">{hint}</p>}
    </div>
  )
}

/** Кнопка-переключатель: выбранный вариант залит, прочие — контур. */
function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onPointerDown={onClick}
      className={`cursor-pointer border px-4 py-1.5 text-sm tracking-[0.2em] transition-colors ${
        active
          ? 'border-[#7fd6ff] bg-[#7fd6ff] text-black'
          : 'border-[#3f7391] text-[#7fd6ff] hover:border-[#7fd6ff]'
      }`}
    >
      {children}
    </button>
  )
}

function GameOver({ score, onRestart }: { score: number; onRestart: () => void }) {
  useLang() // подписка: экран гибели тоже на выбранном языке
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/85">
      <div className="px-8 text-center font-mono text-[#ff7a5c]">
        <h1 className="mb-2 text-5xl tracking-[0.4em]">{t('menu.lost')}</h1>
        <p className="mb-10 text-sm tracking-widest text-[#7a4438]">{t('menu.score', { score })}</p>

        <button
          type="button"
          onClick={onRestart}
          className="cursor-pointer border border-[#7fd6ff] px-8 py-3 text-base tracking-[0.3em] text-[#7fd6ff]
                     transition-colors hover:bg-[#7fd6ff] hover:text-black"
        >
          {t('menu.restart')}
        </button>
      </div>
    </div>
  )
}
