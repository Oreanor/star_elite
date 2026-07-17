import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSession } from './GameContext'
import { TitleStars } from './TitleStars'
import { requestLock, setStickSuspended } from '../platform/input/input'
import { setLang, t, useLang, type Key, type Lang } from '../ui/i18n'
import { Tabs } from '../ui/station/chrome'
import { preloadTitleAssets, titleAssetsReady } from '../ui/preload'

/**
 * Титульный экран: заставка, пауза, настройки и экран гибели. Отдельно от App —
 * это чистая презентация, меняющаяся по СВОЕЙ причине (визуальный лоск заставки:
 * дюзы, варп, блики), а не из-за разводки игры. Shell берёт отсюда только `Paused`
 * и `GameOver`; всё прочее — их внутренние детали.
 */
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
      ['key.nav', 'key.nav.what'],
      ['key.autofight', 'key.autofight.what'],
      ['key.missile', 'key.missile.what'],
      // Аукс-слот ОДИН, и клавиша одна — E: жмётся то, что в нём стоит (ПРО/бомба/маскировка/
      // миелофон). Дрон (Q) — капсула, в справку не выносим.
      ['key.aux', 'key.aux.what'],
    ],
  },
  {
    title: 'keys.group.ship',
    rows: [
      ['key.tractor', 'key.tractor.what'],
      ['key.dock', 'key.dock.what'],
      ['key.flyto', 'key.flyto.what'],
      ['key.ship', 'key.ship.what'],
      ['key.system', 'key.system.what'],
      ['key.galaxy', 'key.galaxy.what'],
      ['key.talk', 'key.talk.what'],
      ['key.camera', 'key.camera.what'],
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
function MenuPanel({
  children,
  title,
  footer,
}: {
  children: React.ReactNode
  /** Заголовок модалки. Есть — шапка сверху с линией-разделителем. */
  title?: React.ReactNode
  /** Кнопки модалки. Есть — уходят в отдельный ФУТЕР (ряд, прижат к низу), а контент
   *  прибит к ВЕРХУ. Нет — контент центрируется по вертикали (прежнее поведение). */
  footer?: React.ReactNode
}) {
  return (
    <div
      // АВТО-РАЗМЕР по обеим осям: высота и ширина растут по контенту, пока есть место
      // (потолок — вьюпорт: 92vh / 92vw), с полом ширины 34rem, чтобы узкие модалки не жались.
      // Скролла в норме нет — плашка просто становится выше; overflow ниже лишь страховка.
      className={`flex max-h-[92vh] w-auto min-w-[34rem] max-w-[92vw] flex-col
                 rounded-2xl border p-8 backdrop-blur-md`}
      style={{ borderColor: 'rgba(63,115,145,0.7)', background: 'rgba(20,44,74,0.38)' }}
    >
      {/* ШАПКА: заголовок модалки, отделён линией, прижат к верху. */}
      {title && (
        <div className="mb-5 shrink-0 border-b border-[#3f7391]/40 pb-4 text-center text-lg tracking-[0.35em] text-[#7fd6ff]">
          {title}
        </div>
      )}
      {/* Контент. С футером — прибит к ВЕРХУ и скроллится; без — по центру (как раньше). */}
      <div
        className={`flex flex-1 flex-col items-center gap-4 overflow-y-auto ${
          footer ? 'justify-start' : 'justify-center'
        }`}
      >
        {children}
      </div>
      {/* ФУТЕР: кнопки в РЯД, отделён линией, прижат к низу. */}
      {footer && (
        <div className="mt-6 flex shrink-0 flex-wrap justify-center gap-3 border-t border-[#3f7391]/40 pt-5">
          {footer}
        </div>
      )}
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
      // Тёмная плотная заливка: на СВЕТЛОМ фоне (белая/голубая звезда за меню) прежние
      // 38% тонули, и светлый текст сливался с белым. 82% тёмного тёмно-синего держит
      // контраст на любом фоне. Наведение по-прежнему заливает кнопку целиком.
      className="min-w-56 w-max cursor-pointer whitespace-nowrap border border-[#7fd6ff] bg-[#0a1a2f]/[0.82] px-8 py-3 text-base
                 backdrop-blur-md tracking-[0.3em] text-[#7fd6ff] transition-colors
                 hover:bg-[#7fd6ff] hover:text-black
                 disabled:cursor-wait disabled:border-[#3f7391] disabled:bg-[#0a1a2f]/[0.7]
                 disabled:text-[#8fb4cc]"
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
/** Дать тремору корабля и «секундочке» отрисоваться до БЛОКИРУЮЩЕГО onBoot, мс. */
const TREMBLE_LEAD_MS = 90
/** Сколько держим «вжух» до перехода в игру, мс: корабль успевает улететь, небо пустеет. */
const LAUNCH_HOLD_MS = 1000
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
        <img ref={imgRef} src="/logo.png" alt="STAR ELITE" onLoad={onReady} className="block w-full" />
        {/* Вспышка старта — БЕЛАЯ НАКЛАДКА по форме букв с анимацией OPACITY (не filter):
            opacity идёт на композиторе и НЕ замирает под блокирующей сборкой сцены — иначе
            вспышка застывала на полусвете. Гаснет в ноль (`forwards`). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            WebkitMaskImage: 'url(/logo.png)',
            maskImage: 'url(/logo.png)',
            WebkitMaskSize: '100% 100%',
            maskSize: '100% 100%',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            background: 'rgba(255,255,255,0.95)',
            opacity: 0,
            animation: launching ? 'logo-flash-op 1s ease-out forwards' : 'none',
          }}
        />
        <div ref={glintRef} className="title-logo-glint" aria-hidden />
      </div>
    </div>
  )
}

/**
 * Корабль с дюзами на титуле. ДВЕ струи — ЗА корпусом (в DOM раньше корабля → он их
 * перекрывает): базы прячутся за кормой, плюмажи торчат сверху. Режим screen гасит чёрный
 * фон струи в свечение над тёмным небом. Боковые крупные, период ≈2 c, синхронно и с лёгким
 * сносом к центру; центральной нет — крыльевой расклад, как у боевого корабля.
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
function TitleDust({ launched, vanishY }: { launched: boolean; vanishY: number }) {
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
      // По СРЫВУ (`launched`) дрейф гаснет сразу: его сменяют варп-штрихи (TitleWarp).
      // `forwards` держит погасшим до перехода в игру. До срыва пыль дрейфует как обычно.
      style={launched ? { animation: 'title-dust-out 0.25s ease-in forwards' } : undefined}
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
        delay: Math.random() * 0.25, // от СРЫВА (компонент монтируется на `launched`), с разбросом — «поток»
        // Чем БЛИЖЕ старт к точке схода (короче луч), тем он «дальше» в перспективе — тем
        // прозрачнее ИЗНАЧАЛЬНО. Иначе у точки схода в кучу сходится десяток резких ярких лучей.
        peak: 0.08 + Math.min(1, dist / 55) * (0.62 + Math.random() * 0.25),
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

function TitleShip({ trembling, launched }: { trembling: boolean; launched: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const shineRef = useRef<HTMLDivElement>(null)
  const shakeRef = useRef<HTMLDivElement>(null)

  // Дрожь ПРОГРАММНАЯ через Web Animations API: кадры генерим формулой (не хардкод), но
  // `element.animate` для transform крутится на КОМПОЗИТОРЕ — не мрёт под блокирующей сборкой
  // сцены (обычный rAF там бы застыл). Частота высокая СРАЗУ (~8 Гц), горизонтальная амплитуда
  // НАРАСТАЕТ (1.2 → 6 px), вертикаль совсем чуть. Один проход, держит финал (`forwards`).
  useEffect(() => {
    const el = shakeRef.current
    if (!trembling || launched || !el) return
    // Тряска — это ИНДИКАТОР загрузки, а сцена может строиться долго. Поэтому она не
    // кончается через пять секунд, а идёт БЕСКОНЕЧНО (iterations: Infinity), пока не придёт
    // готовность — тогда `launched` отменит её (cleanup ниже) и корабль сорвётся как обычно.
    // Амплитуда плавно ВЫХОДИТ НА ПЛАТО за ~RAMP и дальше держится: тряска не затухает,
    // сколько бы ни грузило. Число периодов на проходе ЦЕЛОЕ, поэтому смещение на стыке
    // петли ≈ ноль — повтор незаметен (а если загрузка всё же перевалит за проход, амплитуда
    // мягко перезайдёт с малой — это лучше, чем замереть).
    const DURATION = 24000
    const FREQ = 12 // Гц
    const CYCLES = Math.round((FREQ * DURATION) / 1000) // целое число периодов → бесшовная петля
    const N = CYCLES * 5 // ~5 сэмплов на период — синусоида гладкая
    const MAX_AMP = 6 // px, предел амплитуды
    const RAMP = 5000 // мс до выхода амплитуды на плато
    const frames: Keyframe[] = []
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const ms = t * DURATION
      // Экспоненциальный подход к максимуму: мелко в начале, к ~RAMP выходит на MAX и держит.
      const amp = 0.7 + (MAX_AMP - 0.7) * (1 - Math.exp((-3 * ms) / RAMP))
      const ph = t * CYCLES * 2 * Math.PI
      const x = Math.sin(ph) * amp
      const y = Math.sin(ph * 0.8 + 1.1) * amp * 0.12
      frames.push({ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` })
    }
    const anim = el.animate(frames, { duration: DURATION, iterations: Infinity })
    return () => anim.cancel()
  }, [trembling, launched])

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
    // На интро (тремор → срыв → улёт) параллакс ОТКЛЮЧЁН и корабль возвращён в центр:
    // иначе курсор, уведённый вбок, смещал корабль ещё до старта, и он срывался из
    // смещённой точки — улетал левее/правее или уходил не туда. На интро он обязан
    // стоять по центру и уйти строго вниз, что бы ни делала мышь.
    if (trembling || launched) {
      const el = ref.current
      if (el) el.style.transform = 'translate(0px, 0px)'
      const sh = shineRef.current
      if (sh) {
        sh.style.setProperty('--sx', '0%')
        sh.style.setProperty('--sy', '0%')
      }
      return
    }
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
  }, [trembling, launched])

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(55%+50px)] mx-auto w-full max-w-[43.2rem] -translate-y-1/2 px-8">
      {/* Хлопок-«пуф» на срыве: большой взрыв ЗА кораблём. В проекции он позади ДЛИННОГО
          корпуса, поэтому центр чуть ВЫШЕ середины корабля. Диск — лёгкий эллипс 4:3, рост
          равномерный, тонкое симметричное кольцо у кромки. РЕЗКО раздувается из точки аж за
          края экрана и там же растворяется, никуда не улетая (keyframe title-ship-clap). */}
      {launched && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[40%] mix-blend-screen"
          style={{
            width: '16vw',
            height: '12vw', // 4:3 — лёгкий эллипс
            borderRadius: '50%',
            // Обод — яркое кольцо, пик сдвинут ПОБЛИЖЕ к центру (80%) и затухает СИММЕТРИЧНО
            // на ±18% в обе стороны: к центру (62%) и к краю (98%). Нутро прозрачно, не пузырь.
            // Почти белое для видимости. farthest-side сажает градиент ровно на кромку эллипса.
            background:
              'radial-gradient(ellipse farthest-side at 50% 50%, transparent 62%, rgba(232,246,255,1) 80%, transparent 98%)',
            transform: 'translate(-50%, -50%) scale(0.12)',
            opacity: 0,
            animation: 'title-ship-clap 0.55s ease-out both', // резкий «пуф» на срыве, потом растворяется
          }}
        />
      )}
      <div ref={ref} style={{ transition: 'transform 0.25s ease-out' }}>
        <div
          ref={shakeRef}
          className="relative"
          style={{
            // Грузимся (`trembling`) — дрожь ведёт Web Animations API (выше), CSS-animation
            // выключен. Готово (`launched`) — срыв и улёт ВНИЗ. Длительность 0.5с (не 0.25):
            // за четверть секунды улёт на 90vh не успевал прочитаться — корабль будто таял на
            // месте под хлопком-«пуфом». Полсекунды дают увидеть, что он именно УЛЕТАЕТ вниз.
            animation: launched
              ? 'title-ship-launch 0.5s cubic-bezier(0.7, 0, 1, 1) forwards'
              : trembling
                ? 'none'
                : 'title-ship-float 7s ease-in-out infinite',
          }}
        >
        {/* Боковые струи сдвинуты на 8px К ЦЕНТРУ (calc от прежних 39.8/60.2%) — их НЕ трогаем.
            Центральная струя возвращена на осевую линию арта (left-1/2, привязана к носу корабля,
            а не к боковым), поэтому расклад — тот же, что и на боевом корабле: центр + две крыльевые. */}
        <img
          src="/flame_left.png"
          alt=""
          aria-hidden
          className="absolute bottom-[82%] left-[calc(39.8%_+_8px)] w-[13%] origin-bottom mix-blend-screen"
          style={{ animation: 'title-flame-left 1.5s ease-in-out infinite, flame-flicker 0.42s linear infinite' }}
        />
        <img
          src="/flame_right.png"
          alt=""
          aria-hidden
          className="absolute bottom-[82%] left-[calc(60.2%_-_8px)] w-[13%] origin-bottom mix-blend-screen"
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

export function Paused({
  resuming,
  auto,
  ready,
  flourishRef,
  onFade,
  onBoot,
  onDock,
  onNewGame,
  onSignOut,
}: {
  resuming: boolean
  /** Новичок: сразу играем флориш взлёта и садимся на станцию, без меню и без захвата. */
  auto?: boolean
  /** Сцена ПОСТРОЕНА (первый кадр отрисован). До этого корабль лишь дрожит; по нему — «вжух». */
  ready: boolean
  /** Флаг «идёт флориш» — Paused взводит его, чтобы Shell не дал станции накрыть корабль. */
  flourishRef: React.MutableRefObject<boolean>
  /** Переход в игру через затемнение: Shell гасит экран, под пеленой зовёт swap, светлеет. */
  onFade?: (swap: () => void) => void
  onBoot: () => void
  /** Финал авто-старта: посадить новичка на станцию (вместо запроса захвата курсора). */
  onDock?: () => void
  onNewGame: () => void
  /** Онлайн: выход из аккаунта (Firebase). */
  onSignOut?: () => void
}) {
  useLang() // подписка: смена языка перерисует меню
  const session = useSession()
  // Титул не показываем, пока PNG заставки не в кэше — иначе фон и корабль «прогружаются на глазах».
  const [gfxReady, setGfxReady] = useState(() => titleAssetsReady())
  const [gfxProgress, setGfxProgress] = useState(() =>
    titleAssetsReady() ? 1 : 0,
  )
  useEffect(() => {
    if (gfxReady) return
    let alive = true
    preloadTitleAssets((done, total) => {
      if (alive && total > 0) setGfxProgress(done / total)
    }).then(() => {
      if (alive) {
        setGfxProgress(1)
        setGfxReady(true)
      }
    })
    return () => {
      alive = false
    }
  }, [gfxReady])
  // Авто-старт новичка начинается сразу «занятым»: индикатор вместо меню, без кадра-мигания.
  const [waiting, setWaiting] = useState(!!auto)
  // «Вжух»: срыв корабля. Взводится, только когда сцена ПОСТРОЕНА — до этого корабль лишь
  // дрожит (по нарастающей), а «секундочку» висит. Так тремор и есть индикатор загрузки.
  const [launched, setLaunched] = useState(false)
  // «Новая игра» стирает прогресс — жмётся в два клика: первый взводит подтверждение.
  const [confirmNew, setConfirmNew] = useState(false)
  const [screen, setScreen] = useState<PauseScreen>('main')
  const [keyGroup, setKeyGroup] = useState(0)
  const timer = useRef<number | null>(null)
  // Страж «вжуха»: срыв корабля играем один раз по готовности сцены. Сбрасывается, если
  // захват так и не дался (сдались) — тогда следующая попытка снова доиграет флориш.
  const fired = useRef(false)

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
        setLaunched(false) // и корабль обратно на место (не «улетевший») к следующей попытке
        fired.current = false // разрешаем флоришу сыграть заново на следующей попытке
        return
      }
      timer.current = window.setTimeout(() => poll(deadline), LOCK_RETRY_MS)
    })
  }

  /**
   * Запуск игры. На ПАУЗЕ корабля нет — грузим и возвращаемся сразу. На ТИТУЛЕ корабль
   * ДРОЖИТ (нарастающий тремор), пока строится сцена, — сам тремор и есть индикатор
   * загрузки. Как только сцена готова — «вжух» (`launched`) корабль срывается, и через
   * секунду (небо успевает опустеть) уходим в игру/док.
   *
   * `onBoot` блокирует поток на ~секунду, поэтому его откладываем на `TREMBLE_LEAD_MS`:
   * пусть тремор и «секундочку» успеют отрисоваться до блокировки (иначе их не видно).
   * Пока ждём, меню не принимает нажатий (`waiting`), чтобы второй клик не завёл второй цикл.
   */
  const launch = () => {
    setWaiting(true)
    if (resuming) {
      // Пауза: ни корабля, ни флориша — сцена уже построена, дожимаем захват сразу.
      window.setTimeout(() => {
        onBoot()
        poll(performance.now() + LOCK_GIVE_UP_MS)
      }, 0)
      return
    }
    // С МОМЕНТА нажатия START и на ВСЁ интро (дрожь → срыв → улёт → вылет со станции)
    // мышь молчит: захват курсора берётся уже здесь (poll ниже), и без этого движение
    // мыши копилось бы в ручку и уводило корабль — а он обязан улететь строго прямо.
    // Вернётся мышь пилоту сама, когда кончится кино вылета (advanceUndock).
    setStickSuspended(true)
    // Титул: пока строится сцена, корабль дрожит; станции не даём накрыть его панелью
    // (flourishRef). «Вжух» и переход — по сигналу готовности (`ready`), не по таймеру.
    flourishRef.current = true
    window.setTimeout(onBoot, TREMBLE_LEAD_MS)
  }

  // Сцена готова — «вжух»: корабль срывается, и через секунду (небо пустеет) уходим в игру/док.
  // Ref-страж держит один раз: без него cleanup при смене `launched` убил бы таймер перехода.
  useEffect(() => {
    if (!ready || !waiting || resuming || fired.current) return
    fired.current = true
    setLaunched(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    window.setTimeout(() => {
      // Смена вида идёт под чёрной пеленой (затемнение→просветление), чтобы шов подмены
      // дерева не мелькнул. Небо к этому моменту уже секунду постояло пустым (LAUNCH_HOLD_MS).
      const swap = () => {
        flourishRef.current = false // флориш кончился — станция снова вправе всплывать
        // Куда переходим — по фактическому состоянию мира: пристыкован (новичок ИЛИ сейв у
        // причала) → станция; в полёте → дожимаем захват. Так «продолжить» тоже улетает.
        if (session.world.docked) onDock?.()
        else {
          // В полёт входим БЕЗ кино вылета (оно бывает только от причала), значит вернуть
          // мышь некому — делаем это здесь, иначе после «Продолжить» из космоса корабль
          // остался бы без управления. У причала мышь вернёт advanceUndock при отчаливании.
          setStickSuspended(false)
          poll(performance.now() + LOCK_GIVE_UP_MS)
        }
      }
      if (onFade) onFade(swap)
      else swap()
    }, LAUNCH_HOLD_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, waiting, resuming])

  const take = () => {
    if (waiting) return
    launch()
  }

  // Авто-старт новичка: флориш и посадка на станцию проигрываются сами, без нажатия.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void (auto && launch()), [])

  return (
    <div className="absolute inset-0 cursor-default overflow-hidden bg-black font-mono text-[#7fd6ff]">
      {!gfxReady ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <span className="text-sm tracking-[0.3em]">{t('menu.loadingGfx')}</span>
          <div
            className="h-0.5 w-48 overflow-hidden rounded-full bg-[#0a1a2f]"
            role="progressbar"
            aria-valuenow={Math.round(gfxProgress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-[#7fd6ff] transition-[width] duration-150 ease-out"
              style={{ width: `${Math.round(gfxProgress * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <div
          className="absolute inset-0 cursor-default overflow-hidden bg-black bg-cover bg-center"
          style={{
            backgroundImage: 'url(/bg.png)',
            animation: 'title-fade-in 0.35s ease-out both',
          }}
        >
      {/* Затемнение ради читаемости фосфорного текста поверх звёзд bg.png.
          Слабее прежнего: bg.png сам тёмный, топить его в черноте незачем. */}
      <div className="absolute inset-0 bg-black/45" />

      {/* Мерцание неба — ПОВЕРХ затемнения, иначе scrim гасит его в невидимость. Точки
          редкие и мелкие, лягут в пустотах между логотипом и кнопками, не мешая тексту. */}
      <TitleStars />

      {/* Корабль с дюзами — часть фона, но ПОВЕРХ звёзд: по центру, чуть ниже, ловит провал
          звёздного поля в bg.png и заслоняет собой мерцание. Курсор не трогает, кнопки поверх.
          Пламя — ДВЕ струи ПОД корпусом (в DOM раньше корабля → он их перекрывает): базы
          прячутся за кормой, плюмажи торчат сверху. Режим screen делает чёрный фон струи
          прозрачным и превращает её в свечение над тёмным небом. Позиции в % от корабля —
          правь bottom/left/w, если сопла окажутся не на месте.
          Корабль — только на ПЕРВОЙ заставке (не на паузе: там пустое небо). По СТАРТУ
          (`waiting`) он срывается и улетает, а затем уходит с экраном паузы. */}
      {!resuming && <TitleDust launched={launched} vanishY={vanishY} />}
      {/* Варп-штрихи — только в момент СРЫВА (`launched`): пыль слилась в линии. */}
      {!resuming && launched && <TitleWarp vanishY={vanishY} />}
      {!resuming && <TitleShip trembling={waiting} launched={launched} />}

      {/* Логотип — СВОЙ контейнер, вне общего потока: сдвинуть его нечем, что бы
          ни выросло ниже. Растр, поэтому у него собственная ширина. Заголовок
          остаётся для тех, кто читает страницу не глазами. */}
      <h1 className="sr-only">STAR ELITE</h1>
      <TitleLogo launching={waiting} imgRef={logoRef} onReady={measureVanish} />

      {/* Главное меню — просто кнопки на фоне корабля, без плашки: обводка тут ни к чему.
          Клавиши и настройки не живут на этом экране, а всплывают поверх отдельной панелью. */}
      <div className="absolute inset-0 flex flex-col items-center justify-start pt-[calc(32vh+40px)]">
        {waiting ? (
          /* Идёт загрузка/старт: вместо кнопок — один центрованный индикатор. На первом
             старте (не пауза) он уезжает к середине под улетающий корабль; на паузе стоит. */
          <div
            style={{
              transform: !resuming ? 'translateY(calc(18vh - 3rem))' : 'none',
              // На срыве корабля подпись быстро уходит в прозрачность (0.2с); сдвиг — как был (0.7с).
              opacity: launched ? 0 : 1,
              transition: 'transform 0.7s ease-out, opacity 0.2s ease-out',
            }}
          >
            {/* Эскалация подписи и дрожь кнопки — ЧЕРЕЗ CSS (композитор), а не React-таймеры:
                считается от МОМЕНТА нажатия в реальном времени, даже пока сборка держит поток.
                Три лейбла наложены и переключаются opacity на 2с и 5с; кнопка дрожит с 2с. */}
            <div style={{ animation: 'title-btn-shake 0.5s linear 2s infinite' }}>
              <MenuButton disabled onClick={() => {}}>
                <span className="relative block">
                  <span className="block" style={{ animation: 'esc-a 5s linear forwards' }}>{t('menu.wait')}</span>
                  <span className="absolute inset-0" style={{ animation: 'esc-b 5s linear forwards' }}>{t('menu.wait2')}</span>
                  <span className="absolute inset-0" style={{ animation: 'esc-c 5s linear forwards' }}>{t('menu.waitLong')}</span>
                </span>
              </MenuButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {/* Порядок: НОВАЯ ИГРА · ПРОДОЛЖИТЬ (если есть сейв/пауза) · КЛАВИШИ · НАСТРОЙКИ.
                Отдельной «СТАРТ» нет: новичок идёт через создание перса → сразу на станцию,
                а вход в существующую игру — это «Продолжить». */}
            {/* «Новая игра» стирает прогресс. Есть сейв — спрашиваем МОДАЛКОЙ (Да/Нет);
                нет сейва (нечего терять) — начинаем сразу, без лишнего вопроса. */}
            <MenuButton onClick={() => (session.isNewGame ? onNewGame() : setConfirmNew(true))}>
              {t('menu.newGame')}
            </MenuButton>
            {/* «Продолжить» — только когда есть куда возвращаться: сейв (не новая игра) или
                пауза. Ведёт в игру тем же захватом курсора, что и раньше «Старт». */}
            {(resuming || !session.isNewGame) && (
              <MenuButton onClick={take}>{t(resuming ? 'menu.resume' : 'menu.continue')}</MenuButton>
            )}
            <MenuButton onClick={() => { setConfirmNew(false); setScreen('keys') }}>
              {t('menu.keys')}
            </MenuButton>
            <MenuButton onClick={() => { setConfirmNew(false); setScreen('settings') }}>
              {t('menu.settings')}
            </MenuButton>
          </div>
        )}
      </div>

      {/* Копирайт и версия — тихой строкой у нижнего края. Версия из package.json (см.
          __APP_VERSION__), потому число само едет за релизом. На срыве гаснет вместе со сценой. */}
      {!launched && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center font-mono text-[11px] tracking-wide text-[#7fd6ff]/40">
          © 2026 Oreanor Aurgilion · v{__APP_VERSION__}
        </div>
      )}

      {/* Новая игра при живом сейве — модалка с прямым «уничтожит, начать?». Клик мимо = отмена. */}
      {confirmNew && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 px-8"
          onClick={() => setConfirmNew(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <MenuPanel>
              <p className="max-w-sm text-center text-sm leading-relaxed tracking-widest text-[#7fd6ff]">
                {t('menu.newGameConfirm')}
              </p>
              <p className="max-w-sm text-center text-xs leading-relaxed tracking-widest text-[#3f7391]">
                {t('menu.newGameWarn')}
              </p>
              <div className="flex gap-4">
                <MenuButton onClick={onNewGame}>{t('menu.yes')}</MenuButton>
                <MenuButton onClick={() => setConfirmNew(false)}>{t('menu.no')}</MenuButton>
              </div>
            </MenuPanel>
          </div>
        </div>
      )}

      {/* Панель клавиш/настроек — оверлей ПОВЕРХ меню: всплыла, прочитал, закрыл и вернулся.
          Клик мимо неё (по затемнению) или «назад» возвращает к кнопкам старта. */}
      {(screen === 'keys' || screen === 'settings') && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 px-8"
          onClick={() => setScreen('main')}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <MenuPanel
              title={t(screen === 'keys' ? 'menu.keys' : 'menu.settings')}
              footer={
                screen === 'keys' ? (
                  <MenuButton onClick={() => setScreen('main')}>{t('menu.back')}</MenuButton>
                ) : (
                  <>
                    {onSignOut && <MenuButton onClick={onSignOut}>{t('auth.signout')}</MenuButton>}
                    <MenuButton onClick={() => setScreen('main')}>{t('menu.back')}</MenuButton>
                  </>
                )
              }
            >
              {screen === 'keys' ? (
                <>
                  <Tabs
                    tabs={KEY_GROUPS.map((g) => t(g.title))}
                    active={t(KEY_GROUPS[keyGroup]!.title)}
                    onSelect={(label) => setKeyGroup(KEY_GROUPS.findIndex((g) => t(g.title) === label))}
                  />
                  {/* Высота по контенту с полом (min-h): высокие вкладки растягивают окно, а не
                      скроллятся; короткие держат минимум, чтобы вкладки не дёргались. */}
                  <dl className="min-h-[13rem] w-full max-w-md content-start space-y-1 text-left text-sm">
                    {KEY_GROUPS[keyGroup]!.rows.map(([keyLabel, keyWhat]) => (
                      <div key={keyLabel} className="flex gap-3">
                        <dt className="w-24 shrink-0 text-right text-[#7fd6ff]">{t(keyLabel)}</dt>
                        <dd className="flex-1 truncate text-[#3f7391]">{t(keyWhat)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <Settings session={session} />
              )}
            </MenuPanel>
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  )
}

const ASSIST_STORAGE_KEY = 'elite.assist'

/** Порядок языков в селекте. Стартовый определяется в i18n: сохранённый → язык браузера → en. */
const LANG_CODES: readonly Lang[] = ['ru', 'en', 'pt', 'fr', 'de', 'es', 'it']

/** Селект языка: своя стрелка-шеврон (нативная жмётся в край), отодвинута от кромки. */
const LANG_SELECT = {
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  backgroundColor: 'rgba(10,26,47,0.82)',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237fd6ff' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.75rem center',
} as const

/**
 * Настройки: язык интерфейса и лётный компьютер.
 *
 * Язык живёт в модульной переменной i18n (его читает и HUD вне React), поэтому
 * кнопки зовут `setLang`, а `useLang` в родителе перерисовывает меню. Лётный
 * компьютер — поле `intent`, общее для всей сессии; его выбор запоминается в
 * localStorage и подхватывается при следующем старте (см. createIntent).
 */
function Settings({ session }: { session: ReturnType<typeof useSession> }) {
  const lang = useLang()
  const [assist, setAssist] = useState(session.intent.flightAssist)

  const pickLang = (next: Lang) => setLang(next)
  const toggleAssist = (on: boolean) => {
    session.intent.flightAssist = on
    localStorage.setItem(ASSIST_STORAGE_KEY, on ? 'on' : 'off')
    setAssist(on)
  }

  // Только СОДЕРЖИМОЕ (язык + лётный компьютер). Кнопки «Выход»/«Назад» живут в футере
  // MenuPanel, а не здесь: рамку, фон, верхнее прибитие и футер даёт общая плашка.
  return (
    <div className="flex w-full max-w-md flex-col gap-8">
        <Choice label={t('menu.language')}>
          <select
            value={lang}
            onChange={(e) => pickLang(e.target.value as Lang)}
            className="cursor-pointer border border-[#3f7391] py-1.5 pl-4 pr-9 text-sm tracking-[0.2em] text-[#7fd6ff]
                       outline-none transition-colors hover:border-[#7fd6ff] focus:border-[#7fd6ff]"
            style={LANG_SELECT}
          >
            {LANG_CODES.map((l) => (
              <option key={l} value={l} style={{ background: '#0a1a2f', color: '#7fd6ff' }}>
                {t(('menu.lang.' + l) as Key)}
              </option>
            ))}
          </select>
        </Choice>

      <Choice label={t('menu.assist')} hint={t('menu.assist.hint')}>
        <Toggle active={assist} onClick={() => toggleAssist(true)}>{t('menu.on')}</Toggle>
        <Toggle active={!assist} onClick={() => toggleAssist(false)}>{t('menu.off')}</Toggle>
      </Choice>
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

export function GameOver({ score, onRestart }: { score: number; onRestart: () => void }) {
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
