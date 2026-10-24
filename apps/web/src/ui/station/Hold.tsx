import { useState } from 'react'
import {
  cargoMass,
  itemMass,
  itemName,
  itemSellValue,
  moduleFault,
  moduleStat,
  sellItem,
  type CargoItem,
  type Commodity,
  type World,
} from '@elite/sim'
import { trend, UI } from '../theme'
import { t, useLang } from '../i18n'
import { Button, Column, DIM, Modal, ModalActions, Panel, Table } from './chrome'
import { formatStat, statLabel } from './format'
import { displayName } from './Equipment'
import { itemDisplayName } from '../i18n/dataNames'
import { Money } from './Money'
import { ItemSheet, StatLine } from './ItemSheet'
import { dumpAll, dumpItem } from './jettison'
import { ContrabandMark } from './ContrabandMark'

/**
 * Груз — ОДИН компонент и в магазине станции, и на вкладке груза корабля.
 * На станции — продажа; в полёте — выброс за борт: контейнер для обычного груза,
 * статуэтка — исполин в 3–5 км по носу (пересечение режем, тесный зазор — жёлтый пуш).
 *
 * Клик по строке открывает карточку предмета: что это, вес, цена продажи здесь,
 * выгода и — у снятого железа — степень поломки; у причала товар — окно продажи.
 * Выброс — в тех же окнах, рядом с «Продать»: то, что не продать (контрабанда), иначе не сбыть.
 */

export function Hold({
  world,
  onChange,
  atStation,
  onTrade,
  flush,
  scrollable,
}: {
  world: World
  onChange: () => void
  atStation: boolean
  /** Без верхнего отступа панели — на экране корабля под переключателем «модули / отсек». */
  flush?: boolean
  /** Экран корабля ограничивает высоту отсека; прокручиваются только строки таблицы. */
  scrollable?: boolean
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
      sortValue: (item) => (item.kind === 'module' ? displayName(item.module) : itemDisplayName(item)),
      cell: (item) => {
        const name = item.kind === 'module' ? displayName(item.module) : itemDisplayName(item)
        return (
          <span className="block truncate" title={name}>
            {name}
            {item.kind === 'commodity' && item.commodity.contraband && <ContrabandMark />}
          </span>
        )
      },
    },
    {
      key: 'mass',
      width: '4rem',
      header: t('station.col.mass'),
      align: 'right',
      sortValue: (item) => itemMass(item),
      cell: (item) => <span style={{ color: DIM }}>{formatStat('mass', itemMass(item))}</span>,
    },
    {
      key: 'price',
      width: '7rem',
      header: t('station.col.price'),
      align: 'right',
      sortValue: (item) => itemSellValue(world, item),
      cell: (item) => <Money amount={itemSellValue(world, item)} />,
    },
  ]

  return (
    <Panel
      // Под вкладкой корабля имя уже на кнопке. На торговле вкладки нет — заголовок нужен.
      title={flush ? '' : t('station.hold.title')}
      flush={flush}
      className={scrollable ? 'flex h-full min-h-0 flex-1 flex-col' : undefined}
    >
      {/* Пустой отсек — просто список пуст. «Занято» внизу, сразу перед выбросом:
          сверху его читали как заголовок таблицы, а решение выбросить смотрят внизу. */}
      {hold.items.length === 0 ? null : (
        <Table
          fixedLayout
          scrollable={scrollable}
          columns={columns}
          rows={hold.items}
          // Ключ обязан пережить продажу соседа: одинаковые товары уже в одной стопке,
          // разные модули различаются именем, а хвост индекса разводит совпадения.
          rowKey={(item, i) => `${itemName(item)}-${i}`}
          onRowClick={(item) => (item.kind === 'commodity' && onTrade ? onTrade(item.commodity) : setDetail(item))}
        />
      )}

      {/* Вне прокрутки: строка занятого и выброс остаются на месте, когда список длинный. */}
      <div className={scrollable ? 'mt-auto shrink-0' : undefined}>
        <p className="text-xs tracking-meta" style={{ color: DIM }}>
          {t('ship.cargo.used', { used: Math.round(cargoMass(hold)), cap: hold.capacity })}
        </p>
        {hold.items.length > 0 && (
          <Button
            onClick={() => {
              if (dumpAll(world)) onChange()
            }}
          >
            {t('ship.jettisonAll')}
          </Button>
        )}
      </div>

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
        {/* У аукс-устройств (РЭБ, бомба, заборник) главная строка — уже масса: не повторяем. */}
        {(item.kind !== 'module' || moduleStat(item.module).key !== 'mass') && (
          <StatLine label={statLabel('mass')}>{formatStat('mass', itemMass(item))}</StatLine>
        )}
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

      <ModalActions>
        {atStation && (
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
        )}
        {/* Выбросить — и у причала рядом с «Продать»: что не продать, то не застрянет в трюме. */}
        <Button
          small
          variant={atStation ? 'secondary' : 'primary'}
          onClick={() => {
            if (dumpItem(world, item)) onChange()
            onClose()
          }}
        >
          {t('ship.jettison')}
        </Button>
        <Button small variant="secondary" onClick={onClose}>
          {t('ship.close')}
        </Button>
      </ModalActions>
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
