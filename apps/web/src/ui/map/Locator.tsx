import { useState } from 'react'
import { Vector3 } from 'three'
import { isVisible, shipAxes, type BodyEntity, type ShipEntity, type World } from '@elite/sim'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { chassisName, occupationName, properName } from '../i18n/dataNames'

/**
 * Локатор — большой круглый радар консоли: вид сверху, нос корабля ВВЕРХ.
 *
 * Тот же прибор, что в углу кабины (`drawRadar`), но во весь экран и с наведением:
 * на дот можно навести курсор и прочитать, кто это. Проекция и логарифмическая
 * шкала — один в один кабинная, чтобы «слева на радаре» и «слева на локаторе»
 * означали одно место. Консоль на паузе (курсор отпущен), мир не движется —
 * снимок статичен, кадровый цикл не нужен, как и карте системы.
 */

/** Радиус диска, единицы SVG. */
const R = 300
/** Поле под подписи по краям. */
const PAD = 34
const VIEW = 2 * (R + PAD)
/** Дальше этого локатор не разбирает дистанцию, м: отметка прижата к ободу (как в кабине). */
const RANGE = 20_000
/** Максимальный штрих высоты над плоскостью корабля, единицы SVG. */
const LIFT = 26

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _rel = new Vector3()

/** Цвет корабля — тот же ответ «стрелять или нет», что в кабине. */
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
  /** Место на диске, единицы SVG (уже с учётом штриха высоты). */
  px: number
  py: number
  /** Длина штриха высоты вверх, единицы SVG (может быть отрицательной). */
  lift: number
  color: string
  shape: Shape
  size: number
  /** Обвести кольцом: цель боя, знакомый — их выделяем и здесь. */
  ring: boolean
  title: string
  subtitle: string
}

/** Проекция мировой точки на диск локатора. Null — если точка в самом центре (нечего рисовать). */
function project(world: World, pos: Vector3): { px: number; py: number; lift: number } | null {
  _rel.copy(pos).sub(world.player.state.pos)
  const dist = _rel.length()
  if (dist < 1) return null
  const x = _rel.dot(_right)
  const z = _rel.dot(_fwd)
  const flat = Math.hypot(x, z)
  if (flat < 1e-3) return null
  // Логарифм сжимает пять порядков дистанций в радиус диска; дальше предела — прижато к ободу.
  const k = Math.min(1, Math.log10(1 + dist / 50) / Math.log10(1 + RANGE / 50))
  const px = (x / flat) * k * R
  const py = -(z / flat) * k * R
  const lift = Math.max(-1, Math.min(1, _rel.dot(_up) / dist)) * LIFT
  return { px, py, lift }
}

/** Все, кого локатор видит: тела-места и корабли-кто. */
function blips(world: World): Blip[] {
  shipAxes(world.player.state.quat, _fwd, _right, _up)
  const out: Blip[] = []

  for (const body of world.bodies) {
    const p = project(world, body.pos)
    if (!p) continue
    const nav = body.id === world.navTargetId
    out.push({
      key: `body-${body.id}`,
      px: p.px,
      py: p.py,
      lift: p.lift,
      color: bodyColor(body),
      shape: body.kind === 'station' ? 'diamond' : 'round',
      size: body.kind === 'star' ? 11 : 7,
      ring: nav,
      title: properName(body.name),
      subtitle: t(`locator.kind.${body.kind}` as 'locator.kind.planet'),
    })
  }

  for (const ship of world.ships) {
    if (!isVisible(ship)) continue
    const p = project(world, ship.state.pos)
    if (!p) continue
    const marked = ship.id === world.lockedTargetId || ship.acquaintanceId != null
    out.push({
      key: `ship-${ship.id}`,
      px: p.px,
      py: p.py,
      lift: p.lift,
      color: shipColor(ship, world),
      shape: 'square',
      size: 7,
      ring: marked,
      title: ship.pilotName,
      subtitle: `${occupationName(ship.originKind, ship.faction)} · ${chassisName(ship.loadout.chassis.name)}`,
    })
  }

  return out
}

export function Locator({ world }: { world: World }) {
  useLang()
  const [hover, setHover] = useState<string | null>(null)
  const marks = blips(world)
  const active = marks.find((m) => m.key === hover) ?? null

  return (
    <div className="flex w-full items-start justify-center gap-6 py-2 font-mono">
      <div className="relative aspect-square w-full min-w-0 max-w-[34rem] shrink">
        <svg className="absolute inset-0 h-full w-full" viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}>
          <defs>
            <radialGradient id="locator-disc">
              <stop offset="0%" stopColor="rgba(124,196,255,0.14)" />
              <stop offset="70%" stopColor="rgba(124,196,255,0.03)" />
              <stop offset="100%" stopColor="rgba(124,196,255,0)" />
            </radialGradient>
          </defs>

          <circle r={R} fill="url(#locator-disc)" stroke="rgba(124,196,255,0.22)" />
          <circle r={R / 2} fill="none" stroke="rgba(124,196,255,0.12)" />
          <line x1={0} y1={-6} x2={0} y2={6} stroke="rgba(124,196,255,0.2)" />
          <line x1={-6} y1={0} x2={6} y2={0} stroke="rgba(124,196,255,0.2)" />
          {/* Нос — вверх: подпись у верхней кромки, чтобы читалось, куда смотрит корабль. */}
          <text x={0} y={-R - 12} fontSize={13} fill={UI.DIM} textAnchor="middle" style={{ pointerEvents: 'none' }}>
            {t('locator.nose')}
          </text>

          {/* Игрок в центре — нос вверх, как метка корабля на карте системы. */}
          <path d="M 0 -7 L 5 6 L 0 3 L -5 6 Z" fill={UI.SALVAGE} />

          {marks.map((m) => {
            const on = m.key === hover
            const my = m.py - m.lift
            return (
              <g
                key={m.key}
                onMouseEnter={() => setHover(m.key)}
                onMouseLeave={() => setHover((h) => (h === m.key ? null : h))}
                style={{ cursor: 'pointer' }}
              >
                {/* Крупная прозрачная мишень: попасть курсором в дот из семи единиц тяжело. */}
                <circle cx={m.px} cy={my} r={16} fill="transparent" />
                {/* Штрих высоты над плоскостью корабля — как в кабине. */}
                {Math.abs(m.lift) > 1 && (
                  <line x1={m.px} y1={m.py} x2={m.px} y2={my} stroke={m.color} strokeOpacity={0.35} />
                )}
                <Mark shape={m.shape} cx={m.px} cy={my} size={m.size} color={m.color} />
                {(m.ring || on) && (
                  <circle cx={m.px} cy={my} r={m.size + 4} fill="none" stroke={m.color} strokeOpacity={on ? 0.9 : 0.5} />
                )}
                {on && (
                  <text
                    x={m.px + m.size + 8}
                    y={my + 4}
                    fontSize={13}
                    fill={m.color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {m.title}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Кто под курсором. Пусто — подсказка «наведи», плюс счётчик контактов на диске. */}
      <div className="flex w-64 shrink-0 flex-col" style={{ color: UI.PRIMARY }}>
        <h1 className="text-xl tracking-[0.3em]">{t('locator.title')}</h1>
        <p className="mb-6 mt-1 text-[11px] tracking-widest opacity-50">
          {t('locator.count', { n: marks.length })}
        </p>
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
