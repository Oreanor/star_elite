import { useEffect, useState } from 'react'
import {
  armMissiles,
  armMissilesFromHold,
  buy,
  canBuy,
  canUpgrade,
  fitFromHold,
  freeCapacity,
  isEssential,
  minTechForClass,
  moduleFault,
  moduleResaleValue,
  moduleStat,
  priceOf,
  rearm,
  rearmCost,
  repair,
  repairModule,
  repairModuleQuote,
  repairQuote,
  sellMissiles,
  sellModule,
  stripMissiles,
  upgradeMissiles,
  stationStock,
  unfitModule,
  upgradeCashCost,
  upgradedStatValue,
  upgradeModule,
  type CargoItem,
  type ShipModule,
  type World,
} from '@elite/sim'
import { t, type Key } from '../i18n'
import { trend, UI } from '../theme'
import { ACCENT, Button, DIM, Modal } from '../station/chrome'
import { formatStat, statLabel } from '../station/format'
import { Money, tm } from '../station/Money'
import { displayName, headlineCompare, headlineNumber, weaponSlot } from '../station/Equipment'
import { type SlotView } from './ShipSlots'

/**
 * Окно слота: что стоит, чем заменить (магазин / трюм), ремонт и подтверждение. Своя причина
 * меняться — правила замены и ремонта детали.
 */

/** Выбор, который модалка задаёт перед необратимым действием: «купить и поставить?»,
 *  «установить взамен?». Пустой список действий — просто сообщение с «ОК» (нет денег). */
export interface Confirm {
  message: React.ReactNode
  /** Цена отдельно от текста — для подтверждения покупки. */
  price?: number
  // `stay` — оставить модалку слота ОТКРЫТОЙ после действия (покупка/установка): деталь
  // встаёт в слот, и пилот тут же жмёт «улучшить», не открывая слот заново.
  actions: { label: React.ReactNode; run: () => void; stay?: boolean }[]
}

export interface RepairInfo {
  /** Цена работы (при успехе для корпуса, полная для дозарядки). 0 — чинить нечего. */
  price: number
  /** Можно ли жать кнопку: есть что чинить, хватает денег и мастерская берётся. */
  can: boolean
  /** Тут за такой корпус не берутся (мастер класса ниже вещи на два) — гасим и поясняем. */
  refused: boolean
}

/**
 * Стеклянная модалка по клику на плитку — поверх всего экрана. Никаких раскрытий и
 * колонки «купить»: сверху вид слота, под ним что стоит, ниже РЯД действий
 * (снять · починить · улучшить · продать), а в самом низу — варианты В ДВЕ КОЛОНКИ:
 * что есть в магазине и что лежит у тебя в трюме. Клик по варианту не ставит молча,
 * а спрашивает — купить и поставить / установить взамен, — либо честно говорит «нет
 * денег». В полёте верфи нет: только паспорт стоящего модуля.
 */
export function SlotModal({
  world,
  docked,
  slot,
  onChange,
  onClose,
}: {
  world: World
  docked: boolean
  slot: SlotView
  onChange: () => void
  onClose: () => void
}) {
  const player = world.player
  const module = slot.module
  // Виды, что принимает слот: у аукса их несколько, у прочих один. Фильтр — по вхождению.
  const kinds = slot.optionKinds
  // Мунишн ('missile'+'drone') подписываем как «ракеты», аукс — «доп», прочее — своим видом.
  const labelKind = kinds.includes('missile') ? 'missile' : kinds.length > 1 ? 'aux' : (kinds[0] ?? 'engine')
  // Мунишн-слот особый: один тип на ВСЕ пилоны, поэтому купить/поставить/снять/продать/качать
  // идут по слоту целиком (armMissiles/…), а не по одному пилону, как прочее оружие.
  const isMissileSlot = kinds.includes('missile')
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  // Escape закрывает ИМЕННО эту модалку (а сперва — подтверждение внутри неё), а не весь
  // экран/консоль под ней. Слушаем в фазе ЗАХВАТА и глушим событие: так внутренняя
  // модалка перехватывает Escape раньше центрального обработчика App, который иначе закрыл
  // бы всю консоль. Следующий Escape (модалки уже нет) закроет экран как обычно.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return
      e.stopPropagation()
      if (confirm) setConfirm(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm, onClose])

  // Действие, ПОСЛЕ которого слот меняет смысл (снял/продал) — перерисовать и закрыть:
  // держать модалку поверх исчезнувшего модуля значило бы врать.
  const commit = (run: () => void) => {
    run()
    onChange()
    onClose()
  }

  // Ремонт корпуса — БРОСОК: жмём, домен решает исход, показываем его сообщением и НЕ
  // закрываем окно (чини/дозаряжай/улучшай подряд). Провал денег не берёт, но может доломать.
  const doRepair = () => {
    if (!module) return
    const outcome = runRepair(world, module)
    onChange()
    setConfirm({ message: t(('ship.repair.' + outcome) as Key), actions: [] })
  }

  // Клик по МОЕМУ варианту из трюма — спросить и поставить взамен (даром, железо своё).
  const askFit = (holdIndex: number, m: ShipModule) =>
    setConfirm({
      message: t('ship.confirm.fit', { name: displayName(m) }),
      // Установка не закрывает слот: деталь встала — можно сразу улучшить.
      actions: [
        {
          label: t('station.fit'),
          run: () => (isMissileSlot ? armMissilesFromHold(player, holdIndex) : fitFromHold(player, holdIndex)),
          stay: true,
        },
      ],
    })

  // Клик по варианту из МАГАЗИНА — спросить, купить и поставить; нет денег — так и сказать.
  const askBuy = (m: ShipModule) => {
    const at = weaponSlot(world, m)
    const affordable = isMissileSlot ? world.credits >= priceOf(m) : canBuy(world, player, m, at) !== 'no-money'
    if (!affordable) {
      setConfirm({ message: tm('ship.confirm.noFunds', { price: <Money amount={priceOf(m)} /> }), actions: [] })
      return
    }
    setConfirm({
      message: tm('ship.confirm.buy', { name: displayName(m), price: <Money amount={priceOf(m)} /> }),
      // Покупка не закрывает слот: деталь встала взамен — можно тут же жать «улучшить».
      actions: [
        {
          label: t('station.buy'),
          run: () => (isMissileSlot ? armMissiles(world, player, m) : buy(world, player, m, at)),
          stay: true,
        },
      ],
    })
  }

  // Улучшение — единственное действие с выбором дороги: копией (+50%, копия сгорает)
  // или деньгами (+25%). Показываем обе доступные; ни одной — значит просто нет денег.
  const askUpgrade = () => {
    if (!module) return
    // «было → станет» по главной оси модуля. Копия (+50%) и деньги (+25%) дают разный
    // прирост — показываем абсолютные числа в каждой кнопке, рядом с процентом.
    const stat = moduleStat(module)
    const arrow = (useCopy: boolean) =>
      `${formatStat(stat.key, stat.value)} → ${formatStat(stat.key, upgradedStatValue(module, useCopy))}`
    const actions: Confirm['actions'] = []
    // stay: улучшение оставляет модуль в слоте — модалку держим открытой (чини/улучшай подряд).
    if (canUpgrade(world, player, module, true) === null)
      actions.push({
        label: `${t('station.upgradeCopy')} · ${arrow(true)}`,
        // Ракетный слот качаем целиком (все пилоны), прочее — по одному модулю.
        run: () => (isMissileSlot ? upgradeMissiles(world, player, true) : upgradeModule(world, player, module, true)),
        stay: true,
      })
    if (canUpgrade(world, player, module, false) === null)
      actions.push({
        label: (
          <>
            {t('station.upgradeCash')} · <Money amount={upgradeCashCost(module)} /> · {arrow(false)}
          </>
        ),
        run: () => (isMissileSlot ? upgradeMissiles(world, player, false) : upgradeModule(world, player, module, false)),
        stay: true,
      })
    // Ни одной дороги — почему? Мир не тянет этот класс (нужен развитее) — своя причина;
    // иначе просто нет денег.
    const lowTech = canUpgrade(world, player, module, false) === 'low-tech'
    setConfirm(
      actions.length > 0
        ? { message: t('ship.confirm.upgrade', { name: displayName(module) }), actions }
        : lowTech
          ? { message: t('ship.confirm.lowTech', { tech: minTechForClass(module.class) }), actions: [] }
          : { message: tm('ship.confirm.noFunds', { price: <Money amount={upgradeCashCost(module)} /> }), actions: [] },
    )
  }

  const shopOptions = docked
    ? stationStock(world).filter((m) => kinds.includes(m.kind) && m.id !== module?.id).slice(0, 8)
    : []
  const holdOptions = player.hold.items
    .map((it, i) => ({ it, i }))
    .filter(
      (x): x is { it: Extract<CargoItem, { kind: 'module' }>; i: number } =>
        x.it.kind === 'module' && kinds.includes(x.it.module.kind) && x.it.module.id !== module?.id,
    )

  return (
    <Modal onClose={onClose} wide>
        {/* Шапка: вид слота словом и кнопка закрытия. */}
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-sm tracking-[0.25em]" style={{ color: DIM }}>
            {t(('kind.' + labelKind) as Key).toUpperCase()}
          </h3>
          <Button small variant="secondary" onClick={onClose}>
            {t('ship.close')}
          </Button>
        </div>

        {/* Что стоит сейчас — крупно, без рамки. */}
        <div className="mt-4">
          {module ? (
            <>
              <p className="text-lg">{displayName(module)}</p>
              <p className="text-sm" style={{ color: DIM }}>
                {statLabel(moduleStat(module).key)} {formatStat(moduleStat(module).key, moduleStat(module).value)}
              </p>
              {/* Поломка: сколько силы потеряно. Красным — это не «износ на продажу», а урон в бою. */}
              {moduleFault(module) > 0 && (
                <p className="text-sm" style={{ color: UI.DANGER }}>
                  {t('ship.broken', { pct: Math.round(moduleFault(module) * 100) })}
                </p>
              )}
            </>
          ) : (
            <p className="text-lg" style={{ color: DIM }}>
              {t('ship.slotEmpty')}
            </p>
          )}
        </div>

        {docked ? (
          <>
            <ActionBar
              world={world}
              module={module}
              onStrip={() =>
                module && commit(() => (isMissileSlot ? stripMissiles(player) : unfitModule(player, module)))
              }
              onRepair={doRepair}
              onUpgrade={askUpgrade}
              onSell={() =>
                module && commit(() => (isMissileSlot ? sellMissiles(world, player) : sellModule(world, player, module)))
              }
            />
            {module && isEssential(module) && (
              <p className="mt-2 text-xs" style={{ color: DIM }}>
                {t('ship.essentialNote')}
              </p>
            )}

            {/* Варианты в две колонки: магазин слева, твой трюм справа. Ни колонки
                «купить», ни раскрытий — клик по строке сам спрашивает и ставит. */}
            <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
              <VariantColumn title={t('ship.col.shop')} empty={t('ship.noneShop')}>
                {shopOptions.map((m) => (
                  <VariantRow key={m.id} world={world} module={m} price={priceOf(m)} onClick={() => askBuy(m)} />
                ))}
              </VariantColumn>
              <VariantColumn title={t('ship.col.hold')} empty={t('ship.noneHold')}>
                {holdOptions.map(({ it, i }) => (
                  <VariantRow key={`${it.module.id}-${i}`} world={world} module={it.module} onClick={() => askFit(i, it.module)} />
                ))}
              </VariantColumn>
            </div>
          </>
        ) : null}

        {confirm && (
          <ConfirmBox
            confirm={confirm}
            onRun={(a) => {
              a.run()
              onChange()
              setConfirm(null)
              // `stay` (покупка/установка) — слот остаётся открытым: деталь встала, статы
              // догнали (refresh), и «улучшить» уже активно. Прочее закрывает, как и было.
              if (!a.stay) onClose()
            }}
            onCancel={() => setConfirm(null)}
          />
        )}
    </Modal>
  )
}

/** Ряд действий над стоящим модулем. Снять и продать гаснут у двигателя/маневровых
 *  (их только заменяют) и когда слот пуст; починить — когда чинить нечего; улучшить —
 *  на потолке прокачки. Числа берём из домена, чтобы гашение не разошлось с делом. */
function ActionBar({
  world,
  module,
  onStrip,
  onRepair,
  onUpgrade,
  onSell,
}: {
  world: World
  module: ShipModule | null
  onStrip: () => void
  onRepair: () => void
  onUpgrade: () => void
  onSell: () => void
}) {
  const player = world.player
  const essential = module ? isEssential(module) : false
  const noRoom = module ? freeCapacity(player.hold) < module.mass : true
  const repair = module ? repairInfoFor(world, module) : { price: 0, can: false, refused: false }
  const maxed = module ? canUpgrade(world, player, module, true) === 'maxed' : true
  // «Ремонт» значит РАЗНОЕ по виду: у бронеплиты латает КОРПУС корабля (общий), у
  // пусковой — ДОЗАРЯДКА ракет, у прочего железа — чинит ПОЛОМКУ самой детали.
  const repairLabel =
    module?.kind === 'missile'
      ? t('station.rearm')
      : module?.kind === 'armour'
        ? t('station.repairHull')
        : t('station.repairModule')

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: DIM }}>
        <Button small variant="primary" disabled={!module || essential || noRoom} onClick={onStrip}>
          {t('station.strip')}
        </Button>
        <Button small variant="primary" disabled={!repair.can} onClick={onRepair}>
          {repair.price > 0 ? (
            <>
              {repairLabel} · <Money amount={repair.price} />
            </>
          ) : (
            repairLabel
          )}
        </Button>
        <Button small variant="primary" disabled={!module || maxed} onClick={onUpgrade}>
          {t('station.upgrade')}
        </Button>
        <Button small variant="primary" disabled={!module || essential} onClick={onSell}>
          {module ? tm('station.sellModule', { value: <Money amount={moduleResaleValue(player, module)} /> }) : t('station.sell')}
        </Button>
      </div>
      {/* Захолустная мастерская за такой корпус не берётся — так и говорим, а не молчим кнопкой. */}
      {repair.refused && (
        <p className="mt-2 text-xs" style={{ color: DIM }}>
          {t('ship.repair.tooComplex')}
        </p>
      )}
    </>
  )
}

/** Одна колонка вариантов: заголовок и строки. Пусто — честная строка «—», а не провал. */
function VariantColumn({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children]
  const hasAny = items.some(Boolean)
  return (
    <div>
      <h4 className="mb-2 text-xs tracking-[0.25em]" style={{ color: DIM }}>
        {title}
      </h4>
      {hasAny ? (
        <div className="flex flex-col gap-1.5">{children}</div>
      ) : (
        <p className="text-xs" style={{ color: DIM }}>
          {empty}
        </p>
      )}
    </div>
  )
}

/** Кликабельная строка варианта: имя, заголовочное число со стрелкой лучше/хуже
 *  относительно стоящего и — для магазина — цена. Без кнопки: строка И есть кнопка. */
function VariantRow({
  world,
  module,
  price,
  onClick,
}: {
  world: World
  module: ShipModule
  price?: number
  onClick: () => void
}) {
  const cmp = headlineCompare(world, module)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center justify-between gap-3 border px-3 py-2 text-left text-sm transition-colors hover:border-[#7fd6ff] hover:bg-[#7fd6ff]/10"
      style={{ borderColor: DIM }}
    >
      <span className="min-w-0 truncate">{displayName(module)}</span>
      <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <span style={{ color: DIM }}>{headlineNumber(module)}</span>
        {cmp && <span style={{ color: trend(cmp.better).color }}>{trend(cmp.better).mark}</span>}
        {price !== undefined && (
          <span style={{ color: DIM }}>
            <Money amount={price} />
          </span>
        )}
      </span>
    </button>
  )
}

/** Стеклянный вопрос поверх модалки: сообщение и кнопки действий (или одна «ОК»). */
export function ConfirmBox({
  confirm,
  onRun,
  onCancel,
}: {
  confirm: Confirm
  onRun: (action: Confirm['actions'][number]) => void
  onCancel: () => void
}) {
  return (
    // Два действия и больше — окно шире, чтобы кнопки стояли в одну строку, а не лесенкой.
    <Modal onClose={onCancel} z={60} medium={confirm.actions.length > 1}>
      <p className={confirm.price !== undefined ? 'text-center text-base' : 'text-sm'}>{confirm.message}</p>
      {confirm.price !== undefined && (
        <div className="mt-3 text-center text-2xl font-semibold leading-8 tabular-nums" style={{ color: ACCENT }}>
          <Money amount={confirm.price} />
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {confirm.actions.map((a, i) => (
          <Button key={i} small variant="primary" onClick={() => onRun(a)}>
            {a.label}
          </Button>
        ))}
        <Button small variant={confirm.actions.length > 0 ? 'secondary' : 'primary'} onClick={onCancel}>
          {confirm.actions.length > 0 ? t('ship.cancel') : t('ship.ok')}
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Расклад ремонта у этого модуля: у брони — КОРПУС (через мастерскую), у пусковой —
 * ДОЗАРЯДКА ракет, у прочего рабочего железа — ПОЛОМКА самой детали (если сломана).
 */
function repairInfoFor(world: World, module: ShipModule): RepairInfo {
  if (module.kind === 'armour') {
    const q = repairQuote(world, world.player)
    if (q.price <= 0) return { price: 0, can: false, refused: false } // корпус цел
    if (q.chance <= 0) return { price: q.price, can: false, refused: true } // не берутся
    return { price: q.price, can: world.credits >= q.price, refused: false }
  }
  if (module.kind === 'missile') {
    const price = rearmCost(world.player)
    return { price, can: price > 0 && world.credits >= price, refused: false }
  }
  if (moduleFault(module) > 0) {
    const q = repairModuleQuote(world, module)
    if (q.chance <= 0) return { price: q.price, can: false, refused: true } // класс не по зубам
    return { price: q.price, can: world.credits >= q.price, refused: false }
  }
  return { price: 0, can: false, refused: false } // исправна — чинить нечего
}

/** Собственно ремонт. Возвращает КЛЮЧ исхода для сообщения игроку (ремонт — бросок). */
function runRepair(world: World, module: ShipModule): string {
  if (module.kind === 'armour') return repair(world, world.player) // 'repaired'|'botched'|'refused'|...
  if (module.kind === 'missile') return rearm(world, world.player) ? 'rearmed' : 'no-money'
  // Поломка детали — тот же бросок мастеров, но свой текст (не «корпус», а «деталь»).
  const o = repairModule(world, world.player, module)
  return o === 'repaired' ? 'partRepaired' : o === 'botched' ? 'partBotched' : o === 'refused' ? 'partRefused' : o
}
