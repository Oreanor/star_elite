import { useState } from 'react'
import {
  buyCommodity,
  cargoMass,
  commodityBuyPrice,
  commodityHeld,
  commoditySellPrice,
  commodityStock,
  commodityStockAt,
  sellCommodity,
  type Commodity,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { ACCENT, Button, Column, DIM, Modal, Panel, Table } from './chrome'
import { credits, formatStat } from './format'
import { commodityDesc, commodityName } from '../i18n/dataNames'

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
  // Строка не раскрывается вниз — клик открывает модалку сделки (купить/продать).
  const [trading, setTrading] = useState<Commodity | null>(null)

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
      <Table columns={columns} rows={commodityStock()} rowKey={(c) => c.id} onRowClick={(c) => setTrading(c)} />
      {trading && (
        <TradeModal world={world} commodity={trading} onChange={onChange} onClose={() => setTrading(null)} />
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

type TradeMode = 'buy' | 'sell'

/**
 * Модалка сделки: название и описание товара, переключатель КУПИТЬ/ПРОДАТЬ, один
 * горизонтальный ползунок 0..макс и итоговая сумма с кнопкой ОК. Макс покупки —
 * меньшее из трёх (деньги, место в трюме, склад станции); макс продажи — сколько
 * этого товара уже в трюме. Смена режима сбрасывает ползунок: границы разные.
 */
function TradeModal({
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
  useLang()
  const player = world.player
  const hold = player.hold
  const buyPrice = commodityBuyPrice(world, commodity)
  const sellPrice = commoditySellPrice(world, commodity)
  const stock = commodityStockAt(world, commodity)
  const held = commodityHeld(player, commodity)

  const [mode, setMode] = useState<TradeMode>('buy')
  const [qty, setQty] = useState(0)

  const affordable = buyPrice > 0 ? Math.floor(world.credits / buyPrice) : 0
  const freeUnits = Math.floor((hold.capacity - cargoMass(hold)) / commodity.unitMass)
  const buyMax = Math.max(0, Math.min(affordable, freeUnits, stock))
  const max = mode === 'buy' ? buyMax : held
  const unitPrice = mode === 'buy' ? buyPrice : sellPrice

  // Границы могли сузиться после сделки — держим ползунок в них, не заводя вторую истину.
  const value = Math.min(Math.max(0, qty), max)
  const disabled = value < 1

  const pick = (m: TradeMode) => {
    setMode(m)
    setQty(0)
  }

  const act = () => {
    const ok =
      mode === 'buy'
        ? buyCommodity(world, player, commodity, value) > 0
        : sellCommodity(world, player, commodity, value) > 0
    if (ok) onChange()
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-base tracking-[0.2em]">
          {commodity.contraband ? `${commodityName(commodity)} ⚠` : commodityName(commodity)}
        </h3>
        <span className="text-xs" style={{ color: DIM }}>
          {commodityMass(commodity)}
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed" style={{ color: DIM }}>
        {commodityDesc(commodity)}
      </p>

      {/* Переключатель режима: залитая вкладка — активный режим, как у вкладок станции. */}
      <div className="mb-4 flex gap-2">
        <TradeTab on={mode === 'buy'} onClick={() => pick('buy')} label={t('station.trade.buy')} />
        <TradeTab on={mode === 'sell'} onClick={() => pick('sell')} label={t('station.trade.sell')} />
      </div>

      {/* Контекст режима: почём и «сколько где». */}
      <div className="mb-2 flex justify-between text-xs" style={{ color: DIM }}>
        <span>{credits(unitPrice)}</span>
        <span>{mode === 'buy' ? t('station.trade.stock', { n: stock }) : t('station.trade.have', { n: held })}</span>
      </div>

      {/* Ползунок 0..макс: слева ноль, справа потолок режима. */}
      <div className="flex items-center gap-3 text-sm tabular-nums">
        <span className="w-10 text-right" style={{ color: DIM }}>
          0
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, max)}
          value={value}
          disabled={max < 1}
          onChange={(e) => setQty(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer accent-[#7fd6ff]"
        />
        <span className="w-10" style={{ color: DIM }}>
          {max}
        </span>
      </div>

      {/* Итог — крупно по центру: главное число сделки. Под ним мелко «сколько × почём». */}
      <div className="mt-4 text-center">
        <div className="text-2xl tabular-nums" style={{ color: ACCENT }}>
          {credits(value * unitPrice)}
        </div>
        <div className="mt-1 text-xs tabular-nums" style={{ color: DIM }}>
          {value} × {credits(unitPrice)}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button small disabled={disabled} onClick={act}>
          {t('ship.ok')}
        </Button>
        <Button small onClick={onClose}>
          {t('ship.cancel')}
        </Button>
      </div>
    </Modal>
  )
}

/** Вкладка режима сделки: залита в активном, обведена в неактивном — как вкладки станции. */
function TradeTab({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 cursor-pointer border px-4 py-1.5 text-xs tracking-[0.2em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
      style={{ borderColor: on ? ACCENT : DIM, backgroundColor: on ? ACCENT : 'transparent', color: on ? '#000' : DIM }}
    >
      {label}
    </button>
  )
}
