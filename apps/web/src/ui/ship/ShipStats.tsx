import {
  type ShipSpec,
} from '@elite/sim'
import { Column, DIM, Panel, Table } from '../station/chrome'
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

/** Стрелка сравнения с текущим кораблём: белая вверх — лучше, синяя вниз — хуже. */
function CompareArrow({ id, value, base }: { id: StatId; value: number; base: number }) {
  if (Math.abs(value - base) < 1e-6) return null
  const better = (HIGHER_BETTER[id] ?? true) ? value > base : value < base
  return <span style={{ color: better ? '#eaf4ff' : '#5b9bd6' }}>{better ? '▲' : '▼'}</span>
}

export function Stats({ spec, name, baseline }: { spec: ShipSpec; name: string; baseline?: ShipSpec | null }) {
  const rows = statRows(spec)
  const base = baseline ? statRows(baseline) : null
  const baseAll = base ? [...base.own, ...base.gear] : null

  const columns: Column<StatRow>[] = [
    { key: 'name', header: '', cell: (r) => <span style={{ color: DIM }}>{statLabel(r.id)}</span> },
    {
      key: 'value',
      header: '',
      align: 'right',
      cell: (r) => {
        const b = baseAll?.find((x) => x.id === r.id)
        return (
          <span className="inline-flex items-center justify-end gap-1.5">
            {formatStat(r.id, r.value)}
            {b && <CompareArrow id={r.id} value={r.value} base={b.value} />}
          </span>
        )
      },
    },
  ]

  return (
    <Panel title={name}>
      <Table columns={columns} rows={rows.own} rowKey={(r) => r.id} />
      {/* Маленький разделитель: выше — своё, ниже — от оборудования. */}
      <div className="my-1.5 border-t" style={{ borderColor: DIM, opacity: 0.4 }} />
      <Table columns={columns} rows={rows.gear} rowKey={(r) => r.id} />
    </Panel>
  )
}
