import { useMemo } from 'react'
import {
  CORE_INDEX,
  arrivalBounds,
  jumpBlock,
  jumpDistance,
  stationsOf,
  systemDefFor,
  systemLife,
  type StarSystem,
  type SystemDef,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { t } from '../i18n'
import { lifeName, properName, starClassName } from '../i18n/dataNames'
import { LY_PER_PARSEC, formatStarSize } from './GalaxyScene'

/**
 * Карточка системы на карте галактики: сведения, выбор станции прибытия и схема-оррерий.
 * Своя причина меняться — что мы рассказываем о системе.
 */

export function formatRange(ly: number): string {
  return `${ly.toFixed(1)} ${t('unit.ly')} · ${(ly / LY_PER_PARSEC).toFixed(2)} ${t('unit.pc')}`
}

/** Почему прыжок запрещён — код домена в строку интерфейса. */
const BLOCK_KEY = {
  'no-drive': 'map.block.noDrive',
  'out-of-range': 'map.block.range',
  'out-of-charge': 'map.block.charge',
  'same-system': 'map.block.here',
  docked: 'map.block.docked',
  cruising: 'map.block.cruising',
  scaled: 'map.block.scaled',
} as const

export function blockLabel(reason: NonNullable<ReturnType<typeof jumpBlock>>): string {
  return t(BLOCK_KEY[reason])
}

export interface Ring {
  name: string
  orbit: number
  angle: number
  radius: number
  giant: boolean
  station: boolean
  x: number
  y: number
}

/**
 * Плашка выбранной системы — та же, что у причала: имя, миры, жизнь и схемка выхода
 * у станции. Кнопки прыжка нет нигде: метка пишется в мир и переживает отчаливание;
 * гипер — только клавишей H в космосе, когда привод и заряд позволяют.
 */
export function SystemPopup({
  system,
  world,
  index,
  docked,
  at,
  inline = false,
  onArrival,
  onClose,
}: {
  system: StarSystem
  world: World
  index: number
  docked: boolean
  /** Позиция плашки у курсора — только для всплывающего режима. В `inline` не нужна. */
  at?: { x: number; y: number; w: number; h: number }
  /** Встроена в колонку инфо (статичная карточка), а не всплывает у курсора. */
  inline?: boolean
  onArrival: (planet: number | null) => void
  onClose: () => void
}) {
  const def = useMemo(() => systemDefFor(index, world.galaxySeed), [index, world.galaxySeed])
  const core = index === CORE_INDEX
  const distance = jumpDistance(world, index)
  // Дальность маршрута важна и при планировании у причала, где jumpBlock раньше
  // заслонял её менее полезным сообщением «сначала отчальте».
  const beyondDriveRange =
    index !== world.systemIndex && world.player.spec.jumpRange > 0 && distance > world.player.spec.jumpRange
  const blocked = beyondDriveRange ? 'out-of-range' : docked ? null : jumpBlock(world, index)

  // Все причалы системы — индексы их планет. Порядок планет в карте и в мире совпадает
  // (мост строит SystemDef.planets один-к-одному), поэтому индекс годится и для выхода.
  const stations = stationsOf(system)
  const stationPlanets = useMemo(
    () => new Set(stations.map((s) => system.planets.indexOf(s.planet))),
    [system, stations],
  )

  // Всплывающий режим — прижимаем плашку к полю карты у курсора. Встроенная (`inline`)
  // карточка просто течёт в колонке инфо: ни абсолюта, ни фиксированной ширины.
  const PW = 384
  const PH = 220
  const pos = at && !inline
    ? { left: Math.max(8, Math.min(at.x + 12, at.w - PW - 8)), top: Math.max(8, Math.min(at.y, at.h - PH - 8)) }
    : null

  return (
    <div
      className={inline ? 'rounded-lg border p-3' : 'absolute z-30 w-96 rounded-lg border p-4 backdrop-blur-md'}
      style={{
        ...(pos ?? {}),
        borderColor: 'rgba(124,196,255,0.4)',
        background: 'rgba(8,22,42,0.88)',
        boxShadow: '0 0 30px rgba(60,150,255,0.2)',
        color: UI.PRIMARY,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base leading-tight tracking-[0.2em]">{properName(system.name).toUpperCase()}</h3>
            <button type="button" onClick={onClose} className="cursor-pointer text-lg leading-none" style={{ color: UI.DIM }}>
              ×
            </button>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row
              label={t('map.class')}
              value={`${system.star.class} · ${starClassName(system.star)}${
                system.companion ? ` · ${t('map.binary')}` : ''
              }`}
            />
            <Row label={t('map.size')} value={formatStarSize(system.star.radius)} />
            <Row label={t('map.planets')} value={String(system.planets.length)} />
            <Row label={t('map.stations')} value={String(stations.length)} />
            <Row label={t('map.life')} value={lifeName(systemLife(system))} />
            <Row label={t('map.distance')} value={formatRange(distance)} />
          </dl>

          {core && <p className="mt-3 text-[11px] leading-relaxed" style={{ color: UI.WARN }}>{t('map.core')}</p>}

          {blocked && (
            <p
              className="mt-auto pt-3 text-[11px] tracking-widest"
              style={{ color: UI.WARN }}
            >
              {blockLabel(blocked)}
            </p>
          )}
        </div>

        {/* Схема идёт отдельной строкой: длинные значения характеристик больше не заходят под неё. */}
        {def.planets.length > 0 && (
          <div className="mt-4 border-t pt-4" style={{ borderColor: 'rgba(124,196,255,0.18)' }}>
            <div className="mx-auto w-full max-w-52">
              <StationPicker def={def} stationPlanets={stationPlanets} selected={world.jumpArrivalPlanet} onPick={onArrival} />
              {stations.length > 1 && (
                <p className="mt-2 text-[10px] leading-tight" style={{ color: UI.DIM }}>
                  {t('map.pickStation', { n: stations.length })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Схемка выхода: звезда в центре, планеты по орбитам. Кликается ТОЛЬКО планета со
 * станцией — туда и выйдешь, к причалу. Клик по звезде — выход у светила (без причала).
 * Произвольную точку больше не ставят: прыгать имеет смысл лишь туда, где есть жизнь.
 */
function StationPicker({
  def,
  stationPlanets,
  selected,
  onPick,
}: {
  def: SystemDef
  /** Индексы планет со станциями — все они кликаются как точки выхода. */
  stationPlanets: Set<number>
  /** Индекс планеты-со-станцией, у которой назначен выход, или null — у звезды. */
  selected: number | null
  onPick: (planet: number | null) => void
}) {
  const plotted = rings(def, stationPlanets)
  if (plotted.length === 0) return null
  const marked = selected != null ? plotted[selected] : null

  return (
    <div>
      <svg viewBox={`0 0 ${ORRERY_VIEW} ${ORRERY_VIEW}`} className="w-full" role="img" aria-label={`Схема ${def.name}`}>
        {/* Звезда — и точка выхода у светила: клик по ней снимает причал. */}
        <circle
          cx={ORRERY_CENTRE}
          cy={ORRERY_CENTRE}
          r="6"
          fill={`#${def.star.color.toString(16).padStart(6, '0')}`}
          className="cursor-pointer"
          onClick={() => onPick(null)}
        />
        {plotted.map((p, i) => (
          <g key={p.name}>
            <circle cx={ORRERY_CENTRE} cy={ORRERY_CENTRE} r={p.radius} fill="none" stroke={UI.DIM} strokeWidth="0.4" opacity="0.5" />
            {/* Планета со станцией светит фосфором и кликается; прочие — тусклые, мимо них. */}
            <circle cx={p.x} cy={p.y} r={p.giant ? 3.4 : 2} fill={p.station ? UI.PRIMARY : UI.DIM} opacity={p.station ? 1 : 0.4} />
            {/* Зона под палец: в точку в 2 единицы мышью не попасть. Только у станций. */}
            {p.station && (
              <circle cx={p.x} cy={p.y} r="7" fill="transparent" className="cursor-pointer" onClick={() => onPick(i)} />
            )}
          </g>
        ))}
        {marked && <Cross x={marked.x} y={marked.y} />}
      </svg>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="min-w-0 text-xs" style={{ color: UI.DIM }}>
        {label}
      </dt>
      <dd className="min-w-0 text-right leading-tight">{value}</dd>
    </div>
  )
}

/**
 * Схема системы: звезда, орбиты и КРЕСТИК точки выхода.
 *
 * Схема строится из `SystemDef` — из того самого описания, по которому будет
 * собран мир, а не из карточки генератора. Иначе крестик указывал бы на планету,
 * которой в системе не окажется: родная система задана вручную и генератору не
 * подчиняется, а прыгать домой можно, как в любую другую.
 *
 * Радиус логарифмический — иначе внутренние миры слипаются в точку у светила,
 * а внешний уезжает за край. Азимут настоящий: `atan2(z, x)` от звезды, поэтому
 * клик по схеме — это клик по месту в системе, а не по картинке.
 */
const ORRERY_VIEW = 160

const ORRERY_CENTRE = ORRERY_VIEW / 2

/** Внутренняя орбита ложится сюда, внешняя — на `HUB + REACH`. */
const ORRERY_HUB = 12

const ORRERY_REACH = 62

function rings(def: SystemDef, stationPlanets: Set<number>): Ring[] {
  const bounds = arrivalBounds(def)
  if (!bounds) return []

  /**
   * Логарифм берётся от ОТНОШЕНИЯ орбиты к внутренней, а не от неё самой.
   *
   * Орбиты расходятся геометрически, поэтому в логарифме они стоят через равные
   * промежутки — но только если отсчитывать от первой. Абсолютный логарифм делил
   * `lg(2.4e10)` на `lg(1e12)`, и внутренняя планета оказывалась сразу на семидесяти
   * процентах радиуса: все миры любой системы жались к краю, а середина пустовала.
   *
   * Единственная планета отношения не имеет — ей отводится середина: рисовать её
   * у самого светила было бы такой же ложью, как и на краю.
   */
  const span = Math.log(bounds.max / bounds.min)

  return def.planets.map((p, i) => {
    const orbit = Math.hypot(p.pos[0] - def.star.pos[0], p.pos[2] - def.star.pos[2])
    const angle = Math.atan2(p.pos[2] - def.star.pos[2], p.pos[0] - def.star.pos[0])
    const radius = ORRERY_HUB + (span > 1e-6 ? Math.log(orbit / bounds.min) / span : 0.5) * ORRERY_REACH
    return {
      name: p.name,
      orbit,
      angle,
      radius,
      giant: p.type === 'Газовый гигант',
      station: stationPlanets.has(i),
      x: ORRERY_CENTRE + radius * Math.cos(angle),
      y: ORRERY_CENTRE + radius * Math.sin(angle),
    }
  })
}

function Cross({ x, y }: { x: number; y: number }) {
  const arm = 5
  return (
    <g stroke={UI.TARGET} strokeWidth="0.8" style={{ pointerEvents: 'none' }}>
      <line x1={x - arm} y1={y} x2={x - 1.5} y2={y} />
      <line x1={x + 1.5} y1={y} x2={x + arm} y2={y} />
      <line x1={x} y1={y - arm} x2={x} y2={y - 1.5} />
      <line x1={x} y1={y + 1.5} x2={x} y2={y + arm} />
      <circle cx={x} cy={y} r="6.5" fill="none" strokeDasharray="1.5 2" opacity="0.7" />
    </g>
  )
}
