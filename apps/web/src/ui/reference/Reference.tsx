import { useState } from 'react'
import { MODULE_CATALOGUE, minTechForClass, moduleStat, type ShipModule } from '@elite/sim'
import { t, useLang, type Key } from '../i18n'
import { moduleName } from '../i18n/dataNames'
import { ACCENT, DIM, SideTabs, Table, type Column } from '../station/chrome'
import { formatStat, statLabel, type StatId } from '../station/format'
import { CATEGORY_ORDER, cardOf, type SlotCard } from '../ship/ShipSlots'
import { Money } from '../station/Money'

/**
 * СПРАВОЧНИК: всё железо галактики по слотам корабля, от слабого к сильному. Слоты —
 * те же карточки, что на экране корабля (`cardOf`): доп-устройства одним «доп. отсеком»,
 * дрон-ракеты вместе с ракетами.
 *
 * Читает каталог напрямую — тот же, из которого собираются прилавки, поэтому справочник
 * не расходится с игрой. Колонка ТЕХ — порог развитости мира, ниже которого модуль не
 * продают и не чинят (`minTechForClass`), то есть ответ на «где это искать».
 *
 * Предметы бога сюда не попадают: их не покупают, и справочник — не место для спойлеров.
 */

type Kind = ShipModule['kind']

const HIDDEN: ReadonlySet<Kind> = new Set<Kind>(['mielophone'])

const VISIBLE = MODULE_CATALOGUE.filter((m) => !HIDDEN.has(m.kind))

/** Виды в порядке каталога — чтобы внутри смешанного слота шли кучками, а не вперемешку. */
const KIND_ORDER: readonly Kind[] = [...new Set(MODULE_CATALOGUE.map((m) => m.kind))]

/** Слабое сверху: вид, затем класс, внутри класса — цена. Стартовый хлам (цена 0) первым. */
const byStrength = (a: ShipModule, b: ShipModule) =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.class - b.class || a.cost - b.cost

/**
 * Второе число там, где одного мало: у ракет «сколько штук» ничего не говорит без урона.
 * Данные, а не ветка в разметке — добавить слоту колонку значит дописать строку сюда.
 */
const EXTRA: Partial<Record<Kind, (m: ShipModule) => { id: StatId; value: number } | null>> = {
  missile: (m) => (m.kind === 'missile' ? { id: 'damage', value: m.damage } : null),
}

export function Reference() {
  useLang()
  const [card, setCard] = useState<SlotCard>(CATEGORY_ORDER[0])
  const rows = VISIBLE.filter((m) => cardOf(m.kind) === card).sort(byStrength)
  const first = rows[0]
  // Общую характеристику
  // показываем, только если она у всех строк одна: у РЭБ и маскировки сравнивать нечего.
  const statKeys = new Set(rows.map((m) => moduleStat(m).key))
  const statId: StatId | null = first && statKeys.size === 1 ? moduleStat(first).key : null
  const extra = first ? EXTRA[first.kind] : undefined
  const extraId = first && extra ? extra(first)?.id ?? null : null

  const columns: Column<ShipModule>[] = [
    { key: 'class', header: t('stat.class').toUpperCase(), width: '3.5rem', cell: (m) => m.class },
    { key: 'name', header: t('station.col.name'), cell: (m) => moduleName(m) },
    { key: 'tech', header: t('ref.col.tech'), align: 'right', width: '5rem', cell: (m) => `${minTechForClass(m.class)}+` },
    { key: 'mass', header: t('station.col.mass'), align: 'right', width: '6rem', cell: (m) => formatStat('mass', m.mass, 1) },
    ...(statId
      ? [{
          key: 'stat',
          header: statLabel(statId),
          align: 'right' as const,
          width: '9rem',
          cell: (m: ShipModule) => formatStat(statId, moduleStat(m).value),
        }]
      : []),
    ...(extra && extraId
      ? [{
          key: 'extra',
          header: statLabel(extraId),
          align: 'right' as const,
          width: '7rem',
          cell: (m: ShipModule) => {
            const v = extra(m)
            return v ? formatStat(v.id, v.value) : '—'
          },
        }]
      : []),
    {
      key: 'price',
      header: t('station.col.price'),
      align: 'right',
      width: '9rem',
      // Стартовый хлам не продаётся — цены у него нет, а не «0 кр.».
      cell: (m) => (m.cost > 0 ? <Money amount={m.cost} /> : <span style={{ color: DIM }}>—</span>),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 gap-6 font-mono">
      <SideTabs
        items={CATEGORY_ORDER.map((c) => ({ id: c, label: t(('kind.' + c) as Key).toUpperCase() }))}
        active={card}
        onSelect={setCard}
      />
      <div className="min-w-0 flex-1" style={{ color: ACCENT }}>
        <Table columns={columns} rows={rows} rowKey={(m) => m.id} />
      </div>
    </div>
  )
}
