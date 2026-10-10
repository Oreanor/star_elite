import { useState } from 'react'
import {
  COMMODITIES,
  cargoMass,
  itemMass,
  itemName,
  itemSellValue,
  jettisonItem,
  moduleFault,
  moduleStat,
  placeFigurineFromHold,
  sellItem,
  type CargoItem,
  type Commodity,
  type World,
} from '@elite/sim'
import { trend, UI } from '../theme'
import { t, useLang } from '../i18n'
import { pushWarning } from '../../session/warnings'
import { Button, Column, DIM, Modal, Panel, Table } from './chrome'
import { formatStat, statLabel } from './format'
import { displayName } from './Equipment'
import { itemDisplayName } from '../i18n/dataNames'
import { Money } from './Money'
import { ItemSheet, StatLine } from './ItemSheet'

/**
 * Груз — ОДИН компонент и в магазине станции, и на вкладке груза корабля.
 * На станции — продажа; в полёте — выброс за борт: контейнер для обычного груза,
 * статуэтка — исполин в 3–5 км по носу (пересечение режем, тесный зазор — жёлтый пуш).
 *
 * Клик по строке открывает карточку предмета: что это, вес, цена продажи здесь,
 * выгода и — у снятого железа — степень поломки. Сделка/выброс — в карточке,
 * чтобы строка не была тесной от кнопок.
 */

function isFigurine(item: CargoItem): boolean {
  return item.kind === 'commodity' && item.commodity.id === COMMODITIES.FIGURINE.id
}

/** Одна статуэтка по носу; `no-room` → жёлтый пуш. Пересечение — молча. */
function dumpFigurine(world: World, index: number): boolean {
  const result = placeFigurineFromHold(world, world.player, index)
  if (result === 'no-room') pushWarning('noRoom', world.time)
  return result === 'ok'
}

/**
 * Весь трюм за борт. Статуэтки — по одной по носу (пока место есть);
 * остальное — контейнерами. При отказе выкладки статуэтки стопка остаётся, идём дальше.
 */
function dumpAllInFlight(world: World): boolean {
  let changed = false
  let i = 0
  while (i < world.player.hold.items.length) {
    const item = world.player.hold.items[i]!
    if (isFigurine(item)) {
      // Одна единица за проход; при ok индекс может остаться тем же (стопка).
      if (dumpFigurine(world, i)) {
        changed = true
        continue
      }
      i++
      continue
    }
    if (jettisonItem(world, world.player, i)) {
      changed = true
      continue
    }
    i++
  }
  return changed
}

export function Hold({
  world,
  onChange,
  atStation,
  onTrade,
}: {
  world: World
  onChange: () => void
  atStation: boolean
  /**
   * Товар из отсека продают ТЕМ ЖЕ окном сделки, что и со списка товаров (его держит
   * магазин). Есть — клик по товару зовёт его; модули и вне станции — своя карточка.
   */
  onTrade?: (commodity: Commodity) => void
}) {
  useLang()
  const player = world.player
  const hold = player.hold
  // Клик по строке раскрывает карточку предмета. Индекс держим отдельно: продажа соседа
  // сдвигает список, а карточку по индексу мы к тому моменту уже закрываем.
  const [detail, setDetail] = useState<CargoItem | null>(null)

  const columns: Column<CargoItem>[] = [
    // Модуль в трюме — с «+», если прокачан; товар — обычным именем со счётом.
    {
      key: 'name',
      header: t('station.col.name'),
      cell: (item) => (item.kind === 'module' ? displayName(item.module) : itemDisplayName(item)),
    },
    {
      key: 'mass',
      header: t('station.col.mass'),
      align: 'right',
      cell: (item) => <span style={{ color: DIM }}>{formatStat('mass', itemMass(item))}</span>,
    },
    {
      key: 'profit',
      header: t('station.col.profit'),
      align: 'right',
      cell: (item) => {
        const mark = profitMark(item, itemSellValue(world, item))
        return <span style={{ color: mark.color }}>{mark.text}</span>
      },
    },
  ]

  return (
    <Panel title={t('station.hold.title')}>
      <p className="mb-3 text-xs tracking-widest" style={{ color: DIM }}>
        {t('ship.cargo.used', { used: Math.round(cargoMass(hold)), cap: hold.capacity })}
      </p>

      {hold.items.length === 0 ? (
        <p className="text-sm" style={{ color: DIM }}>
          {t('station.hold.empty')}
        </p>
      ) : (
        <>
          <Table
            columns={columns}
            rows={hold.items}
            // Ключ обязан пережить продажу соседа: одинаковые товары уже в одной стопке,
            // разные модули различаются именем, а хвост индекса разводит совпадения.
            rowKey={(item, i) => `${itemName(item)}-${i}`}
            onRowClick={(item) => (item.kind === 'commodity' && onTrade ? onTrade(item.commodity) : setDetail(item))}
          />

          {/* У причала «продать всё» нет: товар продают по одному через окно сделки, видя
              цену и выгоду. В полёте остаётся «выбросить всё» — там торговаться не с кем. */}
          {!atStation && (
            <Button
              onClick={() => {
                if (dumpAllInFlight(world)) onChange()
              }}
            >
              {t('ship.jettisonAll')}
            </Button>
          )}
        </>
      )}

      {detail && (
        <ItemModal
          world={world}
          item={detail}
          atStation={atStation}
          onChange={onChange}
          onClose={() => setDetail(null)}
        />
      )}
    </Panel>
  )
}

/**
 * Карточка предмета трюма: имя, вес, цена продажи здесь, выгода. У товара — описание,
 * у снятого модуля — его характеристика и степень поломки (если сломан). Продать —
 * прямо отсюда, на станции: карточка И есть место сделки.
 */
function ItemModal({
  world,
  item,
  atStation,
  onChange,
  onClose,
}: {
  world: World
  item: CargoItem
  atStation: boolean
  onChange: () => void
  onClose: () => void
}) {
  useLang()
  const value = itemSellValue(world, item)
  const mark = profitMark(item, value)
  const fault = item.kind === 'module' ? moduleFault(item.module) : 0

  return (
    <Modal onClose={onClose}>
      {/* Та же карточка, что в окне покупки (`ItemSheet`): название, ниже с отступом строки
          «ПОДПИСЬ: значение» — главная (у модуля), масса, цена здесь с выгодой следом. */}
      <ItemSheet title={item.kind === 'module' ? displayName(item.module) : itemDisplayName(item)}>
        {item.kind === 'module' && (
          <StatLine label={statLabel(moduleStat(item.module).key)}>
            {formatStat(moduleStat(item.module).key, moduleStat(item.module).value)}
          </StatLine>
        )}
        <StatLine label={statLabel('mass')}>{formatStat('mass', itemMass(item), 1)}</StatLine>
        <StatLine label={t('station.col.price')}>
          <span className="inline-flex items-baseline gap-3">
            <Money amount={value} />
            <span className="text-xs" style={{ color: mark.color }}>
              {mark.text}
            </span>
          </span>
        </StatLine>
        {/* Поломка — это урон в бою, а не износ на продажу: красным и в процентах. */}
        {fault > 0 && <p style={{ color: UI.DANGER }}>{t('ship.broken', { pct: Math.round(fault * 100) })}</p>}
      </ItemSheet>

      <div className="mt-6 flex justify-center gap-2">
        {atStation ? (
          <Button
            small
            variant="primary"
            onClick={() => {
              // Индекс берём в момент клика из живого трюма: продажа соседа его сдвигает.
              const index = world.player.hold.items.indexOf(item)
              if (index >= 0 && sellItem(world, world.player, index) > 0) onChange()
              onClose()
            }}
          >
            {t('station.sell')}
          </Button>
        ) : (
          <Button
            small
            variant="primary"
            onClick={() => {
              const index = world.player.hold.items.indexOf(item)
              if (index < 0) {
                onClose()
                return
              }
              if (isFigurine(item)) {
                if (dumpFigurine(world, index)) onChange()
              } else if (jettisonItem(world, world.player, index)) {
                onChange()
              }
              onClose()
            }}
          >
            {t('ship.jettison')}
          </Button>
        )}
        <Button small variant="secondary" onClick={onClose}>
          {t('ship.close')}
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Пометка выгоды. Куплено — абсолютный выигрыш/проигрыш от продажи ЗДЕСЬ.
 * Не куплено (добыча, трофей) — «находка»: цены входа нет, сравнивать не с чем.
 */
function profitMark(item: CargoItem, revenue: number): { text: React.ReactNode; color: string } {
  // Цена входа есть и у товара, и у модуля (купленного или снятого со своего борта).
  // Нет её — трофей с обломков: «находка».
  const basis = item.costBasis
  if (basis === undefined) return { text: t('station.salvage'), color: DIM }

  const profit = revenue - basis
  const color = trend(profit >= 0).color
  return { text: <Money amount={Math.abs(profit)} sign={profit >= 0 ? '+' : '−'} color={color} />, color }
}
