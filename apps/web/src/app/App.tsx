import { useCallback, useEffect, useRef, useState } from 'react'
import { interlocutor } from '@elite/sim'
import { GameProvider, useSession } from './GameContext'
import { Game } from './Game'
import { input, releaseLock, requestLock } from '../platform/input/input'
import { Dialogue } from '../ui/dialogue/Dialogue'
import { setLang, t, useLang, type Key, type Lang } from '../ui/i18n'
import { GalaxyMap } from '../ui/map/GalaxyMap'
import { SystemMap } from '../ui/map/SystemMap'
import { StationMenu } from '../ui/station/StationMenu'

/**
 * Оболочка: заставка, пауза и экран гибели. Это единственное место,
 * где React вообще что-то перерисовывает.
 */
export function App() {
  // Перезапуск — новая сессия целиком. `key` пересоздаёт мир, контроллеры и сцену:
  // ни одно поле не переживёт смерть, а значит, и не привезёт с собой баг.
  const [run, setRun] = useState(0)

  return (
    <GameProvider key={run}>
      <Shell onRestart={() => setRun((n) => n + 1)} />
    </GameProvider>
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
  /** Какая карта раскрыта. Обе ставят мир на паузу, поэтому состояние одно. */
  const [chart, setChart] = useState<'none' | 'system' | 'galaxy' | 'talk'>('none')

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
    session.onDockChange = setDocked
    return () => {
      session.onOver = null
      session.onDockChange = null
    }
  }, [session])

  const closeChart = useCallback(() => {
    session.mapOpen = false
    setChart('none')
    void requestLock()
  }, [session])

  /**
   * Оверлеи переключаются ЗДЕСЬ, а не в кадре симуляции: раскрыть карту или
   * канал связи — значит отпустить курсор, а без курсора кадр до чтения клавиш
   * не доходит (пауза). Тумблер, живущий внутри того, что он останавливает,
   * закрыть себя не сможет.
   *
   * Раскрыт всегда РОВНО ОДИН оверлей, поэтому состояние одно: два флага паузы
   * однажды разойдутся, и мир останется стоять под закрытым окном.
   *
   * Карта галактики открывается и в доке: прыгать из дока нельзя, но выбрать,
   * куда лететь после отчаливания, — можно и нужно.
   *
   * С кем можно говорить, решает домен (`interlocutor`): захваченный, живой и
   * в пределах слышимости. Клавише этого правила знать не положено.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || over) return

      const wanted =
        e.code === 'KeyM' ? 'system' : e.code === 'KeyG' ? 'galaxy' : e.code === 'KeyT' ? 'talk' : null
      if (!wanted) return
      if (wanted !== 'galaxy' && docked) return

      // Та же клавиша закрывает своё окно и молчит под чужим.
      if (session.mapOpen) {
        if (chart === wanted) closeChart()
        return
      }
      if (wanted === 'talk' && !interlocutor(session.world)) return

      session.mapOpen = true
      setChart(wanted)
      releaseLock() // мир замирает сам: пауза — это отпущенный курсор
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, closeChart, over, docked, chart])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {booted && <Game />}
      {over ? (
        <GameOver score={session.world.score} onRestart={onRestart} />
      ) : chart === 'galaxy' ? (
        <GalaxyMap onClose={closeChart} />
      ) : docked ? (
        <StationMenu world={session.world} onUndock={() => void requestLock()} />
      ) : chart === 'system' ? (
        <SystemMap world={session.world} onClose={closeChart} />
      ) : chart === 'talk' ? (
        <Dialogue onClose={closeChart} />
      ) : (
        !locked && <Paused resuming={started} onBoot={() => setBooted(true)} />
      )}
    </div>
  )
}

/**
 * Таблица клавиш — из словаря и СГРУППИРОВАНА по смыслу: пилотирование, бой,
 * корабль и мир. Пары «клавиша / что делает» по ключам `key.X` и `key.X.what`.
 * Раскладка в две колонки: группы не рвутся, а перетекают целиком (break-inside).
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
      className="w-56 cursor-pointer border border-[#7fd6ff] px-8 py-3 text-base tracking-[0.3em]
                 text-[#7fd6ff] transition-colors hover:bg-[#7fd6ff] hover:text-black
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

/** Какой экран паузы раскрыт: главный, таблица клавиш или настройки. */
type PauseScreen = 'main' | 'keys' | 'settings'

function Paused({ resuming, onBoot }: { resuming: boolean; onBoot: () => void }) {
  useLang() // подписка: смена языка перерисует меню
  const session = useSession()
  const [waiting, setWaiting] = useState(false)
  const [screen, setScreen] = useState<PauseScreen>('main')
  const timer = useRef<number | null>(null)

  // Захват получен — Paused размонтируется, и таймер обязан уйти вместе с ним.
  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), [])

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
    window.setTimeout(() => {
      // Первое нажатие строит сцену. Пока её нет, захват не даётся, и цикл
      // повторов дожидается канваса — специально для этого он и заведён.
      onBoot()
      poll(performance.now() + LOCK_GIVE_UP_MS)
    }, 0)
  }

  return (
    <div
      // Форма курсора задаётся ЯВНО, а не наследуется: под оверлеем лежит канвас
      // с прицелом, и до первого движения мыши браузер продолжает рисовать его.
      className="absolute inset-0 cursor-default overflow-hidden bg-black bg-cover bg-center font-mono text-[#7fd6ff]"
      style={{ backgroundImage: 'url(/bhole.png)' }}
    >
      {/* Аккреционный диск раскалён ровно по центру — там же, где логотип и кнопки.
          Без затемнения фосфорный текст на нём не читается вовсе. */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Логотип — СВОЙ контейнер, вне общего потока: сдвинуть его нечем, что бы
          ни выросло ниже. Растр, поэтому у него собственная ширина. Заголовок
          остаётся для тех, кто читает страницу не глазами. */}
      <h1 className="sr-only">STAR ELITE</h1>
      <img
        src="/logo.png"
        alt="STAR ELITE"
        className="absolute inset-x-0 top-[8vh] mx-auto w-full max-w-lg px-8"
      />

      {screen === 'keys' ? (
        /* Таблица клавиш вчетверо выше пары кнопок. По центру экрана она бы
           наехала на логотип, поэтому у неё свой отсчёт — от него вниз. */
        <div className="absolute inset-0 flex flex-col items-center overflow-y-auto px-8 pt-[22vh] pb-10">
          <div className="mb-8 w-full max-w-4xl gap-x-12 sm:columns-2">
            {KEY_GROUPS.map((group) => (
              <div key={group.title} className="mb-6 break-inside-avoid">
                <h3 className="mb-2 text-xs tracking-[0.3em] text-[#7fd6ff]">{t(group.title)}</h3>
                <dl className="space-y-1 text-left text-sm">
                  {group.rows.map(([keyLabel, keyWhat]) => (
                    <div key={keyLabel} className="flex gap-3">
                      <dt className="w-24 shrink-0 text-right text-[#7fd6ff]">{t(keyLabel)}</dt>
                      <dd className="text-[#3f7391]">{t(keyWhat)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <MenuButton onClick={() => setScreen('main')}>{t('menu.back')}</MenuButton>
        </div>
      ) : screen === 'settings' ? (
        <Settings session={session} onBack={() => setScreen('main')} />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <MenuButton onClick={take} disabled={waiting}>
            {waiting ? t('menu.wait') : resuming ? t('menu.resume') : t('menu.start')}
          </MenuButton>
          <MenuButton onClick={() => setScreen('keys')} disabled={waiting}>
            {t('menu.keys')}
          </MenuButton>
          <MenuButton onClick={() => setScreen('settings')} disabled={waiting}>
            {t('menu.settings')}
          </MenuButton>
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

  return (
    <div className="absolute inset-0 flex flex-col items-center overflow-y-auto px-8 pt-[30vh] pb-10">
      <div className="mb-10 flex w-full max-w-md flex-col gap-8">
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
    </div>
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
