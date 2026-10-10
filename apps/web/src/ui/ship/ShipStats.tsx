import {
  type ShipSpec,
} from '@elite/sim'
import { DIM } from '../station/chrome'
import { trend } from '../theme'
import { StatId, formatStat, statLabel } from '../station/format'

/**
 * Таблица характеристик корабля: свои силы корпуса и вклад оборудования, со сравнением
 * со стоящим сейчас (стрелки лучше/хуже).
 */

/** Строки характеристик корабля. Читаются из `spec` при каждом рендере — после
 *  установки модуля `spec` уже пересобран доменом, и числа едут сами. */
export interface StatRow {
  id: StatId
  value: number
}

/** У какой характеристики «больше — лучше». По умолчанию да; масса — исключение: лёгкий вёртче. */
const HIGHER_BETTER: Partial<Record<StatId, boolean>> = { mass: false }

/** Характеристики двумя группами: сперва собственные оси рамы (их и качают на верфи),
 *  потом те, что определяет оборудование. Порядок — как просил пилот: своё вперёд. */
function statRows(spec: ShipSpec): { own: StatRow[]; gear: StatRow[] } {
  const tuning = spec.tuning
  return {
    // Собственные х-ки корпуса — ровно те оси, что усиливаются на верфи.
    own: [
      { id: 'hull', value: spec.hull.hull },
      { id: 'cargo', value: spec.cargoCapacity },
      { id: 'aux', value: spec.power.auxCapacity },
    ],
    // Задаются обвесом: щит, движки, привод, реактор и суммарная масса корабля.
    gear: [
      { id: 'shield', value: spec.hull.shield },
      { id: 'speed', value: tuning.MAX_SPEED },
      // Манёвренность — одним числом: среднее угловых ускорений по трём осям. Три
      // строки тангаж/рыскание/крен пилоту ни к чему, «тяжесть» носа читается и так.
      { id: 'maneuver', value: (tuning.PITCH_ACCEL + tuning.YAW_ACCEL + tuning.ROLL_ACCEL) / 3 },
      { id: 'jump', value: spec.jumpRange },
      { id: 'energy', value: spec.power.capacity },
      { id: 'mass', value: spec.mass },
    ],
  }
}

/** Стрелка сравнения с текущим кораблём — общим знаком «лучше/хуже» (`trend`). */
function CompareArrow({ id, value, base }: { id: StatId; value: number; base: number }) {
  if (Math.abs(value - base) < 1e-6) return null
  const better = (HIGHER_BETTER[id] ?? true) ? value > base : value < base
  const { color, mark } = trend(better)
  return <span style={{ color }}>{mark}</span>
}

export function Stats({ spec, name, baseline }: { spec: ShipSpec; name: string; baseline?: ShipSpec | null }) {
  const rows = statRows(spec)
  const base = baseline ? statRows(baseline) : null
  const baseAll = base ? [...base.own, ...base.gear] : null
  const all = [...rows.own, ...rows.gear]
  const half = Math.ceil(all.length / 2)

  // Плотные строки, а не общая таблица станции: экран корабля обязан влезть без прокрутки
  // целиком, а у таблицы поля рассчитаны на длинные списки товаров.
  const row = (r: StatRow) => {
    const b = baseAll?.find((x) => x.id === r.id)
    return (
      <div key={r.id} className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
        <span style={{ color: DIM }}>{statLabel(r.id)}</span>
        <span className="inline-flex items-center gap-1.5">
          {formatStat(r.id, r.value)}
          {b && <CompareArrow id={r.id} value={r.value} base={b.value} />}
        </span>
      </div>
    )
  }

  return (
    <section className="border px-4 py-3" style={{ borderColor: DIM }}>
      <h2 className="mb-1.5 text-sm tracking-[0.3em]">{name}</h2>
      {/* Две колонки по порядку чтения: своё корпуса, затем от оборудования. Половина
          ширины экрана — это слишком длинная строка для пары «имя … число». */}
      <div className="grid grid-cols-2 items-start gap-x-8">
        <div>{all.slice(0, half).map(row)}</div>
        <div>{all.slice(half).map(row)}</div>
      </div>
    </section>
  )
}
