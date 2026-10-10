import type { ReactNode } from 'react'
import { UI } from '../theme'
import { t } from '../i18n'

/**
 * Проекция точки диска на экран для КРУГЛЫХ карт (локатор и система): поворот в
 * плоскости (yaw), затем наклон (tilt) сжимает ось «вперёд» и поднимает высоту, зум
 * множит. Плоский вид сверху при tilt=0; драгом круг превращается в наклонный эллипс.
 *
 * Один источник на обе карты: раньше эта же математика жила отдельной копией в каждой,
 * и правка наклона в одной не доезжала до другой. `depth` — глубина после поворота, по
 * ней метки сортируются (дальние рисуются первыми, ближние ложатся поверх).
 */
export function discProject(
  side: number,
  fwd: number,
  h: number,
  yaw: number,
  tilt: number,
  zoom: number,
): { x: number; y: number; depth: number } {
  const rx = (side * Math.cos(yaw) - fwd * Math.sin(yaw)) * zoom
  const fy = (side * Math.sin(yaw) + fwd * Math.cos(yaw)) * zoom
  return { x: rx, y: -(fy * Math.cos(tilt) + h * zoom * Math.sin(tilt)), depth: fy }
}

/**
 * Единая рамка ВСЕХ карт консоли: слева треть — колонка сведений, справа две трети —
 * само поле (локатор, система, галактика, мир).
 *
 * Раскладка живёт здесь одна на четверых не для красоты: раньше каждый вид верстал свои
 * отступы, свою ширину колонки и свой предел высоты — и при переключении вкладки картинка
 * прыгала. Прибор один, значит и корпус у него один; вид приносит только содержимое.
 *
 * Колонка слева, потому что читают слева направо: сперва «что тут есть» списком, потом
 * взгляд уходит на поле. Поле шире колонки вдвое — на нём и происходит работа.
 */
export function MapFrame({
  title,
  aside,
  square = false,
  children,
}: {
  title?: string
  /** Содержимое левой колонки: карточка выбранного, список, поиск, фильтры. */
  aside: ReactNode
  /** Поле круглое (локатор, система) — вписываем квадрат по высоте, чтобы не резало обод. */
  square?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 w-full flex-1 items-stretch gap-6 font-mono" style={{ color: UI.PRIMARY }}>
      <div className="flex min-h-0 w-1/3 min-w-0 shrink-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-3">{aside}</div>
      </div>

      <div className="flex min-h-0 w-2/3 min-w-0 flex-col">
        {title !== undefined && <h1 className="mb-3 shrink-0 text-center text-xl tracking-[0.12em]">{title}</h1>}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {square ? (
            // Квадрат меряется высотой поля под заголовком, чтобы не резало обод.
            <div className="relative aspect-square h-full max-w-full">{children}</div>
          ) : (
            <div className="relative h-full w-full">{children}</div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Карточка выбранного объекта — общая для всех видов: род объекта, имя тоном объекта,
 * под ними строки-сведения. Рамка загорается, когда объект действительно ЗАХВАЧЕН, а не
 * просто под курсором: наведение показывает, захват подтверждает.
 *
 * Род пишем ВСЕГДА и перед именем («ПЛАНЕТА: Люрилар»): по одному имени не угадать,
 * причал это, спутник или чужой борт, а цвет отметки читается только на поле.
 */
export function MapCard({
  kind,
  name,
  color,
  lines,
  body,
}: {
  /**
   * Своё содержимое вместо «род: имя» и строк — у бортов паспорт пилота (`PilotIdentity`),
   * тот же, что во вкладке «Люди» и в шапке разговора. Рамка и фон карточки остаются.
   */
  body?: React.ReactNode
  /** Род объекта словом: ПЛАНЕТА, ПРИЧАЛ, КОРАБЛЬ, СИСТЕМА, ГАЛАКТИКА. */
  kind: string
  name: string
  color: string
  /** Строки сведений; пустые и `null` выброшены — карточка не держит пустых мест. */
  lines: (string | null | undefined)[]
}) {
  return (
    <div
      // Карточка ВСЕГДА висит поверх поля (см. `MapPin`), поэтому фон у неё непрозрачный:
      // читать имя сквозь звёзды и орбиты нельзя. Рамка всегда одна и та же: цветом она ничего
      // не кодирует — захват и так виден кольцом у отметки и заливкой строки в списке.
      className="rounded border p-3 backdrop-blur-sm"
      style={{
        borderColor: 'rgba(124,196,255,0.35)',
        background: 'rgba(8,22,42,0.88)',
        boxShadow: '0 0 24px rgba(0,0,0,0.5)',
      }}
    >
      {body ?? (
        <>
          <div className="truncate text-base tracking-widest" style={{ color }}>
            <span className="opacity-60">{kind.toUpperCase()}: </span>
            {name}
          </div>
          {lines
            .filter((s): s is string => typeof s === 'string' && s.length > 0)
            .map((s, i) => (
              <div key={i} className="mt-1 truncate text-xs tracking-widest opacity-70">
                {s}
              </div>
            ))}
        </>
      )}
    </div>
  )
}

/**
 * Булавка: карточка У САМОЙ ТОЧКИ на поле. Не часть вёрстки — абсолютный слой поверх
 * карты, поэтому появление карточки ничего не двигает и ничего не перекраивает.
 *
 * Координаты — доли поля (0..1), а не пиксели: у SVG-карт точка известна в единицах
 * `viewBox`, у трёхмерных — из проекции кадра. Обе меры сводятся к доле, и булавка одна
 * на все четыре вида. Ближе к правому краю карточка сама перекидывается влево, иначе
 * она уезжала бы за поле у крайних отметок.
 */
export function MapPin({ x, y, wide, children }: { x: number; y: number; wide?: boolean; children: ReactNode }) {
  const flip = x > 0.55
  return (
    <div
      // `wide` — карточка с портретом (борт): паспорт пилота в узкую не влезал и рубился «Пег…».
      className={`pointer-events-none absolute z-30 ${wide ? 'w-[24rem]' : 'w-64'} max-w-[80%]`}
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
      }}
    >
      {/* Сама карточка кликабельна (в ней бывают кнопки), а поле под булавкой — нет. */}
      <div className="pointer-events-auto">{children}</div>
    </div>
  )
}

/**
 * Строка списка объектов — одна на все карты: род и имя слева, мера справа (дистанция,
 * дуга, класс). Выделение и наведение здесь общие, потому что выбор во ВСЕХ видах
 * двусторонний: подсветил строку — загорелась отметка на поле, и наоборот.
 *
 * Род перед именем обязателен — та же причина, что и в карточке: «Церера» ничего не
 * говорит, «СПУТНИК: Церера» говорит всё.
 */
export function MapRow({
  kind,
  name,
  meta,
  color,
  active,
  hover,
  onClick,
  onHover,
  strong,
}: {
  kind: string
  name: string
  /** Имя жирным — у людей (пилот встречного борта): человек важнее корпуса. */
  strong?: boolean
  meta?: string
  color: string
  /** Захвачен: то же состояние, что кольцо на поле. */
  active: boolean
  /** Под курсором — здесь или на поле. */
  hover?: boolean
  onClick: () => void
  onHover?: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      data-active={active}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      // Строка как в таблицах торговли: без рамки, наведение и захват — фоном.
      className="flex w-full cursor-pointer items-baseline gap-3 px-2 py-1 text-left text-sm transition-colors"
      style={{
        background: active ? 'rgba(124,196,255,0.16)' : hover ? 'rgba(124,196,255,0.07)' : 'transparent',
        color,
      }}
    >
      <span className="min-w-0 flex-1 truncate">
        {/* По-человечески: сперва имя, род — следом через запятую, приглушённо («Ардин,
            планета»). Не «ПЛАНЕТА: Ардин» — анкета вместо названия. Род, совпадающий с именем
            («Астероид»), не повторяем. */}
        {strong ? <span className="font-semibold">{name}</span> : name}
        {kind && kind.toLowerCase() !== name.toLowerCase() ? <span className="opacity-60">, {kind}</span> : null}
      </span>
      {meta ? <span className="shrink-0 text-xs opacity-60">{meta}</span> : null}
    </button>
  )
}

export type ListSort = 'dist' | 'type'

/**
 * Порядок кучек при сортировке по типу — один на локатор и карту системы: сперва то, с чем
 * говорят и дерутся (борта), затем куда летят (станции, планеты, луны), потом светила и
 * прочие ориентиры. Незнакомый род — в конец.
 */
const KIND_RANK: Record<string, number> = {
  ship: 0,
  contact: 0,
  player: 0,
  station: 1,
  planet: 2,
  moon: 3,
  star: 4,
  blackhole: 5,
  figurine: 6,
  monolith: 7,
  asteroid: 8,
}
export const kindRank = (kind: string): number => KIND_RANK[kind] ?? 9

/** Сравнение строк списка: по удалённости или кучками по типу (внутри — по удалённости). */
export function bySort(sort: ListSort) {
  return (a: { kind: string; dist: number }, b: { kind: string; dist: number }): number =>
    sort === 'type' ? kindRank(a.kind) - kindRank(b.kind) || a.dist - b.dist : a.dist - b.dist
}

/** Переключатель сортировки над списком карты. */
export function SortToggle({ value, onChange }: { value: ListSort; onChange: (v: ListSort) => void }) {
  return (
    <div className="mb-2 flex gap-2">
      {(['dist', 'type'] as const).map((k) => {
        const on = k === value
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            aria-current={on ? 'true' : undefined}
            className="cursor-pointer border px-3 py-1 text-xs tracking-[0.2em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
            style={{ borderColor: on ? UI.PRIMARY : UI.DIM, backgroundColor: on ? UI.PRIMARY : 'transparent', color: on ? '#000' : UI.DIM }}
          >
            {t(k === 'dist' ? 'locator.sort.dist' : 'locator.sort.type')}
          </button>
        )
      })}
    </div>
  )
}
