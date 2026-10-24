import { useState } from 'react'
import {
  localFine,
  buyCommodity,
  buyLimit,
  commodityBuyPrice,
  commodityHeld,
  commoditySellPrice,
  commodityStock,
  commodityStockAt,
  sellCommodity,
  type Commodity,
  type World,
} from '@elite/sim'
import { trend, UI } from '../theme'
import { t, useLang } from '../i18n'
import { ACCENT, Button, Column, DIM, Modal, ModalActions, ModalTitle, Table } from './chrome'
import { Hold } from './Hold'
import { dumpUnits } from './jettison'
import { ContrabandMark } from './ContrabandMark'
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
      sortValue: (c) => commodityName(c),
      cell: (c) => (
        <span>
          {commodityName(c)}
          {c.contraband && <ContrabandMark />}
        </span>
      ),
    },
    // Порядок: что, почём, сколько есть, как цена против обычной. Столбца «единица» нет: у
    // всех товаров она тонна (у статуэтки — штука), и он стоял сплошными «1 т».
    {
      key: 'price',
      header: t('station.col.price'),
      align: 'right',
      sortValue: (c) => commodityBuyPrice(world, c),
      cell: (c) => (
        <span style={{ color: DIM }}>
          <Money amount={commodityBuyPrice(world, c)} />
        </span>
      ),
    },
    {
      key: 'stock',
      header: t('station.col.stock'),
      align: 'right',
      sortValue: (c) => commodityStockAt(world, c),
      cell: (c) => <span style={{ color: DIM }}>{stockText(c, commodityStockAt(world, c))}</span>,
    },
    {
      key: 'market',
      header: t('station.col.market'),
      align: 'center',
      cell: (c) => <MarketTag world={world} commodity={c} />,
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
            className="cursor-pointer border px-3 py-1 text-xs tracking-label transition-colors ui-btn"
            style={{ borderColor: on ? ACCENT : DIM, backgroundColor: on ? ACCENT : 'transparent', color: on ? '#000' : DIM }}
          >
            {t(s === 'goods' ? 'station.market.title' : 'station.outfit.title')}
          </button>
        )
      })}
    </div>
  )

  // Список слева уже отсека: имена в трюме обрезались, а прайс читается и в узкой колонке.
  // Обе колонки — на всю высоту вкладки, и на ОБЕИХ переключателях: купленное железо
  // должно тут же появиться рядом. Отступ панели отсека гасим, чтобы колонки начались вровень.
  return (
    // Высота — остаток консоли, не длина списка. Иначе отсек растёт вместе с грузом,
    // и внутренняя прокрутка (та же, что на вкладке корабля) не включается.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Отсек справа — половина модалки; таблица внутри на всю эту колонку.
          Уже 1280 px колонки стоят друг под другом. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-5 xl:grid-cols-2 xl:grid-rows-1">
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="shrink-0">{switcher}</div>
          {section === 'gear' ? (
            <Outfitter world={world} onChange={onChange} />
          ) : (
            // Без своей рамки и заголовка: вкладка ТОВАРЫ сверху уже сказала, что это за список.
            // Прокручивается список, шапка липнет — как строки отсека справа.
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Список — ВСЕ товары, чтобы видеть цену даже на то, чего ни у кого нет. Но строка,
                  в которой сейчас ни купить, ни продать, — неактивна: делать в ней нечего. */}
              <Table
                scrollable
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
        <div className="flex min-h-0 min-w-0 flex-col [&>section]:mt-0 [&>section]:min-h-0 [&>section]:flex-1">
          <Hold world={world} onChange={onChange} atStation scrollable onTrade={(c) => setTrading({ commodity: c, sell: true })} />
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
  // Предел покупки — доменный (`buyLimit`): тот же, по которому `buyCommodity` отдаёт товар.
  return { buyMax: buyLimit(world, world.player, c), held: commodityHeld(world.player, c) }
}

/** Склад — сразу в тоннах («23 т»); товар без массы (статуэтки) — штуками. */
function stockText(c: Commodity, units: number): string {
  return c.unitMass > 0 ? formatStat('mass', units * c.unitMass) : String(units)
}

/** Масса единицы товара — всегда в тоннах: на вес в игре меряют только тоннами, не килограммами. */
function commodityMass(c: Commodity): string {
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
  // Только что выписанный штраф (кредиты) — окно сделки сменяется извещением о нём.
  const [issued, setIssued] = useState<number | null>(null)
  const value = Math.min(Math.max(0, qty), max)
  const units = value
  const unitPrice = selling ? sellPrice : buyPrice
  const totalMass = Math.round(units * commodity.unitMass * 10) / 10
  // Местный штраф (контрабанда) закрывает станции ВСЮ торговлю до оплаты: без строки об этом
  // кнопка просто молчала — «то продаётся, то остаётся».
  const fine = localFine(world)
  const disabled = value === 0 || fine != null

  // Купил/продал — сделка сделана, окно закрывается; перерисовка (onChange) обновит список,
  // отсек и кошелёк под ним.
  const act = () => {
    if (disabled) return
    const before = localFine(world)?.amount ?? 0
    const ok =
      selling
        ? sellCommodity(world, player, commodity, units) > 0
        : buyCommodity(world, player, commodity, units) > 0
    // Сделка с запрещёнкой выписала штраф — сказать об этом сразу, а не молча закрыть торговлю.
    const after = localFine(world)?.amount ?? 0
    if (after > before) {
      onChange()
      setIssued(after - before)
      return
    }
    if (ok) {
      onChange()
      onClose()
    }
  }

  if (issued != null) {
    return (
      <Modal onClose={onClose}>
        <ModalTitle>{t('station.fine.title')}</ModalTitle>
        <p className="mt-6 text-center text-base leading-7" style={{ color: UI.DANGER }}>
          {tm('station.fine.issued', { amount: <Money amount={issued} /> })}
        </p>
        <ModalActions>
          <Button small variant="primary" onClick={onClose}>
            {t('ship.ok')}
          </Button>
        </ModalActions>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose}>
      <ModalTitle>
        {commodityName(commodity)}
        {commodity.contraband && <ContrabandMark />}
      </ModalTitle>

      {/* Товар — в тоннах: «3 т × цена тонны». Единица любого товара — тонна, дробных тонн нет. */}
      <div className="mt-6 flex flex-col gap-2 text-center tabular-nums" style={{ color: ACCENT }}>
        <div className="text-base font-normal leading-7">
            {tm('station.trade.line', {
              mass: commodity.unitMass === 1 ? formatStat('mass', totalMass) : `${units} × ${commodityMass(commodity)}`,
              price: <Money amount={unitPrice} />,
            })}
        </div>
        <div className="text-xl leading-7">
          <Money amount={units * unitPrice} />
        </div>
      </div>

      {fine && (
        <p className="mt-4 text-center text-xs tracking-meta" style={{ color: UI.DANGER }}>
          {tm('station.trade.fined', { amount: <Money amount={fine.amount} /> })}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3 text-xs tabular-nums">
        <span className="w-10 text-right text-base" style={{ color: DIM }}>0</span>
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
        <span className="w-10 text-base" style={{ color: DIM }}>{max}</span>
      </div>

      <ModalActions>
        <Button small variant="primary" disabled={disabled} onClick={act}>
          {t(selling ? 'station.trade.sell' : 'station.trade.buy')}
        </Button>
        {/* Выбросить выставленное — рядом с «Продать». Под штрафом и для контрабанды тоже:
            это не сделка, а избавление от груза, который иначе не сбыть (рабы). */}
        {selling && (
          <Button
            small
            disabled={value === 0}
            onClick={() => {
              if (dumpUnits(world, commodity, units) > 0) {
                onChange()
                onClose()
              }
            }}
          >
            {t('ship.jettison')}
          </Button>
        )}
        <Button small variant="secondary" onClick={onClose}>
          {t('ship.cancel')}
        </Button>
      </ModalActions>
    </Modal>
  )
}
