import { useState } from 'react'
import { UI } from '../theme'
import { Vector3 } from 'three'
import { shipAxes, type BodyEntity, type World } from '@elite/sim'

/**
 * Карта системы — голограмма над консолью.
 *
 * Вид сверху, плоскость XZ, оси МИРОВЫЕ: карта не крутится вместе с носом, иначе
 * ею невозможно пользоваться как картой. Куда повёрнут корабль, показывает игла
 * курса из центра.
 *
 * Центр — ИГРОК, а не звезда. Это не вкус: при логарифмическом радиусе от звезды
 * станция (814 км от неё), планета (797 км) и сам корабль (816 км) встают на
 * r = 275, 274 и 275 и различаются азимутом на 0.8° — то есть сливаются в одно
 * пятно шириной в четыре пикселя. От игрока те же тела расходятся на 63, 150 и 290.
 * Карта отвечает на вопрос «куда мне отсюда лететь», и меряет она от «отсюда».
 *
 * Радиус логарифмический: причал в двух километрах и звезда в восьмистах не
 * помещаются на один диск линейно. Высота (Y) не показывается наклоном — наклонная
 * проекция врёт о расстояниях, ради которых карту и открыли; вместо неё
 * вертикальный штрих, как на радаре.
 *
 * Карта ничего не решает: она пишет `world.navTargetId` и на этом заканчивается.
 */

/** Радиус диска в единицах SVG. */
const DISC = 300
const VIEW = 2 * DISC + 90
/** Максимальная длина штриха высоты. Длиннее — штрихи начинают спорить с телами. */
const LIFT = 46
/** Дальше этого штрих высоты уже не растёт, метры. Иначе газовый гигант съедает шкалу. */
const LIFT_RANGE = 60_000

/**
 * Голубой значит «цель навигации» — и здесь, и на HUD в кабине. Жёлтый в этой игре
 * занят боевым захватом, и красить им выбранную планету значило бы сказать игроку
 * «вот во что ты стреляешь». Выбранное тело выделяется не цветом, а размером,
 * плотностью заливки и пунктирным кольцом — тем же, чем скобки выделяют его в кабине.
 */
/** Тела — фосфором, корабли — другим тоном: это разные сущности, а не разная яркость. */
const BODY = UI.PRIMARY
const SHIP = UI.SALVAGE


type MarkerKind = BodyEntity['kind'] | 'ship'

interface Marker {
  /** У корабля своего id нет: он не тело. Отрицательный — значит, не выбирается. */
  id: number
  name: string
  kind: MarkerKind
  /** Точка на диске: азимут от игрока в плоскости XZ, радиус — по логарифму. */
  x: number
  y: number
  /** Штрих высоты в единицах SVG, вверх положительный. */
  lift: number
  /** До игрока, метры. */
  range: number
}

/** Логарифм сжимает четыре порядка дистанций в радиус диска. */
function radiusOf(flat: number, maxFlat: number): number {
  const kMax = Math.log10(1 + maxFlat / 500)
  return kMax > 0 ? (Math.log10(1 + flat / 500) / kMax) * DISC : 0
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

function markers(world: World): Marker[] {
  const origin = world.player.state.pos

  const raw = world.bodies.map((body) => ({
    id: body.id,
    name: body.name,
    kind: body.kind as MarkerKind,
    dx: body.pos.x - origin.x,
    dy: body.pos.y - origin.y,
    dz: body.pos.z - origin.z,
    range: body.pos.distanceTo(origin),
  }))

  const maxFlat = Math.max(...raw.map((m) => Math.hypot(m.dx, m.dz)), 1)

  const plotted: Marker[] = raw.map((m) => {
    const flat = Math.hypot(m.dx, m.dz)
    const r = radiusOf(flat, maxFlat)
    // Высота сжата к пределу, а не отнормирована на максимум: иначе далёкий
    // гигант, ушедший на 58 км вверх, прижал бы все остальные штрихи к нулю.
    const lift = Math.max(-1, Math.min(1, m.dy / LIFT_RANGE)) * LIFT
    return {
      id: m.id,
      name: m.name,
      kind: m.kind,
      x: flat > 1e-6 ? (m.dx / flat) * r : 0,
      y: flat > 1e-6 ? (m.dz / flat) * r : 0,
      lift,
      range: m.range,
    }
  })

  plotted.push({ id: -1, name: 'ТЫ', kind: 'ship', x: 0, y: 0, lift: 0, range: 0 })
  return plotted
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} км` : `${Math.round(metres)} м`
}

const selectable = (m: Marker) => m.kind === 'planet' || m.kind === 'station'

export function SystemMap({ world, onClose }: { world: World; onClose: () => void }) {
  // Мир мутируется напрямую; React о нём не знает и сам перерисоваться не может.
  const [, bump] = useState(0)

  const points = markers(world)
  const select = (id: number) => {
    world.navTargetId = world.navTargetId === id ? null : id
    bump((n) => n + 1)
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center backdrop-blur-md"
      style={{ background: 'radial-gradient(ellipse at center, rgba(12,34,60,0.66), rgba(0,3,8,0.93))' }}
    >
      <div
        className="flex items-stretch gap-6 rounded-2xl border p-7 font-mono"
        style={{
          borderColor: 'rgba(124,196,255,0.3)',
          background: 'linear-gradient(150deg, rgba(40,95,150,0.18), rgba(8,22,42,0.4))',
          boxShadow: '0 0 70px rgba(60,150,255,0.16), inset 0 0 90px rgba(80,180,255,0.06)',
        }}
      >
        <Hologram
          points={points}
          heading={headingOf(world)}
          navTargetId={world.navTargetId}
          onSelect={select}
        />

        <div className="flex w-72 shrink-0 flex-col" style={{ color: BODY }}>
          <h1 className="text-xl tracking-[0.3em]">{world.systemName.toUpperCase()}</h1>
          <p className="mb-6 mt-1 text-[11px] tracking-widest opacity-50">
            ОТ КОРАБЛЯ · ЛОГ. МАСШТАБ · ШТРИХ = ВЫСОТА
          </p>

          <ul className="space-y-1">
            {points.filter(selectable).map((m) => {
              const active = m.id === world.navTargetId
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => select(m.id)}
                    className="flex w-full cursor-pointer items-baseline gap-3 rounded border px-3 py-2 text-left text-sm transition-colors"
                    style={{
                      borderColor: active ? BODY : 'rgba(124,196,255,0.16)',
                      background: active ? 'rgba(124,196,255,0.12)' : 'transparent',
                      color: BODY,
                    }}
                  >
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-xs opacity-60">{formatDistance(m.range)}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          <p className="mt-6 text-[11px] leading-relaxed opacity-45">
            Клик по телу назначает его целью навигации; повторный — снимает. В полёте
            цель обведена рамкой, а из-за края кадра на неё указывает стрелка.
          </p>

          <button
            type="button"
            onClick={onClose}
            className="mt-auto w-full cursor-pointer rounded border py-2 text-sm tracking-[0.3em] transition-colors hover:bg-white/10"
            style={{ borderColor: BODY }}
          >
            M — ЗАКРЫТЬ
          </button>
        </div>
      </div>
    </div>
  )
}

function Hologram({
  points,
  heading,
  navTargetId,
  onSelect,
}: {
  points: Marker[]
  heading: { x: number; y: number }
  navTargetId: number | null
  onSelect: (id: number) => void
}) {
  return (
    <svg width={VIEW} height={VIEW} viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}>
      <defs>
        <radialGradient id="map-disc">
          <stop offset="0%" stopColor="rgba(124,196,255,0.15)" />
          <stop offset="70%" stopColor="rgba(124,196,255,0.035)" />
          <stop offset="100%" stopColor="rgba(124,196,255,0)" />
        </radialGradient>
      </defs>

      <circle r={DISC} fill="url(#map-disc)" />
      {/* Кольца — деления логарифмической шкалы, не орбиты. Подписать их дистанцией
          нельзя: она зависит от того, как далеко улетело самое дальнее тело. */}
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <circle key={k} r={DISC * k} fill="none" stroke="rgba(124,196,255,0.15)" strokeDasharray="2 6" />
      ))}
      <line x1={-DISC} y1={0} x2={DISC} y2={0} stroke="rgba(124,196,255,0.1)" />
      <line x1={0} y1={-DISC} x2={0} y2={DISC} stroke="rgba(124,196,255,0.1)" />

      {/* Игла курса: единственное, что связывает карту с тем, куда повёрнут нос. */}
      <line
        x1={0}
        y1={0}
        x2={heading.x * DISC}
        y2={heading.y * DISC}
        stroke={SHIP}
        strokeOpacity={0.28}
        strokeDasharray="6 5"
      />

      {points.map((m) => {
        const active = m.id === navTargetId
        const clickable = selectable(m)
        const colour = m.kind === 'ship' ? SHIP : BODY

        return (
          <g
            key={m.id}
            transform={`translate(${m.x} ${m.y})`}
            onClick={clickable ? () => onSelect(m.id) : undefined}
            style={{ cursor: clickable ? 'pointer' : 'default' }}
          >
            {/* Штрих от плоскости корабля к телу: единственный носитель высоты. */}
            {Math.abs(m.lift) > 1 && (
              <line x1={0} y1={0} x2={0} y2={-m.lift} stroke={colour} strokeOpacity={0.35} />
            )}

            <g transform={`translate(0 ${-m.lift})`}>
              {/* Кружок под палец: у планеты радиус 6 единиц, попасть в него мышью тяжело. */}
              {clickable && <circle r={18} fill="transparent" />}

              {m.kind === 'star' ? (
                <>
                  <circle r={15} fill="#ffdca0" fillOpacity={0.15} />
                  <circle r={5.5} fill="#ffe6a8" />
                </>
              ) : m.kind === 'ship' ? (
                <circle r={4} fill={colour} />
              ) : m.kind === 'station' ? (
                <rect x={-4} y={-4} width={8} height={8} fill={colour} fillOpacity={active ? 0.9 : 0.55} />
              ) : (
                <circle r={active ? 8 : 6} fill={colour} fillOpacity={active ? 0.9 : 0.55} />
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
                {m.name}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}
