import { useState } from 'react'
import {
  buyCommodity,
  cargoMass,
  commodityBuyPrice,
  commodityStock,
  commodityStockAt,
  type Commodity,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { ACCENT, Button, Column, DIM, Panel, Table } from './chrome'
import { credits, formatStat } from './format'
import { commodityName } from '../i18n/dataNames'

/**
 * Прилавок. Цена выведена из уровня развития системы и её строя плюс запаса на
 * складе — не назначена вручную. Дёшево там, где товар производят; дорого, где
 * его ввозят. Возить выгодно между системами, а не через этот же прилавок:
 * покупка выше продажи на спред.
 *
 * Строки — настоящие колонки: цена, масса, рынок и склад больше не слеплены в
 * одну заметку. Клик по названию раскрывает выбор количества — ползунок и поле.
 */
export function Market({ world, onChange }: { world: World; onChange: () => void }) {
  useLang() // перерисоваться при смене языка: заголовки и метки идут через t()

  const columns: Column<Commodity>[] = [
    {
      key: 'name',
      header: t('station.col.name'),
      cell: (c) => (c.contraband ? `${commodityName(c)} ⚠` : commodityName(c)),
    },
    {
      key: 'price',
      header: t('station.col.price'),
      align: 'right',
      cell: (c) => <span style={{ color: DIM }}>{credits(commodityBuyPrice(world, c))}</span>,
    },
    {
      key: 'mass',
      header: t('station.col.mass'),
      align: 'right',
      cell: (c) => <span style={{ color: DIM }}>{formatStat('mass', c.unitMass)}</span>,
    },
    {
      key: 'market',
      header: t('station.col.market'),
      align: 'center',
      cell: (c) => <MarketTag world={world} commodity={c} />,
    },
    {
      key: 'stock',
      header: t('station.col.stock'),
      align: 'right',
      cell: (c) => <span style={{ color: DIM }}>{commodityStockAt(world, c)}</span>,
    },
  ]

  return (
    <Panel title={t('station.market.title')}>
      <Table
        columns={columns}
        rows={commodityStock()}
        rowKey={(c) => c.id}
        detail={(c) => <BuyPanel world={world} commodity={c} onChange={onChange} />}
      />
    </Panel>
  )
}

/** «дёшево / дорого» относительно каталога — сигнал рынка одной клеткой, не строкой. */
function MarketTag({ world, commodity }: { world: World; commodity: Commodity }) {
  const ratio = commodityBuyPrice(world, commodity) / commodity.basePrice
  if (ratio < 0.95) return <span style={{ color: UI.ALLY }}>{t('station.cheap')}</span>
  if (ratio > 1.3) return <span style={{ color: UI.WARN }}>{t('station.dear')}</span>
  return <span style={{ color: DIM }}>·</span>
}

/**
 * Выбор количества: ползунок + числовое поле, границы 1..макс. Макс — это меньшее
 * из трёх: на что хватает денег, что влезает в трюм, что есть на складе. Итоговая
 * цена и занятость трюма считаются на лету, пока тянешь.
 */
function BuyPanel({ world, commodity, onChange }: { world: World; commodity: Commodity; onChange: () => void }) {
  const hold = world.player.hold
  const price = commodityBuyPrice(world, commodity)
  const affordable = price > 0 ? Math.floor(world.credits / price) : 0
  const freeUnits = Math.floor((hold.capacity - cargoMass(hold)) / commodity.unitMass)
  const stock = commodityStockAt(world, commodity)
  const max = Math.max(0, Math.min(affordable, freeUnits, stock))

  const [qty, setQty] = useState(1)
  // Границы могли сузиться после покупки — держим ползунок в них, не заводя вторую истину.
  const value = Math.min(Math.max(1, qty), Math.max(1, max))
  const usedAfter = Math.round(cargoMass(hold) + value * commodity.unitMass)

  const disabled = max < 1

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-3">
        <span className="tracking-widest" style={{ color: DIM }}>
          {t('station.qty')}
        </span>
        <input
          type="range"
          min={1}
          max={Math.max(1, max)}
          value={value}
          disabled={disabled}
          onChange={(e) => setQty(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer accent-[#7fd6ff]"
        />
        <input
          type="number"
          min={1}
          max={Math.max(1, max)}
          value={value}
          disabled={disabled}
          onChange={(e) => setQty(Number(e.target.value))}
          className="w-16 border bg-transparent px-2 py-1 text-right"
          style={{ borderColor: DIM, color: ACCENT }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setQty(max)}
          className="cursor-pointer tracking-widest hover:underline disabled:opacity-40"
          style={{ color: DIM }}
        >
          {t('station.max')} {max}
        </button>
      </div>

      <p style={{ color: DIM }}>
        {t('station.total')} <span style={{ color: ACCENT }}>{credits(value * price)}</span> ·{' '}
        {t('ship.cargo.used', { used: usedAfter, cap: hold.capacity })}
      </p>

      <Button
        small
        disabled={disabled}
        onClick={() => {
          if (buyCommodity(world, world.player, commodity, value) > 0) onChange()
        }}
      >
        {t('station.buyN', { n: value })}
      </Button>
    </div>
  )
}
