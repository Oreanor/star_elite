import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Group, Vector3, type BufferGeometry } from 'three'
import {
  buy,
  buyHull,
  canBuy,
  canUpgrade,
  deriveShipSpec,
  fitFromHold,
  freeCapacity,
  isEssential,
  moduleResaleValue,
  moduleStat,
  priceOf,
  SHIPYARD,
  rearm,
  rearmCost,
  repair,
  repairCost,
  sellModule,
  stationStock,
  unfitModule,
  upgradeCashCost,
  upgradeModule,
  type CargoItem,
  type ModuleKind,
  type ShipModule,
  type ShipSpec,
  type World,
} from '@elite/sim'
import { chassisGeometry } from '../../render/geometry/ships'
import { hullMaterial } from '../../render/materials/materials'
import { t, useLang, type Key } from '../i18n'
import { UI } from '../theme'
import { ACCENT, Button, Column, DIM, Panel, Table } from '../station/chrome'
import { StatId, credits, formatStat, statLabel } from '../station/format'
import { displayName, headlineCompare, headlineNumber, moduleBenefit, weaponSlot } from '../station/Equipment'
import { chassisName, properName } from '../i18n/dataNames'

/**
 * Экран корабля (клавиша I) и он же — ВЕРФЬ у причала. ОДИН компонент, а не два:
 * пользователь просил, чтобы «на станции была такая же панелька, как по I».
 * Разницу задаёт `docked`: в полёте это витрина (чертёж, статы, груз — только
 * читать), у причала — мастерская (почини, замени, улучши слот).
 *
 * Характеристики и модули НАМЕРЕННО на одной вкладке: меняя оснастку, пилот тут
 * же видит, как поехали статы, — ради этого их и держат бок о бок.
 *
 * Мир под экраном стоит (App отпускает курсор — пауза это и есть отпущенный
 * курсор), поэтому анимировать чертёж собственным кадром безопасно, а мутации
 * оснастки перерисовывают экран через `bump`: React узнать иначе не может.
 */

/** Поле зрения чертёжной камеры, град. Влезает и «Оса» в 3 м, и баржа в 60. */
const FOV = 32

export function ShipScreen({
  world,
  onClose,
  docked = false,
  embedded = false,
}: {
  world: World
  onClose: () => void
  docked?: boolean
  /** Встроен в стеклянную панель станции: без своего оверлея, фона и заголовка. */
  embedded?: boolean
}) {
  useLang()
  // Счётчик перерисовок: установка/улучшение мутируют мир, статы обязаны догнать.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const player = world.player

  // Открытый слот: по клику на плитку над всем встаёт стеклянная модалка с вариантами
  // и действиями. Ищем по ключу заново каждый рендер — операция могла сдвинуть слоты.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const slots = buildSlots(world)
  const openSlot = slots.find((s) => s.key === openKey) ?? null

  // Escape закрывает экран — как на карте галактики. Клавишу I гасит App.
  // Встроенным в станцию клавишами заведует сама станция — второго слушателя не вешаем.
  useEffect(() => {
    if (embedded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, embedded])

  const body = (
    <>
      {!embedded && (
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl tracking-[0.35em]">{docked ? t('station.shipyard.title') : t('ship.title')}</h1>
            <p className="mt-1 text-sm tracking-widest" style={{ color: DIM }}>
              {t('station.system')} {properName(world.systemName).toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border px-4 py-2 text-sm tracking-[0.3em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
            style={{ borderColor: ACCENT }}
          >
            {docked ? t('menu.back') : `I — ${t('ship.close')}`}
          </button>
        </div>
      )}

      {/* Слева паспорт (чертёж + характеристики), справа — оснастка ПЛИТКОЙ, а не в
          три колонки таблиц. Столбца «класс» больше нет: класс жил лишь в имени
          модуля, отдельной осью пилоту он ни к чему. */}
      <div className="mt-1 grid gap-5 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="space-y-3">
          <div
            className="aspect-[15/8] w-full border"
            style={{
              borderColor: DIM,
              background: 'radial-gradient(ellipse at center, rgba(20,44,74,0.35), rgba(2,6,12,0.6))',
            }}
          >
            <Blueprint chassisId={player.loadout.chassis.id} />
          </div>
          {/* Имя корабля — заголовком панели характеристик, а не отдельной строкой над моделью. */}
          <Stats spec={player.spec} name={chassisName(player.loadout.chassis.name)} />
        </div>

        <SlotGrid slots={slots} onOpen={setOpenKey} docked={docked} />
      </div>

      {/* Модалка — ТОЛЬКО у причала: там она мастерская (варианты + действия). В полёте
          карточки самодостаточны (харка и вес прямо на них), и клик ничего не открывает. */}
      {docked && openSlot && (
        <SlotModal world={world} docked={docked} slot={openSlot} onChange={bump} onClose={() => setOpenKey(null)} />
      )}
    </>
  )

  // Встроенный — просто тело: рамку, фон и скролл даёт стеклянная панель станции.
  if (embedded) return <div className="font-mono">{body}</div>

  return (
    <div className="absolute inset-0 overflow-auto bg-black/90 font-mono" style={{ color: ACCENT }}>
      <div className="mx-auto max-w-5xl px-8 py-10">{body}</div>
    </div>
  )
}

/** Одна ячейка оснастки: установленный модуль или пустая точка подвески. */
interface SlotView {
  key: string
  module: ShipModule | null
  hardpointIndex?: number
  optionKinds: ModuleKind[]
  /** Сколько пилонов свёрнуто в эту строку (ракеты) и их суммарный боезапас. */
  ammoTotal?: number
}

/**
 * Перечень слотов корабля — по ЁМКОСТИ корпуса, а не по установленному. Пустой слот
 * не пропадает из сетки, а остаётся плиткой «СВОБОДНО»: снятый модуль иначе некуда
 * вернуть, да и куда ставить новый — было бы не видно.
 *
 * Ракеты НЕ считаются по пилонам: пилоны несут один тип разом («либо одни, либо
 * другие»), поэтому все схлопнуты в одну плитку с суммарным боезапасом.
 * Действия верфи над ней идут по первому пилону — остальные того же вида.
 */
function buildSlots(world: World): SlotView[] {
  const loadout = world.player.loadout
  const rows: SlotView[] = []

  // Внутренние слоты заданы корпусом (chassis.slots). Раздаём установленные модули
  // по видам; на что не хватило — слот пуст. Порядок слотов — порядок корпуса.
  const pool = [...loadout.internals]
  loadout.chassis.slots.forEach((slot, i) => {
    const idx = pool.findIndex((m) => m.kind === slot.kind)
    const module = idx >= 0 ? pool.splice(idx, 1)[0]! : null
    rows.push({ key: `int-${i}`, module, optionKinds: [slot.kind] })
  })

  // Орудийные точки — всегда в сетке, пустые тоже: снял ствол — ставь заново.
  const pylons: number[] = []
  loadout.chassis.hardpoints.forEach((hp, i) => {
    if (hp.kind === 'pylon') {
      pylons.push(i)
      return
    }
    const weapon = loadout.weapons[i]
    rows.push({ key: `hp-${i}`, module: weapon ?? null, hardpointIndex: i, optionKinds: ['laser'] })
  })

  // Пилоны одной плиткой: заряжены — суммарный боезапас, пусты — плитка «СВОБОДНО»,
  // чтобы было куда снарядить. Пилона нет вовсе — плитки тоже нет.
  const loaded = pylons.filter((i) => loadout.weapons[i])
  if (loaded.length > 0) {
    const ammoTotal = loaded.reduce((sum, i) => sum + moduleStat(loadout.weapons[i]!).value, 0)
    rows.push({
      key: 'missiles',
      module: loadout.weapons[loaded[0]!]!,
      hardpointIndex: loaded[0],
      optionKinds: ['missile'],
      ammoTotal,
    })
  } else if (pylons.length > 0) {
    rows.push({ key: 'missiles-empty', module: null, hardpointIndex: pylons[0], optionKinds: ['missile'] })
  }

  return rows
}

/**
 * Оснастка ПЛИТКОЙ, а не таблицей: каждая ячейка — вид слота, что в нём стоит
 * («нет» — свободен), его характеристика и вес прямо на карточке. У причала плитка
 * кликабельна — по ней встаёт мастерская-модалка; в полёте карточки только читают,
 * клик ничего не открывает (незачем модалка ради тех же цифр).
 */
function SlotGrid({
  slots,
  onOpen,
  docked,
}: {
  slots: readonly SlotView[]
  onOpen: (key: string) => void
  docked: boolean
}) {
  // Своя секция, а не общий Panel: у того `mt-6` роняет модули на строку ниже модельки.
  // Здесь верх плитки встаёт вровень с контейнером чертежа — как и просили.
  return (
    <section className="border p-5" style={{ borderColor: DIM }}>
      <h2 className="mb-3 text-sm tracking-[0.3em]">{t('ship.tab.modules')}</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {slots.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={docked ? () => onOpen(s.key) : undefined}
            className={`flex flex-col gap-1 border p-3 text-left transition-colors ${
              docked ? 'cursor-pointer hover:border-[#7fd6ff] hover:bg-[#7fd6ff]/10' : 'cursor-default'
            }`}
            style={{ borderColor: DIM }}
          >
            {/* Вид слота — что за оборудование сюда ставится, а не имя конкретной модели. */}
            <span className="text-[0.6rem] tracking-[0.2em]" style={{ color: DIM }}>
              {t(('kind.' + s.optionKinds[0]) as Key).toUpperCase()}
            </span>
            <span className="text-sm leading-tight" style={{ color: s.module ? ACCENT : DIM }}>
              {s.module ? displayName(s.module) : t('ship.slotEmpty')}
            </span>
            {/* Харка и вес — прямо на карточке. У ракет заголовочная цифра — суммарный
                боезапас пилонов, а не боезапас одного; вес показываем модуля. */}
            {s.module && (
              <span className="text-[0.7rem]" style={{ color: DIM }}>
                {s.ammoTotal !== undefined ? formatStat('ammo', s.ammoTotal) : moduleBenefit(s.module)}
                {' · '}
                {formatStat('mass', s.module.mass)}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * Верфь корпусов: отдельная вкладка станции. Слева — крутящийся чертёж ВЫБРАННОГО
 * корпуса и его паспорт (тот же `deriveShipSpec`, что и у живого корабля, только для
 * стоковой сборки предложения); справа — плитки корпусов. Клик по плитке лишь ВЫБИРАЕТ
 * корпус для показа, а ставит его отдельная кнопка «взять»: сперва разгляди модель,
 * потом бери. Взял — домен меняет сборку целиком, `bump` перерисовывает всю панель.
 */
export function HullShop({ world, onChange }: { world: World; onChange: () => void }) {
  const currentId = world.player.loadout.chassis.id
  // Показываем сперва тот корпус, на котором летим. Клик по плитке — сменить показ.
  const [selectedId, setSelectedId] = useState(currentId)
  const selected = SHIPYARD.find((o) => o.chassis.id === selectedId) ?? SHIPYARD[0]!
  const owned = selected.chassis.id === currentId
  // Паспорт стоковой сборки предложения — та же чистая функция, что кормит живой корабль.
  const spec = useMemo(() => deriveShipSpec(selected.loadout()), [selected])

  return (
    <section className="border p-5" style={{ borderColor: DIM }}>
      <h2 className="mb-3 text-sm tracking-[0.3em]">{t('ship.hulls')}</h2>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_1fr]">
        {/* Слева — чертёж выбранного корпуса, под ним паспорт и кнопка «взять». */}
        <div className="space-y-3">
          <div
            className="aspect-[15/8] w-full border"
            style={{
              borderColor: DIM,
              background: 'radial-gradient(ellipse at center, rgba(20,44,74,0.35), rgba(2,6,12,0.6))',
            }}
          >
            <Blueprint chassisId={selected.chassis.id} />
          </div>
          <Stats spec={spec} name={chassisName(selected.chassis.name)} />
          <Button
            disabled={owned}
            onClick={() => {
              if (buyHull(world, selected.loadout(), selected.cost) === null) onChange()
            }}
          >
            {owned
              ? t('ship.current')
              : `${t('ship.take')} · ${selected.cost === 0 ? t('ship.free') : credits(selected.cost)}`}
          </Button>
        </div>

        {/* Справа — плитки корпусов. Клик выбирает для показа, не покупает. */}
        <div className="grid grid-cols-2 gap-2.5 self-start sm:grid-cols-3">
          {SHIPYARD.map((offer) => {
            const c = offer.chassis
            const isCurrent = c.id === currentId
            const isSelected = c.id === selectedId
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className="flex cursor-pointer flex-col gap-1 border p-3 text-left transition-colors hover:border-[#7fd6ff] hover:bg-[#7fd6ff]/10"
                style={{
                  borderColor: isSelected ? ACCENT : DIM,
                  backgroundColor: isSelected ? 'rgba(127,214,255,0.08)' : 'transparent',
                }}
              >
                <span className="text-sm leading-tight" style={{ color: ACCENT }}>
                  {chassisName(c.name)}
                </span>
                {/* Голое шасси: корпус и масса — с завода, до модулей. Для сравнения корпусов. */}
                <span className="text-[0.7rem]" style={{ color: DIM }}>
                  {formatStat('hull', c.baseHull)} · {formatStat('mass', c.baseMass)}
                </span>
                <span className="text-[0.7rem]" style={{ color: isCurrent ? ACCENT : DIM }}>
                  {isCurrent ? t('ship.current') : offer.cost === 0 ? t('ship.free') : credits(offer.cost)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** Выбор, который модалка задаёт перед необратимым действием: «купить и поставить?»,
 *  «установить взамен?». Пустой список действий — просто сообщение с «ОК» (нет денег). */
interface Confirm {
  message: string
  actions: { label: string; run: () => void }[]
}

/**
 * Стеклянная модалка по клику на плитку — поверх всего экрана. Никаких раскрытий и
 * колонки «купить»: сверху вид слота, под ним что стоит, ниже РЯД действий
 * (снять · починить · улучшить · продать), а в самом низу — варианты В ДВЕ КОЛОНКИ:
 * что есть в магазине и что лежит у тебя в трюме. Клик по варианту не ставит молча,
 * а спрашивает — купить и поставить / установить взамен, — либо честно говорит «нет
 * денег». В полёте верфи нет: только паспорт стоящего модуля.
 */
function SlotModal({
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
  const kind = slot.optionKinds[0] ?? 'engine'
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  // Любое действие меняет оснастку — перерисовать и закрыть: ключ слота после операции
  // мог бы указывать уже на другой модуль, а держать модалку открытой поверх — врать.
  const commit = (run: () => void) => {
    run()
    onChange()
    onClose()
  }

  // Клик по МОЕМУ варианту из трюма — спросить и поставить взамен (даром, железо своё).
  const askFit = (holdIndex: number, m: ShipModule) =>
    setConfirm({
      message: t('ship.confirm.fit', { name: displayName(m) }),
      actions: [{ label: t('station.fit'), run: () => fitFromHold(player, holdIndex) }],
    })

  // Клик по варианту из МАГАЗИНА — спросить, купить и поставить; нет денег — так и сказать.
  const askBuy = (m: ShipModule) => {
    const at = weaponSlot(world, m)
    if (canBuy(world, player, m, at) === 'no-money') {
      setConfirm({ message: t('ship.confirm.noFunds', { price: credits(priceOf(m)) }), actions: [] })
      return
    }
    setConfirm({
      message: t('ship.confirm.buy', { name: displayName(m), price: credits(priceOf(m)) }),
      actions: [{ label: t('station.buy'), run: () => buy(world, player, m, at) }],
    })
  }

  // Улучшение — единственное действие с выбором дороги: копией (+50%, копия сгорает)
  // или деньгами (+25%). Показываем обе доступные; ни одной — значит просто нет денег.
  const askUpgrade = () => {
    if (!module) return
    const actions: Confirm['actions'] = []
    if (canUpgrade(world, player, module, true) === null)
      actions.push({ label: t('station.upgradeCopy'), run: () => upgradeModule(world, player, module, true) })
    if (canUpgrade(world, player, module, false) === null)
      actions.push({
        label: `${t('station.upgradeCash')} · ${credits(upgradeCashCost(module))}`,
        run: () => upgradeModule(world, player, module, false),
      })
    setConfirm(
      actions.length > 0
        ? { message: t('ship.confirm.upgrade', { name: displayName(module) }), actions }
        : { message: t('ship.confirm.noFunds', { price: credits(upgradeCashCost(module)) }), actions: [] },
    )
  }

  const shopOptions = docked ? stationStock(world).filter((m) => m.kind === kind && m.id !== module?.id).slice(0, 8) : []
  const holdOptions = player.hold.items
    .map((it, i) => ({ it, i }))
    .filter(
      (x): x is { it: Extract<CargoItem, { kind: 'module' }>; i: number } =>
        x.it.kind === 'module' && x.it.module.kind === kind && x.it.module.id !== module?.id,
    )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 font-mono"
      onClick={onClose}
      style={{ color: ACCENT }}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto border bg-black/85 p-6 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: ACCENT, boxShadow: '0 0 40px rgba(127,214,255,0.15)' }}
      >
        {/* Шапка: вид слота словом и кнопка закрытия. */}
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-sm tracking-[0.25em]" style={{ color: DIM }}>
            {t(('kind.' + kind) as Key).toUpperCase()}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border px-3 py-1 text-xs tracking-[0.3em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
            style={{ borderColor: ACCENT }}
          >
            {t('ship.close')}
          </button>
        </div>

        {/* Что стоит сейчас — крупно, без рамки. */}
        <div className="mt-4">
          {module ? (
            <>
              <p className="text-lg">{displayName(module)}</p>
              <p className="text-sm" style={{ color: DIM }}>
                {statLabel(moduleStat(module).key)} {formatStat(moduleStat(module).key, moduleStat(module).value)}
              </p>
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
              onStrip={() => module && commit(() => unfitModule(player, module))}
              onRepair={() => module && commit(() => runRepair(world, module))}
              onUpgrade={askUpgrade}
              onSell={() => module && commit(() => sellModule(world, player, module))}
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

        {confirm && <ConfirmBox confirm={confirm} onRun={commit} onCancel={() => setConfirm(null)} />}
      </div>
    </div>
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
  const repairCostNow = module ? repairCostFor(world, module) : 0
  const maxed = module ? canUpgrade(world, player, module, true) === 'maxed' : true

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: DIM }}>
      <Button small disabled={!module || essential || noRoom} onClick={onStrip}>
        {t('station.strip')}
      </Button>
      <Button small disabled={repairCostNow <= 0 || world.credits < repairCostNow} onClick={onRepair}>
        {repairCostNow > 0 ? `${t('station.repair')} · ${credits(repairCostNow)}` : t('station.repair')}
      </Button>
      <Button small disabled={!module || maxed} onClick={onUpgrade}>
        {t('station.upgrade')}
      </Button>
      <Button small disabled={!module || essential} onClick={onSell}>
        {module ? t('station.sellModule', { value: credits(moduleResaleValue(player, module)) }) : t('station.sell')}
      </Button>
    </div>
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
        {cmp && <span style={{ color: cmp.better ? UI.ALLY : UI.DANGER }}>{cmp.better ? '▲' : '▼'}</span>}
        {price !== undefined && <span style={{ color: DIM }}>{credits(price)}</span>}
      </span>
    </button>
  )
}

/** Стеклянный вопрос поверх модалки: сообщение и кнопки действий (или одна «ОК»). */
function ConfirmBox({
  confirm,
  onRun,
  onCancel,
}: {
  confirm: Confirm
  onRun: (run: () => void) => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div
        className="w-full max-w-sm border bg-black/90 p-6 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: ACCENT, boxShadow: '0 0 40px rgba(127,214,255,0.2)' }}
      >
        <p className="text-sm">{confirm.message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {confirm.actions.map((a) => (
            <Button key={a.label} small onClick={() => onRun(a.run)}>
              {a.label}
            </Button>
          ))}
          <Button small onClick={onCancel}>
            {confirm.actions.length > 0 ? t('ship.cancel') : t('ship.ok')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Почём чинить у этого модуля: у брони — корпус, у пусковой — ракеты; иначе нечего.
 *  Одна точка правды и для гашения кнопки, и для самого ремонта — чтобы не разошлись. */
function repairCostFor(world: World, module: ShipModule): number {
  if (module.kind === 'armour') return repairCost(world.player)
  if (module.kind === 'missile') return rearmCost(world.player)
  return 0
}

/** Собственно ремонт: корпус у брони, боезапас у пусковой. Домен решает, хватит ли денег. */
function runRepair(world: World, module: ShipModule): void {
  if (module.kind === 'armour') repair(world, world.player)
  else if (module.kind === 'missile') rearm(world, world.player)
}

/** Строки характеристик корабля. Читаются из `spec` при каждом рендере — после
 *  установки модуля `spec` уже пересобран доменом, и числа едут сами. */
interface StatRow {
  id: StatId
  value: number
}

function Stats({ spec, name }: { spec: ShipSpec; name: string }) {
  const tuning = spec.tuning
  const rows: StatRow[] = [
    { id: 'hull', value: spec.hull.hull },
    { id: 'shield', value: spec.hull.shield },
    { id: 'mass', value: spec.mass },
    { id: 'speed', value: tuning.MAX_SPEED },
    // Манёвренность — одним числом: среднее угловых ускорений по трём осям. Три
    // строки тангаж/рыскание/крен пилоту ни к чему, «тяжесть» носа читается и так.
    { id: 'maneuver', value: (tuning.PITCH_ACCEL + tuning.YAW_ACCEL + tuning.ROLL_ACCEL) / 3 },
    { id: 'jump', value: spec.jumpRange },
    { id: 'cargo', value: spec.cargoCapacity },
    { id: 'energy', value: spec.power.capacity },
  ]

  const columns: Column<StatRow>[] = [
    { key: 'name', header: '', cell: (r) => <span style={{ color: DIM }}>{statLabel(r.id)}</span> },
    { key: 'value', header: '', align: 'right', cell: (r) => formatStat(r.id, r.value) },
  ]

  return (
    <Panel title={name}>
      <Table columns={columns} rows={rows} rowKey={(r) => r.id} />
    </Panel>
  )
}

// ─── Чертёж ────────────────────────────────────────────────────────────────

/** Состояние вращения чертежа. Живёт в ref, а не в state: его крутит кадр, не React. */
interface DragState {
  dragging: boolean
  lastX: number
  lastY: number
  /** Ручной доворот от перетаскивания — гаснет к нулю, когда отпустили. */
  yaw: number
  pitch: number
  /** Холостое вращение — копится, пока не тянут. */
  base: number
}

function Blueprint({ chassisId }: { chassisId: string }) {
  const geometry = useMemo(() => chassisGeometry(chassisId), [chassisId])
  const drag = useRef<DragState>({ dragging: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0, base: 0 })

  // Кадрируем по сфере столкновений геометрии: корабль любого размера влезает
  // целиком. d = R / sin(fov/2) — сфера радиуса R вписывается по вертикали; 1.35 — поля.
  const { centre, camPos, distance } = useMemo(() => {
    const sphere = geometry.boundingSphere
    const r = sphere ? sphere.radius : 20
    const c = sphere ? sphere.center.clone() : new Vector3()
    const dist = (r / Math.sin((FOV / 2) * (Math.PI / 180))) * 0.85
    const dir = new Vector3(0.7, 0.45, -1).setLength(dist)
    return { centre: c, camPos: [dir.x, dir.y, dir.z] as [number, number, number], distance: dist }
  }, [geometry])

  const onDown = (e: React.PointerEvent) => {
    const d = drag.current
    d.dragging = true
    d.lastX = e.clientX
    d.lastY = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d.dragging) return
    d.yaw += (e.clientX - d.lastX) * 0.01
    // Тангаж ограничен: перевернуть кверху брюхом чертёж незачем, и так не «отвалится».
    d.pitch = Math.max(-1, Math.min(1, d.pitch + (e.clientY - d.lastY) * 0.01))
    d.lastX = e.clientX
    d.lastY = e.clientY
  }
  const onUp = (e: React.PointerEvent) => {
    drag.current.dragging = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // указатель уже отпущен — не важно
    }
  }

  return (
    <div
      className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      <Canvas
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: FOV, near: distance * 0.05, far: distance * 6, position: camPos }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <directionalLight position={[-4, 6, 8]} intensity={1.9} color={0xfff2dd} />
        <directionalLight position={[6, 3, -6]} intensity={0.55} color={0xa8c4e6} />
        <hemisphereLight args={[0x4a6480, 0x141a22, 0.5]} />
        <SpinningShip geometry={geometry} centre={centre} drag={drag} />
      </Canvas>
    </div>
  )
}

/**
 * Крутится сам, а под перетаскиванием слушается мыши и, отпущенный, ВЫРАВНИВАЕТСЯ
 * обратно: ручной доворот плавно гаснет к нулю, и холостое вращение продолжается
 * с того места. Экран на паузе — кадр здесь не связан с симуляцией.
 */
function SpinningShip({
  geometry,
  centre,
  drag,
}: {
  geometry: BufferGeometry
  centre: Vector3
  drag: React.RefObject<DragState>
}) {
  const ref = useRef<Group>(null)
  useFrame((_, dt) => {
    const d = drag.current
    if (!d) return
    if (!d.dragging) {
      d.base += dt * 0.5
      const k = Math.min(1, dt * 5) // возврат к нулю за доли секунды, без рывка
      d.yaw += (0 - d.yaw) * k
      d.pitch += (0 - d.pitch) * k
    }
    if (ref.current) {
      ref.current.rotation.y = d.base + d.yaw
      ref.current.rotation.x = d.pitch
    }
  })
  return (
    <group ref={ref}>
      <mesh geometry={geometry} material={hullMaterial()} position={[-centre.x, -centre.y, -centre.z]} />
    </group>
  )
}
