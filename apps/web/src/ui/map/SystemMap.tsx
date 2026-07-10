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
/**
 * Каждому роду тел — свой тон. Это не украшение: в списке из семи строк «звезда»
 * и «планета» различаются только цветом, читать слово целиком не приходится.
 * Звезда светит своим светом, причал — рукотворный и потому белый, планеты —
 * фосфор консоли. Корабли — четвёртый тон: они не тела.
 */
const BODY = UI.PRIMARY
const SHIP = UI.SALVAGE
const STAR = '#ffe6a8'
const STATION = '#ffffff'

const colourOf = (kind: MarkerKind): string =>
  kind === 'star' ? STAR : kind === 'station' ? STATION : kind === 'ship' ? SHIP : BODY


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
  /** Тело не влезло в текущий обзор и прижато к ободу. */
  beyond: boolean
}

/**
 * Сколько порядков дистанции умещается на диске. Ближе `span/DEPTH` от корабля
 * всё сливается в центральную точку — за этим и нужен масштаб.
 *
 * Шесть порядков — компромисс, и он честный. Система тянется от причала в двух
 * километрах до гиганта в пяти астрономических единицах, а это восемь с половиной
 * порядков: показать разом всё нельзя ничем, кроме лжи о расстояниях. Меньше
 * порядков — колесо крутится резче, но при обзоре «вся система» планета у звезды
 * падает в центральную точку вместе со станцией. Больше — картинка стоит на месте.
 */
const DEPTH = 1e6

/**
 * Логарифм сжимает шесть порядков дистанций в радиус диска.
 *
 * Логарифм берётся от ДОЛИ обзора (`flat/span`), а не от самой дистанции в метрах.
 * Абсолютный логарифм не масштабировался вовсе: делить `lg(1+d/500)` на
 * `lg(1+span/500)` — значит менять радиус планеты с 0.45 на 0.50 при восьмикратном
 * сужении обзора. Колесо крутилось, картинка стояла.
 *
 * Теперь на ободе всегда `span`, а в центре — `span/DEPTH`, и сужение обзора
 * честно разводит то, что в нём осталось. Уехавшее за обод прижимается к нему:
 * тело не исчезает, просто дальше уже некуда.
 */
function radiusOf(flat: number, span: number): number {
  if (span <= 0) return 0
  const k = Math.log10(1 + (flat / span) * DEPTH) / Math.log10(1 + DEPTH)
  return Math.min(1, k) * DISC
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

/** Что помещается на диск при масштабе «вся система», метры. */
function systemSpan(world: World): number {
  const origin = world.player.state.pos
  return Math.max(...world.bodies.map((b) => Math.hypot(b.pos.x - origin.x, b.pos.z - origin.z)), 1)
}

function markers(world: World, span: number): Marker[] {
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

  const plotted: Marker[] = raw.map((m) => {
    const flat = Math.hypot(m.dx, m.dz)
    const r = radiusOf(flat, span)
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
      beyond: flat > span,
    }
  })

  plotted.push({ id: -1, name: 'ТЫ', kind: 'ship', x: 0, y: 0, lift: 0, range: 0, beyond: false })
  return plotted
}

/** Астрономическая единица, м. Планетные дистанции в километрах нечитаемы. */
const AU = 149_597_870_700

function formatDistance(metres: number): string {
  if (metres >= 0.02 * AU) return `${(metres / AU).toFixed(2)} а.е.`
  if (metres >= 1e6) return `${Math.round(metres / 1000).toLocaleString('ru')} км`
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} км`
  return `${Math.round(metres)} м`
}

/** Ближе этого обзор не сужается, м: пояс обломков и станция ещё различимы. */
const MIN_SPAN = 2_000
/** Дальше системы смотреть не на что: за последним телом пусто. */
const MAX_SPAN_K = 1.6

const clampSpan = (span: number, fit: number) => Math.max(MIN_SPAN, Math.min(fit * MAX_SPAN_K, span))

/**
 * Выбирается всё, что стоит на месте: звезда, планета, причал. Корабль — нет:
 * он летит, и «цель навигации» на нём означала бы преследование, а не курс.
 *
 * Звезда тоже цель. Она нарисована, до неё летят за топливом, и запрещать её
 * было бы правилом ради правила: крейсер сам не даст в неё врезаться — потолок
 * множителя падает вместе с высотой над короной.
 */
const selectable = (m: Marker) => m.kind !== 'ship'

export function SystemMap({ world, onClose }: { world: World; onClose: () => void }) {
  // Мир мутируется напрямую; React о нём не знает и сам перерисоваться не может.
  const [, bump] = useState(0)

  /**
   * Обзор в метрах. `null` — «вся система»: карта открывается так, чтобы самое
   * дальнее тело лежало на ободе. Хранить сюда сразу число нельзя — прыжок сменит
   * систему, и обзор остался бы от прежней.
   */
  const fit = systemSpan(world)
  const [span, setSpan] = useState<number | null>(null)
  const shown = clampSpan(span ?? fit, fit)

  const points = markers(world, shown)
  const select = (id: number) => {
    world.navTargetId = world.navTargetId === id ? null : id
    bump((n) => n + 1)
  }
  const zoom = (deltaY: number) => setSpan(clampSpan(shown * (deltaY > 0 ? 1.3 : 1 / 1.3), fit))

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
          onZoom={zoom}
        />

        <div className="flex w-72 shrink-0 flex-col" style={{ color: BODY }}>
          <h1 className="text-xl tracking-[0.3em]">{world.systemName.toUpperCase()}</h1>
          {/* Обод диска в метрах: без него колесо крутит масштаб вслепую. */}
          <p className="mb-6 mt-1 text-[11px] tracking-widest opacity-50">ОБЗОР {formatDistance(shown)}</p>

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
                      color: colourOf(m.kind),
                    }}
                  >
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-xs opacity-60">{formatDistance(m.range)}</span>
                  </button>
                </li>
              )
            })}
          </ul>

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
  onZoom,
}: {
  points: Marker[]
  heading: { x: number; y: number }
  navTargetId: number | null
  onSelect: (id: number) => void
  onZoom: (deltaY: number) => void
}) {
  return (
    <svg
      width={VIEW}
      height={VIEW}
      viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
      onWheel={(e) => onZoom(e.deltaY)}
    >
      <defs>
        <radialGradient id="map-disc">
          <stop offset="0%" stopColor="rgba(124,196,255,0.15)" />
          <stop offset="70%" stopColor="rgba(124,196,255,0.035)" />
          <stop offset="100%" stopColor="rgba(124,196,255,0)" />
        </radialGradient>
      </defs>

      <circle r={DISC} fill="url(#map-disc)" />
      {/* Кольца — деления логарифмической шкалы, не орбиты. Подписать их дистанцией
          нельзя: шкала логарифмическая, и деления не равноотстоят. Обод — обзор,
          он подписан в панели. */}
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
        const colour = colourOf(m.kind)

        return (
          <g
            key={m.id}
            transform={`translate(${m.x} ${m.y})`}
            onClick={clickable ? () => onSelect(m.id) : undefined}
            style={{ cursor: clickable ? 'pointer' : 'default' }}
            // Прижатое к ободу тело гаснет: иначе оно врёт о своей дистанции,
            // притворяясь, что стоит там, где кончилась шкала.
            opacity={m.beyond ? 0.4 : 1}
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
                  <circle r={15} fill={STAR} fillOpacity={0.15} />
                  <circle r={5.5} fill={STAR} />
                </>
              ) : m.kind === 'ship' ? (
                <circle r={4} fill={colour} />
              ) : m.kind === 'station' ? (
                <rect x={-4} y={-4} width={8} height={8} fill={colour} fillOpacity={active ? 0.9 : 0.55} />
              ) : m.kind === 'moon' ? (
                // Спутник вдвое мельче планеты: у своего мира он гость, а не ровня.
                <circle r={active ? 5 : 3} fill={colour} fillOpacity={active ? 0.9 : 0.45} />
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
