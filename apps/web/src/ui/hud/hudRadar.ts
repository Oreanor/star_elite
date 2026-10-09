import { Vector3, type PerspectiveCamera } from 'three'
import {
  LANDING,
  MIELOPHONE,
  MONOLITH_NAMES,
  NAV_ASTEROID_NAME,
  nearestLandable,
  isStationBot,
  isVisible,
  shipAxes,
  warBaseFixtureWorldPos,
  lockedShipId,
  lockedPodId,
  lockedAsteroidId,
  lockedFixtureId,
} from '@elite/sim'
import { galaxyRadar } from '../../render/scene/galaxyRadar'
import { HUD_COLORS, circle, corners, dot, ellipse, line, text } from './draw'
import { figurineTitleLocal, properName } from '../i18n/dataNames'
import { formatDistance, projectPoint } from './project'
import { HudFrame, S, bodyColor, formatLy, galaxyStarName, hudFont, hudGalaxyFor, isOnScreen, offscreenArrow, radarColor } from './hudShared'

/**
 * Локатор в углу кабины (эллипс с метками тел, бортов, камней, деталей баз) и высотомер
 * рядом с ним. Отдельный прибор: меняется вместе со шкалой и раскладкой меток, а не с метками в кадре.
 */

const _fixtureAt = new Vector3()
const _fwd = new Vector3()
const _gtar = new Vector3()
const _point = new Vector3()
const _right = new Vector3()
const _up = new Vector3()

export function drawRadar(frame: HudFrame): void {
  const { ctx, camera, world, width, height } = frame
  const radiusX = 47 * 1.5 * S // ширина эллипса локатора (прежняя, ~70): читается на скорости
  const radiusY = 47 * 0.75 * S // высота на 25% МЕНЬШЕ прежней (47→35): локатор стал площе
  const cx = width - radiusX - 12 * S // снова в правом нижнем углу: по центру он мешал
  const cy = height - radiusY - 12 * S
  const FRAME_W = 2 // обод и лучи чуть толще одинарной линии — крупный локатор их держит

  // Высотомер — слева вплотную к ободу локатора: приборы «где я» стоят рядом.
  drawAltimeter(frame, cx - radiusX - 12 * S, cy - radiusY, cy + radiusY)

  ellipse(ctx, cx, cy, radiusX, radiusY, HUD_COLORS.DIM, FRAME_W)
  ellipse(ctx, cx, cy, radiusX / 2, radiusY / 2, HUD_COLORS.DIM, FRAME_W)
  line(ctx, cx, cy - 3 * S, cx, cy + 3 * S, HUD_COLORS.DIM, FRAME_W)
  line(ctx, cx - 3 * S, cy, cx + 3 * S, cy, HUD_COLORS.DIM, FRAME_W)

  // Локатор переключается на ГАЛАКТИКУ, только когда слой ПРОЯВИЛСЯ (gr.active) — тогда в
  // сфере видимости есть звёзды. Пока спит — система (за GHOST_BODY на локаторе только
  // своя звезда/дыра; соседи — с того же порога, что слой = GHOST_BODY).
  const gr = galaxyRadar()
  if (gr.active && gr.positions && gr.colors) {
    // Лучи поля зрения — как в системном режиме: по ним целишься носом на звезду.
    const gfov = (camera as PerspectiveCamera).fov
    const gHalf = Math.atan(Math.tan((gfov * Math.PI) / 360) * (width / height))
    for (const s of [-1, 1]) {
      const dx = Math.sin(gHalf) * s
      const dy = -Math.cos(gHalf)
      const reach = 1 / Math.hypot(dx / radiusX, dy / radiusY)
      line(ctx, cx, cy, cx + dx * reach, cy + dy * reach, HUD_COLORS.DIM)
    }

    const player = world.player
    shipAxes(player.state.quat, _fwd, _right, _up)
    // Сфера и точки — в св.г кадра (не в метрах): на миллионах × иначе локатор плывёт.
    const rangeLy = gr.layerScale > 0 ? gr.sphereRadius / gr.layerScale : 0
    if (rangeLy <= 0) return
    const pos = gr.positions
    const col = gr.colors
    const invLy = 1 / gr.layerScale
    const plx = (player.state.pos.x - gr.anchor.x) * invLy
    const ply = (player.state.pos.y - gr.anchor.y) * invLy
    const plz = (player.state.pos.z - gr.anchor.z) * invLy

    // Проецирует звезду (индекс·3) на локатор. `force` игнорирует сферу видимости (для
    // своей звезды — её показываем всегда). Возвращает экранную точку или null.
    const projStar = (b: number, force: boolean): { px: number; my: number } | null => {
      _point.set(pos[b]! - plx, pos[b + 1]! - ply, pos[b + 2]! - plz)
      const distSq = _point.lengthSq()
      if (!force && distSq > rangeLy * rangeLy) return null
      const distance = Math.sqrt(distSq) || 1
      const x = _point.dot(_right)
      const z = _point.dot(_fwd)
      const flat = Math.hypot(x, z)
      if (flat < 1e-6) return { px: cx, my: cy }
      const k = Math.min(1, distance / rangeLy)
      const px = cx + (x / flat) * k * radiusX
      const py = cy - (z / flat) * k * radiusY
      const lift = Math.max(-10 * S, Math.min(10 * S, (_point.dot(_up) / distance) * 20 * S))
      const my = py - lift
      if (Math.abs(lift) > S) line(ctx, px, py, px, my, HUD_COLORS.DIM)
      return { px, my }
    }

    for (let i = 0; i < gr.count; i++) {
      // Своя главная — ниже с кольцом; спутник своей двойной рисуем тут же (force).
      if (i === gr.originIndex) continue
      const b = i * 3
      const homeComp = i === gr.homeCompanionIndex
      const p = projStar(b, homeComp)
      if (!p) continue
      const color = `rgb(${Math.round(col[b]! * 255)},${Math.round(col[b + 1]! * 255)},${Math.round(col[b + 2]! * 255)})`
      dot(ctx, p.px, p.my, Math.max(1, (homeComp ? 2 : 1.5) * S), color)
    }

    // ВЫБРАННАЯ звезда (Tab / карта → jumpTargetIndex): только главные (systemCount).
    const tgt = world.jumpTargetIndex
    if (tgt != null && tgt !== gr.originIndex && tgt >= 0 && tgt < gr.systemCount) {
      const b = tgt * 3
      // Мир для ретикулы/стрелки; на локаторе — ly через projStar (стабильнее на большом ×).
      _gtar.set(
        gr.anchor.x + pos[b]! * gr.layerScale,
        gr.anchor.y + pos[b + 1]! * gr.layerScale,
        gr.anchor.z + pos[b + 2]! * gr.layerScale,
      )
      const remLy = Math.sqrt(
        (pos[b]! - plx) ** 2 + (pos[b + 1]! - ply) ** 2 + (pos[b + 2]! - plz) ** 2,
      )
      const starName = hudGalaxyFor(world)[tgt]?.name ?? galaxyStarName(world.galaxySeed, tgt)
      const title = starName ? properName(starName) : null
      const rangeLabel = formatLy(remLy)
      const arrowLabel = title ? `${title} · ${rangeLabel}` : rangeLabel

      const tp = projStar(b, true)
      if (tp) {
        dot(ctx, tp.px, tp.my, Math.max(1, 1.5 * S), HUD_COLORS.NAV)
        circle(ctx, tp.px, tp.my, 3.5 * S, HUD_COLORS.NAV)
        const inward = tp.px >= cx
        const lx = tp.px + (inward ? -5 : 5) * S
        const align = inward ? 'right' : 'left'
        if (title) text(ctx, title, lx, tp.my - 5 * S, HUD_COLORS.NAV, align)
        text(ctx, rangeLabel, lx, tp.my + 4 * S, HUD_COLORS.NAV, align)
      }

      const sp = projectPoint(_gtar, camera, width, height)
      if (!sp.behind && isOnScreen(sp.x, sp.y, width, height, 20 * S)) {
        corners(ctx, sp.x, sp.y, 16 * S, HUD_COLORS.NAV, 2)
        if (title) text(ctx, title, sp.x, sp.y + 14 * S, HUD_COLORS.NAV, 'center')
        text(ctx, rangeLabel, sp.x, sp.y + (title ? 22 : 14) * S, HUD_COLORS.NAV, 'center')
      } else {
        offscreenArrow(frame, _gtar, HUD_COLORS.NAV, true, arrowLabel)
      }
    }

    // СВОЯ звезда (текущая система) — ВСЕГДА, кольцом и подписью, даже вне сферы: это
    // бесшовная подмена «система → звезда галактики» и точка отсчёта. Прочие подтянутся
    // на радар по мере роста — игрок видит, куда всё сходится.
    const ownB = gr.originIndex * 3
    const own = projStar(ownB, true)
    if (own) {
      // Цвет — НАСТОЯЩИЙ цвет своей звезды из буфера слоя, а не HUD_COLORS.PRIMARY.
      // `PRIMARY` и `PLANET` — один и тот же #7fd6ff, и голубая точка своей звезды, которая
      // вдобавок нарисована `force` (вне сферы видимости, всегда), читалась как зависшая
      // планета: «Люрилар голубой так и висит на локаторе». Кольцо и подпись отличают её от
      // прочих звёзд, а цвет класса — от планеты.
      const ownColor = `rgb(${Math.round(col[ownB]! * 255)},${Math.round(col[ownB + 1]! * 255)},${Math.round(col[ownB + 2]! * 255)})`
      dot(ctx, own.px, own.my, Math.max(1, 2 * S), ownColor)
      circle(ctx, own.px, own.my, 3 * S, ownColor)
      text(ctx, properName(world.systemName), own.px - 5 * S, own.my - 3 * S, ownColor, 'right')
    }
    return
  }

  // Лучи границ угла зрения от центра ВВЕРХ (нос — вверху): что между ними, то в кадре
  // перед тобой; что снаружи — за краем экрана. Горизонтальный FOV выводим из вертикального
  // FOV камеры и соотношения сторон, лучи тянем до обода эллипса.
  const fov = (camera as PerspectiveCamera).fov
  const halfFov = Math.atan(Math.tan((fov * Math.PI) / 360) * (width / height))
  for (const s of [-1, 1]) {
    const dx = Math.sin(halfFov) * s
    const dy = -Math.cos(halfFov)
    const reach = 1 / Math.hypot(dx / radiusX, dy / radiusY) // до пересечения с эллипсом
    line(ctx, cx, cy, cx + dx * reach, cy + dy * reach, HUD_COLORS.DIM)
  }

  const player = world.player
  shipAxes(player.state.quat, _fwd, _right, _up)

  /**
   * Отметка. `ring` — обвести кольцом (захват, цель навигации). `shape` — форма
   * метки: небесные тела круглые, станции — ромбом, а всё подвижное (корабли,
   * обломки, платформы) — квадратом. Форма отвечает на вопрос «это место или это
   * цель?» ещё до цвета: по круглому и ромбу не стреляют, к ним летят.
   */
  const plot = (
    worldPos: Vector3,
    color: string,
    size: number,
    ring = false,
    shape: 'square' | 'round' | 'diamond' | 'ring' = 'square',
    /** Подпись у отметки — даём ТОЛЬКО выбранной нав-цели: подписать все значит не подписать
     *  ни одной (на логарифмической шкале отметки жмутся к ободу и надписи слипнутся). */
    label?: string,
  ) => {
    _point.copy(worldPos).sub(player.state.pos)
    const distance = _point.length()
    if (distance < 1) return

    const x = _point.dot(_right)
    const z = _point.dot(_fwd)
    const flat = Math.hypot(x, z)
    if (flat < 1e-3) return

    /**
     * Логарифм сжимает пять порядков дистанций в радиус радара — но только пять.
     *
     * Без зажима планета в четырёхстах тысячах километров давала `scaled` втрое
     * больше радиуса, и её отметка уезжала на середину экрана: локатор рисовал
     * тела ВНЕ собственного круга. Ушедшее за предел прижимается к ободу — это
     * честнее, чем не показать вовсе: «оно там, дальше уже неважно насколько».
     */
    const k = Math.min(1, Math.log10(1 + distance / 50) / Math.log10(1 + RADAR_RANGE / 50))
    // Эллипс: по горизонтали шкала шире (radiusX), по вертикали как была (radiusY).
    const px = cx + (x / flat) * k * radiusX
    const py = cy - (z / flat) * k * radiusY

    // Высота над плоскостью корабля — вертикальный штрих, как в Elite.
    const lift = Math.max(-10 * S, Math.min(10 * S, (_point.dot(_up) / distance) * 20 * S))
    if (Math.abs(lift) > S) line(ctx, px, py, px, py - lift, HUD_COLORS.DIM)

    const my = py - lift
    if (shape === 'ring') {
      // Кольцо: полая окружность с точкой в центре — рукотворная сфера-база.
      circle(ctx, px, my, Math.max(2, size), color)
      dot(ctx, px, my, Math.max(1, size * 0.3), color)
    } else if (shape === 'round') {
      dot(ctx, px, my, Math.max(1, size / 2), color)
    } else if (shape === 'diamond') {
      // Ромб КОНТУРОМ с точкой внутри (а не залитый): станция — «место, куда летят».
      // Ромбик держим чуть крупнее, чтобы точка внутри читалась; квадрат на угол.
      const r = size * 0.8
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(Math.round(px), Math.round(my - r))
      ctx.lineTo(Math.round(px + r), Math.round(my))
      ctx.lineTo(Math.round(px), Math.round(my + r))
      ctx.lineTo(Math.round(px - r), Math.round(my))
      ctx.closePath()
      ctx.stroke()
      dot(ctx, px, my, Math.max(1, r * 0.35), color)
    } else {
      ctx.fillStyle = color
      ctx.fillRect(Math.round(px - size / 2), Math.round(my - size / 2), size, size)
    }
    if (ring) circle(ctx, px, my, size, color)

    // Подпись выбранной цели: одно слово рядом с отметкой — чтобы её было видно СРАЗУ, а не
    // искать глазами кольцо среди прижатых к ободу точек. Кегль мелкий, шрифт возвращаем.
    if (label) {
      const baseFont = ctx.font
      ctx.font = `${Math.round(6 * S)}px "Consolas", "DejaVu Sans Mono", monospace`
      text(ctx, label.toUpperCase(), px + size + 3 * S, my - 3 * S, color, 'left')
      ctx.font = baseFont
    }
  }

  // Выше GHOST_BODY система для локатора растворилась: только звезда / дыра.
  // Иначе на миллионах × ромб Кориолиса и планеты ещё висят, пока галактика не проснулась.
  const stellarOnly = world.player.state.scale >= MIELOPHONE.GHOST_BODY_SCALE

  // Круг = место (звезда/планета/дыра/статуя), ромб = станция, квадрат = борт/обломок.
  // Кольцо — только у активной цели (захват или нав).
  for (const body of world.bodies) {
    if (stellarOnly && body.kind !== 'star' && body.kind !== 'blackhole') continue
    const nav = body.id === world.navTargetId
    const shape = body.kind === 'station' ? 'diamond' : 'round'
    const base = body.kind === 'star' || body.kind === 'blackhole' ? 3 : 2
    plot(body.pos, bodyColor(body), Math.round((nav ? base + 1 : base) * S), nav, shape, nav ? properName(body.name) : undefined)
  }

  if (stellarOnly) return

  for (const m of world.monoliths) {
    const nav = m.id === world.navTargetId
    plot(m.pos, HUD_COLORS.MONOLITH, Math.round((nav ? 3 : 2) * S), nav, 'round', nav ? properName(MONOLITH_NAMES[m.variant] ?? MONOLITH_NAMES[0]!) : undefined)
  }

  for (const f of world.figurines) {
    if (!f.alive) continue
    const nav = f.id === world.navTargetId
    plot(f.pos, HUD_COLORS.MONOLITH, Math.round((nav ? 3 : 2) * S), nav, 'round', nav ? figurineTitleLocal(f.titleId) : undefined)
  }

  for (const base of world.warBases) {
    if (!base.alive) continue
    const nav = base.id === world.navTargetId
    // Белым и КОЛЕЧКОМ: рукотворная сфера, а не бурая точка камня.
    plot(base.pos, HUD_COLORS.STATION, Math.round((nav ? 3 : 2) * S), true, 'ring', nav ? properName(base.name) : undefined)

    // Детали — отдельные отметки рядом с базой: по ним и наводятся, и бьют поштучно.
    // Мельче корпуса и без кольца, пока не захвачены: иначе рой точек забьёт локатор.
    for (const fix of base.fixtures) {
      if (!fix.alive) continue
      warBaseFixtureWorldPos(base, fix, world.time, _fixtureAt)
      if (_fixtureAt.distanceToSquared(player.state.pos) > ROCK_RANGE * ROCK_RANGE) continue
      plot(_fixtureAt, HUD_COLORS.STATION, Math.round(1.5 * S), fix.id === lockedFixtureId(world))
    }
  }

  for (const rock of world.asteroids) {
    if (!rock.alive) continue
    const nav = rock.id === world.navTargetId
    // Нав-глыбу держим на радаре всегда; мелочь — только рядом.
    if (!nav && rock.pos.distanceToSquared(player.state.pos) > ROCK_RANGE * ROCK_RANGE) continue
    const color = nav ? HUD_COLORS.MONOLITH : HUD_COLORS.ROCK
    const locked = rock.id === lockedAsteroidId(world)
    plot(rock.pos, color, Math.round((nav ? 3 : 1.5) * S), nav || locked, 'round', nav ? NAV_ASTEROID_NAME : undefined)
  }

  for (const pod of world.pods) {
    if (!pod.alive) continue
    plot(pod.pos, HUD_COLORS.WARN, Math.round(1.5 * S), pod.id === lockedPodId(world))
  }

  // Киты / платформы — крупнее рядового борта, без кольца (кольцо = только активный захват).
  for (const titan of world.titans) plot(titan.pos, HUD_COLORS.NEUTRAL, Math.round(3 * S), false, 'round')
  for (const platform of world.platforms) {
    if (!platform.alive) continue
    plot(platform.pos, HUD_COLORS.DANGER, Math.round(3 * S), false, 'square')
  }

  for (const ship of world.ships) {
    if (!isVisible(ship) || isStationBot(ship)) continue
    plot(ship.state.pos, radarColor(ship, world), Math.round(2 * S), ship.id === lockedShipId(world))
  }
}

/** Дальше этого локатор не разбирает дистанцию, м: отметка прижата к ободу. */
const RADAR_RANGE = 20_000
/** Ближе этого камни рисуются, м. Дальше они — не препятствие, а пейзаж. */
const ROCK_RANGE = 4_000

/**
 * ВЫСОТОМЕР: вертикальная лента слева от локатора. Молчит, пока под кораблём нет
 * поверхности, — это прибор режима «полёт над телом», а не постоянная строка.
 *
 * Он понадобился, когда выяснилось, что у крупной луны притяжение около 0.4 g и без тяги
 * борт проседает метра по три в секунду: летишь, маневрируешь, а высота уходит незаметно,
 * и касание выглядит беспричинным. Автоматически держать высоту было бы нечестно — значит
 * пилот обязан её ВИДЕТЬ.
 *
 * Шкала корневая, а не линейная: у земли важен каждый десяток метров, на километрах —
 * порядок. Метка ползёт снизу вверх, под лентой — число.
 */
export function drawAltimeter(frame: HudFrame, cx: number, top: number, bottom: number): void {
  const { ctx, world } = frame
  const near = nearestLandable(world, world.player)
  if (!near || near.altitude > LANDING.ALTIMETER_HI) return

  const altitude = Math.max(0, near.altitude)
  const t = Math.min(1, Math.sqrt(altitude / LANDING.ALTIMETER_HI))
  const y = bottom - (bottom - top) * t
  // Земля внизу — сплошная черта: от неё и отсчитывается всё остальное.
  line(ctx, cx, top, cx, bottom, HUD_COLORS.DIM)
  line(ctx, cx - 3 * S, bottom, cx + 3 * S, bottom, HUD_COLORS.DIM)
  // Окно входа в ховер (400…600 м) — засечка: пилот видит, где нажимать L.
  const promptY = bottom - (bottom - top) * Math.sqrt(LANDING.HOVER_ALT / LANDING.ALTIMETER_HI)
  line(ctx, cx - 2 * S, promptY, cx + 2 * S, promptY, HUD_COLORS.DIM)

  // Ниже окна посадки — жёлтая: это уже не «лечу», а «сейчас коснусь».
  const color = altitude < LANDING.PROMPT_LO ? HUD_COLORS.WARN : HUD_COLORS.PRIMARY
  line(ctx, cx, y, cx, bottom, color, 2)
  ctx.beginPath()
  ctx.moveTo(cx - 4 * S, y)
  ctx.lineTo(cx, y - 3 * S)
  ctx.lineTo(cx + 4 * S, y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()

  const baseFont = ctx.font
  ctx.font = hudFont(6 * S)
  text(ctx, formatDistance(altitude), cx, bottom + 9 * S, color, 'center')
  ctx.font = baseFont
}
