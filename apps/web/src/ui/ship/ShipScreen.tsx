import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  deriveShipSpec,
  fitOntoChassis,
  shipyardOffers,
  swapHull,
  usedCapacityOf,
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
  // Ряд корпусов ЭТОЙ верфи: «Гермес» — только у диктатур (`shipyardOffers`).
  const offers = shipyardOffers(world)
  const [browseIdx, setBrowseIdx] = useState(() => Math.max(0, offers.findIndex((o) => o.chassis.id === currentId)))
  const offer = offers[browseIdx] ?? offers[0]!
  // У причала показываем ВЫБРАННЫЙ стрелками корпус; в полёте — всегда свой.
  const shownId = docked ? offer.chassis.id : currentId
  const owned = shownId === currentId

  // Чужой корпус показываем в одной из двух сборок. По умолчанию ЗАВОДСКАЯ — так верфь его
  // и продаёт. Галочка «примерить обвес» ставит на него СВОЁ железо (как разложит его
  // `swapHull` при покупке), и стрелки отвечают на вопрос «станет ли МОЙ корабль сильнее».
  // Выбор переживает листание: сравниваешь корпуса одной меркой.
  const [tryFit, setTryFit] = useState(false)
  const previewLoadout = useMemo(
    () => (tryFit ? fitOntoChassis(player.loadout, offer.chassis).loadout : offer.loadout()),
    [tryFit, player.loadout, offer],
  )
  const previewSpec = useMemo(() => deriveShipSpec(previewLoadout), [previewLoadout])

  // Сетка слотов — по ПОКАЗЫВАЕМОМУ корпусу: свой борт интерактивен (клик открывает
  // мастерскую), а листая ЧУЖОЙ корпус на верфи, видим ЕГО раскладку слотов (сколько чего
  // и что пусто) в выбранной сборке — но только на просмотр, оснащать чужой корабль нельзя.
  const shownLoadout = docked && !owned ? previewLoadout : player.loadout
  const slots = buildSlots(shownLoadout)
  // Свой борт интерактивен всегда: в полёте — переставить своё железо из трюма, у причала — верфь.
  const slotsInteractive = owned
  const openSlot = slotsInteractive ? slots.find((s) => s.key === openKey) ?? null : null
  // Покупка корпуса идёт через модалку подтверждения: там зачёт старого, доплата и
  // предупреждение о перегрузе. Пролистнул каталог — модалку гасим.
  const [buyingHull, setBuyingHull] = useState(false)
  const cycle = (d: number) => {
    setBrowseIdx((i) => (i + d + offers.length) % offers.length)
    setBuyingHull(false)
    setOpenKey(null) // открытый слот своего борта не должен «переехать» на чужой корпус
  }

  // МАСТЕРСКАЯ КОРПУСА — ремонт и усиление осей — открывается кнопкой «просмотреть» под чертежом.
  // Только у своего борта на верфи: чужой корпус не чинят, а в полёте мастерской нет.
  const hullWorkshop = docked && owned
  // Правая колонка: модули или грузовой отсек — по очереди, переключателем над ней.
  const [rightTab, setRightTab] = useState<RightTab>('modules')
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
            className="cursor-pointer border px-4 py-2 text-sm tracking-[0.3em] transition-colors ui-btn"
            style={{ borderColor: ACCENT }}
          >
            {docked ? t('menu.back') : `I — ${t('ship.close')}`}
          </button>
        </div>
      )}

      {/* Пополам: слева паспорт (корабль крупно, под ним характеристики в две колонки),
          справа — оснастка плиткой. Корабль — главное на экране, ему половина ширины,
          а не узкая полоска над столбцом цифр. */}
      {/* Колонки — одной высоты (grid тянет обе), а нижние кромки панелей — на одной линии:
          характеристики прижаты к низу левой, модули растянуты до низа правой. */}
      <div className="mt-1 grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div
            // 16:9 и без подложки: корабль висит прямо на стекле панели, а под ним целиком
            // влезают характеристики и кнопка покупки. На низком окне потолок по высоте
            // экрана сжимает превью первым — характеристики важнее простора вокруг модели.
            className="relative aspect-[16/9] max-h-[39vh] w-full"
          >
            <Blueprint chassisId={shownId} />

            {/* Стрелки каталога — на самом контейнере, по бокам и по центру высоты: они
                листают то, что в нём показано, и отдельной строки под ним не заслуживают.
                Имя корпуса не дублируем — оно заголовком в карточке характеристик ниже.
                В полёте стрелок нет вовсе: корпус в пустоте не сменить. */}
            {docked && (
              <>
                <div className="absolute left-1.5 top-1/2 -translate-y-1/2">
                  <ArrowButton dir="left" onClick={() => cycle(-1)} />
                </div>
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                  <ArrowButton dir="right" onClick={() => cycle(1)} />
                </div>
              </>
            )}
            {/* Покупка с ценой — на самом чертеже, внизу по центру, над характеристиками: сперва
                смотришь, что за корпус, решаешь — и кнопка прямо под ним. На своём корпусе
                та же кнопка открывает МАСТЕРСКУЮ КОРПУСА (ремонт, усиление осей): покупать
                своё нечего, а место под чертежом — самое заметное на экране.
                Чужой корпус — модалка сделки: зачёт старого, груз-осадок, доплата. */}
            {docked && (
              <div className="absolute inset-x-0 bottom-1.5 flex justify-center">
                <button
                  type="button"
                  onClick={() => (hullWorkshop ? setHullOpen(true) : setBuyingHull(true))}
                  className="cursor-pointer border bg-black/40 px-5 py-2 text-sm tracking-[0.2em] whitespace-nowrap backdrop-blur-sm transition-colors ui-btn"
                  style={{ borderColor: ACCENT, color: ACCENT }}
                >
                  {owned ? t('ship.inspect') : tm('ship.buyHull', { price: <Money amount={offer.cost} /> })}
                </button>
              </div>
            )}
          </div>

          {/* Характеристики. У чужого корпуса — со стрелками сравнения с текущим: белая
              вверх — параметр лучше, синяя вниз — хуже. */}
          <div className="mt-auto">
          <Stats
            spec={owned ? player.spec : previewSpec}
            name={chassisName((owned ? player.loadout.chassis : offer.chassis).name)}
            baseline={docked && !owned ? player.spec : null}
            cargoUsed={usedCapacityOf(player.hold)}
            corner={
              docked && !owned ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs tracking-[0.15em]" style={{ color: ACCENT }}>
                  <input type="checkbox" checked={tryFit} onChange={(e) => setTryFit(e.target.checked)} />
                  {t('ship.tryFit')}
                </label>
              ) : null
            }
          />
          </div>


        </div>

        <div className="flex flex-col gap-3">
          {/* Правая колонка — по очереди: модули или грузовой отсек. Вместе они не влезали:
              отсек под модулями растягивал экран, и приходилось листать. Отсек здесь всегда —
              и в полёте (выбросить за борт), и у причала (продать), компонент один и тот же. */}
          <RightTabs value={rightTab} onChange={setRightTab} />
          {rightTab === 'modules' ? (
            <SlotGrid
              slots={slots}
              onOpen={setOpenKey}
              interactive={slotsInteractive}
              // У причала модули — нижняя панель колонки: тянем её до линии характеристик.
              grow={docked}
            />
          ) : (
            // Высота — не больше колонки модулей: длинный трюм прокручивается внутри, а не
            // растягивает экран (иначе характеристики слева уезжали вниз за край).
            <Hold world={world} onChange={refresh} atStation={docked} flush scrollable />
          )}
        </div>
      </div>

      {/* Модалка слота: у причала — мастерская (магазин, ремонт, улучшение), в полёте —
          перестановка своего железа (снять в трюм, поставить из трюма). */}
      {openSlot && (
        <SlotModal world={world} docked={docked} slot={openSlot} onChange={refresh} onClose={() => setOpenKey(null)} />
      )}

      {/* Мастерская корпуса по кнопке «просмотреть»: починить раму, усилить оси. */}
      {hullWorkshop && hullOpen && (
        <HullModal world={world} onChange={refresh} onClose={() => setHullOpen(false)} />
      )}

      {/* Подтверждение покупки корпуса: зачёт старого, груз-осадок, доплата, перегруз. */}
      {docked && buyingHull && !owned && (
        <HullBuyModal
          world={world}
          chassis={offer.chassis}
          onConfirm={(net, sellOverflow) => {
            if (swapHull(world, offer.chassis, net, sellOverflow) === null) {
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

type RightTab = 'modules' | 'hold'

/** Переключатель правой колонки — того же вида, что «по удалённости / по типу» на картах. */
function RightTabs({ value, onChange }: { value: RightTab; onChange: (v: RightTab) => void }) {
  return (
    <div className="flex gap-2">
      {(['modules', 'hold'] as const).map((k) => {
        const on = k === value
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            aria-current={on ? 'true' : undefined}
            className="cursor-pointer border px-3 py-1 text-xs tracking-[0.2em] transition-colors ui-btn"
            style={{ borderColor: on ? ACCENT : DIM, backgroundColor: on ? ACCENT : 'transparent', color: on ? '#000' : DIM }}
          >
            {t(k === 'modules' ? 'ship.tab.modules' : 'station.hold.title')}
          </button>
        )
      })}
    </div>
  )
}
