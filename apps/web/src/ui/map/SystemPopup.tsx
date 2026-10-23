import { useMemo } from 'react'
import {
  CORE_INDEX,
  arrivalBounds,
  jumpBlock,
  jumpDistance,
  quasarOf,
  stationsOf,
  systemDefFor,
  fateEdits,
  isSettled,
  systemLife,
  type StarSystem,
  type SystemDef,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { t } from '../i18n'
import { lifeName, properName, starClassName } from '../i18n/dataNames'
import { formatStarSize } from './GalaxyScene'
import { MapCard } from './MapFrame'

/**
 * Карточка системы на карте галактики: сведения, выбор станции прибытия и схема-оррерий.
 * Своя причина меняться — что мы рассказываем о системе.
 */

/** Дальность — только в световых годах: в них же дальность привода и список систем. */
export function formatRange(ly: number): string {
  return `${ly.toFixed(1)} ${t('unit.ly')}`
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
 * Плашка системы на карте галактики — та же карточка `MapCard`, что на локаторе, в системе и
 * в мире: «СИСТЕМА: имя», сведения, кнопка «ВЫБРАТЬ». Рассматривать систему и целиться в неё —
 * разные действия: кнопка ставит цель прыжка, и только у цели схема выхода кликается
 * (`onArrival`). Кнопки прыжка нет: гипер — клавишей H в космосе.
 */
/** Наибольший тех-уровень среди обитаемых миров системы; «—», если жизни нет. */
function maxTechOf(system: StarSystem): string {
  let best = 0
  for (const p of system.planets) if (isSettled(p) && p.settlement.techLevel > best) best = p.settlement.techLevel
  return best > 0 ? String(best) : '—'
}

export function SystemPopup({
  system,
  world,
  index,
  docked,
  onArrival,
  action,
}: {
  system: StarSystem
  world: World
  index: number
  docked: boolean
  /** Назначить точку выхода (у не-цели — заодно выбрать систему целью). */
  onArrival: (planet: number | null) => void
  action: { selected: boolean; onClick: () => void }
}) {
  const def = useMemo(() => systemDefFor(index, world.galaxySeed), [index, world.galaxySeed])
  const core = index === CORE_INDEX
  const distance = jumpDistance(world, index)
  // Дальность маршрута важна и при планировании у причала, где jumpBlock раньше
  // заслонял её менее полезным сообщением «сначала отчальте».
  const beyondDriveRange =
    index !== world.systemIndex && world.player.spec.jumpRange > 0 && distance > world.player.spec.jumpRange
  // Неустранимое для ГИПЕРПРЫЖКА (вне дальности, без привода, своя же система) пишем всегда —
  // и у причала. Но выбрать звезду это не мешает: пространство связное, к любой можно лететь
  // своим ходом (и J ведёт), так что «ВЫБРАТЬ» и выход у причала доступны всегда.
  // Временное (в доке, мало заряда, крейсер) — только в полёте и цель не запрещает.
  const permanent = beyondDriveRange
    ? 'out-of-range'
    : index === world.systemIndex
      ? 'same-system'
      : world.player.spec.jumpRange <= 0
        ? 'no-drive'
        : null
  const blocked = permanent ?? (docked ? null : jumpBlock(world, index))

  // Все причалы системы — индексы их планет. Порядок планет в карте и в мире совпадает
  // (мост строит SystemDef.planets один-к-одному), поэтому индекс годится и для выхода.
  const stations = stationsOf(system)
  const stationPlanets = useMemo(
    () => new Set(stations.map((s) => system.planets.indexOf(s.planet))),
    [system, stations],
  )
  // Имя причала по индексу планеты — подпись на схеме: без неё кликабельные точки не
  // отличались от прочих ничем, кроме цвета, и было неясно, что их вообще можно выбрать.
  const stationNames = useMemo(
    () => new Map(stations.map((s) => [system.planets.indexOf(s.planet), properName(s.station.name)])),
    [system, stations],
  )

  // Разбитые планеты держат слот (номер = адрес), но миров среди них уже нет.
  const fallen = useMemo(
    () => new Set(system.planets.flatMap((p, i) => (p.remnant ? [i] : []))),
    [system],
  )
  // Схема строится по SystemDef генератора, без журнала: цвет светила — из карточки,
  // где правки уже наложены (растворилось — тусклый остаток, у пары — выживший).
  const starColor = fateEdits(world.galaxyDelta, index).some((e) => e.ref === 'star' || e.ref === 'star:1')
    ? system.star.color
    : def.star.color

  return (
    <MapCard
      kind={t('map.view.system')}
      name={properName(system.name).toUpperCase()}
      color={UI.PRIMARY}
      lines={[]}
      action={action}
      extra={
        <div style={{ color: UI.PRIMARY }}>
          {/* Две колонки по смыслу: слева звезда и путь к ней (длинные значения), справа счёт
              миров (короткие). Сетка заполняется по строкам, поэтому пары идут вперемешку.
              Правая колонка — по содержимому, левой достаётся остаток: строки не переносятся. */}
          <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-1 text-sm">
            <Row
              label={t('map.class')}
              value={`${system.star.class} · ${starClassName(system.star)}${
                system.companion ? ` · ${t('map.binary')}` : ''
              }${core && quasarOf(world.galaxySeed) ? ` · ${t('map.quasar')}` : ''}`}
            />
            <Row label={t('map.planets')} value={String(system.planets.length - fallen.size)} />
            <Row label={t('map.distance')} value={formatRange(distance)} />
            <Row label={t('map.life')} value={lifeName(systemLife(system))} />
            {/* Самый развитый мир системы: тех-уровень решает, что продают на её причалах. */}
            <Row label={t('map.maxTech')} value={maxTechOf(system)} />
            <Row label={t('map.size')} value={formatStarSize(system.star.radius)} />
            <Row label={t('map.stations')} value={String(stations.length)} />
          </dl>

          {core && <p className="mt-3 text-2xs leading-relaxed" style={{ color: UI.WARN }}>{t('map.core')}</p>}

          {blocked && (
            <p className="pt-3 text-2xs tracking-meta" style={{ color: UI.WARN }}>
              {blockLabel(blocked)}
            </p>
          )}

          {/* Схема отдельной строкой: длинные значения характеристик не заходят под неё. */}
          {def.planets.length > 0 && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: 'rgba(124,196,255,0.18)' }}>
              <div className="mx-auto w-full max-w-52">
                <StationPicker
                  def={def}
                  stationPlanets={stationPlanets}
                  stationNames={stationNames}
                  fallen={fallen}
                  starColor={starColor}
                  selected={action.selected ? world.jumpArrivalPlanet : null}
                  onPick={onArrival}
                />
                {stations.length > 1 && (
                  <p className="mt-2 text-2xs leading-tight" style={{ color: UI.DIM }}>
                    {t('map.pickStation', { n: stations.length })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      }
    />
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
  stationNames,
  fallen,
  starColor,
  selected,
  onPick,
}: {
  def: SystemDef
  /** Индексы планет со станциями — все они кликаются как точки выхода. */
  stationPlanets: Set<number>
  /** Имя причала по индексу планеты — мелкая подпись у точки. */
  stationNames: Map<number, string>
  /** Индексы разбитых планет: на их орбите пояс обломков, точки нет. */
  fallen: Set<number>
  starColor: number
  /** Индекс планеты-со-станцией, у которой назначен выход, или null — у звезды. */
  selected: number | null
  /** null — схема для справки: система не цель прыжка, выход назначать некуда. */
  onPick: ((planet: number | null) => void) | null
}) {
  const plotted = rings(def, stationPlanets)
  if (plotted.length === 0) return null
  const marked = selected != null ? plotted[selected] : null

  return (
    <div>
      <svg viewBox={`0 0 ${ORRERY_VIEW} ${ORRERY_VIEW}`} className="w-full overflow-visible" role="img" aria-label={`Схема ${def.name}`}>
        {/* Звезда — и точка выхода у светила: клик по ней снимает причал. */}
        <circle
          cx={ORRERY_CENTRE}
          cy={ORRERY_CENTRE}
          r="6"
          fill={`#${starColor.toString(16).padStart(6, '0')}`}
          className={onPick ? 'cursor-pointer' : undefined}
          data-no-drag={onPick ? true : undefined}
          onClick={onPick ? () => onPick(null) : undefined}
        />
        {plotted.map((p, i) => (
          <g key={p.name}>
            {/* Орбита разбитой планеты — пунктир пояса обломков (у газового — пусто). */}
            {fallen.has(i) ? (
              !p.giant && (
                <circle cx={ORRERY_CENTRE} cy={ORRERY_CENTRE} r={p.radius} fill="none" stroke={UI.DIM} strokeWidth="1.2" strokeDasharray="0.6 1.6" opacity="0.7" />
              )
            ) : (
              <circle cx={ORRERY_CENTRE} cy={ORRERY_CENTRE} r={p.radius} fill="none" stroke={UI.DIM} strokeWidth="0.4" opacity="0.5" />
            )}
            {/* Планета со станцией светит фосфором и кликается; прочие — тусклые, мимо них.
                От разбитой остаётся лишь её причал — малой точкой. */}
            {(!fallen.has(i) || p.station) && (
              <circle
                cx={p.x}
                cy={p.y}
                r={fallen.has(i) ? 1.2 : p.giant ? 3.4 : 2}
                fill={p.station ? UI.PRIMARY : UI.DIM}
                opacity={p.station ? 1 : 0.4}
              />
            )}
            {/* Зона под палец: в точку в 2 единицы мышью не попасть. Только у станций. */}
            {/* Подпись причала — мелко, сбоку от точки, к центру не лезет: справа от звезды
                пишем вправо, слева — влево. Кликается вместе с точкой. */}
            {p.station && stationNames.has(i) && (
              <text
                x={p.x + (p.x >= ORRERY_CENTRE ? 5 : -5)}
                y={p.y + 2}
                fontSize="6"
                textAnchor={p.x >= ORRERY_CENTRE ? 'start' : 'end'}
                fill={selected === i ? UI.PRIMARY : UI.DIM}
                className={onPick ? 'cursor-pointer select-none' : 'select-none'}
                data-no-drag={onPick ? true : undefined}
                onClick={onPick ? () => onPick(i) : undefined}
              >
                {stationNames.get(i)}
              </text>
            )}
            {p.station && onPick && (
              <circle cx={p.x} cy={p.y} r="7" fill="transparent" className="cursor-pointer" data-no-drag onClick={() => onPick(i)} />
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
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 whitespace-nowrap text-xs" style={{ color: UI.DIM }}>
        {label}
      </dt>
      <dd className="min-w-0 truncate whitespace-nowrap text-right leading-tight">{value}</dd>
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
