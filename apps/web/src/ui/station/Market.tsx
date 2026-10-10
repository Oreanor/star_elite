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
import { trend } from '../theme'
import { t, useLang } from '../i18n'
import { ACCENT, Button, Column, DIM, Modal, Table } from './chrome'
import { Hold } from './Hold'
import { Outfitter } from './Outfitter'
import { formatStat } from './format'
import { commodityName } from '../i18n/dataNames'
import { Money, tm } from './Money'

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
  // Две половины прилавка: товары на перепродажу и железо для своего корабля.
  const [section, setSection] = useState<'goods' | 'gear'>('goods')
  // Строка не раскрывается вниз — клик открывает модалку сделки (купить/продать).
  // Из списка товаров и из отсека открывается одна и та же сделка.
  const [trading, setTrading] = useState<{ commodity: Commodity; sell?: boolean } | null>(null)

  const columns: Column<Commodity>[] = [
    {
      key: 'name',
      header: t('station.col.name'),
      cell: (c) => (
        <span>
          {commodityName(c)}
          {c.contraband && (
            <span className="ml-2 cursor-help" title="Торговля ограничена законом: перевозка разрешена, штрафуют за покупку или продажу" aria-label="Торговля ограничена законом: перевозка разрешена, штрафуют за покупку или продажу">
              ⚠
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'price',
      header: t('station.col.price'),
      align: 'right',
      cell: (c) => (
        <span style={{ color: DIM }}>
          <Money amount={commodityBuyPrice(world, c)} />
        </span>
      ),
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

  const switcher = (
    <div className="mb-5 flex gap-2">
      {(['goods', 'gear'] as const).map((s) => {
        const on = s === section
        return (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            aria-current={on ? 'page' : undefined}
            className="cursor-pointer border px-4 py-1.5 text-xs tracking-[0.25em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
            style={{ borderColor: on ? ACCENT : DIM, backgroundColor: on ? ACCENT : 'transparent', color: on ? '#000' : DIM }}
          >
            {t(s === 'goods' ? 'station.market.title' : 'station.outfit.title')}
          </button>
        )
      })}
    </div>
  )

  // Список (товары или оборудование) — левые две трети, ГРУЗОВОЙ ОТСЕК — правая треть на
  // всю высоту, и на ОБЕИХ вкладках: торговля это разговор двух списков, «что продают» и
  // «что у меня», а купленное в трюм железо должно тут же появиться рядом. Отступ панелей
  // гасим, чтобы обе колонки начинались вровень.
  return (
    // Растягиваемся на всю высоту вкладки — чтобы отсек справа доходил до низа панели.
    <div className="flex flex-1 flex-col">
      {/* Отсек справа — от 1280 px; уже — он уходит под список: пять колонок оборудования
          без переносов в две трети узкого окна не влезают и наезжали на отсек. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {switcher}
          {section === 'gear' ? (
            <Outfitter world={world} onChange={onChange} />
          ) : (
            // Без своей рамки и заголовка: вкладка ТОВАРЫ сверху уже сказала, что это за список.
            <div>
              {/* Список — ВСЕ товары, чтобы видеть цену даже на то, чего ни у кого нет. Но строка,
                  в которой сейчас ни купить, ни продать, — неактивна: делать в ней нечего. */}
              <Table
                columns={columns}
                rows={commodityStock()}
                rowKey={(c) => c.id}
                onRowClick={(c) => setTrading({ commodity: c })}
                rowDisabled={(c) => {
                  const { buyMax, held } = tradeLimits(world, c)
                  return buyMax < 1 && held < 1
                }}
              />
            </div>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col [&>section]:mt-0 [&>section]:flex-1">
          <Hold world={world} onChange={onChange} atStation onTrade={(c) => setTrading({ commodity: c, sell: true })} />
        </div>
      </div>
      {trading && (
        <TradeModal
          world={world}
          commodity={trading.commodity}
          initialSell={trading.sell}
          onChange={onChange}
          onClose={() => setTrading(null)}
        />
      )}
    </div>
  )
}

/**
 * Пределы сделки ЗДЕСЬ И СЕЙЧАС: сколько можно купить (меньшее из денег, места и склада) и
 * сколько этого товара уже в грузовом отсеке. Один источник для неактивности строки в списке
 * и для границ ползунка в модалке — чтобы они не разошлись.
 */
function tradeLimits(world: World, c: Commodity): { buyMax: number; held: number } {
  const hold = world.player.hold
  const buyPrice = commodityBuyPrice(world, c)
  const affordable = buyPrice > 0 ? Math.floor(world.credits / buyPrice) : 0
  const freeUnits = Math.floor((hold.capacity - cargoMass(hold)) / c.unitMass)
  const stock = commodityStockAt(world, c)
  const buyMax = Math.max(0, Math.min(affordable, freeUnits, stock))
  return { buyMax, held: commodityHeld(world.player, c) }
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
  // Тот же код, что «лучше/хуже» (`trend`): дёшево — выгодно, зелёным; дорого — красным.
  if (ratio < 0.95) return <span style={{ color: trend(true).color }}>{t('station.cheap')}</span>
  if (ratio > 1.3) return <span style={{ color: trend(false).color }}>{t('station.dear')}</span>
  return <span style={{ color: DIM }}>·</span>
}

/**
 * Отрицательное количество продаёт груз, положительное покупает. Макс покупки —
 * меньшее из трёх (деньги, место в отсеке, склад станции); макс продажи — сколько
 * этого товара уже в отсеке. Ноль не совершает сделку.
 * После сделки окно закрывается: сделка сделана.
 */
function TradeModal({
  world,
  commodity,
  initialSell = false,
  onChange,
  onClose,
}: {
  world: World
  commodity: Commodity
  initialSell?: boolean
  onChange: () => void
  onClose: () => void
}) {
  useLang()
  const player = world.player
  const buyPrice = commodityBuyPrice(world, commodity)
  const sellPrice = commoditySellPrice(world, commodity)
  // Пределы читаем из мира: нельзя продать больше груза или купить больше доступного.
  const { buyMax, held } = tradeLimits(world, commodity)

  const selling = initialSell
  const max = selling ? held : buyMax
  const [qty, setQty] = useState(0)
  const value = Math.min(Math.max(0, qty), max)
  const units = value
  const unitPrice = selling ? sellPrice : buyPrice
  const totalMass = Math.round(units * commodity.unitMass * 10) / 10
  const disabled = value === 0

  // Купил/продал — сделка сделана, окно закрывается; перерисовка (onChange) обновит список,
  // отсек и кошелёк под ним.
  const act = () => {
    if (disabled) return
    const ok =
      selling
        ? sellCommodity(world, player, commodity, units) > 0
        : buyCommodity(world, player, commodity, units) > 0
    if (ok) {
      onChange()
      onClose()
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-lg tracking-[0.2em]">
          {commodity.contraband ? `${commodityName(commodity)} ⚠` : commodityName(commodity)}
        </h3>
      </div>

      {/* Цена за ТОННУ, а не за единицу: у роскоши единица легче тонны, и «по 1456» без
          единицы читалось бы как цена тонны. */}
      <div className="mt-7 flex flex-col gap-2 text-center tabular-nums" style={{ color: ACCENT }}>
        <div className="text-base font-normal leading-7">
            {tm('station.trade.line', {
              mass: formatStat('mass', totalMass, Number.isInteger(totalMass) ? 0 : 1),
              price: <Money amount={unitPrice / commodity.unitMass} />,
            })}
        </div>
        <div className="text-xl leading-7">
          <Money amount={units * unitPrice} />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3 text-xs tabular-nums">
        <span className="w-10 text-right" style={{ color: DIM }}>0</span>
        <input
          type="range"
          aria-label={t(selling ? 'station.trade.sell' : 'station.trade.buy')}
          min={0}
          max={max}
          step={1}
          value={value}
          disabled={max === 0}
          onChange={(e) => setQty(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer accent-[#7fd6ff]"
        />
        <span className="w-10" style={{ color: DIM }}>{max}</span>
      </div>

      <div className="mt-5 flex justify-center gap-2">
        <Button small variant="primary" disabled={disabled} onClick={act}>
          {t(selling ? 'station.trade.sell' : 'station.trade.buy')}
        </Button>
        <Button small variant="secondary" onClick={onClose}>
          {t('ship.cancel')}
        </Button>
      </div>
    </Modal>
  )
}
