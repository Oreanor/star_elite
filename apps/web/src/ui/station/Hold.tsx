import { useState } from 'react'
import {
  COMMODITIES,
  cargoMass,
  holdSellValue,
  itemMass,
  itemName,
  itemSellValue,
  jettisonItem,
  moduleFault,
  placeFigurineFromHold,
  sellCargo,
  sellItem,
  type CargoItem,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { pushWarning } from '../hud/warnings'
import { Button, Column, DIM, Modal, Panel, Table } from './chrome'
import { credits, formatStat } from './format'
import { displayName, moduleBenefit } from './Equipment'
import { commodityDesc, itemDisplayName } from '../i18n/dataNames'

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
}: {
  world: World
  onChange: () => void
  atStation: boolean
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
      key: 'value',
      header: t('station.col.value'),
      align: 'right',
      cell: (item) => <span style={{ color: DIM }}>{credits(itemSellValue(world, item))}</span>,
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
            onRowClick={(item) => setDetail(item)}
          />

          {atStation ? (
            <Button
              onClick={() => {
                if (sellCargo(world, player) > 0) onChange()
              }}
            >
              {t('station.sellAll', { total: holdSellValue(world, player) })}
            </Button>
          ) : (
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
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-base tracking-[0.2em]">
          {item.kind === 'module' ? displayName(item.module) : itemDisplayName(item)}
        </h3>
        <span className="text-xs" style={{ color: DIM }}>
          {formatStat('mass', itemMass(item))}
        </span>
      </div>

      {item.kind === 'commodity' ? (
        <p className="mb-4 text-xs leading-relaxed" style={{ color: DIM }}>
          {commodityDesc(item.commodity)}
        </p>
      ) : (
        <div className="mb-4 text-sm">
          <p style={{ color: DIM }}>{moduleBenefit(item.module)}</p>
          {/* Поломка — это урон в бою, а не износ на продажу: красным и в процентах. */}
          {fault > 0 && (
            <p style={{ color: UI.DANGER }}>{t('ship.broken', { pct: Math.round(fault * 100) })}</p>
          )}
        </div>
      )}

      {/* Цена продажи здесь — крупно; под ней выгода/находка тем же знаком, что в списке. */}
      <div className="text-center">
        <div className="text-2xl tabular-nums" style={{ color: UI.PRIMARY }}>
          {credits(value)}
        </div>
        <div className="mt-1 text-xs" style={{ color: mark.color }}>
          {mark.text}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        {atStation ? (
          <Button
            small
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
        <Button small onClick={onClose}>
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
function profitMark(item: CargoItem, revenue: number): { text: string; color: string } {
  const basis = item.kind === 'commodity' ? item.costBasis : undefined
  if (basis === undefined) return { text: t('station.salvage'), color: DIM }

  const profit = revenue - basis
  const sign = profit >= 0 ? '+' : '−'
  return { text: `${sign}${credits(Math.abs(profit))}`, color: profit >= 0 ? UI.ALLY : UI.DANGER }
}
