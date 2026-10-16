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
import { UI } from '../theme'
import { ACCENT, Button, DIM, Modal, Table, type Column } from '../station/chrome'
import { moduleColumns } from '../station/moduleColumns'
import { formatStat, statLabel, statNumber } from '../station/format'
import { Money, tm } from '../station/Money'
import { displayName, weaponSlot } from '../station/Equipment'
import { type SlotView } from './ShipSlots'
import { ItemSheet } from '../station/ItemSheet'

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
  /** Характеристика детали над ценой: что покупаешь, а не только почём. */
  detail?: React.ReactNode
  /**
   * Что крупнее: цена (покупка — решает «почём») или характеристика (улучшение — решает
   * прирост, цена при нём мелким шрифтом). По умолчанию — цена.
   */
  emphasis?: 'price' | 'detail'
  /**
   * Карточка предмета вместо сообщения: заголовок и строки «ПОДПИСЬ: значение» (`ItemSheet`),
   * как в окне продажи из отсека. Есть — `message`/`detail`/`price` не рисуются.
   */
  sheet?: { title: React.ReactNode; lines: React.ReactNode }
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
          run: () => (isMissileSlot ? armMissilesFromHold(player, holdIndex) : fitFromHold(player, holdIndex, slot.hardpointIndex)),
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
      `${statNumber(stat.key, stat.value)} → ${formatStat(stat.key, upgradedStatValue(module, useCopy))}`
    const byCopy = canUpgrade(world, player, module, true) === null
    const byCash = canUpgrade(world, player, module, false) === null
    // stay: улучшение оставляет модуль в слоте — модалку держим открытой (чини/улучшай подряд).
    // Ракетный слот качаем целиком (все пилоны), прочее — по одному модулю.
    const run = (useCopy: boolean) => () =>
      isMissileSlot ? upgradeMissiles(world, player, useCopy) : upgradeModule(world, player, module, useCopy)
    // Всё, что решает, — в теле окна: что станет и почём; на кнопке лишь «ОК». Деньгами — основная
    // дорога; копия (редкость: нужна такая же деталь в трюме) — вторая кнопка со своим итогом.
    const main = byCash ? false : byCopy ? true : null
    if (main !== null) {
      const actions: Confirm['actions'] = [{ label: t('ship.ok'), run: run(main), stay: true }]
      if (main === false && byCopy) {
        actions.push({ label: `${t('station.byCopy').toUpperCase()} · ${arrow(true)}`, run: run(true), stay: true })
      }
      setConfirm({
        message: t('ship.confirm.upgrade', { name: displayName(module) }),
        detail: (
          <>
            <div className="text-xs font-normal tracking-[0.2em]" style={{ color: DIM }}>
              {statLabel(stat.key)}
              {main ? ` · ${t('station.byCopy')}` : ''}
            </div>
            <div>{arrow(main)}</div>
          </>
        ),
        // Решает прирост — он крупно; цена при нём мелко.
        emphasis: 'detail',
        ...(main === false ? { price: upgradeCashCost(module) } : {}),
        actions,
      })
      return
    }
    // Ни одной дороги — почему? Мир не тянет этот класс (нужен развитее) — своя причина;
    // иначе просто нет денег.
    const lowTech = canUpgrade(world, player, module, false) === 'low-tech'
    setConfirm(
      lowTech
        ? { message: t('ship.confirm.lowTech', { tech: minTechForClass(module.class) }), actions: [] }
        : { message: tm('ship.confirm.noFunds', { price: <Money amount={upgradeCashCost(module)} /> }), actions: [] },
    )
  }

  const shopOptions = docked
    ? stationStock(world).filter((m) => kinds.includes(m.kind) && m.id !== module?.id)
    : []
  const holdOptions = player.hold.items
    .map((it, i) => ({ it, i }))
    .filter(
      (x): x is { it: Extract<CargoItem, { kind: 'module' }>; i: number } =>
        x.it.kind === 'module' && kinds.includes(x.it.module.kind) && x.it.module.id !== module?.id,
    )
  const holdModules = holdOptions.map((x) => x.it.module)
  // Индекс в трюме — по самому объекту модуля: таблица сортирует строки, и позиция в ней
  // с позицией в трюме больше не совпадает.
  const pickFromHold = (m: ShipModule) => {
    const hit = holdOptions.find((x) => x.it.module === m)
    if (hit) askFit(hit.i, m)
  }
  const shopColumns = moduleColumns(world, {
    hardpointIndex: slot.hardpointIndex,
    price: (m) => (
      <span className="whitespace-nowrap">
        <Money amount={priceOf(m)} />
      </span>
    ),
  })
  const holdColumns = moduleColumns(world, { hardpointIndex: slot.hardpointIndex })

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
              docked
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

            {/* Варианты — ТЕ ЖЕ таблицы, что в торговле (`moduleColumns`): магазин слева, твой
                трюм справа. Клик по строке сам спрашивает и ставит; заголовки сортируют. */}
            <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
            <OptionTable
              title={t('ship.col.shop')}
              empty={t('ship.noneShop')}
              rows={shopOptions}
              columns={shopColumns}
              onPick={askBuy}
            />
            <OptionTable
              title={t('ship.col.hold')}
              empty={t('ship.noneHold')}
              rows={holdModules}
              columns={holdColumns}
              onPick={pickFromHold}
            />
            </div>
          </>
        ) : (
          /* В ПОЛЁТЕ верфи нет, а своё железо пилот переставляет сам: снять в трюм и поставить
             из трюма. Купить, продать, чинить и качать — только у причала. */
          <>
            <ActionBar
              world={world}
              docked={false}
              module={module}
              onStrip={() =>
                module && commit(() => (isMissileSlot ? stripMissiles(player) : unfitModule(player, module)))
              }
              onRepair={doRepair}
              onUpgrade={askUpgrade}
              onSell={() => {}}
            />
            <OptionTable
              title={t('ship.col.hold')}
              empty={t('ship.noneHold')}
              rows={holdModules}
              columns={holdColumns}
              onPick={pickFromHold}
            />
          </>
        )}

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
  docked,
  module,
  onStrip,
  onRepair,
  onUpgrade,
  onSell,
}: {
  world: World
  /** Не у причала — только «снять в трюм»: прочее (деньги и мастерская) живёт на верфи. */
  docked: boolean
  module: ShipModule | null
  onStrip: () => void
  onRepair: () => void
  onUpgrade: () => void
  onSell: () => void
}) {
  const player = world.player
  const essential = module ? isEssential(module) : false
  const noRoom = module ? freeCapacity(player.hold) < module.mass : true
  const repair = docked && module ? repairInfoFor(world, module) : { price: 0, can: false, refused: false }
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
        {docked && (
        <>
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
        </>
        )}
      </div>
      {/* Захолустная мастерская за такой корпус не берётся — так и говорим, а не молчим кнопкой. */}
      {docked && repair.refused && (
        <p className="mt-2 text-xs" style={{ color: DIM }}>
          {t('ship.repair.tooComplex')}
        </p>
      )}
    </>
  )
}

/** Одна колонка вариантов: заголовок и строки. Пусто — честная строка «—», а не провал. */
/** Раздел окна слота: подпись и таблица модулей (или «нет»), клик по строке — выбрать. */
function OptionTable({
  title,
  empty,
  rows,
  columns,
  onPick,
}: {
  title: string
  empty: string
  rows: readonly ShipModule[]
  columns: Column<ShipModule>[]
  onPick: (m: ShipModule) => void
}) {
  return (
    <div className="mt-6">
      <h4 className="mb-2 text-xs tracking-[0.25em]" style={{ color: DIM }}>
        {title}
      </h4>
      {rows.length > 0 ? (
        <Table columns={columns} rows={rows} rowKey={(m, i) => `${m.id}-${i}`} onRowClick={onPick} />
      ) : (
        <p className="text-xs" style={{ color: DIM }}>
          {empty}
        </p>
      )}
    </div>
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
      {confirm.sheet ? (
        <ItemSheet title={confirm.sheet.title}>{confirm.sheet.lines}</ItemSheet>
      ) : (
        <p className={confirm.price !== undefined ? 'text-center text-base' : 'text-sm'}>{confirm.message}</p>
      )}
      {!confirm.sheet && confirm.detail && (
        confirm.emphasis === 'detail' ? (
          <div className="mt-3 text-center text-2xl font-semibold leading-8 tabular-nums" style={{ color: ACCENT }}>
            {confirm.detail}
          </div>
        ) : (
          <div className="mt-2 text-center text-sm">{confirm.detail}</div>
        )
      )}
      {!confirm.sheet && confirm.price !== undefined && (
        confirm.emphasis === 'detail' ? (
          <div className="mt-2 text-center text-sm tabular-nums" style={{ color: DIM }}>
            <Money amount={confirm.price} />
          </div>
        ) : (
          <div className="mt-3 text-center text-2xl font-semibold leading-8 tabular-nums" style={{ color: ACCENT }}>
            <Money amount={confirm.price} />
          </div>
        )
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
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
