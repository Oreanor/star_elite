import {
  cargoMass,
  holdSellValue,
  itemMass,
  itemName,
  itemSellValue,
  sellCargo,
  sellItem,
  type CargoItem,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { Button, Column, DIM, Panel, Table } from './chrome'
import { credits, formatStat } from './format'
import { ModuleHeadline, displayName } from './Equipment'
import { commodityName } from '../i18n/dataNames'

/**
 * Трюм — ОДИН компонент и в магазине станции, и на вкладке груза корабля.
 * Разница только в праве продавать: `atStation` открывает кнопки сделки; в полёте
 * их нет — торговать посреди космоса не с кем, экран груза там только витрина.
 *
 * Цена продажи местная, рыночная: тот же груз в другой системе стоит иначе.
 * У купленного помечена ВЫГОДА (выручка минус уплаченное), у добычи и трофеев —
 * «находка»: сравнивать не с чем, вся выручка в плюс.
 */
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

  const columns: Column<CargoItem>[] = [
    // Модуль в трюме — с «+», если прокачан; товар — обычным именем со счётом.
    { key: 'name', header: t('station.col.name'), cell: (item) => (item.kind === 'module' ? displayName(item.module) : `${commodityName(item.commodity)} ×${item.units}`) },
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

  // Продажа — только на станции. В полёте колонки действия нет вовсе.
  if (atStation) {
    columns.push({
      key: 'sell',
      header: '',
      align: 'right',
      cell: (item) => (
        <Button
          small
          onClick={() => {
            // Индекс берём в момент клика из живого трюма: продажа соседа его сдвигает.
            const index = hold.items.indexOf(item)
            if (index >= 0 && sellItem(world, player, index) > 0) onChange()
          }}
        >
          {t('station.sell')}
        </Button>
      ),
    })
  }

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
            // Модуль в трюме — снятое/трофейное железо: клик раскрывает его характеристику.
            // Установка живёт на верфи (вкладка СНАРЯЖЕНИЕ), поэтому здесь только справка.
            detail={(item) => (item.kind === 'module' ? <ModuleHeadline module={item.module} /> : null)}
          />

          {atStation && (
            <Button
              onClick={() => {
                if (sellCargo(world, player) > 0) onChange()
              }}
            >
              {t('station.sellAll', { total: holdSellValue(world, player) })}
            </Button>
          )}
        </>
      )}
    </Panel>
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
