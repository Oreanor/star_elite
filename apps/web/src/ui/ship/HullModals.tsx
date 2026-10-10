import { useState } from 'react'
import {
  canUpgradeHullStat,
  hullPurchase,
  hullStatUpgradeCost,
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
import { ACCENT, Button, DIM, Modal } from '../station/chrome'
import { statLabel } from '../station/format'
import { chassisName } from '../i18n/dataNames'
import { Money } from '../station/Money'

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
  const doUpgrade = (stat: HullStat) => {
    if (upgradeHullStat(world, player, stat) === null) {
      setNote(null)
      onChange()
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3 className="mb-3 text-base tracking-[0.2em]">{chassisName(player.loadout.chassis.name)}</h3>

      <p className="text-sm" style={{ color: DIM }}>
        {dmg <= 0
          ? t('station.service.hullOk', { cur: hullCur, max: hullMax })
          : t('station.service.hullDmg', { cur: hullCur, max: hullMax, cost: quote.price })}
      </p>
      <div className="mt-3">
        <Button small variant="primary" disabled={dmg <= 0 || quote.chance <= 0 || world.credits < quote.price} onClick={doRepair}>
          {dmg <= 0 ? t('station.service.hullWhole') : t('station.service.repair')}
        </Button>
      </div>

      <div className="mt-5 space-y-1">
        <div className="text-xs tracking-[0.15em]" style={{ color: DIM }}>
          {t('ship.hullUpgradeHint')}
        </div>
        {HULL_STATS.map((stat) => {
          const done = player.hullUp[stat]
          const active = canUpgradeHullStat(world, player, stat) === null
          return (
            <button
              key={stat}
              type="button"
              disabled={!active}
              onClick={() => doUpgrade(stat)}
              className={`flex w-full items-center justify-between border px-4 py-2 text-sm tracking-[0.15em] transition-colors ${
                active ? 'cursor-pointer hover:bg-[#7fd6ff] hover:text-black' : 'cursor-not-allowed opacity-40'
              }`}
              style={{ borderColor: done ? DIM : ACCENT, color: done ? DIM : ACCENT }}
            >
              <span>{done ? `${statLabel(stat)} ✓` : t('ship.hullStat', { stat: statLabel(stat) })}</span>
              <span>{done ? '+25%' : <Money amount={cost} />}</span>
            </button>
          )
        })}
      </div>

      {note && (
        <p className="mt-3 text-xs tracking-widest" style={{ color: ACCENT }}>
          {note}
        </p>
      )}
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
  onConfirm: (net: number) => void
  onClose: () => void
}) {
  useLang()
  const q: HullPurchase = hullPurchase(world, chassis)
  const overflowTons = Math.max(0, Math.ceil(q.loadAfter - q.newCapacity))
  const canBuy = q.fits && world.credits >= q.net

  return (
    <Modal onClose={onClose}>
      <h3 className="mb-4 text-sm tracking-[0.25em]" style={{ color: DIM }}>
        {t('ship.hullBuy.title')}
      </h3>

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

      {/* Что не влезло в слоты нового корпуса — уедет в грузовой отсек (если по массе влезет). */}
      {q.fits && q.overflow.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed" style={{ color: DIM }}>
          {t('ship.hullBuy.overflow', { n: q.overflow.length })}
        </p>
      )}

      {q.fits ? (
        <div className="mt-4 border-t pt-3 text-center" style={{ borderColor: DIM }}>
          <div className="text-xs tracking-[0.2em]" style={{ color: DIM }}>
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

      <div className="mt-5 flex justify-end gap-2">
        <Button small variant="primary" disabled={!canBuy} onClick={() => onConfirm(q.net)}>
          {t('ship.ok')}
        </Button>
        <Button small variant="secondary" onClick={onClose}>
          {t('ship.cancel')}
        </Button>
      </div>
    </Modal>
  )
}
