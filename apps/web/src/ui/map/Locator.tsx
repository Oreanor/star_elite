import { useEffect, useReducer, useRef, useState } from 'react'
import { Vector3 } from 'three'
import {
  clearContactLock,
  clearNavLock,
  isVisible,
  MIELOPHONE,
  MONOLITH_NAMES,
  figurineDisplayName,
  NAV_ASTEROID_NAME,
  shipAxes,
  stanceTo,
  type BodyEntity,
  type ShipEntity,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { chassisName, occupationName, properName } from '../i18n/dataNames'
import { formatDistance } from '../hud/project'
import { useWheelZoom } from './useWheelZoom'
import { discProject, MapCard, MapFrame, MapPin, MapRow } from './MapFrame'

/**
 * Локатор — большой круглый радар консоли: вид сверху, нос корабля ВВЕРХ.
 *
 * Тот же прибор, что в углу кабины (`drawRadar`), но во весь экран и живой: его можно
 * КРУТИТЬ и НАКЛОНЯТЬ драгом, приближать колесом и КЛИКАТЬ отметку — выбор пишет в те же
 * поля мира, что Tab / Shift+Tab / карта системы (`navTargetId` или `lockedTargetId` +
 * `targetFocus`). HUD и J/P читают их сразу. Наведение показывает карточку; клик —
 * захват.
 *
 * Наклон превращает круг в ЭЛЛИПС: все координаты пересчитываются общей проекцией
 * `discProject` — поворот в плоскости (yaw), затем наклон (tilt) сжимает ось «вперёд»
 * и поднимает высоту над плоскостью. Диск, сетка, конус обзора и метки — всё через неё.
 */

/** Радиус диска в единицах SVG (до зума). */
const R = 300
/** Поле под подписи по краям. */
const PAD = 46
const VIEW = 2 * (R + PAD)
/** Дальше этого локатор не разбирает дистанцию, м: отметка прижата к ободу (как в кабине). */
const RANGE = 20_000
/** Максимальная высота отметки над плоскостью при наклоне, единицы SVG. */
const LIFT = 46
/** Вертикальный FOV погони (град) — из него и соотношения сторон строим конус обзора. */
const FOV_V = 70
const ASPECT = 16 / 9
const HALF_FOV = Math.atan(Math.tan((FOV_V * Math.PI) / 360) * ASPECT)

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _rel = new Vector3()

function shipColor(ship: ShipEntity, world: World): string {
  if (ship.kinematic) return UI.PLAYER
  const stance = stanceTo(world, ship)
  if (stance === 'hostile') return UI.DANGER
  if (stance === 'friendly') return UI.ALLY
  return UI.NEUTRAL
}

/** Цвет тела по роду; планета/луна/база — общий фосфор. Таблица, а не лестница if. */
const BODY_COLOR: Partial<Record<BodyEntity['kind'], string>> = {
  star: UI.STAR,
  blackhole: UI.BLACKHOLE,
  station: UI.STATION,
}
function bodyColor(body: BodyEntity): string {
  return BODY_COLOR[body.kind] ?? UI.PLANET
}

type Shape = 'square' | 'round' | 'diamond'

type SelectKind = 'body' | 'monolith' | 'figurine' | 'asteroid' | 'ship'

interface Blip {
  key: string
  /** Место в плоскости диска: right (вбок) и forward (вперёд), единицы SVG. */
  rt: number
  fwd: number
  /** Высота над плоскостью, единицы SVG. */
  h: number
  color: string
  shape: Shape
  size: number
  ring: boolean
  /** Род объекта словом: ПЛАНЕТА, ПРИЧАЛ, КОРАБЛЬ. Пишется перед именем и на поле, и в списке. */
  kind: string
  title: string
  /** Строки карточки: у борта — пилот, профессия, отношение, корпус. */
  lines: string[]
  /** До игрока, метры: по нему выстроен список — ближнее сверху. */
  dist: number
  /** Клик пишет захват в мир — тот же id, что у тела/борта/статуи. */
  selectId: number
  selectKind: SelectKind
}


/** Проекция мировой точки на плоскость диска (right/forward/height), null — в самом центре. */
function toDisc(world: World, pos: Vector3): { rt: number; fwd: number; h: number; dist: number } | null {
  _rel.copy(pos).sub(world.player.state.pos)
  const dist = _rel.length()
  if (dist < 1) return null
  const x = _rel.dot(_right)
  const z = _rel.dot(_fwd)
  const flat = Math.hypot(x, z)
  if (flat < 1e-3) return null
  const k = Math.min(1, Math.log10(1 + dist / 50) / Math.log10(1 + RANGE / 50))
  return {
    rt: (x / flat) * k * R,
    fwd: (z / flat) * k * R,
    h: Math.max(-1, Math.min(1, _rel.dot(_up) / dist)) * LIFT,
    dist,
  }
}

function blips(world: World): Blip[] {
  shipAxes(world.player.state.quat, _fwd, _right, _up)
  const out: Blip[] = []

  /**
   * За `GHOST_BODY_SCALE` единичный мир растворяется: планеты, спутники и причалы уже
   * не ориентиры, а `toDisc` зажимает `k` единицей — они прилипают к ободу и выглядят
   * застывшими. `drawRadar` этот порог соблюдает давно, а здесь его не было вовсе:
   * отсюда голубая точка планеты, висевшая на локаторе на миллионных масштабах.
   * Остаются только звёзды и чёрные дыры — на них ещё можно править.
   */
  const stellarOnly = world.player.state.scale >= MIELOPHONE.GHOST_BODY_SCALE

  for (const body of world.bodies) {
    if (stellarOnly && body.kind !== 'star' && body.kind !== 'blackhole') continue
    const d = toDisc(world, body.pos)
    if (!d) continue
    out.push({
      key: `body-${body.id}`,
      ...d,
      color: bodyColor(body),
      shape: body.kind === 'station' ? 'diamond' : 'round',
      size: body.kind === 'star' || body.kind === 'blackhole' ? 11 : 7,
      ring: body.id === world.navTargetId && world.targetFocus === 'nav',
      kind: t(`locator.kind.${body.kind}` as 'locator.kind.planet'),
      title: properName(body.name),
      lines: [],
      selectId: body.id,
      selectKind: 'body',
    })
  }

  // Статуи, статуэтки, глыбы, контейнеры и борта — тем более не ориентиры на таком
  // масштабе: всё это мельче планеты, которую мы только что убрали.
  if (stellarOnly) return out

  for (const m of world.monoliths) {
    const d = toDisc(world, m.pos)
    if (!d) continue
    out.push({
      key: `mono-${m.id}`,
      ...d,
      color: UI.MONOLITH,
      shape: 'round',
      size: 9,
      ring: m.id === world.navTargetId && world.targetFocus === 'nav',
      kind: t('locator.kind.monolith'),
      title: properName(MONOLITH_NAMES[m.variant] ?? 'Монолит'),
      lines: [],
      selectId: m.id,
      selectKind: 'monolith',
    })
  }

  for (const f of world.figurines) {
    if (!f.alive) continue
    const d = toDisc(world, f.pos)
    if (!d) continue
    out.push({
      key: `fig-${f.id}`,
      ...d,
      color: UI.MONOLITH,
      shape: 'round',
      size: 9,
      ring: f.id === world.navTargetId && world.targetFocus === 'nav',
      kind: t('locator.kind.figurine'),
      title: figurineDisplayName(f),
      lines: [],
      selectId: f.id,
      selectKind: 'figurine',
    })
  }

  for (const rock of world.warBases) {
    if (!rock.alive) continue
    const d = toDisc(world, rock.pos)
    if (!d) continue
    out.push({
      key: `rock-${rock.id}`,
      ...d,
      color: UI.MONOLITH,
      shape: 'round',
      size: 7,
      ring: rock.id === world.navTargetId && world.targetFocus === 'nav',
      kind: t('locator.kind.asteroid'),
      title: properName(NAV_ASTEROID_NAME),
      lines: [],
      selectId: rock.id,
      selectKind: 'asteroid',
    })
  }

  for (const ship of world.ships) {
    if (!isVisible(ship) || ship.divine) continue
    const d = toDisc(world, ship.state.pos)
    if (!d) continue
    const stance = stanceTo(world, ship)
    out.push({
      key: `ship-${ship.id}`,
      ...d,
      color: shipColor(ship, world),
      shape: 'square',
      size: 7,
      // Кольцо только у активного Tab-захвата — не у знакомых.
      ring: ship.id === world.lockedTargetId && world.targetFocus === 'contact',
      kind: t('locator.kind.ship'),
      // Имя БОРТА, а не пилота: род объекта на локаторе — корабль, человек внутри идёт
      // строкой ниже. Раньше здесь стояло имя пилота, и «корабль: Джон» читалось враньём.
      title: properName(ship.name),
      lines: [
        `${t('map.label.pilot')}: ${ship.pilotName}`,
        `${t('map.label.profession')}: ${occupationName(ship.originKind, ship.faction)}`,
        `${t('map.label.stance')}: ${t(`dialogue.stance.${stance}` as 'dialogue.stance.neutral')}`,
        `${t('map.label.hull')}: ${chassisName(ship.loadout.chassis.name)}`,
      ],
      selectId: ship.id,
      selectKind: 'ship',
    })
  }

  return out
}

/** Клик по отметке — тот же захват, что Tab / Shift+Tab / карта системы. */
function applySelect(world: World, kind: SelectKind, id: number): void {
  if (kind === 'ship') {
    if (world.lockedTargetId === id && world.targetFocus === 'contact') {
      clearContactLock(world)
      return
    }
    clearNavLock(world)
    clearContactLock(world)
    world.lockedTargetId = id
    world.targetFocus = 'contact'
    return
  }
  // Тело, статуя или глыба — нав-цель (как Shift+Tab).
  if (world.navTargetId === id && world.targetFocus === 'nav') {
    clearNavLock(world)
    return
  }
  clearContactLock(world)
  world.navTargetId = id
  world.targetFocus = 'nav'
  const body = world.bodies.find((b) => b.id === id)
  world.lockedStationId = body?.kind === 'station' ? id : null
}

/** Расстояние, отвечающее доле радиуса k (обратная логарифмической шкале радара). */
function distAt(k: number): number {
  return 50 * ((1 + RANGE / 50) ** k - 1)
}
function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(0)} ${t('unit.km')}` : `${Math.round(m / 10) * 10} ${t('unit.m')}`
}

export function Locator({ world }: { world: World }) {
  useLang()
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [hover, setHover] = useState<string | null>(null)
  // Поворот, наклон и зум диска. Наклон по умолчанию — лёгкий (радар-«тарелка»), но
  // 0 даёт честный вид сверху; крайние значения зажаты, чтобы диск не выворачивался.
  const [yaw, setYaw] = useState(0)
  const [tilt, setTilt] = useState(0.5)
  const [zoom, setZoom] = useState(1)
  const box = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  /** После драга pointerup на метке не должен считаться кликом. */
  const dragged = useRef(false)
  useWheelZoom(box, (dy) => setZoom((z) => Math.min(3, Math.max(0.6, z * (dy > 0 ? 0.9 : 1.1)))))

  const proj = (rt: number, fwd: number, h: number) => discProject(rt, fwd, h, yaw, tilt, zoom)
  const cos = Math.cos(tilt)

  const marks = blips(world)
    .map((b) => ({ b, base: proj(b.rt, b.fwd, 0), tip: proj(b.rt, b.fwd, b.h) }))
    // Дальние (больше «вперёд» после поворота) рисуем первыми — ближние лягут поверх.
    .sort((a, b) => b.base.depth - a.base.depth)
  // Карточка: выбранная цель важнее наведения — пилот видит, что захватил. Держим и место
  // отметки на экране: карточка висит булавкой У НЕЁ, а не в колонке.
  const active = marks.find((m) => m.b.ring) ?? marks.find((m) => m.b.key === hover) ?? null

  // Обод, сетка и конус — через ту же проекцию. Кольца сетки: эллипсы rx=r·zoom, ry=r·cos·zoom.
  const gridRings = [0.25, 0.5, 0.75, 1]
  const spokes = [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3) // радиальные лучи через 60°
  const fovA = proj(Math.sin(HALF_FOV) * R, Math.cos(HALF_FOV) * R, 0)
  const fovB = proj(Math.sin(-HALF_FOV) * R, Math.cos(-HALF_FOV) * R, 0)

  // Захват с ДИСКА подтягивает строку в видимую часть списка: выбрал отметку — видно, кто
  // это, не листая. Обратное направление (строка → диск) листать нечего.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [world.navTargetId, world.lockedTargetId, world.targetFocus])

  // Список слева: ближнее сверху. Выделение двустороннее — наведение на строку зажигает
  // отметку на диске, наведение на отметку подсвечивает строку.
  const listed = [...marks].sort((a, b) => a.b.dist - b.b.dist)

  return (
    <MapFrame square title={t('locator.title')} subtitle={t('locator.count', { n: marks.length })} aside={
      <>
        <ul ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {listed.map(({ b }) => (
            <li key={b.key}>
              <MapRow
                kind={b.kind}
                name={b.title}
                meta={formatDistance(b.dist)}
                color={b.color}
                active={b.ring}
                hover={b.key === hover}
                onHover={(on) => setHover((h) => (on ? b.key : h === b.key ? null : h))}
                onClick={() => {
                  applySelect(world, b.selectKind, b.selectId)
                  bump()
                }}
              />
            </li>
          ))}
        </ul>
      </>
    }>
      <div
        ref={box}
        onPointerDown={(e) => {
          dragged.current = false
          drag.current = { x: e.clientX, y: e.clientY }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const s = drag.current
          if (!s) return
          if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) > 3) dragged.current = true
          setYaw((y) => y - (e.clientX - s.x) * 0.008)
          setTilt((tl) => Math.max(0, Math.min(1.35, tl + (e.clientY - s.y) * 0.006)))
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        // Размер круга держит рамка (`MapFrame square`): квадрат по высоте панели. Здесь
        // осталось только поведение — драг крутит и наклоняет диск.
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
      >
        <svg className="absolute inset-0 h-full w-full" viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}>
          {/* Конус обзора — сектор от центра между лучами FOV, залит еле-еле. */}
          <path d={`M 0 0 L ${fovA.x} ${fovA.y} L ${fovB.x} ${fovB.y} Z`} fill="rgba(124,196,255,0.06)" />
          <line x1={0} y1={0} x2={fovA.x} y2={fovA.y} stroke="rgba(124,196,255,0.28)" />
          <line x1={0} y1={0} x2={fovB.x} y2={fovB.y} stroke="rgba(124,196,255,0.28)" />

          {/* Координатная сетка — вдвое приглушённая: кольца-эллипсы и радиальные лучи. */}
          {gridRings.map((k) => (
            <ellipse key={k} rx={R * k * zoom} ry={R * k * cos * zoom} fill="none" stroke="rgba(124,196,255,0.09)" />
          ))}
          {spokes.map((a, i) => {
            const p = proj(Math.sin(a) * R, Math.cos(a) * R, 0)
            return <line key={i} x1={0} y1={0} x2={p.x} y2={p.y} stroke="rgba(124,196,255,0.07)" />
          })}
          {/* Обод — чуть ярче сетки. */}
          <ellipse rx={R * zoom} ry={R * cos * zoom} fill="none" stroke="rgba(124,196,255,0.24)" />

          {/* Подписи расстояний у верхней кромки колец (экранно, не вращаются). */}
          {[0.5, 1].map((k) => (
            <text
              key={k}
              x={4}
              y={-R * k * cos * zoom - 3}
              fontSize={11}
              fill={UI.DIM}
              style={{ pointerEvents: 'none' }}
            >
              {fmtDist(distAt(k))}
            </text>
          ))}
          {/* Нос — вверх: где смотрит корабль. Метка ездит с наклоном вместе с ободом. */}
          <text x={0} y={-R * cos * zoom - 16} fontSize={13} fill={UI.DIM} textAnchor="middle" style={{ pointerEvents: 'none' }}>
            {t('locator.nose')}
          </text>

          {/* Игрок в центре — нос вверх. */}
          <path d="M 0 -7 L 5 6 L 0 3 L -5 6 Z" fill={UI.SALVAGE} />

          {marks.map(({ b, base, tip }) => {
            const on = b.key === hover
            return (
              <g
                key={b.key}
                onMouseEnter={() => setHover(b.key)}
                onMouseLeave={() => setHover((h) => (h === b.key ? null : h))}
                onClick={() => {
                  if (dragged.current) return
                  applySelect(world, b.selectKind, b.selectId)
                  bump()
                }}
                style={{ cursor: 'pointer' }}
              >
                <circle cx={tip.x} cy={tip.y} r={16} fill="transparent" />
                {/* Штрих высоты: от плоскости (base) к отметке (tip) — виден при наклоне. */}
                {Math.hypot(tip.x - base.x, tip.y - base.y) > 1 && (
                  <line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} stroke={b.color} strokeOpacity={0.35} />
                )}
                <Mark shape={b.shape} cx={tip.x} cy={tip.y} size={b.size} color={b.color} />
                {(b.ring || on) && (
                  <circle cx={tip.x} cy={tip.y} r={b.size + 4} fill="none" stroke={b.color} strokeOpacity={b.ring || on ? 0.9 : 0.5} />
                )}
                {(on || b.ring) && (
                  <text x={tip.x + b.size + 8} y={tip.y + 4} fontSize={13} fill={b.color} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {b.kind.toUpperCase()}: {b.title}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* Карточка — булавкой у самой отметки, поверх диска. Координаты `viewBox`
            переводим в доли поля: SVG растянут на весь квадрат, значит доля та же. */}
        {active && (
          <MapPin x={(active.tip.x + VIEW / 2) / VIEW} y={(active.tip.y + VIEW / 2) / VIEW}>
            <MapCard
              kind={active.b.kind}
              name={active.b.title}
              color={active.b.color}
              locked={active.b.ring}
              lines={[...active.b.lines, `${t('map.distance')}: ${formatDistance(active.b.dist)}`]}
            />
          </MapPin>
        )}
      </div>
    </MapFrame>
  )
}

function Mark({ shape, cx, cy, size, color }: { shape: Shape; cx: number; cy: number; size: number; color: string }) {
  const r = size / 2
  if (shape === 'round') return <circle cx={cx} cy={cy} r={r} fill={color} />
  if (shape === 'diamond')
    return <path d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`} fill={color} />
  return <rect x={cx - r} y={cy - r} width={size} height={size} fill={color} />
}
