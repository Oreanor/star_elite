import { useRef, useState } from 'react'
import { Vector3 } from 'three'
import { isVisible, shipAxes, type BodyEntity, type ShipEntity, type World } from '@elite/sim'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { chassisName, occupationName, properName } from '../i18n/dataNames'
import { useWheelZoom } from './useWheelZoom'

/**
 * Локатор — большой круглый радар консоли: вид сверху, нос корабля ВВЕРХ.
 *
 * Тот же прибор, что в углу кабины (`drawRadar`), но во весь экран и живой: его можно
 * КРУТИТЬ и НАКЛОНЯТЬ драгом (на себя — от себя), приближать колесом и наводиться на
 * отметку, чтобы прочитать, кто это. В кабине этого нет намеренно: там мыши нет, радар
 * плоский. Здесь панель на паузе (курсор отпущен), мир статичен — перерисовка на драг
 * дёшева, кадровый цикл не нужен.
 *
 * Наклон превращает круг в ЭЛЛИПС: все координаты пересчитываются проекцией
 * `project` — поворот в плоскости (yaw), затем наклон (tilt) сжимает ось «вперёд»
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
  if (ship.faction === 'hostile') return UI.DANGER
  if (ship.kinematic) return UI.PLAYER
  return ship.faction === world.player.faction ? UI.ALLY : UI.NEUTRAL
}

function bodyColor(body: BodyEntity): string {
  if (body.kind === 'star') return UI.STAR
  if (body.kind === 'station') return UI.STATION
  return UI.PRIMARY
}

type Shape = 'square' | 'round' | 'diamond'

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
  title: string
  subtitle: string
}

/** Проекция точки диска на экран: сперва поворот в плоскости, затем наклон и зум. */
function project(rt: number, fwd: number, h: number, yaw: number, tilt: number, zoom: number): { x: number; y: number; depth: number } {
  const rc = (rt * Math.cos(yaw) - fwd * Math.sin(yaw)) * zoom
  const fc = (rt * Math.sin(yaw) + fwd * Math.cos(yaw)) * zoom
  return { x: rc, y: -(fc * Math.cos(tilt) + h * zoom * Math.sin(tilt)), depth: fc }
}

/** Проекция мировой точки на плоскость диска (right/forward/height), null — в самом центре. */
function toDisc(world: World, pos: Vector3): { rt: number; fwd: number; h: number } | null {
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
  }
}

function blips(world: World): Blip[] {
  shipAxes(world.player.state.quat, _fwd, _right, _up)
  const out: Blip[] = []

  for (const body of world.bodies) {
    const d = toDisc(world, body.pos)
    if (!d) continue
    out.push({
      key: `body-${body.id}`,
      ...d,
      color: bodyColor(body),
      shape: body.kind === 'station' ? 'diamond' : 'round',
      size: body.kind === 'star' ? 11 : 7,
      ring: body.id === world.navTargetId,
      title: properName(body.name),
      subtitle: t(`locator.kind.${body.kind}` as 'locator.kind.planet'),
    })
  }

  for (const ship of world.ships) {
    if (!isVisible(ship)) continue
    const d = toDisc(world, ship.state.pos)
    if (!d) continue
    out.push({
      key: `ship-${ship.id}`,
      ...d,
      color: shipColor(ship, world),
      shape: 'square',
      size: 7,
      ring: ship.id === world.lockedTargetId || ship.acquaintanceId != null,
      title: ship.pilotName,
      subtitle: `${occupationName(ship.originKind, ship.faction)} · ${chassisName(ship.loadout.chassis.name)}`,
    })
  }

  return out
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
  const [hover, setHover] = useState<string | null>(null)
  // Поворот, наклон и зум диска. Наклон по умолчанию — лёгкий (радар-«тарелка»), но
  // 0 даёт честный вид сверху; крайние значения зажаты, чтобы диск не выворачивался.
  const [yaw, setYaw] = useState(0)
  const [tilt, setTilt] = useState(0.5)
  const [zoom, setZoom] = useState(1)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  useWheelZoom(box, (dy) => setZoom((z) => Math.min(3, Math.max(0.6, z * (dy > 0 ? 0.9 : 1.1)))))

  const proj = (rt: number, fwd: number, h: number) => project(rt, fwd, h, yaw, tilt, zoom)
  const cos = Math.cos(tilt)

  const marks = blips(world)
    .map((b) => ({ b, base: proj(b.rt, b.fwd, 0), tip: proj(b.rt, b.fwd, b.h) }))
    // Дальние (больше «вперёд» после поворота) рисуем первыми — ближние лягут поверх.
    .sort((a, b) => b.base.depth - a.base.depth)
  const active = marks.find((m) => m.b.key === hover)?.b ?? null

  // Обод, сетка и конус — через ту же проекцию. Кольца сетки: эллипсы rx=r·zoom, ry=r·cos·zoom.
  const gridRings = [0.25, 0.5, 0.75, 1]
  const spokes = [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3) // радиальные лучи через 60°
  const fovA = proj(Math.sin(HALF_FOV) * R, Math.cos(HALF_FOV) * R, 0)
  const fovB = proj(Math.sin(-HALF_FOV) * R, Math.cos(-HALF_FOV) * R, 0)

  return (
    <div className="flex w-full items-start gap-6 py-1 font-mono">
      {/* Единый расклад всех трёх карт: диск в левых 2/3 (центрован), инфо — в правой 1/3. */}
      <div className="flex w-2/3 justify-center">
      <div
        ref={box}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const s = drag.current
          if (!s) return
          setYaw((y) => y - (e.clientX - s.x) * 0.008)
          setTilt((tl) => Math.max(0, Math.min(1.35, tl + (e.clientY - s.y) * 0.006)))
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        // Круг обязан влезать в высоту панели, иначе появляется скролл: сторона квадрата
        // ограничена и шириной колонки, и оставшейся высотой экрана. Хром консоли над
        // картой (шапка + вкладки + ряд видов) ≈16rem — вычитаем с запасом, чтоб не скроллило.
        className="relative aspect-square w-full max-w-[min(31rem,calc(100vh-17rem))] shrink cursor-grab touch-none select-none active:cursor-grabbing"
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
                style={{ cursor: 'pointer' }}
              >
                <circle cx={tip.x} cy={tip.y} r={16} fill="transparent" />
                {/* Штрих высоты: от плоскости (base) к отметке (tip) — виден при наклоне. */}
                {Math.hypot(tip.x - base.x, tip.y - base.y) > 1 && (
                  <line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} stroke={b.color} strokeOpacity={0.35} />
                )}
                <Mark shape={b.shape} cx={tip.x} cy={tip.y} size={b.size} color={b.color} />
                {(b.ring || on) && (
                  <circle cx={tip.x} cy={tip.y} r={b.size + 4} fill="none" stroke={b.color} strokeOpacity={on ? 0.9 : 0.5} />
                )}
                {on && (
                  <text x={tip.x + b.size + 8} y={tip.y + 4} fontSize={13} fill={b.color} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {b.title}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      </div>

      <div className="flex w-1/3 shrink-0 flex-col" style={{ color: UI.PRIMARY }}>
        <h1 className="text-xl tracking-[0.3em]">{t('locator.title')}</h1>
        <p className="mb-6 mt-1 text-[11px] tracking-widest opacity-50">{t('locator.count', { n: marks.length })}</p>
        {active ? (
          <div className="rounded border p-4" style={{ borderColor: 'rgba(124,196,255,0.24)' }}>
            <div className="text-base tracking-widest" style={{ color: active.color }}>
              {active.title}
            </div>
            <div className="mt-1 text-xs tracking-widest opacity-70">{active.subtitle}</div>
          </div>
        ) : (
          <p className="text-sm opacity-60">{t('locator.hint')}</p>
        )}
        <p className="mt-4 text-[11px] leading-relaxed opacity-40">{t('locator.controls')}</p>
      </div>
    </div>
  )
}

function Mark({ shape, cx, cy, size, color }: { shape: Shape; cx: number; cy: number; size: number; color: string }) {
  const r = size / 2
  if (shape === 'round') return <circle cx={cx} cy={cy} r={r} fill={color} />
  if (shape === 'diamond')
    return <path d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`} fill={color} />
  return <rect x={cx - r} y={cy - r} width={size} height={size} fill={color} />
}
