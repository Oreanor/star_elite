import { useReducer } from 'react'
import { findStation, localSettlement, type BodyEntity, type ShipEntity, type World } from '@elite/sim'
import { currentLang, t, useLang } from '../i18n'
import { chassisName, economyName, governmentName, properName, speciesName } from '../i18n/dataNames'
import { ACCENT, Button, Column, DIM, PilotPortrait, Table } from '../station/chrome'
import { Hold } from '../station/Hold'
import { Market } from '../station/Market'
import { HullShop, ShipScreen } from '../ship/ShipScreen'
import { SystemMap } from '../map/SystemMap'
import { GalaxyMap } from '../map/GalaxyMap'

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
export type ConsoleTab = 'planet' | 'ship' | 'shipyard' | 'shop' | 'cargo' | 'system' | 'galaxy'

export function Console({
  world,
  docked,
  tab,
  onTab,
  onClose,
  onTalk,
}: {
  world: World
  docked: boolean
  tab: ConsoleTab
  onTab: (tab: ConsoleTab) => void
  /** У причала — отчаливание, в полёте — просто закрыть консоль. */
  onClose: () => void
  /** Открыть канал с пристыкованным пилотом (клик по плашке дока). */
  onTalk: (shipId: number) => void
}) {
  useLang()
  const [, bump] = useReducer((n: number) => n + 1, 0)

  const station = findStation(world)
  const planet = capitalWorld(world)

  // Верфь и магазин — только у причала: в полёте оснастку не сменить и не поторговать.
  // Вкладка корабля зовётся «КОРАБЛЬ» и там, и там — это один и тот же экран; у причала
  // он лишь обрастает действиями (починить, купить, улучшить), а имя ему незачем менять.
  const tabs: { id: ConsoleTab; label: string }[] = [
    // У причала первая вкладка — СТАНЦИЯ (шапка места + кто пристыкован); в полёте
    // станции под тобой нет, и та же вкладка показывает паспорт мира — ПЛАНЕТА.
    { id: 'planet', label: docked ? t('station.nav.station') : t('station.nav.planet') },
    { id: 'ship', label: t('ship.title') },
    // Верфь — отдельная вкладка у причала: «где купить корпус» не должно теряться
    // под сеткой модулей. Рядом с «КОРАБЛЁМ» (твой борт) и «МАГАЗИНОМ» (железо).
    ...(docked ? [{ id: 'shipyard' as const, label: t('station.nav.ship') }] : []),
    ...(docked ? [{ id: 'shop' as const, label: t('station.nav.shop') }] : []),
    { id: 'cargo', label: t('station.nav.cargo') },
    { id: 'system', label: t('station.nav.system') },
    { id: 'galaxy', label: t('station.nav.galaxy') },
  ]

  return (
    <div
      className="absolute inset-0 flex items-center justify-center backdrop-blur-md"
      style={{ background: 'radial-gradient(ellipse at center, rgba(12,34,60,0.66), rgba(0,3,8,0.93))' }}
    >
      <div
        className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-w-6xl flex-col rounded-2xl border p-7 font-mono"
        style={{
          borderColor: 'rgba(124,196,255,0.3)',
          background: 'linear-gradient(150deg, rgba(40,95,150,0.18), rgba(8,22,42,0.4))',
          boxShadow: '0 0 70px rgba(60,150,255,0.16), inset 0 0 90px rgba(80,180,255,0.06)',
          color: ACCENT,
        }}
      >
        {/* Заголовок модалки — ПРИЧАЛ, где стоим: имя станции и в скобках её планета.
            В полёте причала нет — тогда пишем хотя бы систему, чтобы шапка не пустовала.
            Кредиты и паспорт мира — не сюда: деньги у корабля, планета — в первой вкладке. */}
        <div className="flex items-start justify-between gap-6">
          <h1 className="text-xl tracking-[0.3em]">
            {docked && station
              ? `${properName(station.name)}${planet ? ` (${properName(planet.name)})` : ''}`
              : `${t('station.system')}: ${properName(world.systemName).toUpperCase()}`}
          </h1>
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
            const on = item.id === tab
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTab(item.id)}
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
              <StationReadout world={world} station={station} planet={planet} onTalk={onTalk} />
            ) : (
              <LocationReadout world={world} planet={planet} />
            ))}
          {tab === 'ship' && <ShipScreen world={world} docked={docked} embedded onClose={() => onTab('planet')} />}
          {tab === 'shipyard' && docked && <HullShop world={world} onChange={bump} />}
          {tab === 'shop' && docked && <Market world={world} onChange={bump} />}
          {tab === 'cargo' && <Hold world={world} onChange={bump} atStation={docked} />}
          {tab === 'system' && <SystemMap world={world} embedded onClose={() => onTab('planet')} />}
          {/* onClose у карты галактики срабатывает только при старте прыжка — тогда
              консоль закрывается целиком и мир оживает под кино, а не переходит на вкладку. */}
          {tab === 'galaxy' && <GalaxyMap embedded onClose={onClose} />}
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
 * Плашка пилота у причала: портрет, имя и модель корпуса. Чужая плашка — кнопка:
 * клик открывает канал разговора с этим пилотом (как в космосе). Своя (ТЫ) — просто
 * карточка. Имя берём ИСТИННОЕ (`pilotName`): у причала манифест, тут все с именами,
 * даже с кем ещё не знаком в полёте.
 */
function DockPlaque({ ship, you, onTalk }: { ship: ShipEntity; you: boolean; onTalk: (id: number) => void }) {
  const inner = (
    <>
      {/* У причала пилот спокоен — портрет нейтральный. */}
      <PilotPortrait ship={ship} emotion="neutral" size={96} />
      <div className="min-w-0 text-left">
        <div className="truncate text-sm tracking-widest" style={{ color: ACCENT }}>
          {you ? t('station.you') : ship.pilotName}
        </div>
        <div className="truncate text-xs" style={{ color: DIM }}>
          {chassisName(ship.loadout.chassis.name)}
        </div>
      </div>
    </>
  )
  const box = 'flex items-center gap-3 border px-3 py-2'
  if (you) {
    return (
      <div className={box} style={{ borderColor: DIM, minWidth: '15rem' }}>
        {inner}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onTalk(ship.id)}
      className={`${box} cursor-pointer transition-colors hover:bg-[#7fd6ff]/10`}
      style={{ borderColor: DIM, minWidth: '15rem' }}
    >
      {inner}
    </button>
  )
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
  onTalk,
}: {
  world: World
  station: BodyEntity | null
  planet: BodyEntity | null
  onTalk: (shipId: number) => void
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

  const pilots = dockedPilots(world)

  return (
    <div>
      <h1 className="text-2xl tracking-[0.2em]">{properName(station ? station.name : world.systemName)}</h1>
      <div className="mt-6 max-w-md text-sm">
        <Table columns={FACT_COLUMNS} rows={rows} rowKey={(r) => r.key} />
      </div>

      <h2 className="mb-3 mt-8 text-sm tracking-[0.3em]">{t('station.docked.title')}</h2>
      {pilots.length === 0 ? (
        <p className="text-sm" style={{ color: DIM }}>
          {t('station.docked.empty')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {pilots.map((p, i) => (
            <DockPlaque key={p.id} ship={p} you={i === 0} onTalk={onTalk} />
          ))}
        </div>
      )}
    </div>
  )
}
