import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Group, Vector3, type BufferGeometry } from 'three'
import {
  AUX_KINDS,
  buy,
  canBuy,
  canUpgrade,
  deriveShipSpec,
  fitFromHold,
  fitOntoChassis,
  freeCapacity,
  isEssential,
  minTechForClass,
  moduleResaleValue,
  moduleStat,
  priceOf,
  SHIPYARD,
  rearm,
  rearmCost,
  repair,
  repairCost,
  sellModule,
  slotCategoryOf,
  stationStock,
  swapHull,
  unfitModule,
  upgradeCashCost,
  upgradedStatValue,
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
import { displayName, headlineCompare, headlineNumber, weaponSlot } from '../station/Equipment'
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
  onChange,
}: {
  world: World
  onClose: () => void
  docked?: boolean
  /** Встроен в стеклянную панель станции: без своего оверлея, фона и заголовка. */
  embedded?: boolean
  /** Родитель (консоль) хочет знать о тратах — обновить кошелёк в своей шапке. */
  onChange?: () => void
}) {
  useLang()
  // Счётчик перерисовок: установка/улучшение мутируют мир, статы обязаны догнать.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  // Траты в модалке слота меняют и наш экран, и КОШЕЛЁК в шапке станции — а он живёт в
  // родителе (Console). Бампаем оба: иначе кредиты списаны, но табло баланса остаётся старым.
  const refresh = () => {
    bump()
    onChange?.()
  }
  const player = world.player

  // Открытый слот: по клику на плитку над всем встаёт стеклянная модалка с вариантами
  // и действиями. Ищем по ключу заново каждый рендер — операция могла сдвинуть слоты.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const slots = buildSlots(world)
  const openSlot = slots.find((s) => s.key === openKey) ?? null

  // ── Витрина корпусов прямо здесь: отдельной «ВЕРФИ» больше нет. Стрелками листаем
  // каталог, под моделью — имя и кнопка «купить». В ПОЛЁТЕ стрелок нет: корпус там
  // не сменить, экран лишь показывает твой корабль.
  const currentId = player.loadout.chassis.id
  const [browseIdx, setBrowseIdx] = useState(() => Math.max(0, SHIPYARD.findIndex((o) => o.chassis.id === currentId)))
  const offer = SHIPYARD[browseIdx] ?? SHIPYARD[0]!
  // У причала показываем ВЫБРАННЫЙ стрелками корпус; в полёте — всегда свой.
  const shownId = docked ? offer.chassis.id : currentId
  const owned = shownId === currentId

  // Примерка обвеса на выбранный корпус: спека и осадок «в трюм». По ней и статы со
  // стрелками, и проверка грузоподъёмности для кнопки покупки.
  const fit = useMemo(() => fitOntoChassis(player.loadout, offer.chassis), [player.loadout, offer])
  const previewSpec = useMemo(() => deriveShipSpec(fit.loadout), [fit])
  // Не хватило трюма на перенос обвеса — показываем МОДАЛКУ (а не строку под кнопкой).
  const [noRoom, setNoRoom] = useState(false)
  const cycle = (d: number) => {
    setBrowseIdx((i) => (i + d + SHIPYARD.length) % SHIPYARD.length)
    setNoRoom(false)
  }
  const doSwap = () => {
    const err = swapHull(world, offer.chassis, offer.cost)
    if (err === null) refresh()
    else if (err === 'no-room') setNoRoom(true)
  }

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
            <Blueprint chassisId={shownId} />
          </div>

          {/* Имя корпуса в обрамлении стрелок — ими и листаем каталог. В полёте стрелок
              нет (корпус не сменить), просто имя своего корабля по центру. */}
          {docked ? (
            <div className="flex items-center gap-2">
              <ArrowButton dir="left" onClick={() => cycle(-1)} />
              <span className="flex-1 text-center text-sm tracking-[0.2em]">{chassisName(offer.chassis.name)}</span>
              <ArrowButton dir="right" onClick={() => cycle(1)} />
            </div>
          ) : (
            <div className="text-center text-sm tracking-[0.2em]">{chassisName(player.loadout.chassis.name)}</div>
          )}

          {/* Цена внутри кнопки покупки, либо «уже у вас». Не хватает трюма на перенос
              обвеса — кнопка гаснет и подсказывает продать лишнее. */}
          {docked && (
            owned ? (
              <div className="w-full border py-2.5 text-center text-sm tracking-[0.2em]" style={{ borderColor: DIM, color: DIM }}>
                {t('ship.owned')}
              </div>
            ) : (
              <button
                type="button"
                disabled={world.credits < offer.cost}
                onClick={doSwap}
                className={`w-full border px-4 py-2.5 text-sm tracking-[0.2em] transition-colors ${
                  world.credits < offer.cost ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-[#7fd6ff] hover:text-black'
                }`}
                style={{ borderColor: ACCENT, color: ACCENT }}
              >
                {t('ship.buyHull', { price: credits(offer.cost) })}
              </button>
            )
          )}

          {/* Характеристики. У чужого корпуса — со стрелками сравнения с текущим: белая
              вверх — параметр лучше, синяя вниз — хуже. */}
          <Stats
            spec={owned ? player.spec : previewSpec}
            name={chassisName((owned ? player.loadout.chassis : offer.chassis).name)}
            baseline={docked && !owned ? player.spec : null}
          />
        </div>

        <SlotGrid slots={slots} onOpen={setOpenKey} docked={docked} />
      </div>

      {/* Модалка — ТОЛЬКО у причала: там она мастерская (варианты + действия). В полёте
          карточки самодостаточны (харка и вес прямо на них), и клик ничего не открывает. */}
      {docked && openSlot && (
        <SlotModal world={world} docked={docked} slot={openSlot} onChange={refresh} onClose={() => setOpenKey(null)} />
      )}

      {/* Не хватило грузоподъёмности на перенос обвеса — модалка (то же стекло, что у покупки). */}
      {noRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 font-mono" onClick={() => setNoRoom(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border p-6 text-center backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
            style={{
              borderColor: 'rgba(124,196,255,0.3)',
              background: 'linear-gradient(150deg, rgba(40,95,150,0.28), rgba(8,22,42,0.55))',
              boxShadow: '0 0 60px rgba(60,150,255,0.18), inset 0 0 80px rgba(80,180,255,0.06)',
              color: ACCENT,
            }}
          >
            <p className="text-sm leading-relaxed" style={{ color: UI.WARN }}>
              {t('ship.hullNoRoom')}
            </p>
            <button
              type="button"
              onClick={() => setNoRoom(false)}
              className="mt-5 border px-6 py-2 text-sm tracking-[0.2em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
              style={{ borderColor: ACCENT }}
            >
              {t('ship.ok')}
            </button>
          </div>
        </div>
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
    // Слот сравниваем по КАТЕГОРИИ: аукс-ячейку могут занимать разные виды устройств.
    const idx = pool.findIndex((m) => slotCategoryOf(m.kind) === slot.kind)
    const module = idx >= 0 ? pool.splice(idx, 1)[0]! : null
    // Аукс предлагает ВСЕ свои виды (маскировка/ECM/бомба/скуп/миелофон); прочее — один вид.
    const optionKinds: ModuleKind[] = slot.kind === 'aux' ? [...AUX_KINDS] : [slot.kind]
    rows.push({ key: `int-${i}`, module, optionKinds })
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

/** Категория слота у карточки: аукс-виды под 'aux', оружие — своими, прочее — само. */
function categoryOf(s: SlotView): string {
  return s.optionKinds.length > 1 ? 'aux' : (s.optionKinds[0] ?? 'engine')
}

/** Порядок категорий в сетке — от «сердца» корабля к грузу и допам. */
const CATEGORY_ORDER = [
  'engine', 'thrusters', 'shield', 'hyperdrive',
  'laser', 'missile', 'armour', 'cargo', 'aux',
] as const

interface CategoryCard {
  cat: string
  subs: SlotView[]
}

/** Свернуть плоские под-слоты в карточки по КАТЕГОРИИ, в заданном порядке. Пустых нет. */
function groupCards(slots: readonly SlotView[]): CategoryCard[] {
  const cards: CategoryCard[] = []
  for (const cat of CATEGORY_ORDER) {
    const subs = slots.filter((s) => categoryOf(s) === cat)
    if (subs.length > 0) cards.push({ cat, subs })
  }
  return cards
}

/**
 * Оснастка КАРТОЧКАМИ ПО КАТЕГОРИИ: одна карточка на вид оборудования, а внутри —
 * 1–3 под-слота (лазеры, броня, груз, аукс), куда и ставят конкретные штуки. Под-слот
 * пуст — тускло «нет», занят — ярко краткое имя. Клик по под-слоту у причала открывает
 * мастерскую-модалку (выбрать/заменить/снять/купить); в полёте карточки только читают.
 * У груза под под-слотами — сводка суммарного тоннажа.
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
  const cards = groupCards(slots)
  return (
    <section className="border p-5" style={{ borderColor: DIM }}>
      <h2 className="mb-3 text-sm tracking-[0.3em]">{t('ship.tab.modules')}</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {cards.map(({ cat, subs }) => {
          const filled = subs.filter((s) => s.module)
          const cargoTons =
            cat === 'cargo'
              ? filled.reduce((sum, s) => sum + moduleStat(s.module!).value, 0)
              : null
          return (
            <div key={cat} className="flex flex-col gap-1.5 border p-3" style={{ borderColor: DIM }}>
              {/* Шапка карточки: имя категории и «занято/всего», если под-слотов больше одного. */}
              <div className="flex items-baseline justify-between">
                <span className="text-[0.6rem] tracking-[0.2em]" style={{ color: DIM }}>
                  {t(('kind.' + cat) as Key).toUpperCase()}
                </span>
                {subs.length > 1 && (
                  <span className="text-[0.6rem]" style={{ color: DIM }}>
                    {filled.length}/{subs.length}
                  </span>
                )}
              </div>
              {/* Под-слоты: каждая единица — своя строка-кнопка. Пусто — тускло «нет». */}
              {subs.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={docked ? () => onOpen(s.key) : undefined}
                  className={`flex items-baseline justify-between gap-2 border px-2 py-1 text-left transition-colors ${
                    docked ? 'cursor-pointer hover:border-[#7fd6ff] hover:bg-[#7fd6ff]/10' : 'cursor-default'
                  }`}
                  style={{ borderColor: 'rgba(127,214,255,0.12)' }}
                >
                  <span
                    className="truncate text-xs leading-tight"
                    style={{ color: s.module ? ACCENT : DIM }}
                  >
                    {s.module ? displayName(s.module) : t('ship.slotEmpty')}
                  </span>
                  {s.module && (
                    <span className="shrink-0 text-[0.6rem]" style={{ color: DIM }}>
                      {s.ammoTotal !== undefined ? formatStat('ammo', s.ammoTotal) : formatStat('mass', s.module.mass)}
                    </span>
                  )}
                </button>
              ))}
              {/* Груз: суммарный тоннаж установленных отсеков — то, что реально влезет. */}
              {cargoTons !== null && filled.length > 0 && (
                <span className="text-[0.6rem]" style={{ color: DIM }}>
                  {t('ship.cargoTotal', { tons: formatStat('cargo', cargoTons) })}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Выбор, который модалка задаёт перед необратимым действием: «купить и поставить?»,
 *  «установить взамен?». Пустой список действий — просто сообщение с «ОК» (нет денег). */
interface Confirm {
  message: string
  // `stay` — оставить модалку слота ОТКРЫТОЙ после действия (покупка/установка): деталь
  // встаёт в слот, и пилот тут же жмёт «улучшить», не открывая слот заново.
  actions: { label: string; run: () => void; stay?: boolean }[]
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
  // Виды, что принимает слот: у аукса их несколько, у прочих один. Фильтр — по вхождению.
  const kinds = slot.optionKinds
  const labelKind = kinds.length > 1 ? 'aux' : (kinds[0] ?? 'engine')
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  // Действие, ПОСЛЕ которого слот меняет смысл (снял/продал) — перерисовать и закрыть:
  // держать модалку поверх исчезнувшего модуля значило бы врать.
  const commit = (run: () => void) => {
    run()
    onChange()
    onClose()
  }

  // Действие, что оставляет тот же модуль в слоте (ремонт корпуса, дозарядка) — модалку
  // НЕ закрываем: чини и улучшай подряд, не открывая слот заново. Только перерисовать.
  const commitStay = (run: () => void) => {
    run()
    onChange()
  }

  // Клик по МОЕМУ варианту из трюма — спросить и поставить взамен (даром, железо своё).
  const askFit = (holdIndex: number, m: ShipModule) =>
    setConfirm({
      message: t('ship.confirm.fit', { name: displayName(m) }),
      // Установка не закрывает слот: деталь встала — можно сразу улучшить.
      actions: [{ label: t('station.fit'), run: () => fitFromHold(player, holdIndex), stay: true }],
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
      // Покупка не закрывает слот: деталь встала взамен — можно тут же жать «улучшить».
      actions: [{ label: t('station.buy'), run: () => buy(world, player, m, at), stay: true }],
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
      actions.push({ label: `${t('station.upgradeCopy')} · ${arrow(true)}`, run: () => upgradeModule(world, player, module, true), stay: true })
    if (canUpgrade(world, player, module, false) === null)
      actions.push({
        label: `${t('station.upgradeCash')} · ${credits(upgradeCashCost(module))} · ${arrow(false)}`,
        run: () => upgradeModule(world, player, module, false),
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
          : { message: t('ship.confirm.noFunds', { price: credits(upgradeCashCost(module)) }), actions: [] },
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
            {t(('kind.' + labelKind) as Key).toUpperCase()}
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
              onRepair={() => module && commitStay(() => runRepair(world, module))}
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
  // Деталь не изнашивается и не чинится: «ремонт» на бронеплите латает КОРПУС корабля
  // (общий, до нового максимума), на ракете — ДОЗАРЯДКА боезапаса. Зовём по делу, чтобы
  // не читалось как «эта деталь с износом» — изношенного мы не продаём.
  const repairLabel = module?.kind === 'missile' ? t('station.rearm') : t('station.repairHull')

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: DIM }}>
      <Button small disabled={!module || essential || noRoom} onClick={onStrip}>
        {t('station.strip')}
      </Button>
      <Button small disabled={repairCostNow <= 0 || world.credits < repairCostNow} onClick={onRepair}>
        {repairCostNow > 0 ? `${repairLabel} · ${credits(repairCostNow)}` : repairLabel}
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
  onRun: (action: Confirm['actions'][number]) => void
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
            <Button key={a.label} small onClick={() => onRun(a)}>
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

/** У какой характеристики «больше — лучше». По умолчанию да; масса — исключение: лёгкий вёртче. */
const HIGHER_BETTER: Partial<Record<StatId, boolean>> = { mass: false }

function statRows(spec: ShipSpec): StatRow[] {
  const tuning = spec.tuning
  return [
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
}

/** Стрелка сравнения с текущим кораблём: белая вверх — лучше, синяя вниз — хуже. */
function CompareArrow({ id, value, base }: { id: StatId; value: number; base: number }) {
  if (Math.abs(value - base) < 1e-6) return null
  const better = (HIGHER_BETTER[id] ?? true) ? value > base : value < base
  return <span style={{ color: better ? '#eaf4ff' : '#5b9bd6' }}>{better ? '▲' : '▼'}</span>
}

function Stats({ spec, name, baseline }: { spec: ShipSpec; name: string; baseline?: ShipSpec | null }) {
  const rows = statRows(spec)
  const base = baseline ? statRows(baseline) : null

  const columns: Column<StatRow>[] = [
    { key: 'name', header: '', cell: (r) => <span style={{ color: DIM }}>{statLabel(r.id)}</span> },
    {
      key: 'value',
      header: '',
      align: 'right',
      cell: (r) => {
        const b = base?.find((x) => x.id === r.id)
        return (
          <span className="inline-flex items-center justify-end gap-1.5">
            {formatStat(r.id, r.value)}
            {b && <CompareArrow id={r.id} value={r.value} base={b.value} />}
          </span>
        )
      },
    },
  ]

  return (
    <Panel title={name}>
      <Table columns={columns} rows={rows} rowKey={(r) => r.id} />
    </Panel>
  )
}

/** Стрелка-кнопка листания каталога корпусов под моделью. */
function ArrowButton({ dir, onClick }: { dir: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer border px-3 py-1 text-sm transition-colors hover:bg-[#7fd6ff] hover:text-black"
      style={{ borderColor: DIM, color: ACCENT }}
    >
      {dir === 'left' ? '◄' : '►'}
    </button>
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
