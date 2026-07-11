import { Fragment, useState } from 'react'
import type { ShipEntity, World } from '@elite/sim'
import { UI } from '../theme'
import { pilotEmotion, portraitIndex, portraitStyle, type Emotion } from '../portrait'

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
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  small?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`border tracking-[0.2em] transition-colors ${small ? 'px-3 py-1 text-xs' : 'mt-4 px-6 py-2 text-sm'} ${
        disabled ? 'cursor-not-allowed opacity-35' : 'cursor-pointer hover:bg-[#7fd6ff] hover:text-black'
      }`}
      style={{ borderColor: disabled ? DIM : ACCENT, color: disabled ? DIM : ACCENT }}
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
            className="cursor-pointer border px-5 py-2 text-xs tracking-[0.25em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
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
  name,
  size = 46,
}: {
  ship?: ShipEntity
  world?: World
  emotion?: Emotion
  name?: string
  size?: number
}) {
  const label = (ship?.name ?? name ?? '?').trim()
  const initial = label.charAt(0).toUpperCase() || '?'
  const emo: Emotion | null = ship ? emotion ?? (world ? pilotEmotion(ship, world) : 'neutral') : null
  const crop = ship && emo ? portraitStyle(ship.persona.species, portraitIndex(ship), emo) : null
  return (
    <div
      className="relative flex shrink-0 select-none items-center justify-center border"
      style={{
        width: size,
        height: size,
        borderColor: DIM,
        color: DIM,
        background: 'rgba(127,214,255,0.05)',
        fontSize: size * 0.42,
      }}
      aria-hidden
    >
      {initial}
      {crop && <div className="absolute inset-0" style={crop} />}
    </div>
  )
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 border p-5" style={{ borderColor: DIM }}>
      <h2 className="mb-3 text-sm tracking-[0.3em]">{title}</h2>
      {children}
    </section>
  )
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
  cell: (row: Row) => React.ReactNode
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
}: {
  columns: readonly Column<Row>[]
  rows: readonly Row[]
  rowKey: (row: Row, index: number) => string
  detail?: (row: Row) => React.ReactNode | null
  /** Клик по строке ВЫБИРАЕТ её (вместо раскрытия): подробности уходят в соседнюю колонку. */
  onRowClick?: (row: Row) => void
  /** Ключ выбранной строки — она подсвечена. */
  selectedKey?: string | null
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
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
    <table className="w-full border-collapse text-sm">
      {showHead && (
        <thead>
          <tr className="border-b" style={{ borderColor: DIM }}>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-2 pb-1 text-xs font-normal tracking-widest first:pl-0 last:pr-0 ${alignClass(c.align)}`}
                style={{ color: DIM, width: c.width }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((row, index) => {
          const key = rowKey(row, index)
          const card = detail?.(row) ?? null
          const isOpen = card !== null && open.has(key)
          // Клик по имени либо ВЫБИРАЕТ строку (колонка-компаньон), либо раскрывает карточку.
          const select = onRowClick !== undefined
          const interactive = select || card !== null
          const onName = select ? () => onRowClick(row) : () => toggle(key)
          const marker = select ? '' : isOpen ? '▾ ' : '▸ '
          return (
            <Fragment key={key}>
              <tr
                className="align-baseline"
                style={selectedKey === key ? { backgroundColor: 'rgba(127,214,255,0.10)' } : undefined}
              >
                {columns.map((c, ci) => (
                  <td key={c.key} className={`px-2 py-1 first:pl-0 last:pr-0 ${alignClass(c.align)}`} style={{ width: c.width }}>
                    {ci === 0 && interactive ? (
                      <button
                        type="button"
                        onClick={onName}
                        className="cursor-pointer text-left tracking-wide hover:underline"
                        style={{ color: ACCENT }}
                      >
                        {marker}
                        {c.cell(row)}
                      </button>
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
  )
}
