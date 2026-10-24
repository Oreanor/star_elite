import { useState } from 'react'
import {
  MODULE_CATALOGUE,
  armMissiles,
  buy,
  buyToHold,
  canBuy,
  moduleStat,
  priceOf,
  stationStock,
  type PurchaseError,
  type ShipModule,
  type World,
} from '@elite/sim'
import { t, useLang } from '../i18n'
import { ConfirmBox, type Confirm } from '../ship/SlotModal'
import { DIM, Table } from './chrome'
import { moduleColumns } from './moduleColumns'
import { buyLabel, canStow, displayName, headlineCompare, refusalNote, weaponSlot } from './Equipment'
import { trend } from '../theme'
import { formatStat, statLabel, statNumber } from './format'
import { Money } from './Money'
import { StatLine } from './ItemSheet'

/**
 * ОБОРУДОВАНИЕ: всё железо, что лежит на прилавке ЭТОЙ станции, одним списком.
 *
 * Тот же ассортимент, что предлагает окно слота (`stationStock`), только не по одному
 * слоту, а целиком — чтобы увидеть, за чем сюда стоило лететь. Без категорий: столбик
 * слотов прятал ассортимент за лишним кликом. Сделка та же: клик по строке спрашивает
 * «купить и установить?», вытесненное железо станция забирает по остаточной цене
 * (так решает домен в `buy`).
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

  // Весь прилавок сразу, кучками по виду (двигатель, щит, лазер…), внутри — по классу.
  const stock = stationStock(world).filter((m) => !HIDDEN.has(m.kind))
  const rows = stock
    .slice()
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.class - b.class || a.cost - b.cost)

  // Две дороги: купить и сразу поставить — или купить В ТРЮМ (запас, на другой корабль,
  // на перепродажу). Невозможную строка не предлагает: если нельзя ни то, ни другое, она
  // гаснет, а сюда приходит лишь то, что хоть одной дорогой да купишь.
  const ask = (m: ShipModule) => {
    const actions: Confirm['actions'] = []
    const fitError = canPurchase(world, m)
    const refused = (e: Parameters<typeof refusalNote>[2] | null) => (e ? refusalNote(world, m, e) : null)
    // Просто «КУПИТЬ» (в трюм) — первым, «КУПИТЬ И УСТАНОВИТЬ» — следом, как по возрастанию шага.
    if (canStow(world, m)) actions.push({ label: t('station.buy'), run: () => refused(buyToHold(world, world.player, m)) })
    if (fitError === null)
      actions.push({
        label: t('station.buyFit'),
        run: () =>
          refused(isMunition(m) ? armMissiles(world, world.player, m) : buy(world, world.player, m, weaponSlot(world, m))),
      })
    setConfirm({
      // Установки нет — сказать почему: иначе одинокое «КУПИТЬ» читается как недосмотр.
      ...(fitError && fitError !== 'no-money' ? { note: refusalNote(world, m, fitError) } : {}),
      message: displayName(m),
      // Та же карточка, что при продаже из отсека: главная характеристика (с изменением),
      // масса, цена.
      sheet: {
        title: displayName(m),
        lines: (
          <>
            <ModuleDetail world={world} module={m} />
            {/* У аукс-устройств (РЭБ, бомба, заборник) главная строка — уже масса: не повторяем. */}
            {(headlineCompare(world, m)?.key ?? moduleStat(m).key) !== 'mass' && (
              <StatLine label={statLabel('mass')}>{formatStat('mass', m.mass)}</StatLine>
            )}
            <StatLine label={t('station.col.price')}>
              <Money amount={priceOf(m)} />
            </StatLine>
          </>
        ),
      },
      actions,
    })
  }

  // Колонки — общие с окном слота (`moduleColumns`); своя здесь лишь ячейка цены: почему
  // строка погасла — на месте цены, как на кнопках окна слота.
  const columns = moduleColumns(world, {
    rows,
    price: (m) => {
      const error = canPurchase(world, m)
      // Цена — всегда, если хоть одной дорогой купить можно; причина — когда никакой.
      return (
        <span className="whitespace-nowrap">
          {error && !canStow(world, m) ? <span style={{ color: DIM }}>{buyLabel(error)}</span> : <Money amount={priceOf(m)} />}
        </span>
      )
    },
  })

  if (stock.length === 0) {
    return (
      <p className="text-sm" style={{ color: DIM }}>
        {t('station.outfit.empty')}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Table
        scrollable
        fixedLayout
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        onRowClick={ask}
        // Ни поставить, ни положить в трюм — строка гаснет, но сравнение видно.
        rowDisabled={(m) => canPurchase(world, m) !== null && !canStow(world, m)}
      />
      {confirm && (
        <ConfirmBox
          confirm={confirm}
          onRun={(a) => {
            const refusal = a.run()
            onChange()
            setConfirm(typeof refusal === 'string' ? { message: refusal, actions: [] } : null)
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
