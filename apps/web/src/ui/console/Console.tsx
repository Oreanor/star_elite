import { useEffect, useReducer, useSyncExternalStore, type ReactNode } from 'react'
import {
  MIELOPHONE,
  contactTravelEta,
  contactWhereabouts,
  findStation,
  isBerthed,
  copilotRank,
  focusedPlanet,
  dispatcherName,
  dispatcherPersona,
  generateSystem,
  inSystem,
  livingContacts,
  stanceTo,
  type Contact,
  type Relationship,
  type ShipEntity,
  type World,
} from '@elite/sim'
import { faceOfName } from '../portrait'
import { useOnlinePlayers, type OnlinePlayer } from '../../session/net/presence'
import { t, useLang } from '../i18n'
import { currentGameDate } from '../clock'
import { chassisName, occupationName, professionName, properName } from '../i18n/dataNames'
import { ACCENT, Button, DIM, PilotPortrait } from '../station/chrome'
import { PilotIdentity } from '../station/PilotIdentity'
import { dispatcherFace } from '../dialogue/Dispatcher'
import { GLASS_PANEL, screenBackground } from '../station/backdrop'
import { Market } from '../station/Market'
import { JobsTab } from '../jobs/JobsTab'
import { ShipScreen } from '../ship/ShipScreen'
import { SystemMap } from '../map/SystemMap'
import { GalaxyMap } from '../map/GalaxyMap'
import { UniverseMap } from '../map/UniverseMap'
import { useSession } from '../../session/GameContext'
import { lastSaveFailed, subscribeSaveStatus } from '../../session/save/saveStore'
import { UI } from '../theme'
import { Locator } from '../map/Locator'
import { useBodiesRevision } from '../useBodiesRevision'
import { PlanetScreen } from '../planet/PlanetScreen'
import { Reference } from '../reference/Reference'
import { Money } from '../station/Money'

/**
 * Консоль — ОДНА стеклянная панель с вкладками, общая для причала и полёта.
 * Раньше карта, экран корабля и меню станции были тремя разными оверлеями,
 * открывавшимися поверх друг друга; теперь это вкладки одной панели, и «нажал
 * карту — открылась панель на нужной вкладке» вместо окна поверх окна.
 *
 * Разницу задаёт `docked`. У причала это мастерская: верфь (правь оснастку),
 * магазин (торгуй), груз с продажей. В полёте — приборная доска: тот же корабль
 * и груз, но только на просмотр (в пустоте не с кем торговать и негде чинить),
 * и без вкладок верфи с магазином вовсе. Карты в обоих случаях одни и те же.
 *
 * Здесь только композиция. Правила панели не знают друг о друге; мир мутируют лишь
 * через домен, а `bump` перерисовывает то, что от мира зависит (кредиты после сделки).
 */
export type ConsoleTab =
  | 'planet'
  | 'ship'
  | 'shop'
  | 'people'
  /** ДЕЛА — взятые контракты и их исход. И у причала, и в полёте. */
  | 'jobs'
  | 'locator'
  | 'system'
  | 'galaxy'
  /** МИР — вид карты вселенной: клубок галактик. Доступен всегда — цель перехода намечают заранее. */
  | 'universe'
  /** СПРАВОЧНИК — всё железо по слотам. И у причала, и в полёте: это книга, а не прилавок. */
  | 'reference'

/**
 * Вкладка КАРТА — одна кнопка в шапке, а внутри ЧЕТЫРЕ вида: локатор, система, галактика, мир.
 * Внешние адресаты (клавиши M/G, «проложить курс») по-прежнему метят конкретный вид
 * из этого набора — он и открывается активным. Первый — вид по умолчанию для кнопки.
 */
const MAP_VIEWS = ['locator', 'system', 'galaxy', 'universe'] as const
type MapView = (typeof MAP_VIEWS)[number]
const isMapView = (tab: ConsoleTab): tab is MapView => (MAP_VIEWS as readonly string[]).includes(tab)

/**
 * Какие виды карты сейчас имеют смысл. Ряд ВСЕГДА показывает все четыре — так видно, что
 * вообще бывает, — а неподходящие гаснут и не нажимаются:
 *
 *  • в комнате вселенной локатор и карта системы мерить нечего (мир вокруг спрятан);
 *  • МИР доступен всегда: клубок галактик есть и снаружи, и цель перехода удобно наметить
 *    заранее — до того, как влетишь в дыру ядра;
 *  • за масштабом (миелофон) единичная система растворилась — её карта неактивна;
 *  • вне пузыря системы (межзвёздная пустота) карты системы тоже нет: планет нет.
 */
function mapViewEnabled(view: MapView, bush: boolean, giant: boolean, charted: boolean): boolean {
  if (view === 'universe') return true
  if (bush) return view === 'galaxy'
  if (view === 'system') return !giant && charted
  return true
}

/** Что показать, если выбранный вид сейчас погашен: ближайший осмысленный сосед. */
function fallbackView(bush: boolean, giant: boolean): MapView {
  if (bush) return 'universe'
  return giant ? 'galaxy' : 'locator'
}

export function Console({
  world,
  docked,
  tab: requestedTab,
  onTab,
  onClose,
  onTalk,
  onDispatch,
  onCopilot,
  onLocate: _onLocate,
  onRoute: _onRoute,
  onChat,
  peopleRefresh = 0,
}: {
  world: World
  docked: boolean
  tab: ConsoleTab
  onTab: (tab: ConsoleTab) => void
  onClose: () => void
  onTalk: (shipId: number) => void
  onDispatch: () => void
  /** Разговор со вторым пилотом — тот же, что по P в полёте. */
  onCopilot: () => void
  onLocate?: (shipId: number) => void
  onRoute?: (systemIndex: number) => void
  onChat: (player: OnlinePlayer) => void
  peopleRefresh?: number
}) {
  useLang()
  const bushActive = useSession().bush.active
  const [, bump] = useReducer((n: number) => n + 1, 0)

  // Причал живёт и в доке — его ведёт stepWorld. Экран лишь сверяет счётчик смен и
  // перерисовывает плашки, когда состав поменялся; мир отсюда не двигается.
  useEffect(() => {
    if (!docked) return
    let seen = world.berthRevision
    const id = window.setInterval(() => {
      if (world.berthRevision === seen) return
      seen = world.berthRevision
      bump()
    }, 500)
    return () => window.clearInterval(id)
  }, [docked, world])

  // Разбитая планета исчезает и из вкладок: на старте журнал галактики приходит из сети, пока
  // консоль уже открыта на «планете».
  useBodiesRevision(world)

  const saveFailed = useSyncExternalStore(subscribeSaveStatus, lastSaveFailed)
  const station = findStation(world)
  // У причала «где я» — планета ЭТОЙ станции. Станция не на орбите (монумент «Крест») —
  // вкладки ПЛАНЕТА нет. В полёте паспорт жив только внутри пузыря мира: перелёт
  // между планетами одной системы меняет вкладку, а в межпланетной пустоте она гаснет.
  const planet = focusedPlanet(world)
  const charted = inSystem(world)
  const giant = world.player.state.scale >= MIELOPHONE.PHASE_START
  // ПЛАНЕТА — вкладка «по умолчанию» у вызывающих; без мира под бортом (пустота,
  // межпланетный перегон, галактика) и без планеты у причала на её месте — ЛЮДИ.
  const tab: ConsoleTab = requestedTab === 'planet' && !planet ? 'people' : requestedTab

  // Верфь и магазин — только у причала: в полёте оснастку не сменить и не поторговать.
  // Вкладка корабля зовётся «КОРАБЛЬ» и там, и там — это один и тот же экран; у причала
  // он лишь обрастает действиями (починить, купить, улучшить), а имя ему незачем менять.
  const tabs: { id: ConsoleTab; label: string; active?: boolean; disabled?: boolean }[] = [
    // У причала первая вкладка — СТАНЦИЯ (шапка места + кто пристыкован); в полёте
    // станции под тобой нет, и та же вкладка показывает паспорт мира — ПЛАНЕТА.
    // Вне пузыря мира вкладка остаётся, но гаснет: иначе «пропала» и непонятно, куда делась.
    ...(docked
      ? planet
        ? [{ id: 'planet' as const, label: t('station.nav.planet') }]
        : []
      : [{ id: 'planet' as const, label: t('station.nav.planet'), disabled: !planet }]),
    // ЛЮДИ — сразу за местом: кто здесь и с кем связаться. Есть и у причала, и в полёте.
    // У причала вкладка — про СТАНЦИЮ: кто здесь, диспетчер, Слово. В полёте станции под
    // тобой нет, и там это знакомые и игроки онлайн — ЛЮДИ.
    { id: 'people', label: t('station.nav.comms') },
    // ДЕЛА — рядом с людьми: дело всегда от кого-то из них.
    { id: 'jobs', label: t('station.nav.jobs') },
    // КОРАБЛЬ — и твой борт, и витрина корпусов: у причала под моделью стрелки листают
    // каталог и кнопка покупки. Отдельной «ВЕРФИ» больше нет.
    { id: 'ship', label: t('ship.title') },
    ...(docked ? [{ id: 'shop' as const, label: t('station.nav.shop') }] : []),
    // ГРУЗ отдельной вкладкой больше не живёт: трюм — плашка под модулями во вкладке
    // КОРАБЛЬ (в полёте) и рядом со списком в МАГАЗИНЕ (у причала).
    // КАРТА — одна кнопка на ЧЕТЫРЕ вида (локатор/система/галактика/мир). Подсвечена, пока
    // открыт любой из них; клик ведёт на первый осмысленный в текущей обстановке.
    {
      id: fallbackView(bushActive, giant),
      label: t('station.nav.map'),
      active: isMapView(tab),
    },
  ]

  return (
    <div
      className={`absolute inset-0 flex items-center justify-center ${docked ? '' : 'backdrop-blur-md'}`}
      // У причала фон НЕПРОЗРАЧНЫЙ: ты внутри станции, космос и собственный корабль
      // просвечивать сквозь экран не должны. В полёте же вкладка (карта, трюм) — оверлей
      // поверх боя, и там полупрозрачность с блюром уместна: мир под ней продолжает жить.
      // У причала фон — снимок станции по тех-уровню; в полёте тёмное стекло поверх боя.
      // Единый источник с окном разговора и модалками: `screenBackground`.
      style={{ background: screenBackground(world, docked) }}
    >
      <div
        className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-w-6xl flex-col rounded-2xl border p-7 font-mono"
        style={{ ...GLASS_PANEL, color: ACCENT }}
      >
        {/* Заголовок модалки — ПРИЧАЛ, где стоим: имя станции и в скобках «планета …».
            В полёте причала нет — тогда пишем хотя бы систему, чтобы шапка не пустовала.
            Планета подробнее показана в первой вкладке. */}
        <div className="flex items-center justify-between gap-6">
            <h1 className="min-w-0 text-xl uppercase tracking-title">
              {docked && station
                ? planet
                  ? t('station.atPlanet', { station: properName(station.name), planet: properName(planet.name) })
                  : t('station.atSystem', { station: properName(station.name), system: properName(world.systemName) })
                : `${t('station.system')}: ${properName(world.systemName).toUpperCase()}`}
            </h1>
          <div className="ml-auto flex shrink-0 items-center gap-8">
            <div
              className="flex items-center gap-5 rounded-lg border px-4 py-2 text-sm tracking-meta"
              style={{ borderColor: DIM, color: DIM, background: 'rgba(8,22,42,0.75)' }}
            >
              {/* Дата мира — общий календарь для всех игроков (`worldClock`). */}
              {saveFailed && (
                <span className="whitespace-nowrap font-semibold" style={{ color: UI.DANGER }}>
                  {t('station.saveFailed')}
                </span>
              )}
              <span className="whitespace-nowrap">{currentGameDate()}</span>
              <span className="whitespace-nowrap border-l pl-5 font-semibold" style={{ borderColor: DIM, color: '#d9f3ff' }}>
                <Money amount={world.credits} />
              </span>
            </div>
            <Button small onClick={onClose}>
              {docked ? <>{t('station.undock')} <span aria-hidden="true">→</span></> : t('ship.close')}
            </Button>
          </div>
        </div>

        <nav className="mt-4 flex flex-wrap gap-2" style={{ boxShadow: `inset 0 -1px 0 ${DIM}` }}>
          {tabs.map((item) => {
            const on = item.active ?? item.id === tab
            const disabled = !!item.disabled
            return (
              <button
                key={item.id}
                type="button"
                // КАРТА, уже открытая, не сбрасывает выбранный вид: клик по ней остаётся на нём.
                onClick={disabled ? undefined : () => onTab(item.active ? tab : item.id)}
                disabled={disabled}
                aria-current={on ? 'page' : undefined}
                className="border px-5 py-2 text-xs tracking-label transition-colors disabled:cursor-not-allowed enabled:cursor-pointer ui-btn"
                style={{
                  borderColor: on ? ACCENT : DIM,
                  backgroundColor: on ? ACCENT : 'transparent',
                  color: on ? '#000' : DIM,
                  opacity: disabled ? 0.35 : 1,
                }}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Содержимое вкладки скроллится внутри панели — длинный список не распирает её. */}
        <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
          {/* ПЛАНЕТА — одна и та же и у причала, и в полёте: станция не отдельная сущность
              для пилота, а постройка на орбите этого мира. Паспортов-таблиц больше нет. */}
          {tab === 'planet' && <PlanetScreen world={world} planet={planet} />}
          {tab === 'ship' && <ShipScreen world={world} docked={docked} embedded onChange={bump} onClose={() => onTab('planet')} />}
          {tab === 'shop' && docked && <Market world={world} onChange={bump} />}
          {tab === 'reference' && <Reference />}
          {tab === 'jobs' && <JobsTab world={world} />}
          {tab === 'people' && (
            <PeopleTab key={peopleRefresh} world={world} docked={docked} onTalk={onTalk} onDispatch={onDispatch} onCopilot={onCopilot} onChat={onChat} />
          )}
          {isMapView(tab) && (() => {
            // Выбранный вид мог погаснуть от обстановки (влетел в комнату, вырос миелофоном) —
            // тогда показываем ближайший осмысленный, а кнопка гаснет.
            const view: MapView = mapViewEnabled(tab, bushActive, giant, charted)
              ? tab
              : fallbackView(bushActive, giant)
            return (
            // Карта прокруткой не пользуется — она сама вписана в панель. `overflow-hidden`
            // отрезает её от общего скролла вкладок: иначе драг по полю иногда «пробивал»
            // вертикальную прокрутку консоли, и карта уезжала под шапку.
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="mb-4 flex gap-2">
                {MAP_VIEWS.map((v) => {
                  const on = v === view
                  const disabled = !mapViewEnabled(v, bushActive, giant, charted)
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={disabled ? undefined : () => onTab(v)}
                      disabled={disabled}
                      aria-current={on ? 'page' : undefined}
                      className="border px-3 py-1 text-xs tracking-label transition-colors disabled:cursor-not-allowed enabled:cursor-pointer ui-btn"
                      style={{
                        borderColor: on ? ACCENT : DIM,
                        backgroundColor: on ? ACCENT : 'transparent',
                        color: on ? '#000' : DIM,
                        opacity: disabled ? 0.35 : 1,
                      }}
                    >
                      {t(`map.view.${v}` as 'map.view.locator')}
                    </button>
                  )
                })}
              </div>
              {view === 'locator' && <Locator world={world} />}
              {view === 'system' && <SystemMap world={world} embedded onClose={() => onTab('planet')} />}
              {/* onClose у карты галактики срабатывает только при старте прыжка — тогда
                  консоль закрывается целиком и мир оживает под кино, а не переходит на вкладку. */}
              {view === 'galaxy' && <GalaxyMap embedded onClose={onClose} />}
              {view === 'universe' && <UniverseMap onClose={onClose} />}
            </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

/**
 * Сетка карточек людей — ОДНА на все списки вкладки: равная ширина, во всю ширину панели,
 * по три в ряд, на узком экране по две. Прежде карточки тянулись по содержимому и стояли
 * лесенкой.
 */
const CARD_GRID = 'mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3'

/**
 * Карточка человека: в рамке тот же паспорт, что в шапке разговора (`PilotIdentity`),
 * плюс где он сейчас и кнопка «Связаться».
 */
function PersonPlaque({
  name,
  role,
  craft,
  stance,
  note,
  portrait,
  onTalk,
}: {
  name: string
  role?: string
  craft?: string
  /** Как он к тебе относится. Нет — не показываем вовсе (напр. живой игрок). */
  stance?: Relationship
  /** Где он: система, причал, «отошёл». */
  note?: string
  portrait: ReactNode
  onTalk?: () => void
}) {
  return (
    <div className="border p-3" style={{ borderColor: DIM, color: ACCENT }}>
      <PilotIdentity portrait={portrait} name={name} role={role} craft={craft} stance={stance}>
        {note || onTalk ? (
          <div className="min-w-0">
            {note ? (
              <div className="truncate text-xs leading-4" style={{ color: DIM }}>
                {note}
              </div>
            ) : null}
            {onTalk ? (
              <Button small onClick={onTalk}>
                {t('people.talk')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </PilotIdentity>
    </div>
  )
}

/** Знакомые, чей борт уже в «Пристыкованы», ниже не повторяем. */
function contactsExceptDocked(contacts: Contact[], dockedHere: ShipEntity[]): Contact[] {
  const shipIds = new Set(dockedHere.map((s) => s.id))
  const recordIds = new Set(dockedHere.map((s) => s.acquaintanceId).filter((id): id is number => id != null))
  return contacts.filter((c) => {
    if (c.ship && shipIds.has(c.ship.id)) return false
    if (recordIds.has(c.record.id)) return false
    return true
  })
}

/**
 * ЛЮДИ — реестр живых знакомых: где каждый и как с ним связаться. Со знакомыми нет
 * случайных встреч, их положение известно всегда с точностью до системы; кто в ТВОЕЙ
 * системе — тот на радаре, к нему можно навестись и заговорить. Кто в другой — тому
 * прокладываешь курс или зовёшь к себе. Список живой: погиб знакомый — уходит отсюда,
 * а весть о пропаже приходит на HUD.
 */
function PeopleTab({
  world,
  docked,
  onTalk,
  onDispatch,
  onCopilot,
  onChat,
}: {
  world: World
  docked: boolean
  onTalk: (shipId: number) => void
  onDispatch: () => void
  onCopilot: () => void
  onChat: (player: OnlinePlayer) => void
}) {
  const dockedHere = docked ? dockedPilots(world).slice(1).filter((s) => s.alive) : []
  // Слово — особый бог на Кресте: ВНЕ категорий (не «пристыкованный», не «знакомый»), но
  // на этой станции виден ВСЕГДА. Из «знакомых» исключаем, чтобы не задвоить после разговора.
  const slovo = docked ? world.ships.find((s) => s.alive && s.divine) : undefined
  const station = docked ? findStation(world) : null
  const dispatcher = station ? dispatcherPersona(world, station) : null
  const copilot = world.copilot
  // Второй пилот — у тебя в кабине: своей карточкой сверху, не среди знакомых «где-то там».
  const contacts = contactsExceptDocked(livingContacts(world), dockedHere).filter(
    (c) => !c.ship?.divine && c.record.id !== copilot?.acquaintanceId,
  )

  return (
    <div>
      {copilot && (
        <div className="mb-6">
          <h2 className="text-sm uppercase tracking-title">{t('copilot.title')}</h2>
          <div className={CARD_GRID}>
            <PersonPlaque
              name={properName(copilot.name)}
              role={t('copilot.title')}
              craft={t('copilot.rank', { rank: copilotRank(copilot) })}
              portrait={<PilotPortrait species={copilot.persona.species} face={faceOfName(copilot.name)} size={108} />}
              onTalk={onCopilot}
            />
          </div>
        </div>
      )}
      {/* У причала — кто СЕЙЧАС здесь, одной строкой без категорий: Слово (бог на Кресте) и
          пристыкованные борта. Себя не показываем. Пусто — так и говорим: борта заходят со
          временем, а пока стоишь в доке, мир на паузе. */}
      {docked && (
        <div>
          <h2 className="text-sm uppercase tracking-title">{t('people.atStation')}</h2>
          {slovo || dockedHere.length > 0 ? (
            <div className={CARD_GRID}>
              {station && dispatcher && (
                <PersonPlaque
                  name={dispatcherName(world, station)}
                  role={t('people.dispatcher')}
                  craft={properName(station.name)}
                  portrait={<PilotPortrait species={dispatcher.species} face={dispatcherFace(station.name)} size={108} />}
                  onTalk={onDispatch}
                />
              )}
              {slovo && <DockPlaque ship={slovo} you={false} world={world} onTalk={onTalk} />}
              {dockedHere.map((p) => (
                <DockPlaque key={p.id} ship={p} you={false} world={world} onTalk={onTalk} />
              ))}
            </div>
          ) : station ? (
            <div className={CARD_GRID}>
              <PersonPlaque
                name={dispatcherName(world, station)}
                role={t('people.dispatcher')}
                craft={properName(station.name)}
                portrait={<PilotPortrait species={dispatcherPersona(world, station).species} face={dispatcherFace(station.name)} size={108} />}
                onTalk={onDispatch}
              />
            </div>
          ) : (
            <p className="mt-2 text-sm" style={{ color: DIM }}>{t('people.docked.empty')}</p>
          )}
        </div>
      )}

      {/* Живые игроки онлайн — отдельным блоком. Пусто в офлайне. */}
      <OnlineList onChat={onChat} />

      {/* ЗНАКОМЫЕ — с кем говорил и кто ещё жив, где бы ни были. */}
      {contacts.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm uppercase tracking-title" style={{ color: ACCENT }}>
            {t('people.acquaintances')}
          </h2>
          <p className="mt-1 text-xs tracking-meta" style={{ color: DIM }}>
            {t('people.subtitle')}
          </p>
          <div className={CARD_GRID}>
            {contacts.map((c) => (
              <ContactPlaque key={c.record.id} world={world} contact={c} onTalk={onTalk} />
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

/**
 * Живые игроки в сети (presence): кто онлайн, в какой системе и где стоит. Связаться
 * можно с любым — окно то же, что с ботами. Пусто в офлайне: список приходит из RTDB.
 */
function OnlineList({ onChat }: { onChat: (player: OnlinePlayer) => void }) {
  const players = useOnlinePlayers()
  if (players.length === 0) return null

  return (
    <div className="mt-6">
      <h2 className="text-sm uppercase tracking-title" style={{ color: ACCENT }}>
        {t('people.online')}
      </h2>
      <div className={CARD_GRID}>
        {players.map((p) => {
          const where = p.place
            ? t('people.online.dock', { place: properName(p.place), sys: properName(p.systemName) })
            : t('people.online.sys', { sys: properName(p.systemName) })
          return (
            <PersonPlaque
              key={p.uid}
              name={p.name}
              role={professionName(p.profession)}
              note={p.paused ? t('people.online.paused') : where}
              portrait={
                <PilotPortrait species={p.species} face={p.face} muted={p.paused} size={108} />
              }
              onTalk={() => onChat(p)}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Знакомый — та же плашка, что у причала; связь только если он рядом. */
function ContactPlaque({
  world,
  contact,
  onTalk,
}: {
  world: World
  contact: Contact
  onTalk: (shipId: number) => void
}) {
  const { record, ship } = contact
  const where = contactWhereabouts(world, contact)
  const place = where.place ? properName(where.place) : null
  const system = properName(where.systemName)
  const eta = !where.present ? contactTravelEta(record, world.galaxySeed) : null
  const locationLine = where.present
    ? [
        place ? (where.docked ? t('people.at.dock', { place }) : t('people.at.near', { place })) : t('people.at.here'),
        ship ? t('people.km', { n: Math.round(ship.state.pos.distanceTo(world.player.state.pos) / 1000) }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : [
        system,
        place ? (where.docked ? t('people.at.dock', { place }) : t('people.at.near', { place })) : null,
        record.boundFor != null
          ? t('people.bound', {
              system: properName(generateSystem(record.boundFor, world.galaxySeed).name),
            })
          : null,
        eta != null ? t('people.eta', { hops: eta }) : null,
      ]
        .filter(Boolean)
        .join(' · ')

  const role = ship
    ? ship.persona.profession
      ? professionName(ship.persona.profession)
      : occupationName(ship.originKind, ship.faction)
    : undefined

  return (
    <PersonPlaque
      name={record.name}
      role={role}
      // Отношение берём у ЖИВОГО борта (`stanceTo` учитывает и фракцию: свежий пират враждебен
      // и без записи). Борта рядом нет — показываем, чем кончилось знакомство по журналу.
      stance={ship ? stanceTo(world, ship) : record.relationship}
      craft={ship ? chassisName(ship.loadout.chassis.name) : undefined}
      // Где он — только когда борта рядом нет: рядом он и так на радаре, а вдали это главное.
      note={ship ? undefined : locationLine}
      portrait={
        ship ? (
          <PilotPortrait ship={ship} world={world} emotion="neutral" size={108} />
        ) : (
          <PilotPortrait name={record.name} size={108} />
        )
      }
      onTalk={where.present && ship ? () => onTalk(ship.id) : undefined}
    />
  )
}

/** Плашка пилота у причала. */
function DockPlaque({ ship, you, world, onTalk }: { ship: ShipEntity; you: boolean; world: World; onTalk: (id: number) => void }) {
  return (
    <PersonPlaque
      name={ship.pilotName}
      role={`${you ? professionName(ship.persona.profession) : occupationName(ship.originKind, ship.faction)} · ${t('copilot.rank', { rank: ship.rank })}`}
      // У СЕБЯ отношения нет — не показываем: «ты нейтрален к себе» это шум, а не сведения.
      stance={you ? undefined : stanceTo(world, ship)}
      // У бога тоже корабль — его ладья; в шапке разговора она указана, и здесь так же.
      craft={chassisName(ship.loadout.chassis.name)}
      portrait={<PilotPortrait ship={ship} emotion="neutral" size={108} />}
      onTalk={you ? undefined : () => onTalk(ship.id)}
    />
  )
}

/**
 * Кто сейчас пристыкован. Игрок — всегда первым (он же и стоит у причала), следом
 * НАСТОЯЩИЕ борта из мира, что стоят у причала (`isBerthed`). Подлетающих сюда не берём:
 * они ещё в космосе, видны на локаторе за километры, а мир в доке заморожен — «зайти»
 * они так и не успеют. Это не выдуманный список: улетит пилот — исчезнет и плашка.
 */
function dockedPilots(world: World): ShipEntity[] {
  const here = world.ships.filter((s) => s.alive && isBerthed(s))
  return [world.player, ...here]
}
