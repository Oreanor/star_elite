import { Fragment, useEffect, useState } from 'react'
import type { ShipEntity, World } from '@elite/sim'
import { UI } from '../theme'
import { GLASS_PANEL } from './backdrop'
import { DUDE_SHEET, dudeStyle, emotionToDivine, loadSheet, pilotEmotion, portraitIndex, portraitSheet, portraitStyle, type DivineEmotion, type Emotion } from '../portrait'
import { StaticNoise } from '../StaticNoise'

/**
 * Грузится ли ещё лист портрета. Пока Image в полёте — показываем помехи-прелоадер;
 * как только загрузился ИЛИ отвалился (404), помехи гаснут: на 404 крой прозрачен и
 * наружу проступает плейсхолдер-инициал, поэтому вечных помех на отсутствующем листе нет.
 */
function useSheetLoading(url: string | null): boolean {
  const [loading, setLoading] = useState(() => (url ? !loadSheet(url).complete : false))
  useEffect(() => {
    if (!url) {
      setLoading(false)
      return
    }
    const img = loadSheet(url)
    if (img.complete) {
      setLoading(false)
      return
    }
    setLoading(true)
    const settle = () => setLoading(false)
    img.addEventListener('load', settle)
    img.addEventListener('error', settle)
    return () => {
      img.removeEventListener('load', settle)
      img.removeEventListener('error', settle)
    }
  }, [url])
  return loading
}

/**
 * Хром станции: кнопка, вкладки, панель.
 *
 * Живёт отдельно, потому что меняется по своей причине — из-за оформления,
 * а не из-за правил торговли. Панели импортируют это и не знают друг о друге.
 *
 * Цвет берётся из общей темы: свой оттенок терминал станции заводить не вправе.
 * Литералы `#7fd6ff` в именах классов Tailwind неизбежны — переменную туда
 * не подставить, класс собирается на этапе сборки.
 */

export const ACCENT = UI.PRIMARY
export const DIM = UI.DIM

export function Button({
  children,
  onClick,
  disabled,
  small,
  variant = 'secondary',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  small?: boolean
  variant?: 'primary' | 'secondary'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`border text-xs tracking-label transition-colors ${small ? 'px-3 py-1' : 'mt-4 px-5 py-2'} ${
        disabled ? 'cursor-not-allowed opacity-35' : 'cursor-pointer ui-btn'
      }`}
      style={{
        borderColor: disabled ? DIM : ACCENT,
        color: variant === 'primary' ? '#08162a' : disabled ? DIM : ACCENT,
        backgroundColor: variant === 'primary' ? disabled ? DIM : ACCENT : undefined,
      }}
    >
      {children}
    </button>
  )
}

/**
 * Вкладки. Активная — залита, а не подчёркнута: подчёркивание в моношрифте
 * теряется среди рамок панелей, а заливка читается с любого расстояния.
 *
 * Кнопки, а не ссылки: адреса у вкладок нет, станция — не страница.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly T[]
  active: T
  onSelect: (tab: T) => void
}) {
  return (
    <nav className="mt-6 flex gap-2">
      {tabs.map((tab) => {
        const on = tab === active
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect(tab)}
            aria-current={on ? 'page' : undefined}
            className="cursor-pointer border px-5 py-2 text-xs tracking-label transition-colors ui-btn"
            style={{
              borderColor: on ? ACCENT : DIM,
              backgroundColor: on ? ACCENT : 'transparent',
              color: on ? '#000' : DIM,
            }}
          >
            {tab}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * Вкладки СТОЛБИКОМ слева от списка — слоты корабля в справочнике.
 * Магазин категории не режет: там весь прилавок одним списком.
 * Неактивный пункт виден, но гаснет — так видно, что вообще бывает.
 */
export function SideTabs<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: readonly { id: T; label: string; disabled?: boolean }[]
  active: T
  onSelect: (id: T) => void
}) {
  return (
    // Ширина — по самой длинной надписи, без переносов: «ДОП. ОБОРУДОВАНИЕ» в две строки ломал столбик.
    <nav className="flex w-max shrink-0 flex-col gap-1.5">
      {items.map(({ id, label, disabled }) => {
        const on = id === active
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(id)}
            aria-current={on ? 'page' : undefined}
            className="whitespace-nowrap border px-2 py-1.5 text-left text-xs tracking-label transition-colors enabled:cursor-pointer ui-btn disabled:cursor-not-allowed disabled:opacity-35"
            style={{
              borderColor: on ? ACCENT : DIM,
              backgroundColor: on ? ACCENT : 'transparent',
              color: on ? '#000' : DIM,
            }}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * Портрет пилота. Внизу — плейсхолдер (рамка с инициалом), поверх — крой лица из
 * листа расы по эмоции. Пока листа нет (404), крой прозрачен и проступает инициал;
 * появятся файлы в `public/portraits/` — лица встанут сами, вёрстка не поедет.
 *
 * Лицо и эмоцию берём из борта: вид — из персоны, индекс — из личности, эмоцию —
 * из состояния (можно переопределить пропом `emotion`, напр. по исходу разговора).
 * Без борта — только плейсхолдер по имени (например, у ещё безымянного встречного).
 */
export function PilotPortrait({
  ship,
  world,
  emotion,
  divineEmotion,
  name,
  species,
  face,
  muted,
  size = 46,
  onClick,
  title,
}: {
  ship?: ShipEntity
  world?: World
  emotion?: Emotion
  /** Эмоция БОГА (Слово): его аватар и мимика вне расовой сетки. Игнорируется у обычных бортов. */
  divineEmotion?: DivineEmotion
  name?: string
  /** Вид и лицо напрямую (без борта) — для удалённых игроков из presence. */
  species?: string
  face?: number
  /** «Отошёл»: гасим аватар в серый — игрока в мире сейчас нет. */
  muted?: boolean
  size?: number
  /** Клик по самому портрету — связаться. Задан → портрет кликабелен (курсор, обводка, клавиатура). */
  onClick?: () => void
  /** Подсказка/ARIA-имя для кликабельного портрета: что произойдёт по клику. */
  title?: string
}) {
  const label = (ship?.name ?? name ?? '?').trim()
  const initial = label.charAt(0).toUpperCase() || '?'
  // СЛОВО (divine) несёт СВОЙ аватар (portraits/dude.webp, 8 эмоций в ряд) — он показывается ВЕЗДЕ, где
  // рисуется его лицо (диалог, контакты), а не только в разговоре. Мимику задаёт `divineEmotion`.
  const divine = ship?.divine === true
  const emo: Emotion | null = ship && !divine ? emotion ?? (world ? pilotEmotion(ship, world) : 'neutral') : null
  const crop = divine
    ? dudeStyle(divineEmotion ?? emotionToDivine(emotion ?? (world ? pilotEmotion(ship!, world) : 'neutral')))
    : ship && emo
      ? portraitStyle(ship.persona.species, portraitIndex(ship), emo)
      : species !== undefined && face !== undefined
        ? portraitStyle(species, face, 'neutral')
        : null
  const sheetUrl = divine
    ? DUDE_SHEET
    : ship && emo
      ? portraitSheet(ship.persona.species, emo)
      : species !== undefined
        ? portraitSheet(species, 'neutral')
        : null
  const loading = useSheetLoading(sheetUrl)
  const interactive = onClick !== undefined
  return (
    <div
      // Кликабельный портрет — связаться прямо с лица. Обводка на ховере/фокусе (ring, а не
      // border: рамку тут задаёт inline-style и она бы перебила класс) даёт понять, что он живой.
      className={`relative flex shrink-0 select-none items-center justify-center border ${
        interactive
          ? 'cursor-pointer transition hover:ring-2 hover:ring-inset hover:ring-[#7fd6ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7fd6ff]'
          : ''
      }`}
      style={{
        width: size,
        height: size,
        borderColor: DIM,
        color: DIM,
        background: 'rgba(127,214,255,0.05)',
        fontSize: size * 0.42,
        // Отошёл — серый и приглушённый: в игре его сейчас нет.
        filter: muted ? 'grayscale(1) brightness(0.65)' : undefined,
        opacity: muted ? 0.6 : undefined,
      }}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? title : undefined}
      aria-hidden={interactive ? undefined : true}
      title={interactive ? title : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
    >
      {initial}
      {crop && <div className="absolute inset-0" style={crop} />}
      {loading && <StaticNoise />}
    </div>
  )
}

/** @param flush Без верхнего отступа — когда панель встаёт под переключатель, а не под соседку. */
export function Panel({ title, children, flush, className = '' }: { title: string; children: React.ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`${flush ? '' : 'mt-6 '}border p-5 ${className}`} style={{ borderColor: DIM }}>
      {/* Пустой заголовок не рисуем: под вкладкой «модули / отсек» повтор того же слова шумит. */}
      {title ? <h2 className="mb-3 shrink-0 text-sm tracking-title">{title}</h2> : null}
      {children}
    </section>
  )
}

/**
 * Единая модалка станции: затемнённый фон + СТЕКЛЯННАЯ панель (тот же translucent-синий
 * градиент под размытием, что у консоли и карты). Раньше рецепт стекла копировался в
 * каждую модалку врозь, и оборудование по недосмотру осталось глухо-чёрным — теперь он
 * один. Клик по фону закрывает, клик по панели гасится.
 *
 * `wide` — крупная модалка со скроллом (варианты снаряжения); `z` поднимает вложенную
 * (вопрос-подтверждение поверх уже открытой) выше родителя.
 */
export function Modal({
  onClose,
  children,
  wide,
  medium,
  fit,
  z = 50,
}: {
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
  /** Средняя ширина: вопрос с несколькими кнопками в одну строку («купить / купить и поставить / отмена»). */
  medium?: boolean
  /** По содержимому: окно ровно такой ширины, чтобы таблицы влезли без переносов (до края экрана). */
  fit?: boolean
  z?: number
}) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/70 p-6 font-mono"
      style={{ color: ACCENT, zIndex: z }}
      onClick={onClose}
    >
      <div
        className={`rounded-2xl border p-6 backdrop-blur-md ${fit ? 'max-h-[85vh] w-max max-w-[95vw] overflow-y-auto' : `w-full ${wide ? 'max-h-[85vh] max-w-6xl overflow-y-auto' : medium ? 'max-w-lg' : 'max-w-sm'}`}`}
        onClick={(e) => e.stopPropagation()}
        style={GLASS_PANEL}
      >
        {children}
      </div>
    </div>
  )
}

/** Заголовок модалки: имя того, о чём окно (модуль, товар, корпус). Один кегль на все окна. */
export function ModalTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-4 text-base tracking-title">{children}</h3>
}

/** Надзаголовок модалки: вид окна словом («ЛАЗЕР», «ПОКУПКА КОРПУСА»), тусклый, над именем. */
export function ModalKicker({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-4 text-sm tracking-label" style={{ color: DIM }}>
      {children}
    </h3>
  )
}

/**
 * Нижний ряд кнопок модалки — у ВСЕХ окон одинаковый: по центру, действия слева,
 * «закрыть/отмена» последней. Раньше закрытие жило где придётся (в углу шапки, внизу,
 * нигде), и отступы гуляли от окна к окну.
 */
export function ModalActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>
}

/**
 * Колонка таблицы: заголовок, выравнивание, ширина и как из строки достать ячейку.
 * `header: ''` — колонка без подписи (действие); если пусты ВСЕ, шапка не рисуется.
 */
export interface Column<Row> {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  /** CSS-ширина колонки, напр. '6rem'. Прочее делит остаток. */
  width?: string
  /**
   * Заголовок накрывает столько колонок, начиная с этой (по умолчанию 1). Накрытые
   * следом свой заголовок не рисуют. Для пар, что читаются вместе: «было → станет» и ▲/▼.
   */
  headerSpan?: number
  cell: (row: Row) => React.ReactNode
  /**
   * Ключ сортировки. Есть — заголовок кликается: по возрастанию, по убыванию, исходный порядок.
   * Строки сравниваются по-человечески (`localeCompare`), числа — как числа.
   */
  sortValue?: (row: Row) => number | string
}

const alignClass = (a?: Column<unknown>['align']) =>
  a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left'

/**
 * Настоящая таблица прайса: колонки с заголовком, а не слепленная строка-заметка.
 * Пользователь просил «1 т · дёшево · склад 213» разложить по столбцам — вот они.
 *
 * `detail` — раскрывающаяся карточка под строкой. Где она есть, имя (первая
 * колонка) становится кнопкой: клик по снаряжению показывает его плюс и действия.
 * Раскрытые ключи живут в обычном состоянии React — экран станции стоит, кадра нет,
 * и это ровно тот случай, для которого React и заведён.
 */
export function Table<Row>({
  columns,
  rows,
  rowKey,
  detail,
  onRowClick,
  selectedKey,
  rowDisabled,
  scrollable,
  fixedLayout,
}: {
  columns: readonly Column<Row>[]
  rows: readonly Row[]
  rowKey: (row: Row, index: number) => string
  detail?: (row: Row) => React.ReactNode | null
  /** Клик по строке ВЫБИРАЕТ её (вместо раскрытия): подробности уходят в соседнюю колонку. */
  onRowClick?: (row: Row) => void
  /** Ключ выбранной строки — она подсвечена. */
  selectedKey?: string | null
  /** Строка НЕАКТИВНА: не кликается и приглушена. Данные видны (цена в столбце), а
   *  делать нечего — например товар, который ни купить, ни продать сейчас. */
  rowDisabled?: (row: Row) => boolean
  /** Прокрутка внутри ограниченной по высоте панели с неподвижной шапкой. */
  scrollable?: boolean
  fixedLayout?: boolean
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  // Сортировка по клику на заголовок: колонка и направление; null — исходный порядок данных.
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const sortCol = sort ? columns.find((c) => c.key === sort.key && c.sortValue) : undefined
  const shown = sortCol
    ? [...rows]
        .map((row, i) => ({ row, i, v: sortCol.sortValue!(row) }))
        .sort((a, b) => {
          const d = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))
          // Равные — в исходном порядке: строки не прыгают между собой от клика к клику.
          return d !== 0 ? d * sort!.dir : a.i - b.i
        })
        .map((x) => x.row)
    : rows
  const cycleSort = (key: string) =>
    setSort((prev) => (prev?.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : null))
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  // Шапку прячем, когда все заголовки пусты (характеристики корабля): строка
  // «НАЗВАНИЕ ЗНАЧЕНИЕ» там только шумит.
  const showHead = columns.some((c) => c.header !== '')

  return (
    // Без переносов: строка таблицы — одна строка экрана (имя «Лучевой лазер 3 «Клинок»» в две
    // строки ломало ритм списка). Не влезло — таблица прокручивается вбок, а не ломает строки.
    // pr-3 у прокрутки: последний столбец не прилипает к полосе.
    <div className={scrollable ? 'min-h-0 flex-1 overflow-auto overscroll-contain pr-3' : 'overflow-x-auto'}>
    <table className={`w-full border-collapse whitespace-nowrap text-sm ${fixedLayout ? 'table-fixed' : ''}`}>
      {/* Ширины — колонкам, а не заголовкам: заголовок может накрывать несколько колонок. */}
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={{ width: c.width }} />
        ))}
      </colgroup>
      {showHead && (
        <thead className={scrollable ? 'sticky top-0 z-10' : undefined} style={scrollable ? { backgroundColor: UI.TABLE_HEADER } : undefined}>
          <tr className="border-b" style={{ borderColor: DIM }}>
            {columns.map((c, i) => {
              // Колонку накрыл заголовок одной из предыдущих — своего не рисуем.
              if (columns.slice(0, i).some((p, j) => j + (p.headerSpan ?? 1) > i)) return null
              const span = c.headerSpan ?? 1
              return (
                <th
                  key={c.key}
                  colSpan={span}
                  // Общий заголовок пары — по ЛЕВОМУ краю, с началом её первой колонки; одиночный — как его колонка.
                  className={`px-2 pb-1 text-xs font-normal tracking-meta first:pl-0 last:pr-0 ${span > 1 ? 'text-left' : alignClass(c.align)} ${c.sortValue ? 'cursor-pointer select-none hover:text-[#7fd6ff]' : ''}`}
                  style={{ color: sort?.key === c.key ? ACCENT : DIM }}
                  onClick={c.sortValue ? () => cycleSort(c.key) : undefined}
                >
                  {c.header}
                  {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              )
            })}
          </tr>
        </thead>
      )}
      <tbody>
        {shown.map((row, index) => {
          const key = rowKey(row, index)
          const card = detail?.(row) ?? null
          const isOpen = card !== null && open.has(key)
          // Клик по строке либо ВЫБИРАЕТ её (колонка-компаньон), либо раскрывает карточку.
          const select = onRowClick !== undefined
          const disabled = rowDisabled?.(row) ?? false
          const interactive = (select || card !== null) && !disabled
          const onAct = select ? () => onRowClick(row) : () => toggle(key)
          const marker = select ? '' : isOpen ? '▾ ' : '▸ '
          const selected = selectedKey === key
          // Кликабельна ВСЯ строка, а не одно имя: раньше мимо первой ячейки клик пропадал.
          // Неактивная строка приглушена и не кликается — делать в ней нечего.
          return (
            <Fragment key={key}>
              <tr
                className={`align-baseline ${interactive ? 'cursor-pointer transition-colors hover:bg-[#7fd6ff]/[0.06]' : ''} ${disabled ? 'opacity-40' : ''}`}
                style={selected ? { backgroundColor: 'rgba(127,214,255,0.10)' } : undefined}
                onClick={interactive ? onAct : undefined}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onAct()
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c, ci) => (
                  <td
                    key={c.key}
                    className={`px-2 py-1 first:pl-0 last:pr-0 ${alignClass(c.align)}`}
                    style={{ width: c.width, color: ci === 0 && interactive ? ACCENT : undefined }}
                  >
                    {ci === 0 && interactive ? (
                      <>
                        {marker}
                        {c.cell(row)}
                      </>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={columns.length} className="pb-3">
                    <div className="ml-1 border-l-2 pl-3" style={{ borderColor: DIM }}>
                      {card}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
    </div>
  )
}
