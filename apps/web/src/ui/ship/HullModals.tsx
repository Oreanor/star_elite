import { useState } from 'react'
import {
  canUpgradeHullStat,
  copilotRepair,
  copilotRepairQuote,
  hullPurchase,
  hullStatUpgradeCost,
  hullStatPreview,
  hullDamage,
  HULL_STATS,
  repair,
  repairQuote,
  upgradeHullStat,
  type Chassis,
  type HullPurchase,
  type HullStat,
  type World,
} from '@elite/sim'
import { t, useLang, type Key } from '../i18n'
import { UI } from '../theme'
import { ACCENT, Button, DIM, Modal, ModalActions, ModalKicker, ModalTitle } from '../station/chrome'
import { formatStat, statLabel, statNumber } from '../station/format'
import { chassisName } from '../i18n/dataNames'
import { Money } from '../station/Money'
import { cargoBudgetText } from './ShipSlots'
import { displayName } from '../station/Equipment'
import { copilotRepairNote } from './SlotModal'

/**
 * Окна корпуса: смена рамы на верфи и покупка нового корпуса.
 */

/**
 * МАСТЕРСКАЯ КОРПУСА — по клику на корабль. Здесь всё, что делают с самой рамой:
 * чинят её и усиливают оси. Раньше это жило двумя блоками в колонке под моделью и
 * занимало полэкрана даже тогда, когда корпус цел и всё уже усилено.
 *
 * Ремонт — БРОСОК: криворукий мастер может доломать. Исход приходит ключом из домена,
 * здесь только слова к нему. Усиление оси — ровно раз на +25%, дальше кнопка гаснет
 * галкой; потолок и цену считает домен, не интерфейс.
 */
export function HullModal({
  world,
  onChange,
  onClose,
}: {
  world: World
  onChange: () => void
  onClose: () => void
}) {
  useLang()
  const [note, setNote] = useState<string | null>(null)
  const player = world.player
  const hullMax = player.spec.hull.hull
  const hullCur = Math.round(player.hull)
  const dmg = hullDamage(player)
  const quote = repairQuote(world, player)
  const cost = hullStatUpgradeCost(player)

  const doRepair = () => {
    const out = repair(world, player)
    if (out === 'nothing') return
    setNote(t(('ship.repair.' + out) as Key))
    onChange()
  }
  const copilotQuote = world.copilot ? copilotRepairQuote(world, { kind: 'hull' }) : null
  const doCopilotRepair = () => {
    const price = copilotQuote?.price ?? 0
    setNote(copilotRepairNote(copilotRepair(world, { kind: 'hull' }), price))
    onChange()
  }
  const doUpgrade = (stat: HullStat) => {
    if (upgradeHullStat(world, player, stat) === null) {
      setNote(null)
      onChange()
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalTitle>{chassisName(player.loadout.chassis.name)}</ModalTitle>

      <p className="text-sm" style={{ color: DIM }}>
        {dmg <= 0
          ? t('station.service.hullOk', { cur: hullCur, max: hullMax })
          : t('station.service.hullDmg', { cur: hullCur, max: hullMax, cost: quote.price })}
      </p>
      <div className="mt-3">
        {world.docked ? (
          <Button small variant="primary" disabled={dmg <= 0 || quote.chance <= 0 || world.credits < quote.price} onClick={doRepair}>
            {dmg <= 0 ? t('station.service.hullWhole') : t('station.service.repair')}
          </Button>
        ) : copilotQuote ? (
          // В полёте корпус латает ВТОРОЙ ПИЛОТ — за детали, без броска мастера.
          <Button small variant="primary" disabled={world.credits < copilotQuote.price} onClick={doCopilotRepair}>
            {t('station.service.repair')} · <Money amount={copilotQuote.price} />
          </Button>
        ) : null}
      </div>

      <div className="mt-5 space-y-1">
        {HULL_STATS.map((stat) => {
          const error = canUpgradeHullStat(world, player, stat)
          const done = error === 'already'
          const active = error === null
          // Что улучшится — числом: «ОТСЕК 22 → 27 т», а не «укрепить ось». Усилено — итог с галкой.
          const { from, to } = hullStatPreview(player, stat)
          return (
            <button
              key={stat}
              type="button"
              disabled={!active}
              onClick={() => doUpgrade(stat)}
              className={`flex w-full items-center justify-between border px-4 py-2 text-sm tracking-label transition-colors ${
                active ? 'cursor-pointer ui-btn' : 'cursor-not-allowed opacity-40'
              }`}
              style={{ borderColor: done ? DIM : ACCENT, color: done ? DIM : ACCENT }}
            >
              <span>
                {statLabel(stat)}: {done ? `${formatStat(stat, from)} ✓` : `${statNumber(stat, from)} → ${formatStat(stat, to)}`}
              </span>
              <span>{done ? null : <Money amount={cost} />}</span>
            </button>
          )
        })}
      </div>

      {note && (
        <p className="mt-3 text-xs tracking-meta" style={{ color: ACCENT }}>
          {note}
        </p>
      )}

      <ModalActions>
        <Button small variant="secondary" onClick={onClose}>
          {t('ship.close')}
        </Button>
      </ModalActions>
    </Modal>
  )
}

/**
 * Подтверждение покупки корпуса. Старый борт верфь ПРИНИМАЕТ автоматически по состоянию
 * (цена зачёта тем меньше, чем битее корпус и хуже мастера), обвес не по слотам уедет в
 * грузовой отсек, а внизу — доплата. Если перенесённое не влезает в новую раму по массе —
 * сделку не даём и говорим, сколько тонн лишку: сперва продай.
 */
export function HullBuyModal({
  world,
  chassis,
  onConfirm,
  onClose,
}: {
  world: World
  chassis: Chassis
  onConfirm: (net: number, sellOverflow: boolean) => void
  onClose: () => void
}) {
  useLang()
  // Не вставшее в слоты — в трюм (по умолчанию) или продать верфи прямо в сделке: тогда оно
  // не занимает отсек, а его цена идёт в зачёт. Это и выход из перегруза без похода в магазин.
  const [sell, setSell] = useState(false)
  const q: HullPurchase = hullPurchase(world, chassis, sell)
  const overflowTons = Math.max(0, Math.ceil(q.loadAfter - q.newCapacity))
  const canBuy = q.fits && world.credits >= q.net

  return (
    <Modal onClose={onClose}>
      <ModalKicker>{t('ship.hullBuy.title')}</ModalKicker>

      {/* Зачёт старого корпуса — автоматически, по состоянию и классу мастеров. */}
      <div className="text-sm">
        <div className="flex justify-between gap-3">
          <span>{chassisName(q.oldChassis.name)}</span>
          <span style={{ color: UI.ALLY }}>
            <Money amount={q.tradeIn} sign="+" />
          </span>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: DIM }}>
          {t('ship.hullBuy.tradeIn', { pct: Math.round(q.oldCondition * 100) })}
        </p>
      </div>

      {/* Новый корпус — каталожная цена. */}
      <div className="mt-3 flex justify-between gap-3 text-sm">
        <span>{chassisName(q.chassis.name)}</span>
        <span style={{ color: DIM }}>
          <Money amount={q.price} />
        </span>
      </div>

      {/* Что не встаёт в слоты новой рамы — поимённо, с массой; и выбор: в трюм или продать. */}
      {q.overflow.length > 0 && (
        <div className="mt-3 text-xs" style={{ color: DIM }}>
          <div className="tracking-label">{t('ship.hullBuy.overflowList')}</div>
          {q.overflow.map((m, i) => (
            <div key={`${m.id}-${i}`} className="flex justify-between gap-3">
              <span className="truncate">{displayName(m)}</span>
              <span>{formatStat('mass', m.mass)}</span>
            </div>
          ))}
          <label className="mt-2 flex cursor-pointer items-center justify-between gap-3" style={{ color: ACCENT }}>
            <span className="flex items-center gap-2">
              <input type="checkbox" checked={sell} onChange={(e) => setSell(e.target.checked)} />
              {t('ship.hullBuy.sell')}
            </span>
            <span style={{ color: UI.ALLY }}>
              <Money amount={q.overflowValue} sign="+" />
            </span>
          </label>
        </div>
      )}

      {/* Отсек новой рамы: из чего сложен (контейнеры переезжают) и сколько в нём повезёшь. */}
      <div className="mt-3 text-xs" style={{ color: q.fits ? DIM : UI.WARN }}>
        <div>{cargoBudgetText({ cargoCapacity: q.newCapacity, cargoBudget: q.newBudget })}</div>
        <div>{t('ship.hullBuy.load', { load: Math.ceil(q.loadAfter), cap: q.newCapacity })}</div>
      </div>

      {q.fits ? (
        <div className="mt-4 border-t pt-3 text-center" style={{ borderColor: DIM }}>
          <div className="text-xs tracking-label" style={{ color: DIM }}>
            {q.net >= 0 ? t('ship.hullBuy.toPay') : t('ship.hullBuy.youGet')}
          </div>
          <div className="text-2xl tabular-nums" style={{ color: q.net >= 0 ? ACCENT : UI.ALLY }}>
            <Money amount={Math.abs(q.net)} />
          </div>
        </div>
      ) : (
        // Перегруз: перенесённый обвес не влезает в новую раму по массе.
        <p className="mt-4 border-t pt-3 text-sm leading-relaxed" style={{ borderColor: DIM, color: UI.WARN }}>
          {t('ship.hullBuy.noFit', { tons: overflowTons })}
        </p>
      )}

      <ModalActions>
        <Button small variant="primary" disabled={!canBuy} onClick={() => onConfirm(q.net, sell)}>
          {t('ship.ok')}
        </Button>
        <Button small variant="secondary" onClick={onClose}>
          {t('ship.cancel')}
        </Button>
      </ModalActions>
    </Modal>
  )
}
