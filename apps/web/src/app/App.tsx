import { useCallback, useEffect, useRef, useState } from 'react'
import { interlocutor } from '@elite/sim'
import { GameProvider, useSession } from './GameContext'
import { Game } from './Game'
import { input, releaseLock, requestLock } from '../platform/input/input'
import { Dialogue } from '../ui/dialogue/Dialogue'
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

const KEYS: [string, string][] = [
  ['Мышь', 'вести нос: тангаж и рыскание'],
  ['W / S', 'тяга: рукоять газа стоит там, куда её поставили'],
  ['ПКМ', 'газ до отказа, пока держишь; отпустил — вернулся на рукоять'],
  ['A / D', 'крен. В космосе нет горизонта: корабль сам не выравнивается'],
  ['AA', 'бочка: уход вбок, сбивает наведение ракет'],
  ['WW / SS', 'петля через верх или через низ: пропустить вперёд того, кто на хвосте'],
  ['DD', 'разворот через петлю: он на хвосте — и вот он в прицеле'],
  ['Shift', 'форсаж'],
  ['Ctrl', 'ретро-тяга'],
  ['J', 'крейсерский ход (удерживать)'],
  ['ЛКМ / Space', 'лазер'],
  ['Tab', 'захват цели'],
  ['P', 'автобой: пилот дерётся с захваченной целью (повторно — снять)'],
  ['M', 'карта системы: выбрать цель навигации'],
  ['G', 'карта галактики: гиперпрыжок к другой звезде'],
  ['T', 'связь с захваченным кораблём: требовать, просить, нанять'],
  ['R', 'ракета с пилона по захваченной цели'],
  ['E', 'ПРО: подорвать ближайшую чужую ракету'],
  ['B', 'энергобомба: жжёт врагов вокруг. Копится поверх целого щита'],
  ['X', 'маскировка: тебя не видят и не стреляют. Жрёт энергию, стрелять нельзя'],
  ['Q', 'выпустить БПЛА: дерётся сам, оттягивает огонь. Живёт минуту'],
  ['C', 'тяговый луч: держи — притягивает груз по курсу'],
  ['L', 'автостыковка со станцией (повторно — отмена)'],
  ['V', 'вид: сзади / из кабины'],
  ['Esc', 'пауза и курсор'],
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
 */
const LOCK_RETRY_MS = 150
const LOCK_GIVE_UP_MS = 8000

function Paused({ resuming, onBoot }: { resuming: boolean; onBoot: () => void }) {
  const [waiting, setWaiting] = useState(false)
  const [keysShown, setKeysShown] = useState(false)
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

      {keysShown ? (
        /* Таблица клавиш вчетверо выше пары кнопок. По центру экрана она бы
           наехала на логотип, поэтому у неё свой отсчёт — от него вниз. */
        <div className="absolute inset-0 flex flex-col items-center overflow-y-auto px-8 pt-[26vh] pb-10">
          <dl className="mb-8 space-y-1 text-left text-sm">
            {KEYS.map(([key, description]) => (
              <div key={key} className="flex gap-3">
                <dt className="w-32 shrink-0 text-right text-[#7fd6ff]">{key}</dt>
                <dd className="text-[#3f7391]">{description}</dd>
              </div>
            ))}
          </dl>
          <MenuButton onClick={() => setKeysShown(false)}>НАЗАД</MenuButton>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <MenuButton onClick={take} disabled={waiting}>
            {waiting ? 'СЕКУНДУ…' : resuming ? 'В ИГРУ' : 'СТАРТ'}
          </MenuButton>
          <MenuButton onClick={() => setKeysShown(true)} disabled={waiting}>
            КЛАВИШИ
          </MenuButton>
        </div>
      )}
    </div>
  )
}

function GameOver({ score, onRestart }: { score: number; onRestart: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/85">
      <div className="px-8 text-center font-mono text-[#ff7a5c]">
        <h1 className="mb-2 text-5xl tracking-[0.4em]">КОРАБЛЬ ПОТЕРЯН</h1>
        <p className="mb-10 text-sm tracking-widest text-[#7a4438]">ОЧКОВ: {score}</p>

        <button
          type="button"
          onClick={onRestart}
          className="cursor-pointer border border-[#7fd6ff] px-8 py-3 text-base tracking-[0.3em] text-[#7fd6ff]
                     transition-colors hover:bg-[#7fd6ff] hover:text-black"
        >
          НАЧАТЬ ЗАНОВО
        </button>
      </div>
    </div>
  )
}
