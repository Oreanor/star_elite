import { useEffect, useReducer, type ReactNode } from 'react'
import {
  MIELOPHONE,
  contactTravelEta,
  contactWhereabouts,
  findStation,
  dispatcherPersona,
  generateSystem,
  livingContacts,
  stanceTo,
  type BodyEntity,
  type Contact,
  type Relationship,
  type ShipEntity,
  type World,
} from '@elite/sim'
import { useOnlinePlayers, type OnlinePlayer } from '../../session/net/presence'
import { t, useLang } from '../i18n'
import { currentGameDate } from '../clock'
import { chassisName, occupationName, professionName, properName } from '../i18n/dataNames'
import { ACCENT, Button, DIM, PilotPortrait } from '../station/chrome'
import { PilotIdentity } from '../station/PilotIdentity'
import { GLASS_PANEL, screenBackground } from '../station/backdrop'
import { Market } from '../station/Market'
import { ShipScreen } from '../ship/ShipScreen'
import { SystemMap } from '../map/SystemMap'
import { GalaxyMap } from '../map/GalaxyMap'
import { UniverseMap } from '../map/UniverseMap'
import { useSession } from '../../session/GameContext'
import { Locator } from '../map/Locator'
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
  | 'locator'
  | 'system'
  | 'galaxy'
  /** МИР — вид карты вселенной. Только в комнате: снаружи ты внутри галактики, а не между ними. */
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
  onDispatch,
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

  const station = findStation(world)
  const planet = capitalWorld(world)

  // Верфь и магазин — только у причала: в полёте оснастку не сменить и не поторговать.
  // Вкладка корабля зовётся «КОРАБЛЬ» и там, и там — это один и тот же экран; у причала
  // он лишь обрастает действиями (починить, купить, улучшить), а имя ему незачем менять.
  const tabs: { id: ConsoleTab; label: string; active?: boolean }[] = [
    // У причала первая вкладка — СТАНЦИЯ (шапка места + кто пристыкован); в полёте
    // станции под тобой нет, и та же вкладка показывает паспорт мира — ПЛАНЕТА.
    { id: 'planet', label: t('station.nav.planet') },
    // ЛЮДИ — сразу за местом: кто здесь и с кем связаться. Есть и у причала, и в полёте.
    { id: 'people', label: t('station.nav.people') },
    // КОРАБЛЬ — и твой борт, и витрина корпусов: у причала под моделью стрелки листают
    // каталог и кнопка покупки. Отдельной «ВЕРФИ» больше нет.
    { id: 'ship', label: t('ship.title') },
    ...(docked ? [{ id: 'shop' as const, label: t('station.nav.shop') }] : []),
    // ГРУЗ отдельной вкладкой больше не живёт: трюм — плашка под модулями во вкладке
    // КОРАБЛЬ (в полёте) и рядом со списком в МАГАЗИНЕ (у причала).
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
        {/* Заголовок модалки — ПРИЧАЛ, где стоим: имя станции и в скобках «планета …».
            В полёте причала нет — тогда пишем хотя бы систему, чтобы шапка не пустовала.
            Планета подробнее показана в первой вкладке. */}
        <div className="flex items-center justify-between gap-6">
            <h1 className="min-w-0 text-xl tracking-[0.12em]">
              {docked && station
                ? planet
                  ? t('station.atPlanet', { station: properName(station.name), planet: properName(planet.name) })
                  : properName(station.name)
                : `${t('station.system')}: ${properName(world.systemName).toUpperCase()}`}
            </h1>
          <div className="ml-auto flex shrink-0 items-center gap-8">
            <div
              className="flex items-center gap-5 rounded-lg border px-4 py-2 text-sm tracking-widest"
              style={{ borderColor: DIM, color: DIM, background: 'rgba(8,22,42,0.3)' }}
            >
              {/* Дата мира — общий календарь для всех игроков (`worldClock`). */}
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
          {/* ПЛАНЕТА — одна и та же и у причала, и в полёте: станция не отдельная сущность
              для пилота, а постройка на орбите этого мира. Паспортов-таблиц больше нет. */}
          {tab === 'planet' && <PlanetScreen world={world} planet={planet} />}
          {tab === 'ship' && <ShipScreen world={world} docked={docked} embedded onChange={bump} onClose={() => onTab('planet')} />}
          {tab === 'shop' && docked && <Market world={world} onChange={bump} />}
          {tab === 'reference' && <Reference />}
          {tab === 'people' && (
            <PeopleTab key={peopleRefresh} world={world} docked={docked} onTalk={onTalk} onDispatch={onDispatch} onChat={onChat} />
          )}
          {isMapView(tab) && (() => {
            // Выбранный вид мог погаснуть от обстановки (влетел в комнату, вырос миелофоном) —
            // тогда показываем ближайший осмысленный, а кнопка гаснет.
            const giant = world.player.state.scale >= MIELOPHONE.PHASE_START
            const view: MapView = mapViewEnabled(tab, bushActive, giant)
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
  onChat,
}: {
  world: World
  docked: boolean
  onTalk: (shipId: number) => void
  onDispatch: () => void
  onChat: (player: OnlinePlayer) => void
}) {
  const dockedHere = docked ? dockedPilots(world).slice(1).filter((s) => s.alive) : []
  // Слово — особый бог на Кресте: ВНЕ категорий (не «пристыкованный», не «знакомый»), но
  // на этой станции виден ВСЕГДА. Из «знакомых» исключаем, чтобы не задвоить после разговора.
  const slovo = docked ? world.ships.find((s) => s.alive && s.divine) : undefined
  const station = docked ? findStation(world) : null
  const dispatcher = station ? dispatcherPersona(world, station) : null
  const contacts = contactsExceptDocked(livingContacts(world), dockedHere).filter((c) => !c.ship?.divine)

  return (
    <div>
      {/* У причала — кто СЕЙЧАС здесь, одной строкой без категорий: Слово (бог на Кресте) и
          пристыкованные борта. Себя не показываем. Пусто — так и говорим: борта заходят со
          временем, а пока стоишь в доке, мир на паузе. */}
      {docked && (
        <div>
          <h2 className="text-base">{t('people.atStation')}</h2>
          {slovo || dockedHere.length > 0 ? (
            <div className={CARD_GRID}>
              {station && dispatcher && (
                <PersonPlaque
                  name={`ДИСПЕТЧЕР · ${properName(station.name)}`}
                  role="ДИСПЕТЧЕР"
                  craft={properName(station.name)}
                  portrait={<PilotPortrait species={dispatcher.species} face={0} size={108} />}
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
                name={`ДИСПЕТЧЕР · ${properName(station.name)}`}
                role="ДИСПЕТЧЕР"
                craft={properName(station.name)}
                portrait={<PilotPortrait species={dispatcherPersona(world, station).species} face={0} size={108} />}
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
          <h2 className="text-sm tracking-[0.3em]" style={{ color: ACCENT }}>
            {t('people.acquaintances')}
          </h2>
          <p className="mt-1 text-xs tracking-widest" style={{ color: DIM }}>
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
      <h2 className="text-sm tracking-[0.3em]" style={{ color: ACCENT }}>
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
      role={you ? professionName(ship.persona.profession) : occupationName(ship.originKind, ship.faction)}
      // У СЕБЯ отношения нет — не показываем: «ты нейтрален к себе» это шум, а не сведения.
      stance={you ? undefined : stanceTo(world, ship)}
      // У бога тоже корабль — его ладья; в шапке разговора она указана, и здесь так же.
      craft={chassisName(ship.loadout.chassis.name)}
      portrait={<PilotPortrait ship={ship} emotion="neutral" size={108} />}
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
  if (best) return best
  // Необитаемая система: столицы нет, но мир под тобой есть — берём БЛИЖАЙШУЮ планету.
  // Иначе вкладка ПЛАНЕТА пустовала бы там, где смотреть как раз интереснее всего.
  let near: BodyEntity | null = null
  let dist = Infinity
  for (const b of world.bodies) {
    if (b.kind !== 'planet' && b.kind !== 'moon') continue
    const d = b.pos.distanceTo(world.player.state.pos)
    if (d < dist) {
      dist = d
      near = b
    }
  }
  return near
}

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
