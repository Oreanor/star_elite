import { UI } from '../theme'

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

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 border p-5" style={{ borderColor: DIM }}>
      <h2 className="mb-3 text-sm tracking-[0.3em]">{title}</h2>
      {children}
    </section>
  )
}

/** Строка прайса: название, число, действие. Одинаковая у товаров и у железа. */
export function Row({
  name,
  price,
  note,
  children,
}: {
  name: string
  price: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-baseline gap-3 text-sm">
      <span className="w-64 shrink-0 truncate">{name}</span>
      <span className="w-24 shrink-0 text-right" style={{ color: DIM }}>
        {price}
      </span>
      <span className="w-20 shrink-0 text-right text-xs" style={{ color: DIM }}>
        {note ?? ''}
      </span>
      {children}
    </li>
  )
}
