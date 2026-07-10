import { useState } from 'react'
import { MODULE_CATALOGUE, priceOf, stock, type ModuleKind, type ShipModule, type World } from '@elite/sim'
import { t, type Key } from '../i18n'
import { Column, DIM, Panel, Table, Tabs } from './chrome'
import { credits, formatStat } from './format'
import { BuyButton, CompareCell, StatDeltas, displayName, headlineNumber } from './Equipment'

/**
 * Каталог верфи, РАЗЛОЖЕННЫЙ ПО ВИДАМ. Пользователь не хочет свальную таблицу «всё
 * подряд»: сначала выбираешь вид (двигатели/щиты/лазеры…), потом видишь ровно его.
 *
 * Вкладок — только по тем видам, под которые у корпуса есть слоты или подвески:
 * предлагать баку четвёртый лазер, когда орудийная точка одна, — обман.
 *
 * Строка коротка: имя, цена, характеристика, масса, выигрыш ▲/▼ от стоящего. Полный
 * расклад «было → станет» прячется в раскрытие по имени. Покупка — на строке.
 */
export function KindBrowser({ world, onChange }: { world: World; onChange: () => void }) {
  const kinds = availableKinds(world)
  const [kind, setKind] = useState<ModuleKind>(kinds[0] ?? 'engine')
  const active = kinds.includes(kind) ? kind : kinds[0] ?? 'engine'

  const modules = stock(MODULE_CATALOGUE).filter((m) => m.kind === active)

  const columns: Column<ShipModule>[] = [
    { key: 'name', header: t('station.col.name'), cell: (m) => displayName(m) },
    {
      key: 'cost',
      header: t('station.cost'),
      align: 'right',
      cell: (m) => <span style={{ color: DIM }}>{credits(priceOf(m))}</span>,
    },
    {
      key: 'stat',
      header: t('station.col.benefit'),
      align: 'right',
      cell: (m) => <span style={{ color: DIM }}>{headlineNumber(m)}</span>,
    },
    {
      key: 'mass',
      header: t('stat.mass'),
      align: 'right',
      cell: (m) => <span style={{ color: DIM }}>{formatStat('mass', m.mass)}</span>,
    },
    {
      key: 'imp',
      header: t('station.improvement'),
      align: 'right',
      cell: (m) => <CompareCell world={world} module={m} />,
    },
    { key: 'act', header: '', align: 'right', cell: (m) => <BuyButton world={world} module={m} onChange={onChange} /> },
  ]

  return (
    <Panel title={t('station.catalogue')}>
      <Tabs
        tabs={kinds.map((k) => t(`kind.${k}` as Key))}
        active={t(`kind.${active}` as Key)}
        onSelect={(label) => {
          const found = kinds.find((k) => t(`kind.${k}` as Key) === label)
          if (found) setKind(found)
        }}
      />
      <div className="mt-4">
        <Table
          columns={columns}
          rows={modules}
          rowKey={(m) => m.id}
          // Раскрытие — побочные эффекты установки (масса двигает разворот/скорость).
          detail={(m) => <StatDeltas world={world} module={m} />}
        />
      </div>
    </Panel>
  )
}

/** Канонический порядок видов в панели — не алфавит, а логика оснастки: сперва ход, потом бой. */
const KIND_ORDER: readonly ModuleKind[] = [
  'engine',
  'thrusters',
  'shield',
  'armour',
  'cargo',
  'hyperdrive',
  'cloak',
  'laser',
  'missile',
  'drone',
]

/** Виды, под которые у корпуса есть куда ставить: внутренние слоты + точки подвески. */
function availableKinds(world: World): ModuleKind[] {
  const chassis = world.player.loadout.chassis
  const present = new Set<ModuleKind>()
  chassis.slots.forEach((s) => present.add(s.kind))
  // Ствол — в орудийную точку, ракета/БПЛА — на пилон. Точку под ракеты открываем для ракет.
  chassis.hardpoints.forEach((hp) => present.add(hp.kind === 'pylon' ? 'missile' : 'laser'))
  return KIND_ORDER.filter((k) => present.has(k))
}
