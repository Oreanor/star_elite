import { useEffect, useRef, useState } from 'react'
import { UI } from '../theme'
import { Vector3 } from 'three'
import { shipAxes, type BodyEntity, type World } from '@elite/sim'
import { currentLang, t, useLang } from '../i18n'
import { properName } from '../i18n/dataNames'
import { useWheelZoom } from './useWheelZoom'

/**
 * Карта системы — голограмма над консолью.
 *
 * По умолчанию — вид сверху, плоскость XZ, оси МИРОВЫЕ (карта не крутится вместе с
 * носом). Но её можно КРУТИТЬ и НАКЛОНЯТЬ драгом, как локатор: yaw поворачивает диск,
 * tilt кладёт его в эллипс. Зум — колесом. Всё через ту же проекцию `project`.
 *
 * Центр — ЗВЕЗДА, а карта показывает СИСТЕМУ целиком: звезда, планеты, луны,
 * причал — все на своих орбитах, а игрок отмечен там, где он в системе есть.
 * Радиус берётся логарифмом от ОТНОШЕНИЯ орбиты к внутренней — тем же приёмом,
 * что и оррера в деталях системы на карте галактики. Абсолютный логарифм от
 * дистанции сваливал внутренние миры в точку у светила; отношение разводит
 * орбиты по диску ровно, и «что дальше» видно всё сразу, без прокрутки масштаба.
 *
 * Высота (Y) — вертикальным штрихом от плоскости эклиптики к телу; при наклоне он
 * честно поднимает тело над диском, как на радаре.
 *
 * Карта ничего не решает: она пишет `world.navTargetId` и на этом заканчивается.
 */

/** Радиус диска в единицах SVG. */
const DISC = 300
const VIEW = 2 * DISC + 90
/** Внутренний радиус: ближайшая орбита ложится сюда, оставляя место под звезду в центре. */
const INNER = 34
/** Максимальная длина штриха высоты. Длиннее — штрихи начинают спорить с телами. */
const LIFT = 40
/** Дальше этого штрих высоты уже не растёт, метры. Иначе газовый гигант съедает шкалу. */
const LIFT_RANGE = 60_000

/**
 * Каждому роду тел — свой тон. Это не украшение: в списке из семи строк «звезда»
 * и «планета» различаются только цветом, читать слово целиком не приходится.
 * Звезда светит своим светом, причал — рукотворный и потому белый, планеты —
 * фосфор консоли. Корабль игрока — четвёртый тон: он не тело.
 *
 * Голубой значит «цель навигации» — и здесь, и на HUD в кабине. Жёлтый занят
 * боевым захватом; красить им планету значило бы «вот во что ты стреляешь».
 * Выбранное тело выделяется не цветом, а размером, заливкой и пунктирным кольцом.
 */
const BODY = UI.PRIMARY
const SHIP = UI.SALVAGE
const STAR = '#ffe6a8'
const STATION = '#ffffff'
/** Знакомый на радаре: свой тон, чтобы не спутать с планетой и с игроком. */
const CONTACT = '#b98bff'
/** Живой игрок: розовый — та же семантика, что на локаторе и карте галактики. */
const PLAYER = UI.PLAYER

const colourOf = (kind: MarkerKind): string =>
  kind === 'star'
    ? STAR
    : kind === 'station'
      ? STATION
      : kind === 'ship'
        ? SHIP
        : kind === 'contact'
          ? CONTACT
          : kind === 'player'
            ? PLAYER
            : BODY

type MarkerKind = BodyEntity['kind'] | 'ship' | 'contact' | 'player'

interface Marker {
  /** У корабля своего id нет: он не тело. Отрицательный — значит, не выбирается. */
  id: number
  name: string
  kind: MarkerKind
  /** Точка на диске: азимут от звезды в плоскости XZ, радиус — по логарифму орбиты. */
  x: number
  y: number
  /** Штрих высоты в единицах SVG, вверх положительный. */
  lift: number
  /** Радиус орбиты вокруг звезды, единицы SVG. Ноль у самой звезды. */
  ring: number
  /** До игрока, метры — по нему выстроен список: карта отвечает «куда мне лететь». */
  range: number
  /** Центральное светило: стоит в центре, орбитой не мерится. */
  isStar: boolean
}

/**
 * Проекция точки диска на экран — та же, что у локатора: поворот в плоскости (yaw),
 * затем наклон (tilt) сжимает ось «от звезды» и поднимает высоту, зум множит. Плоский
 * вид сверху при tilt=0; драгом превращаем диск в наклонный эллипс, как радар.
 */
function project(x: number, y: number, h: number, yaw: number, tilt: number, zoom: number): { x: number; y: number; depth: number } {
  const rx = (x * Math.cos(yaw) - y * Math.sin(yaw)) * zoom
  const fy = (x * Math.sin(yaw) + y * Math.cos(yaw)) * zoom
  return { x: rx, y: -(fy * Math.cos(tilt) + h * zoom * Math.sin(tilt)), depth: fy }
}

/** Логарифм отношения орбиты к внутренней сжимает разброс орбит в радиус диска. */
function radiusOf(orbit: number, min: number, span: number): number {
  if (orbit <= 1) return 0
  const k = span > 1e-6 ? Math.log(orbit / min) / span : 0.5
  return INNER + Math.min(1, Math.max(0, k)) * (DISC - INNER)
}

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()

/** Куда смотрит нос, в осях карты. Единичный вектор; нулевой, если нос строго вверх. */
function headingOf(world: World): { x: number; y: number } {
  shipAxes(world.player.state.quat, _fwd, _right, _up)
  const flat = Math.hypot(_fwd.x, _fwd.z)
  return flat > 1e-6 ? { x: _fwd.x / flat, y: _fwd.z / flat } : { x: 0, y: 0 }
}

/**
 * Раскладка всей системы вокруг звезды. Игрок добавлен отдельным маркером — не
 * тело, но его место в системе показать надо: об этом и просили.
 */
function markers(world: World): Marker[] {
  const star = world.bodies.find((b) => b.kind === 'star') ?? null
  // Нет звезды (не должно случаться в обитаемой системе) — мерим от игрока.
  const origin = star ? star.pos : world.player.state.pos
  const player = world.player.state.pos

  // Знакомые, что сейчас в этой системе, — на радаре по имени: их положение известно,
  // и карта показывает, где именно. Отрицательный id (−1000−id борта) держит их
  // невыбираемыми: знакомый летит, «цель навигации» на нём означала бы погоню.
  const contacts = world.ships
    // Кинематических (живых игроков) сюда не берём — они идут отдельным слоем `players`
    // розовым, даже если ты с ними уже знаком: «живой человек здесь» важнее метки знакомства.
    .filter((s) => s.alive && s.acquaintanceId != null && !s.kinematic)
    .map((s) => ({ id: -1000 - s.id, name: s.name, kind: 'contact' as MarkerKind, pos: s.state.pos }))

  // Живые игроки в этой системе (кинематические борта). Отрицательный id (−2000−id)
  // держит их невыбираемыми: игрок летит, «цель навигации» на нём означала бы погоню.
  const players = world.ships
    .filter((s) => s.alive && s.kinematic)
    .map((s) => ({ id: -2000 - s.id, name: s.name, kind: 'player' as MarkerKind, pos: s.state.pos }))

  const raw = [
    ...world.bodies.map((b) => ({ id: b.id, name: b.name, kind: b.kind as MarkerKind, pos: b.pos })),
    { id: -1, name: t('map.you'), kind: 'ship' as MarkerKind, pos: player },
    ...contacts,
    ...players,
  ].map((m) => {
    const dx = m.pos.x - origin.x
    const dz = m.pos.z - origin.z
    const dy = m.pos.y - origin.y
    return {
      ...m,
      orbit: Math.hypot(dx, dz),
      az: Math.atan2(dz, dx),
      dy,
      range: m.pos.distanceTo(player),
      isStar: star != null && m.id === star.id,
    }
  })

  // Внутренняя и внешняя орбиты задают шкалу. Звезду в неё не берём: она в центре.
  const orbits = raw.filter((m) => !m.isStar && m.orbit > 1).map((m) => m.orbit)
  const min = orbits.length ? Math.max(1, Math.min(...orbits)) : 1
  const max = orbits.length ? Math.max(...orbits) : min * 10
  const span = Math.log(max / min)

  return raw.map((m) => {
    const r = m.isStar ? 0 : radiusOf(m.orbit, min, span)
    return {
      id: m.id,
      name: m.name,
      kind: m.kind,
      x: m.orbit > 1 ? Math.cos(m.az) * r : 0,
      y: m.orbit > 1 ? Math.sin(m.az) * r : 0,
      // Высота сжата к пределу, а не отнормирована на максимум: иначе далёкий
      // гигант, ушедший на 58 км вверх, прижал бы все остальные штрихи к нулю.
      lift: Math.max(-1, Math.min(1, m.dy / LIFT_RANGE)) * LIFT,
      ring: r,
      range: m.range,
      isStar: m.isStar,
    }
  })
}

/** Астрономическая единица, м. Планетные дистанции в километрах нечитаемы. */
const AU = 149_597_870_700

function formatDistance(metres: number): string {
  const locale = currentLang() === 'ru' ? 'ru' : 'en-US'
  if (metres >= 0.02 * AU) return `${(metres / AU).toFixed(2)} ${t('unit.au')}`
  if (metres >= 1e6) return `${Math.round(metres / 1000).toLocaleString(locale)} ${t('unit.km')}`
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} ${t('unit.km')}`
  return `${Math.round(metres)} ${t('unit.m')}`
}

/**
 * Выбирается всё, что стоит на месте: звезда, планета, луна, причал. Корабль —
 * нет: он летит, и «цель навигации» на нём означала бы преследование, а не курс.
 */
const selectable = (m: Marker) => m.kind !== 'ship' && m.kind !== 'contact'

/** Состав системы одной строкой: сколько чего в ней есть. */
function census(world: World): string {
  const count = (kind: BodyEntity['kind']) => world.bodies.filter((b) => b.kind === kind).length
  const parts: string[] = []
  const push = (n: number, key: 'map.count.stars' | 'map.count.planets' | 'map.count.moons' | 'map.count.stations') =>
    n > 0 && parts.push(`${n} ${t(key)}`)
  push(count('star'), 'map.count.stars')
  push(count('planet'), 'map.count.planets')
  push(count('moon'), 'map.count.moons')
  push(count('station'), 'map.count.stations')
  return parts.join(' · ')
}

export function SystemMap({
  world,
  onClose,
  embedded = false,
}: {
  world: World
  onClose: () => void
  /** Встроена в панель консоли: без своего оверлея и стеклянной рамки — их даёт консоль. */
  embedded?: boolean
}) {
  useLang()
  // Мир мутируется напрямую; React о нём не знает и сам перерисоваться не может.
  const [, bump] = useState(0)

  // Масштаб голограммы: 1 — вся система в поле, больше — ближе. Колесо его крутит.
  const [zoom, setZoom] = useState(1)
  const holoRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  useWheelZoom(holoRef, (dy) => setZoom((z) => Math.min(6, Math.max(0.6, z * (dy > 0 ? 0.9 : 1.1)))))

  // Поворот и наклон — как у локатора: драг по X крутит диск (yaw), по Y кладёт его в
  // наклон (tilt), превращая круг орбит в эллипс. Плоский вид сверху при tilt=0. `dragged`
  // отличает вращение от клика по метке, чтобы драг не выбирал цель.
  const [yaw, setYaw] = useState(0)
  const [tilt, setTilt] = useState(0.5)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY }
    dragged.current = false
    // НЕ захватываем указатель здесь: setPointerCapture перенаправляет ПОСЛЕДУЮЩИЙ click
    // на этот div, и клик по метке до неё не доходит — выбор объекта не срабатывает.
    // Захват берём в onPointerMove, только когда началось реальное вращение.
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const start = drag.current
    if (!start) return
    const dxp = e.clientX - start.x
    const dyp = e.clientY - start.y
    // До порога это ещё клик, а не драг: не крутим и не захватываем указатель.
    if (!dragged.current) {
      if (Math.hypot(dxp, dyp) <= 3) return
      dragged.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setYaw((yw) => yw - dxp * 0.008)
    setTilt((tl) => Math.max(0, Math.min(1.35, tl + dyp * 0.006)))
    drag.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const points = markers(world)
  // Выбор цели: и клик по метке на диске, и строка списка ведут сюда — одно состояние
  // `navTargetId`, одна подсветка. Тот же клик по выбранному снимает выбор.
  const applySelect = (id: number) => {
    world.navTargetId = world.navTargetId === id ? null : id
    bump((n) => n + 1)
  }
  // С диска — только если это был клик, а не завершение вращения (dragged сбросится на
  // следующем pointerdown). Список к драгу отношения не имеет и зовёт applySelect напрямую.
  const selectFromMap = (id: number) => {
    if (dragged.current) return
    applySelect(id)
  }

  // Выбранную строку подтягиваем в видимую часть списка: клик по дальней планете на диске
  // не должен «подсвечивать» её где-то за прокруткой.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [world.navTargetId])

  const content = (
    <>
      {/* Единый расклад всех трёх карт: диск в левых 2/3 (центрован), инфо — в правой 1/3. */}
      <div className="flex w-2/3 justify-center">
      <div
        ref={holoRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative aspect-square w-full min-w-0 max-w-[min(31rem,calc(100vh-17rem))] shrink cursor-grab touch-none select-none active:cursor-grabbing"
      >
        <Hologram points={points} heading={headingOf(world)} navTargetId={world.navTargetId} zoom={zoom} yaw={yaw} tilt={tilt} onSelect={selectFromMap} />
      </div>
      </div>

      <div className="flex w-1/3 shrink-0 flex-col" style={{ color: BODY }}>
        <h1 className="text-xl tracking-[0.3em]">{properName(world.systemName).toUpperCase()}</h1>
        {/* Состав системы: сколько звёзд, планет, лун и причалов — видно, что тут есть. */}
        <p className="mb-6 mt-1 text-[11px] tracking-widest opacity-50">{census(world)}</p>

        {/* Длинный список объектов не должен распирать карточку — он скроллится сам. */}
        <ul ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {points.filter(selectable).map((m) => {
            const active = m.id === world.navTargetId
            return (
              <li key={m.id}>
                <button
                  type="button"
                  data-active={active}
                  onClick={() => applySelect(m.id)}
                  className="flex w-full cursor-pointer items-baseline gap-3 rounded border px-3 py-2 text-left text-sm transition-colors"
                  style={{
                    borderColor: active ? BODY : 'rgba(124,196,255,0.16)',
                    background: active ? 'rgba(124,196,255,0.12)' : 'transparent',
                    color: colourOf(m.kind),
                  }}
                >
                  <span className="flex-1 truncate">{properName(m.name)}</span>
                  <span className="text-xs opacity-60">{formatDistance(m.range)}</span>
                </button>
              </li>
            )
          })}
        </ul>

        {!embedded && (
          <button
            type="button"
            onClick={onClose}
            className="mt-auto w-full cursor-pointer rounded border py-2 text-sm tracking-[0.3em] transition-colors hover:bg-white/10"
            style={{ borderColor: BODY }}
          >
            M — ЗАКРЫТЬ
          </button>
        )}
      </div>
    </>
  )

  if (embedded) {
    return <div className="flex w-full items-start gap-6 py-2 font-mono">{content}</div>
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center backdrop-blur-md"
      style={{ background: 'radial-gradient(ellipse at center, rgba(12,34,60,0.66), rgba(0,3,8,0.93))' }}
    >
      <div
        className="flex max-h-[calc(100vh-3rem)] items-stretch gap-6 rounded-2xl border p-7 font-mono"
        style={{
          borderColor: 'rgba(124,196,255,0.3)',
          background: 'linear-gradient(150deg, rgba(40,95,150,0.18), rgba(8,22,42,0.4))',
          boxShadow: '0 0 70px rgba(60,150,255,0.16), inset 0 0 90px rgba(80,180,255,0.06)',
        }}
      >
        {content}
      </div>
    </div>
  )
}

function Hologram({
  points,
  heading,
  navTargetId,
  zoom,
  yaw,
  tilt,
  onSelect,
}: {
  points: Marker[]
  heading: { x: number; y: number }
  navTargetId: number | null
  /** Масштаб: множит разлёт орбит. Больше — ближе. Значки не растут. */
  zoom: number
  /** Поворот диска в плоскости и наклон «на себя» — как у локатора. */
  yaw: number
  tilt: number
  onSelect: (id: number) => void
}) {
  const ships = points.find((m) => m.kind === 'ship')
  const cos = Math.cos(tilt)
  const proj = (x: number, y: number, h: number) => project(x, y, h, yaw, tilt, zoom)

  // Проецируем каждую метку: плоскость (base) и вершина штриха высоты (tip). Дальние
  // (по глубине после поворота) рисуем первыми — ближние лягут поверх, как на локаторе.
  const marks = points
    .map((m) => ({ m, base: proj(m.x, m.y, 0), tip: proj(m.x, m.y, m.lift) }))
    .sort((a, b) => b.base.depth - a.base.depth)

  return (
    <svg className="absolute inset-0 h-full w-full" viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}>
      <defs>
        <radialGradient id="map-disc">
          <stop offset="0%" stopColor="rgba(124,196,255,0.14)" />
          <stop offset="70%" stopColor="rgba(124,196,255,0.03)" />
          <stop offset="100%" stopColor="rgba(124,196,255,0)" />
        </radialGradient>
      </defs>

      {/* Диск и орбиты кладутся в наклон эллипсами: ry = rx·cos(tilt), центр — звезда. */}
      <ellipse rx={DISC * zoom} ry={DISC * cos * zoom} fill="url(#map-disc)" />

      {points
        .filter((m) => !m.isStar && m.kind !== 'ship' && m.ring > 0)
        .map((m) => (
          <ellipse
            key={`ring-${m.id}`}
            rx={m.ring * zoom}
            ry={m.ring * cos * zoom}
            fill="none"
            stroke="rgba(124,196,255,0.12)"
            strokeDasharray="2 6"
          />
        ))}

      {/* Игла курса от корабля: куда повёрнут нос. Тоже через проекцию. */}
      {ships && (() => {
        const a = proj(ships.x, ships.y, ships.lift)
        const b = proj(ships.x + heading.x * 34, ships.y + heading.y * 34, ships.lift)
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SHIP} strokeOpacity={0.4} strokeDasharray="6 5" />
      })()}

      {marks.map(({ m, base, tip }) => {
        const active = m.id === navTargetId
        const clickable = selectable(m)
        const colour = colourOf(m.kind)

        return (
          <g
            key={m.id}
            onClick={clickable ? () => onSelect(m.id) : undefined}
            style={{ cursor: clickable ? 'pointer' : 'default' }}
          >
            {/* Штрих высоты: от плоскости эклиптики (base) к телу (tip) — виден при наклоне. */}
            {Math.hypot(tip.x - base.x, tip.y - base.y) > 1 && (
              <line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} stroke={colour} strokeOpacity={0.35} />
            )}

            <g transform={`translate(${tip.x} ${tip.y})`}>
              {/* Кружок под палец: у планеты радиус 6 единиц, попасть в него мышью тяжело. */}
              {clickable && <circle r={18} fill="transparent" />}

              {m.kind === 'star' ? (
                <>
                  <circle r={16} fill={STAR} fillOpacity={0.15} />
                  <circle r={active ? 8 : 6.5} fill={STAR} />
                </>
              ) : m.kind === 'ship' ? (
                // Игрок — не точка, а нос: треугольник заметен среди кружков планет.
                <path d="M 0 -5 L 4 5 L 0 2.5 L -4 5 Z" fill={colour} />
              ) : m.kind === 'contact' ? (
                // Знакомый — ромб: не тело (кружок) и не игрок (нос), сразу отличишь.
                <path d="M 0 -5 L 5 0 L 0 5 L -5 0 Z" fill={colour} fillOpacity={0.85} />
              ) : m.kind === 'station' ? (
                <rect x={-4} y={-4} width={8} height={8} fill={colour} fillOpacity={active ? 0.9 : 0.6} />
              ) : m.kind === 'moon' ? (
                // Спутник вдвое мельче планеты: у своего мира он гость, а не ровня.
                <circle r={active ? 5 : 3} fill={colour} fillOpacity={active ? 0.9 : 0.5} />
              ) : (
                <circle r={active ? 8 : 6} fill={colour} fillOpacity={active ? 0.9 : 0.6} />
              )}

              {active && <circle r={16} fill="none" stroke={colour} strokeDasharray="3 4" />}

              <text
                x={13}
                y={4}
                fontSize={11}
                fill={colour}
                fillOpacity={0.85}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {properName(m.name)}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}
