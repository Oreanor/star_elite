import { useEffect, useReducer, type ReactNode } from 'react'
import {
  MIELOPHONE,
  contactTravelEta,
  contactWhereabouts,
  findStation,
  generateSystem,
  livingContacts,
  localSettlement,
  stepDockTraffic,
  stanceTo,
  type BodyEntity,
  type Contact,
  type Relationship,
  type ShipEntity,
  type World,
} from '@elite/sim'
import { useOnlinePlayers, type OnlinePlayer } from '../../app/net/presence'
import { currentLang, t, useLang, type Key } from '../i18n'
import { UI } from '../theme'
import { currentGameDate } from '../clock'
import { chassisName, economyName, governmentName, occupationName, professionName, properName, speciesName } from '../i18n/dataNames'
import { ACCENT, Button, Column, DIM, PilotPortrait, Table } from '../station/chrome'
import { GLASS_PANEL, screenBackground } from '../station/backdrop'
import { Hold } from '../station/Hold'
import { Market } from '../station/Market'
import { ShipScreen } from '../ship/ShipScreen'
import { SystemMap } from '../map/SystemMap'
import { GalaxyMap } from '../map/GalaxyMap'
import { UniverseMap } from '../map/UniverseMap'
import { useSession } from '../../app/GameContext'
import { Locator } from '../map/Locator'

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
  | 'cargo'
  | 'people'
  | 'locator'
  | 'system'
  | 'galaxy'
  /** МИР — вид карты вселенной. Только в комнате: снаружи ты внутри галактики, а не между ними. */
  | 'universe'

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
 *  • снаружи, наоборот, нечего показывать МИРУ: ты внутри галактики, а не между ними;
 *  • за масштабом (миелофон) единичная система растворилась — её карта неактивна.
 */
function mapViewEnabled(view: MapView, bush: boolean, giant: boolean): boolean {
  if (bush) return view === 'galaxy' || view === 'universe'
  if (view === 'universe') return false
  return !(view === 'system' && giant)
}

/** Что показать, если выбранный вид сейчас погашен: ближайший осмысленный сосед. */
function fallbackView(bush: boolean, giant: boolean): MapView {
  if (bush) return 'universe'
  return giant ? 'galaxy' : 'locator'
}

export function Console({
  world,
  docked,
  tab,
  onTab,
  onClose,
  onTalk,
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
  onLocate?: (shipId: number) => void
  onRoute?: (systemIndex: number) => void
  onChat: (player: OnlinePlayer) => void
  peopleRefresh?: number
}) {
  useLang()
  const bushActive = useSession().bush.active
  const [, bump] = useReducer((n: number) => n + 1, 0)

  // Причал не застывает, пока сидишь в доке: мир на паузе, поэтому смену лиц у причала
  // ведём отдельным тиком по реальному времени. Изменился состав — перерисовываем плашки.
  useEffect(() => {
    if (!docked) return
    const dt = 2 // с реального времени между попытками
    const id = window.setInterval(() => {
      if (stepDockTraffic(world, dt).changed) bump()
    }, dt * 1000)
    return () => window.clearInterval(id)
  }, [docked, world])

  const station = findStation(world)
  const planet = capitalWorld(world)

  // Верфь и магазин — только у причала: в полёте оснастку не сменить и не поторговать.
  // Вкладка корабля зовётся «КОРАБЛЬ» и там, и там — это один и тот же экран; у причала
  // он лишь обрастает действиями (починить, купить, улучшить), а имя ему незачем менять.
  const tabs: { id: ConsoleTab; label: string; active?: boolean }[] = [
    // У причала первая вкладка — СТАНЦИЯ (шапка места + кто пристыкован); в полёте
    // станции под тобой нет, и та же вкладка показывает паспорт мира — ПЛАНЕТА.
    { id: 'planet', label: docked ? t('station.nav.station') : t('station.nav.planet') },
    // КОРАБЛЬ — и твой борт, и витрина корпусов: у причала под моделью стрелки листают
    // каталог и кнопка покупки. Отдельной «ВЕРФИ» больше нет.
    { id: 'ship', label: t('ship.title') },
    ...(docked ? [{ id: 'shop' as const, label: t('station.nav.shop') }] : []),
    { id: 'cargo', label: t('station.nav.cargo') },
    // ЛЮДИ — знакомые пилоты: где они и как с ними связаться. Есть и у причала, и в полёте.
    { id: 'people', label: t('station.nav.people') },
    // КАРТА — одна кнопка на ЧЕТЫРЕ вида (локатор/система/галактика/мир). Подсвечена, пока
    // открыт любой из них; клик ведёт на первый осмысленный в текущей обстановке.
    {
      id: fallbackView(bushActive, world.player.state.scale >= MIELOPHONE.PHASE_START),
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
        {/* Заголовок модалки — ПРИЧАЛ, где стоим: имя станции и в скобках её планета.
            В полёте причала нет — тогда пишем хотя бы систему, чтобы шапка не пустовала.
            Кредиты и паспорт мира — не сюда: деньги у корабля, планета — в первой вкладке. */}
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-xl tracking-[0.3em]">
              {docked && station
                ? `${properName(station.name)}${planet ? ` (${properName(planet.name)})` : ''}`
                : `${t('station.system')}: ${properName(world.systemName).toUpperCase()}`}
            </h1>
            {/* Дата мира — общий календарь для всех игроков (`worldClock`). */}
            <p className="mt-1 text-sm tracking-widest" style={{ color: DIM }}>
              {currentGameDate()}
            </p>
          </div>
          {/* Кошелёк — единожды и на виду: слева от выхода, а не в каждой вкладке. */}
          <div className="flex items-center gap-4">
            <span className="whitespace-nowrap text-sm tracking-widest" style={{ color: DIM }}>
              {t('station.credits')} {world.credits.toLocaleString(currentLang() === 'ru' ? 'ru' : 'en-US')}
            </span>
            <Button small onClick={onClose}>
              {docked ? t('station.undock') : t('ship.close')}
            </Button>
          </div>
        </div>

        <nav className="mt-4 flex flex-wrap gap-2">
          {tabs.map((item) => {
            const on = item.active ?? item.id === tab
            return (
              <button
                key={item.id}
                type="button"
                // КАРТА, уже открытая, не сбрасывает выбранный вид: клик по ней остаётся на нём.
                onClick={() => onTab(item.active ? tab : item.id)}
                aria-current={on ? 'page' : undefined}
                className="cursor-pointer border px-5 py-2 text-xs tracking-[0.25em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
                style={{
                  borderColor: on ? ACCENT : DIM,
                  backgroundColor: on ? ACCENT : 'transparent',
                  color: on ? '#000' : DIM,
                }}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Содержимое вкладки скроллится внутри панели — длинный список не распирает её. */}
        <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
          {tab === 'planet' &&
            (docked ? (
              <StationReadout world={world} station={station} planet={planet} />
            ) : (
              <LocationReadout world={world} planet={planet} />
            ))}
          {tab === 'ship' && <ShipScreen world={world} docked={docked} embedded onChange={bump} onClose={() => onTab('planet')} />}
          {tab === 'shop' && docked && <Market world={world} onChange={bump} />}
          {tab === 'cargo' && <Hold world={world} onChange={bump} atStation={docked} />}
          {tab === 'people' && (
            <PeopleTab key={peopleRefresh} world={world} docked={docked} onTalk={onTalk} onChat={onChat} />
          )}
          {isMapView(tab) && (() => {
            // Выбранный вид мог погаснуть от обстановки (влетел в комнату, вырос миелофоном) —
            // тогда показываем ближайший осмысленный, а кнопка гаснет.
            const giant = world.player.state.scale >= MIELOPHONE.PHASE_START
            const view: MapView = mapViewEnabled(tab, bushActive, giant)
              ? tab
              : fallbackView(bushActive, giant)
            return (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-4 flex gap-2">
                {MAP_VIEWS.map((v) => {
                  const on = v === view
                  const disabled = !mapViewEnabled(v, bushActive, giant)
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={disabled ? undefined : () => onTab(v)}
                      disabled={disabled}
                      aria-current={on ? 'page' : undefined}
                      className="border px-4 py-1.5 text-xs tracking-[0.25em] transition-colors disabled:cursor-not-allowed enabled:cursor-pointer enabled:hover:bg-[#7fd6ff] enabled:hover:text-black"
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

interface Fact {
  key: string
  label: string
  value: string
}

/** Единая плашка человека: портрет слева, справа имя/роль/деталь и кнопка «Связаться». */
/**
 * ОТНОШЕНИЕ словом и цветом. Ключи и слова — ТЕ ЖЕ, что в шапке диалога и на метках
 * кабины: враг красный, друг зелёный, нейтрал погашенный. Фосфор UI — хром, не «друг».
 */
const STANCE_KEY: Record<Relationship, Key> = {
  friendly: 'dialogue.stance.friendly',
  neutral: 'dialogue.stance.neutral',
  hostile: 'dialogue.stance.hostile',
}
const STANCE_COLOR: Record<Relationship, string> = {
  friendly: UI.ALLY,
  neutral: DIM,
  hostile: UI.DANGER,
}

function PersonPlaque({
  name,
  roleLine,
  stance,
  detailLine,
  portrait,
  onTalk,
}: {
  name: string
  roleLine?: string
  /** Как он к тебе относится. Нет — не показываем строку вовсе (напр. это ты сам). */
  stance?: Relationship
  detailLine?: string
  portrait: ReactNode
  onTalk?: () => void
}) {
  return (
    <div className="flex items-center gap-3 border px-3 py-2" style={{ borderColor: DIM, minWidth: '15rem' }}>
      {portrait}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm tracking-widest" style={{ color: ACCENT }}>
          {name}
        </div>
        {stance ? (
          <div className="truncate text-xs tracking-widest" style={{ color: STANCE_COLOR[stance] }}>
            {t(STANCE_KEY[stance])}
          </div>
        ) : null}
        {roleLine ? (
          <div className="truncate text-xs tracking-widest" style={{ color: DIM }}>
            {roleLine}
          </div>
        ) : null}
        {detailLine ? (
          <div className="truncate text-xs" style={{ color: DIM }}>
            {detailLine}
          </div>
        ) : null}
        {onTalk ? (
          <div className="mt-1">
            <Button small onClick={onTalk}>
              {t('people.talk')}
            </Button>
          </div>
        ) : null}
      </div>
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
  onChat,
}: {
  world: World
  docked: boolean
  onTalk: (shipId: number) => void
  onChat: (player: OnlinePlayer) => void
}) {
  const dockedHere = docked ? dockedPilots(world).slice(1).filter((s) => s.alive) : []
  // Слово — особый бог на Кресте: ВНЕ категорий (не «пристыкованный», не «знакомый»), но
  // на этой станции виден ВСЕГДА. Из «знакомых» исключаем, чтобы не задвоить после разговора.
  const slovo = docked ? world.ships.find((s) => s.alive && s.divine) : undefined
  const contacts = contactsExceptDocked(livingContacts(world), dockedHere).filter((c) => !c.ship?.divine)

  return (
    <div>
      <h1 className="text-2xl tracking-[0.2em]">{t('people.title')}</h1>

      {/* СЛОВО — бог на Кресте. Вне категорий: отдельная плашка над списками, всегда, пока ты
          на этой станции. Не «пристыкованный» и не «знакомый» (знакомым станет, когда заговоришь). */}
      {slovo && (
        <div className="mt-4 flex flex-wrap gap-3">
          <DockPlaque ship={slovo} you={false} world={world} onTalk={onTalk} />
        </div>
      )}

      {/* ПРИСТЫКОВАНЫ — кто физически здесь, у причала: к ним можно подойти и заговорить.
          Могут быть и вовсе незнакомцы. Себя не показываем — свою плашку видеть незачем.
          У причала показываем всегда (даже пустой): пусто в начале — борта заходят со
          временем, а пока стоишь в доке мир на паузе, так что причал наполнится по возврате. */}
      {docked && (
        <div className="mt-6">
          <h2 className="text-sm tracking-[0.3em]" style={{ color: ACCENT }}>
            {t('people.docked')}
          </h2>
          {dockedHere.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-3">
              {dockedHere.map((p) => (
                <DockPlaque key={p.id} ship={p} you={false} world={world} onTalk={onTalk} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm" style={{ color: DIM }}>
              {t('people.docked.empty')}
            </p>
          )}
        </div>
      )}

      {/* Живые игроки онлайн — отдельным блоком. Пусто в офлайне. */}
      <OnlineList onChat={onChat} />

      {/* ЗНАКОМЫЕ — с кем говорил и кто ещё жив, где бы ни были. */}
      {contacts.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm tracking-[0.3em]" style={{ color: ACCENT }}>
            {t('people.acquaintances')}
          </h2>
          <p className="mt-1 text-xs tracking-widest" style={{ color: DIM }}>
            {t('people.subtitle')}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
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
      <h2 className="text-sm tracking-[0.3em]" style={{ color: ACCENT }}>
        {t('people.online')}
      </h2>
      <div className="mt-3 flex flex-wrap gap-3">
        {players.map((p) => {
          const where = p.place
            ? t('people.online.dock', { place: p.place, sys: p.systemName })
            : t('people.online.sys', { sys: p.systemName })
          return (
            <PersonPlaque
              key={p.uid}
              name={p.name}
              roleLine={professionName(p.profession).toUpperCase()}
              detailLine={p.paused ? t('people.online.paused') : where}
              portrait={
                <PilotPortrait species={p.species} face={p.face} muted={p.paused} size={96} />
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

  const roleLine = ship
    ? (ship.persona.profession
        ? professionName(ship.persona.profession)
        : occupationName(ship.originKind, ship.faction)
      ).toUpperCase()
    : ''

  const detailLine = ship ? chassisName(ship.loadout.chassis.name) : locationLine

  return (
    <PersonPlaque
      name={record.name}
      roleLine={roleLine}
      // Отношение берём у ЖИВОГО борта (`stanceTo` учитывает и фракцию: свежий пират враждебен
      // и без записи). Борта рядом нет — показываем, чем кончилось знакомство по журналу.
      stance={ship ? stanceTo(world, ship) : record.relationship}
      detailLine={detailLine}
      portrait={
        ship ? (
          <PilotPortrait ship={ship} world={world} emotion="neutral" size={96} />
        ) : (
          <PilotPortrait name={record.name} size={96} />
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
      roleLine={(you ? professionName(ship.persona.profession) : occupationName(ship.originKind, ship.faction)).toUpperCase()}
      // У СЕБЯ отношения нет — не показываем: «ты нейтрален к себе» это шум, а не сведения.
      stance={you ? undefined : stanceTo(world, ship)}
      // У бога корабля нет — вместо марки корпуса пусто: его строка «БОГ» уже всё сказала.
      detailLine={ship.divine ? '' : chassisName(ship.loadout.chassis.name)}
      portrait={<PilotPortrait ship={ship} emotion="neutral" size={96} />}
      onTalk={you ? undefined : () => onTalk(ship.id)}
    />
  )
}

/** Столица системы — самое населённое тело; к ней привязаны и рынок, и причал. */
function capitalWorld(world: World): BodyEntity | null {
  let best: BodyEntity | null = null
  for (const b of world.bodies) {
    if (b.population > 0 && (!best || b.population > best.population)) best = b
  }
  return best
}

/**
 * Паспорт МИРА, а не станции: заголовком — планета, под ней мельче её система, ниже
 * без рамки — строй, экономика, тех-уровень, население. Имя причала сюда не идёт: оно
 * ушло в заголовок модалки. Экономику и строй переводит слой данных.
 */
function LocationReadout({ world, planet }: { world: World; planet: BodyEntity | null }) {
  const s = localSettlement(world)
  const population = Math.round(s.population * 10) / 10

  const rows: Fact[] = [
    { key: 'government', label: t('station.government'), value: governmentName(s.government) },
    { key: 'economy', label: t('station.economy'), value: economyName(s.economy) },
    { key: 'tech', label: t('station.tech'), value: String(s.techLevel) },
    { key: 'population', label: t('station.population'), value: t('station.popUnit', { n: population }) },
    { key: 'species', label: t('station.species'), value: speciesName(s.species) },
  ]

  const columns: Column<Fact>[] = [
    { key: 'label', header: '', width: '9rem', cell: (r) => <span style={{ color: DIM }}>{r.label}</span> },
    { key: 'value', header: '', cell: (r) => r.value },
  ]

  return (
    <div>
      <h1 className="text-2xl tracking-[0.2em]">{properName(planet ? planet.name : world.systemName)}</h1>
      <p className="mt-1 text-xs tracking-widest" style={{ color: DIM }}>
        {t('station.system')} {properName(world.systemName).toUpperCase()}
      </p>
      <div className="mt-6 max-w-md text-sm">
        <Table columns={columns} rows={rows} rowKey={(r) => r.key} />
      </div>
    </div>
  )
}

/** Двухколоночная раскладка «подпись → значение» для шапки паспорта. */
const FACT_COLUMNS: Column<Fact>[] = [
  { key: 'label', header: '', width: '9rem', cell: (r) => <span style={{ color: DIM }}>{r.label}</span> },
  { key: 'value', header: '', cell: (r) => r.value },
]

/**
 * Кто сейчас пристыкован. Игрок — всегда первым (он же и стоит у причала), следом
 * НАСТОЯЩИЕ борта из мира, что заняли причал или заходят на него (`dock` берётся из
 * их ИИ). Это не выдуманный список: пока игрок в доке, мир заморожен, и роль-плашки
 * показывают ровно тех, кто был у причала в этот миг. Улетит пилот — исчезнет и плашка.
 */
function dockedPilots(world: World): ShipEntity[] {
  const here = world.ships.filter((s) => s.alive && (s.ai?.dock === 'berthed' || s.ai?.dock === 'inbound'))
  return [world.player, ...here]
}

/**
 * Паспорт СТАНЦИИ у причала: заголовком её имя, ниже строки «станция / планета /
 * система» и далее строй-экономика-население, а под ними плашки пристыкованных
 * пилотов с местом под портрет. В полёте вместо этого — паспорт мира (`LocationReadout`).
 */
function StationReadout({
  world,
  station,
  planet,
}: {
  world: World
  station: BodyEntity | null
  planet: BodyEntity | null
}) {
  const s = localSettlement(world)
  const population = Math.round(s.population * 10) / 10

  const rows: Fact[] = [
    { key: 'station', label: t('station.title'), value: station ? properName(station.name) : '—' },
    { key: 'planet', label: t('station.nav.planet'), value: planet ? properName(planet.name) : '—' },
    { key: 'system', label: t('station.system'), value: properName(world.systemName) },
    { key: 'government', label: t('station.government'), value: governmentName(s.government) },
    { key: 'economy', label: t('station.economy'), value: economyName(s.economy) },
    { key: 'tech', label: t('station.tech'), value: String(s.techLevel) },
    { key: 'population', label: t('station.population'), value: t('station.popUnit', { n: population }) },
    { key: 'species', label: t('station.species'), value: speciesName(s.species) },
  ]

  return (
    // Крупный заголовок с именем станции убран: причал уже подписан в шапке модалки, а имя
    // повторяется первой строкой таблицы — большой дубль над ней был лишним.
    <div className="max-w-md text-sm">
      <Table columns={FACT_COLUMNS} rows={rows} rowKey={(r) => r.key} />
      {/* Кто пристыкован — теперь во вкладке ЛЮДИ (раздел ПРИСТЫКОВАНЫ), рядом со знакомыми. */}
    </div>
  )
}
