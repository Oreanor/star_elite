import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  deriveShipSpec,
  fitOntoChassis,
  SHIPYARD,
  swapHull,
  type World,
} from '@elite/sim'
import { t, useLang } from '../i18n'
import { ACCENT, DIM } from '../station/chrome'
import { Hold } from '../station/Hold'
import { chassisName, properName } from '../i18n/dataNames'
import { ArrowButton, Blueprint } from './ShipBlueprint'
import { HullBuyModal, HullModal } from './HullModals'
import { SlotGrid, buildSlots } from './ShipSlots'
import { SlotModal } from './SlotModal'
import { Stats } from './ShipStats'
import { Money, tm } from '../station/Money'

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

  // Сетка слотов — по ПОКАЗЫВАЕМОМУ корпусу: свой борт интерактивен (клик открывает
  // мастерскую), а листая ЧУЖОЙ корпус на верфи, видим ЕГО раскладку слотов (сколько чего
  // и что пусто) по примерке — но только на просмотр, оснащать чужой корабль нельзя.
  const shownLoadout = docked && !owned ? fit.loadout : player.loadout
  const slots = buildSlots(shownLoadout)
  const slotsInteractive = docked && owned
  const openSlot = slotsInteractive ? slots.find((s) => s.key === openKey) ?? null : null
  // Покупка корпуса идёт через модалку подтверждения: там зачёт старого, доплата и
  // предупреждение о перегрузе. Пролистнул каталог — модалку гасим.
  const [buyingHull, setBuyingHull] = useState(false)
  const cycle = (d: number) => {
    setBrowseIdx((i) => (i + d + SHIPYARD.length) % SHIPYARD.length)
    setBuyingHull(false)
    setOpenKey(null) // открытый слот своего борта не должен «переехать» на чужой корпус
  }

  // МАСТЕРСКАЯ КОРПУСА — ремонт и усиление осей — открывается кликом по самому кораблю.
  // Только у своего борта на верфи: чужой корпус не чинят, а в полёте мастерской нет.
  const hullWorkshop = docked && owned
  const [hullOpen, setHullOpen] = useState(false)

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

      {/* Пополам: слева паспорт (корабль крупно, под ним характеристики в две колонки),
          справа — оснастка плиткой. Корабль — главное на экране, ему половина ширины,
          а не узкая полоска над столбцом цифр. */}
      <div className="mt-1 grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          {/* Клик по вращающемуся кораблю открывает МАСТЕРСКУЮ КОРПУСА: ремонт и усиление
              осей. Раньше это был ряд кнопок под характеристиками — он занимал полколонки
              и висел там даже тогда, когда чинить и качать нечего. Корабль сам себе кнопка. */}
          <div
            // Чуть ниже 4:3 (на 15%) и без подложки: корабль висит прямо на стекле панели,
            // а под ним целиком влезают характеристики. На низком окне потолок по высоте
            // экрана сжимает превью первым — характеристики важнее простора вокруг модели.
            className={`relative aspect-[80/51] max-h-[40vh] w-full ${hullWorkshop ? 'cursor-pointer' : ''}`}
            onClick={hullWorkshop ? () => setHullOpen(true) : undefined}
          >
            <Blueprint chassisId={shownId} />

            {/* Стрелки каталога — на самом контейнере, по бокам и по центру высоты: они
                листают то, что в нём показано, и отдельной строки под ним не заслуживают.
                Имя корпуса не дублируем — оно заголовком в карточке характеристик ниже.
                В полёте стрелок нет вовсе: корпус в пустоте не сменить. */}
            {docked && (
              <>
                <div className="absolute left-1.5 top-1/2 -translate-y-1/2">
                  {/* Клик по стрелке не должен открывать мастерскую корпуса под ней. */}
                  <ArrowButton dir="left" onClick={(e) => { e.stopPropagation(); cycle(-1) }} />
                </div>
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                  <ArrowButton dir="right" onClick={(e) => { e.stopPropagation(); cycle(1) }} />
                </div>
              </>
            )}

            {/* Покупка — под кораблём, снизу по центру: отдельной строкой она съедала
                высоту, нужную характеристикам. Свой корпус обозначен неактивной кнопкой.
                Клик открывает модалку сделки: зачёт старого, груз-осадок, доплата. */}
            {docked && (
              <button
                type="button"
                disabled={owned}
                onClick={(e) => {
                  e.stopPropagation()
                  setBuyingHull(true)
                }}
                className="absolute bottom-1.5 left-1/2 -translate-x-1/2 cursor-pointer border bg-black/40 px-4 py-1.5 text-sm tracking-[0.2em] whitespace-nowrap backdrop-blur-sm transition-colors enabled:hover:bg-[#7fd6ff] enabled:hover:text-black disabled:cursor-default disabled:opacity-50"
                style={{ borderColor: ACCENT, color: ACCENT }}
              >
                {owned ? t('ship.alreadyOwned') : tm('ship.buyHull', { price: <Money amount={offer.cost} /> })}
              </button>
            )}
          </div>

          {/* Характеристики. У чужого корпуса — со стрелками сравнения с текущим: белая
              вверх — параметр лучше, синяя вниз — хуже. */}
          <Stats
            spec={owned ? player.spec : previewSpec}
            name={chassisName((owned ? player.loadout.chassis : offer.chassis).name)}
            baseline={docked && !owned ? player.spec : null}
          />

        </div>

        <div className="space-y-5">
          <SlotGrid
            slots={slots}
            onOpen={setOpenKey}
            interactive={slotsInteractive}
            cargoCapacity={(owned ? player.spec : previewSpec).cargoCapacity}
          />
          {/* ГРУЗ у причала уехал в МАГАЗИН, под товары: там торгуют, и трюм нужен рядом с
              прилавком. В полёте магазина нет, а трюм есть — и он остаётся здесь, под
              модулями, в режиме «выбросить за борт». Компонент один и тот же. */}
          {!docked && <Hold world={world} onChange={refresh} atStation={false} />}
        </div>
      </div>

      {/* Модалка — ТОЛЬКО у причала: там она мастерская (варианты + действия). В полёте
          карточки самодостаточны (харка и вес прямо на них), и клик ничего не открывает. */}
      {docked && openSlot && (
        <SlotModal world={world} docked={docked} slot={openSlot} onChange={refresh} onClose={() => setOpenKey(null)} />
      )}

      {/* Мастерская корпуса по клику на корабль: починить раму, усилить оси. */}
      {hullWorkshop && hullOpen && (
        <HullModal world={world} onChange={refresh} onClose={() => setHullOpen(false)} />
      )}

      {/* Подтверждение покупки корпуса: зачёт старого, груз-осадок, доплата, перегруз. */}
      {docked && buyingHull && !owned && (
        <HullBuyModal
          world={world}
          chassis={offer.chassis}
          onConfirm={(net) => {
            if (swapHull(world, offer.chassis, net) === null) {
              refresh()
              setBuyingHull(false)
            }
          }}
          onClose={() => setBuyingHull(false)}
        />
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

// ─── Чертёж ────────────────────────────────────────────────────────────────
