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
  // Строка не раскрывается вниз — клик открывает МАЛЕНЬКУЮ модалку выбора количества.
  const [buying, setBuying] = useState<Commodity | null>(null)

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
      cell: (c) => <span style={{ color: DIM }}>{commodityMass(c)}</span>,
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
      <Table columns={columns} rows={commodityStock()} rowKey={(c) => c.id} onRowClick={(c) => setBuying(c)} />
      {buying && (
        <BuyModal world={world} commodity={buying} onChange={onChange} onClose={() => setBuying(null)} />
      )}
    </Panel>
  )
}

/** Единица массы товара: обычные — в тоннах, роскошь и наркотики — в килограммах,
 *  иначе их доли тонны читаются как ноль. Масса в домене всегда в тоннах. */
const KG_GOODS = new Set(['luxuries', 'narcotics'])
function commodityMass(c: Commodity): string {
  if (KG_GOODS.has(c.id)) return `${Math.round(c.unitMass * 1000)} ${t('unit.kg')}`
  return formatStat('mass', c.unitMass)
}

/** «дёшево / дорого» относительно каталога — сигнал рынка одной клеткой, не строкой. */
function MarketTag({ world, commodity }: { world: World; commodity: Commodity }) {
  const ratio = commodityBuyPrice(world, commodity) / commodity.basePrice
  if (ratio < 0.95) return <span style={{ color: UI.ALLY }}>{t('station.cheap')}</span>
  if (ratio > 1.3) return <span style={{ color: UI.WARN }}>{t('station.dear')}</span>
  return <span style={{ color: DIM }}>·</span>
}

/**
 * Маленькая модалка выбора количества: название товара, число и горизонтальный
 * ползунок 1..макс, кнопки «купить» и «отмена». Макс — меньшее из трёх: на что
 * хватает денег, что влезает в трюм, что есть на складе. Итог считается на лету.
 */
function BuyModal({
  world,
  commodity,
  onChange,
  onClose,
}: {
  world: World
  commodity: Commodity
  onChange: () => void
  onClose: () => void
}) {
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 font-mono"
      onClick={onClose}
      style={{ color: ACCENT }}
    >
      <div
        // Стекло как у консоли станции: translucent-синий градиент под размытием, а не глухой
        // чёрный. Модалка покупки — часть того же терминала, и выглядеть должна так же.
        className="w-full max-w-sm rounded-2xl border p-6 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
        style={{
          borderColor: 'rgba(124,196,255,0.3)',
          background: 'linear-gradient(150deg, rgba(40,95,150,0.28), rgba(8,22,42,0.55))',
          boxShadow: '0 0 60px rgba(60,150,255,0.18), inset 0 0 80px rgba(80,180,255,0.06)',
        }}
      >
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h3 className="text-base tracking-[0.2em]">{commodityName(commodity)}</h3>
          <span className="text-xs" style={{ color: DIM }}>
            {credits(price)}
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <input
            type="range"
            min={1}
            max={Math.max(1, max)}
            value={value}
            disabled={disabled}
            onChange={(e) => setQty(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-[#7fd6ff]"
          />
          <span className="w-12 text-right tabular-nums">{value}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setQty(max)}
            className="cursor-pointer text-xs tracking-widest hover:underline disabled:opacity-40"
            style={{ color: DIM }}
          >
            {t('station.max')} {max}
          </button>
        </div>

        <p className="mt-3 text-xs" style={{ color: DIM }}>
          {t('station.total')} <span style={{ color: ACCENT }}>{credits(value * price)}</span> ·{' '}
          {t('ship.cargo.used', { used: usedAfter, cap: hold.capacity })}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            small
            disabled={disabled}
            onClick={() => {
              if (buyCommodity(world, world.player, commodity, value) > 0) onChange()
              onClose()
            }}
          >
            {t('station.buyN', { n: value })}
          </Button>
          <Button small onClick={onClose}>
            {t('ship.cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
