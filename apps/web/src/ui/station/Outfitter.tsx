import { useState } from 'react'
import {
  MODULE_CATALOGUE,
  armMissiles,
  buy,
  buyToHold,
  freeCapacity,
  canBuy,
  moduleStat,
  priceOf,
  stationStock,
  type PurchaseError,
  type ShipModule,
  type World,
} from '@elite/sim'
import { t, useLang, type Key } from '../i18n'
import { ConfirmBox, type Confirm } from '../ship/SlotModal'
import { DIM, SideTabs, Table, type Column } from './chrome'
import { buyLabel, displayName, headlineCompare, weaponSlot } from './Equipment'
import { trend } from '../theme'
import { CATEGORY_ORDER, cardOf, type SlotCard } from '../ship/ShipSlots'
import { formatStat, statLabel, statNumber } from './format'
import { Money } from './Money'
import { StatLine } from './ItemSheet'

/**
 * ОБОРУДОВАНИЕ: всё железо, что лежит на прилавке ЭТОЙ станции, одним списком.
 *
 * Тот же ассортимент, что предлагает окно слота (`stationStock`), только не по одному
 * слоту, а целиком — чтобы увидеть, за чем сюда стоило лететь. Сделка та же: клик по
 * строке спрашивает «купить и установить?», вытесненное железо станция забирает по
 * остаточной цене (так решает домен в `buy`).
 */

type Kind = ShipModule['kind']

/** Виды в порядке каталога — внутри смешанного слота (доп. отсек) идут кучками. */
const KIND_ORDER: readonly Kind[] = [...new Set(MODULE_CATALOGUE.map((m) => m.kind))]

/** Предметы бога не продаются — их слоту на прилавке не место (как и в справочнике). */
const HIDDEN: ReadonlySet<Kind> = new Set<Kind>(['mielophone'])

/** Ракеты и дроны снаряжают ВСЕ пилоны одним типом — у них своя покупка. */
const isMunition = (m: ShipModule) => m.kind === 'missile' || m.kind === 'drone'

function canPurchase(world: World, m: ShipModule): PurchaseError | null {
  if (isMunition(m)) return world.credits >= priceOf(m) ? null : 'no-money'
  return canBuy(world, world.player, m, weaponSlot(world, m))
}

/** Можно ли купить В ТРЮМ, без установки: хватает денег и места. Тот же расчёт, что в `buyToHold`. */
const canStow = (world: World, m: ShipModule) => world.credits >= priceOf(m) && freeCapacity(world.player.hold) >= m.mass

/**
 * Характеристика детали для окна покупки — тем же языком, что колонка «было → станет»:
 * «СКОРОСТЬ 156 → 135 м/с ▼ 14%». Сравнивать не с чем — просто «ТЯГА 215 кН».
 */
function ModuleDetail({ world, module }: { world: World; module: ShipModule }) {
  const cmp = headlineCompare(world, module)
  if (!cmp) {
    const { key, value } = moduleStat(module)
    return <StatLine label={statLabel(key)}>{formatStat(key, value)}</StatLine>
  }
  const same = cmp.to === cmp.from
  const tone = trend(cmp.better)
  const pct = cmp.from !== 0 ? Math.round(Math.abs((cmp.to - cmp.from) / cmp.from) * 100) : null
  return (
    <StatLine label={statLabel(cmp.key)}>
      <span className="whitespace-nowrap">
        <span style={{ color: DIM }}>{statNumber(cmp.key, cmp.from)} → </span>
        <span style={{ color: same ? DIM : tone.color }}>
          {formatStat(cmp.key, cmp.to)}
          {same ? ' =' : ` ${tone.mark}${pct !== null ? ` ${pct}%` : ''}`}
        </span>
      </span>
    </StatLine>
  )
}

export function Outfitter({ world, onChange }: { world: World; onChange: () => void }) {
  useLang()
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  // Список разбит по СЛОТАМ корабля — тем же карточкам, что на экране корабля (`cardOf`):
  // всё доп-оборудование одним «доп. отсеком», дрон-ракеты при ракетах. Столбик слева,
  // справа — только выбранный слот. Слот, которого здесь не продают, виден, но гаснет.
  const stock = stationStock(world).filter((m) => !HIDDEN.has(m.kind))
  const has = (c: SlotCard) => stock.some((m) => cardOf(m.kind) === c)
  const [card, setCard] = useState<SlotCard>(() => CATEGORY_ORDER.find(has) ?? CATEGORY_ORDER[0])
  const rows = stock
    .filter((m) => cardOf(m.kind) === card)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.class - b.class || a.cost - b.cost)

  // Две дороги: купить и сразу поставить — или купить В ТРЮМ (запас, на другой корабль,
  // на перепродажу). Невозможную строка не предлагает: если нельзя ни то, ни другое, она
  // гаснет, а сюда приходит лишь то, что хоть одной дорогой да купишь.
  const ask = (m: ShipModule) => {
    const actions: Confirm['actions'] = []
    // Просто «КУПИТЬ» (в трюм) — первым, «КУПИТЬ И УСТАНОВИТЬ» — следом, как по возрастанию шага.
    if (canStow(world, m)) actions.push({ label: t('station.buy'), run: () => buyToHold(world, world.player, m) })
    if (canPurchase(world, m) === null)
      actions.push({
        label: t('station.buyFit'),
        run: () => (isMunition(m) ? armMissiles(world, world.player, m) : buy(world, world.player, m, weaponSlot(world, m))),
      })
    setConfirm({
      message: displayName(m),
      // Та же карточка, что при продаже из отсека: главная характеристика (с изменением),
      // масса, цена.
      sheet: {
        title: displayName(m),
        lines: (
          <>
            <ModuleDetail world={world} module={m} />
            <StatLine label={statLabel('mass')}>{formatStat('mass', m.mass, 1)}</StatLine>
            <StatLine label={t('station.col.price')}>
              <Money amount={priceOf(m)} />
            </StatLine>
          </>
        ),
      },
      actions,
    })
  }

  const columns: Column<ShipModule>[] = [
    // Ширин колонкам НЕ задаём: таблица сама отдаёт каждой ширину по содержимому. Все числа
    // в одну строку, переносится лишь название — и только когда места правда не хватает.
    // Жёсткие ширины раздували таблицу за край на длинных сравнениях (гиперприводы).
    { key: 'name', header: t('station.col.name'), cell: (m) => displayName(m) },
    // Сравнение одной ячейкой, прижатой вправо: «156 → 135 м/с ▼». Треугольник — вплотную за
    // новым значением (отдельной колонкой он отъезжал на её поля). Ширина у него одна, так
    // что столбик значений по правому краю не гуляет.
    {
      key: 'compare',
      header: t('station.col.compare'),
      align: 'right',
      cell: (m) => {
        const cmp = headlineCompare(world, m)
        if (!cmp) return <span style={{ color: DIM }}>·</span>
        const same = cmp.to === cmp.from
        const tone = trend(cmp.better)
        return (
          <span className="whitespace-nowrap">
            {/* Единица — один раз, в конце, у нового значения. Равное — без цвета и со «=». */}
            <span style={{ color: DIM }}>{statNumber(cmp.key, cmp.from)} → </span>
            <span style={{ color: same ? DIM : tone.color }}>
              {formatStat(cmp.key, cmp.to)} {same ? '=' : tone.mark}
            </span>
          </span>
        )
      },
    },
    {
      key: 'mass',
      header: t('station.col.mass'),
      align: 'right',
      cell: (m) => <span className="whitespace-nowrap" style={{ color: DIM }}>{formatStat('mass', m.mass, 1)}</span>,
    },
    {
      key: 'price',
      header: t('station.col.price'),
      align: 'right',
      // Почему строка погасла — на месте цены, как на кнопках окна слота.
      cell: (m) => {
        const error = canPurchase(world, m)
        // Цена — всегда, если хоть одной дорогой купить можно; причина — когда никакой.
        return (
          <span className="whitespace-nowrap">
            {error && !canStow(world, m) ? <span style={{ color: DIM }}>{buyLabel(error)}</span> : <Money amount={priceOf(m)} />}
          </span>
        )
      },
    },
  ]

  if (stock.length === 0) {
    return (
      <p className="text-sm" style={{ color: DIM }}>
        {t('station.outfit.empty')}
      </p>
    )
  }

  return (
    <div className="flex gap-6">
      <SideTabs
        items={CATEGORY_ORDER.map((c) => ({ id: c, label: t(('kind.' + c) as Key).toUpperCase(), disabled: !has(c) }))}
        active={card}
        onSelect={setCard}
      />
      <div className="min-w-0 flex-1">
        <Table
          columns={columns}
          rows={rows}
          rowKey={(m) => m.id}
          onRowClick={ask}
          // Ни поставить, ни положить в трюм — строка гаснет, но сравнение видно.
          rowDisabled={(m) => canPurchase(world, m) !== null && !canStow(world, m)}
        />
      </div>
      {confirm && (
        <ConfirmBox
          confirm={confirm}
          onRun={(a) => {
            a.run()
            onChange()
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
