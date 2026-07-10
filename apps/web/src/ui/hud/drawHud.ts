import { Vector3, type Camera } from 'three'
import {
  AUTODOCK,
  CRUISE,
  DOCKING,
  GUNNERY,
  canDockAt,
  energyFraction,
  findBody,
  findStation,
  autofightActive,
  bombReady,
  clamp,
  incomingMissile,
  isCruising,
  itemName,
  missileAmmo,
  nearestPod,
  peakHeat,
  isVisible,
  scoopReadiness,
  shipAxes,
  stationRange,
  type BodyEntity,
  type ShipEntity,
  type World,
} from '@elite/sim'
import { bombFlash, bombRing } from '../../render/bombFeel'
import { HUD_SCALE } from '../../render/config'
import { HUD_COLORS, bar, circle, corners, dot, line, rect, text } from './draw'
import { drawFlare } from './drawFlare'
import { angularSize, formatDistance, formatSpeed, projectPoint } from './project'

/**
 * Вся отрисовка HUD. Императивная, в кадре, без React.
 *
 * Все РАЗМЕРЫ умножаются на HUD_SCALE. Координаты спроецированных целей — нет:
 * рамка обязана стоять там, где корабль.
 */

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _point = new Vector3()
const _velocityDir = new Vector3()

const S = HUD_SCALE

export interface HudFrame {
  ctx: CanvasRenderingContext2D
  camera: Camera
  world: World
  width: number
  height: number
  /** За штурвалом автопилот. Это состояние сессии, а не мира: домен о нём не знает. */
  autodock: boolean
  /** Сглаженная частота кадров. Ни на что в игре не влияет — только показывается. */
  fps: number
}

export function drawHud(frame: HudFrame): void {
  const { ctx, width, height, world } = frame

  ctx.clearRect(0, 0, width, height)
  ctx.font = `${Math.round(9 * S)}px "Consolas", "DejaVu Sans Mono", monospace`

  // Блик объектива — первым: он лежит на кадре, а приборы лежат на нём.
  drawFlare(ctx, frame.camera, world, width, height)

  // Счётчик кадров рисуется ДО проверки на гибель: узнать, во что превратилась
  // частота, важнее всего именно тогда, когда на экране взрыв.
  drawFps(frame)

  // Экран смерти — React-оверлей: там нужны кнопки и курсор.
  if (!world.player.alive) return

  drawBodyMarkers(frame)
  drawTargets(frame)
  drawPods(frame)
  drawOffscreenArrows(frame)
  drawGunsight(frame)
  drawFlightPathMarker(frame)
  drawRadar(frame)
  drawReadouts(frame)
  drawCruise(frame)
  drawDocking(frame)
  drawAlerts(frame)

  // Последним: круг бомбы бьёт поверх всего, включая прицел.
  drawBombBurst(frame)
}

/** Ракета ближе этого по времени — тревога. Дальше пилоту не о чем волноваться, с. */
const MISSILE_ALERT_SECONDS = 6

/** Дальше этого контейнеры не обводим: иначе после боя экран зарастает рамками. */
const POD_MARK_RANGE = 900

/**
 * Контейнеры: рамка у каждого близкого, надпись — у ближайшего.
 *
 * Надпись показывает ГОТОВНОСТЬ, а не факт: подбор срабатывает сам, стоит войти
 * в радиус, поэтому лампа «по факту» горела бы один кадр над пустотой. Пилот
 * должен знать заранее, тормозить ему или разгружаться, — и правило, по которому
 * это решается, живёт в домене (`scoopReadiness`), а не переписано здесь заново.
 */
function drawPods(frame: HudFrame): void {
  const { ctx, camera, world, width, height } = frame
  const player = world.player

  for (const pod of world.pods) {
    if (!pod.alive) continue

    const p = projectPoint(pod.pos, camera, width, height)
    if (p.behind || p.distance > POD_MARK_RANGE || !isOnScreen(p.x, p.y, width, height, 10 * S)) continue

    const ready = scoopReadiness(player, pod) === null
    // Рамка мелкая намеренно: контейнер — не цель, и путать его с кораблём нельзя.
    corners(ctx, p.x, p.y, 9 * S, ready ? HUD_COLORS.PRIMARY : HUD_COLORS.WARN)
  }

  const pod = nearestPod(world, POD_MARK_RANGE)
  if (!pod) return

  const p = projectPoint(pod.pos, camera, width, height)
  if (p.behind || !isOnScreen(p.x, p.y, width, height, 10 * S)) return

  const readiness = scoopReadiness(player, pod)

  /**
   * Про скорость больше не просим: луч сам гасит относительную скорость, и совет
   * «тормози» устарел бы ровно в тот момент, когда пилот зажимает C. Зато полный
   * трюм лучом не лечится — об этом сказать надо.
   */
  const label =
    readiness === 'full'
      ? 'ТРЮМ ПОЛОН'
      : readiness === null
        ? `ЗАХВАТ · ${itemName(pod.item)}`
        : pod.tractored
          ? `ЛУЧ · ${itemName(pod.item)}`
          : `C — ПРИТЯНУТЬ · ${itemName(pod.item)}`

  const color = readiness === 'full' ? HUD_COLORS.WARN : HUD_COLORS.PRIMARY
  text(ctx, label, p.x, p.y + 12 * S, color, 'center')
  text(ctx, formatDistance(p.distance), p.x, p.y - 18 * S, color, 'center')
}

/**
 * Счётчик кадров в правом верхнем углу.
 *
 * Цвет несёт вердикт, чтобы не пришлось помнить, много шестьдесят или мало:
 * зелёный — плавно, оранжевый — просело, красный — играть уже нельзя.
 */
function drawFps({ ctx, width, fps }: HudFrame): void {
  const color = fps >= 55 ? HUD_COLORS.DIM : fps >= 30 ? HUD_COLORS.WARN : HUD_COLORS.DANGER
  text(ctx, `${Math.round(fps)} FPS`, width - 6 * S, 5 * S, color, 'right')
}

/** Частота мигания лампы стыковки, Гц. Медленнее — не заметишь, быстрее — раздражает. */
const DOCK_BLINK_HZ = 2.2

type DockState = 'engaged' | 'ready' | 'too-fast' | 'approach'

function dockState(world: World, station: BodyEntity, autodock: boolean): DockState {
  if (autodock) return 'engaged'
  if (canDockAt(world.player, station)) return 'ready'
  // Причал рядом, а скорость больше разрешённой — это не стыковка, а таран.
  if (stationRange(world.player, station) < DOCKING.RANGE) return 'too-fast'
  return 'approach'
}

/**
 * Индикатор стыковки: лампа и надпись. Молчит, пока станция дальше, чем берётся
 * автопилот, — HUD и так тесный, а лампа, горящая всегда, ничего не сообщает.
 *
 * Лампа МИГАЕТ, когда от тебя ждут действия (можно стыковаться, надо сбросить
 * скорость), и горит ровно, когда действовать не нужно: ведёт автопилот или
 * ты просто подлетаешь. Мигание — это просьба, а не украшение.
 */
function drawDocking(frame: HudFrame): void {
  const { ctx, world, width, height, autodock } = frame

  const station = findStation(world)
  if (!station) return

  const range = stationRange(world.player, station)
  if (range > AUTODOCK.ENGAGE_RANGE) return

  const state = dockState(world, station, autodock)

  const color =
    state === 'ready' ? HUD_COLORS.PRIMARY : state === 'too-fast' ? HUD_COLORS.WARN : HUD_COLORS.DIM

  const label =
    state === 'engaged'
      ? `АВТОПИЛОТ · ПРИЧАЛ ${formatDistance(range)} · L — ОТМЕНА`
      : state === 'ready'
        ? 'ПРИЧАЛ СВОБОДЕН · L — СТЫКОВКА'
        : state === 'too-fast'
          ? `СБРОСЬ СКОРОСТЬ ДО ${DOCKING.MAX_SPEED} М/С`
          : `L — АВТОСТЫКОВКА · ПРИЧАЛ ${formatDistance(range)}`

  const blinking = state === 'ready' || state === 'too-fast'
  const lit = !blinking || Math.sin(world.time * DOCK_BLINK_HZ * Math.PI * 2) > 0

  // Панель по ширине надписи: пустая рамка вокруг короткого текста читается как брак.
  const textWidth = ctx.measureText(label).width
  const boxWidth = textWidth + 30 * S
  const boxHeight = 17 * S
  const boxX = Math.round((width - boxWidth) / 2)
  const boxY = Math.round(height - 34 * S)

  rect(ctx, boxX, boxY, boxWidth, boxHeight, lit ? color : HUD_COLORS.DIM)
  dot(ctx, boxX + 11 * S, boxY + boxHeight / 2, 3.5 * S, lit ? color : HUD_COLORS.DIM)
  text(ctx, label, boxX + 21 * S, boxY + 4 * S, lit ? color : HUD_COLORS.DIM)
}

/**
 * Прицел — там, где СХОДЯТСЯ СТВОЛЫ, а не там, где мышь.
 * Мышь у нас виртуальная ручка: она задаёт угловую скорость, а не точку.
 * Луч летит по носу, значит и перекрестье стоит по носу.
 */
function drawGunsight({ ctx, camera, world, width, height }: HudFrame): void {
  const state = world.player.state
  shipAxes(state.quat, _fwd, _right, _up)
  _point.copy(state.pos).addScaledVector(_fwd, GUNNERY.CONVERGENCE)

  const p = projectPoint(_point, camera, width, height)
  if (p.behind) return

  const heat = peakHeat(world.player)
  const color = heat >= 1 ? HUD_COLORS.DANGER : heat > 0.7 ? HUD_COLORS.WARN : HUD_COLORS.PRIMARY

  circle(ctx, p.x, p.y, 5 * S, color)
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    line(ctx, p.x + dx * 9 * S, p.y + dy * 9 * S, p.x + dx * 6 * S, p.y + dy * 6 * S, color)
  }
}

/**
 * Маркер вектора скорости. Единственный прибор, который честно показывает,
 * что корабль летит не туда, куда смотрит нос. Ради него всё и затевалось.
 */
function drawFlightPathMarker({ ctx, camera, world, width, height }: HudFrame): void {
  const state = world.player.state
  if (state.vel.length() < 1) return

  _velocityDir.copy(state.vel).normalize()
  _point.copy(state.pos).addScaledVector(_velocityDir, 200)

  const p = projectPoint(_point, camera, width, height)
  if (p.behind) return

  const color = HUD_COLORS.DIM
  circle(ctx, p.x, p.y, 3 * S, color)
  line(ctx, p.x - 7 * S, p.y, p.x - 3 * S, p.y, color)
  line(ctx, p.x + 3 * S, p.y, p.x + 7 * S, p.y, color)
  line(ctx, p.x, p.y - 7 * S, p.x, p.y - 3 * S, color)
}

function isOnScreen(x: number, y: number, width: number, height: number, margin = 0): boolean {
  return x >= -margin && x <= width + margin && y >= -margin && y <= height + margin
}

/** Рамки враждебных кораблей. Захваченная выделена цветом и подписана. */
function drawTargets({ ctx, camera, world, width, height }: HudFrame): void {
  for (const ship of world.ships) {
    if (!ship.alive) continue

    const p = projectPoint(ship.state.pos, camera, width, height)
    if (p.behind || !isOnScreen(p.x, p.y, width, height, 20 * S)) continue

    const locked = ship.id === world.lockedTargetId
    const color = radarColor(ship, world)

    // Минимум крупный: корабль в 12 м на километре занимает меньше пикселя,
    // и без рамки его физически не найти глазом.
    const size = Math.max(14 * S, Math.min(90 * S, angularSize(ship.spec.hull.radius, p.distance) * height * 1.2))
    corners(ctx, p.x, p.y, size, color)

    // Дистанция у каждого врага, а не только у захваченного: она нужна, чтобы
    // понять, кто рядом, а кто в километре.
    text(ctx, formatDistance(p.distance), p.x, p.y + size / 2 + 3 * S, color, 'center')

    if (locked) {
      text(ctx, ship.name, p.x, p.y + size / 2 + 13 * S, color, 'center')

      const shield = ship.spec.hull.shield > 0 ? ship.shield / ship.spec.hull.shield : 0
      const hull = ship.hull / ship.spec.hull.hull
      bar(ctx, p.x - 20 * S, p.y - size / 2 - 10 * S, 40 * S, 3 * S, shield, HUD_COLORS.PRIMARY)
      bar(ctx, p.x - 20 * S, p.y - size / 2 - 5 * S, 40 * S, 3 * S, hull, HUD_COLORS.DANGER)
    }
  }
}

/**
 * Стрелки к целям вне кадра. Без них противник, ушедший за спину, просто исчезает,
 * и найти его можно только вращением наугад. По той же причине стрелка нужна цели
 * навигации: карта отвечает, КУДА лететь, но не в какую сторону поворачивать нос.
 */
function drawOffscreenArrows(frame: HudFrame): void {
  const { world } = frame

  for (const ship of world.ships) {
    if (!ship.alive) continue
    const color = ship.id === world.lockedTargetId ? HUD_COLORS.TARGET : HUD_COLORS.DANGER
    offscreenArrow(frame, ship.state.pos, color)
  }

  const nav = findBody(world, world.navTargetId)
  if (nav) offscreenArrow(frame, nav.pos, HUD_COLORS.NAV)
}

/** Рисует треугольник у края кадра, если точка за кадром. Иначе молчит. */
function offscreenArrow({ ctx, camera, width, height }: HudFrame, pos: Vector3, color: string): void {
  const p = projectPoint(pos, camera, width, height)
  if (!p.behind && isOnScreen(p.x, p.y, width, height, 20 * S)) return

  const cx = width / 2
  const cy = height / 2
  const inset = 26 * S

  // За камерой проекция зеркалит точку: разворачиваем её обратно вокруг центра.
  let dx = p.x - cx
  let dy = p.y - cy
  if (p.behind) {
    dx = -dx
    dy = -dy
  }

  const length = Math.hypot(dx, dy)
  if (length < 1e-3) return
  dx /= length
  dy /= length

  // Упираем стрелку в границу прямоугольника экрана с отступом.
  const scale = Math.min((cx - inset) / Math.abs(dx || 1e-6), (cy - inset) / Math.abs(dy || 1e-6))
  const ax = cx + dx * scale
  const ay = cy + dy * scale
  const size = 7 * S

  // Треугольник, смотрящий наружу.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(ax + dx * size, ay + dy * size)
  ctx.lineTo(ax - dy * size * 0.6 - dx * size * 0.4, ay + dx * size * 0.6 - dy * size * 0.4)
  ctx.lineTo(ax + dy * size * 0.6 - dx * size * 0.4, ay - dx * size * 0.6 - dy * size * 0.4)
  ctx.closePath()
  ctx.fill()

  text(ctx, formatDistance(p.distance), ax - dx * size * 2.4, ay - dy * size * 2.4 - 4 * S, color, 'center')
}

/**
 * Планеты, станция, звезда. Метка — точка с подписью, и только.
 *
 * Обводить планету кольцом по краю диска бессмысленно: вблизи она занимает сорок
 * градусов неба, и кольцо уезжает за кадр, а вдали её и так видно как точку.
 * Метка обязана говорить «тело здесь», а не повторять его силуэт.
 */
function drawBodyMarkers({ ctx, camera, world, width, height }: HudFrame): void {
  for (const body of world.bodies) {
    const p = projectPoint(body.pos, camera, width, height)
    if (p.behind || !isOnScreen(p.x, p.y, width, height)) continue

    const nav = body.id === world.navTargetId
    const color = nav ? HUD_COLORS.NAV : HUD_COLORS.DIM

    // Цель навигации — точка потолще: цвет на звёздном фоне различим плохо,
    // а разница в размере читается даже боковым зрением.
    dot(ctx, p.x, p.y, nav ? 2.5 * S : 1.5 * S, color)

    text(ctx, body.name, p.x + 6 * S, p.y - 5 * S, color)
    text(ctx, formatDistance(p.distance), p.x + 6 * S, p.y + 5 * S, color)
  }
}

/**
 * Радар: вид сверху, нос — вверх. Показывает и корабли, и тела, поэтому шкала
 * логарифмическая: иначе планета в 400 км сплющит всё остальное к центру.
 */
function drawRadar({ ctx, world, width, height }: HudFrame): void {
  const radius = 36 * S
  const cx = width - radius - 12 * S
  const cy = height - radius - 12 * S

  circle(ctx, cx, cy, radius, HUD_COLORS.DIM)
  circle(ctx, cx, cy, radius / 2, HUD_COLORS.DIM)
  line(ctx, cx, cy - 3 * S, cx, cy + 3 * S, HUD_COLORS.DIM)
  line(ctx, cx - 3 * S, cy, cx + 3 * S, cy, HUD_COLORS.DIM)

  const player = world.player
  shipAxes(player.state.quat, _fwd, _right, _up)

  const plot = (worldPos: Vector3, color: string, size: number) => {
    _point.copy(worldPos).sub(player.state.pos)
    const distance = _point.length()
    if (distance < 1) return

    const x = _point.dot(_right)
    const z = _point.dot(_fwd)
    const flat = Math.hypot(x, z)
    if (flat < 1e-3) return

    // Логарифм сжимает пять порядков дистанций в радиус радара.
    const scaled = (Math.log10(1 + distance / 50) / Math.log10(1 + 20_000 / 50)) * radius
    const px = cx + (x / flat) * scaled
    const py = cy - (z / flat) * scaled

    // Высота над плоскостью корабля — вертикальный штрих, как в Elite.
    const lift = Math.max(-10 * S, Math.min(10 * S, (_point.dot(_up) / distance) * 20 * S))
    if (Math.abs(lift) > S) line(ctx, px, py, px, py - lift, HUD_COLORS.DIM)

    ctx.fillStyle = color
    ctx.fillRect(Math.round(px - size / 2), Math.round(py - lift - size / 2), size, size)
  }

  for (const body of world.bodies) {
    plot(body.pos, body.id === world.navTargetId ? HUD_COLORS.NAV : HUD_COLORS.DIM, Math.round(3 * S))
  }
  for (const pod of world.pods) if (pod.alive) plot(pod.pos, HUD_COLORS.WARN, Math.round(2 * S))
  // Локатор невидимку не берёт — то же правило, что у захвата и у головки ракеты.
  for (const ship of world.ships) {
    if (!isVisible(ship)) continue
    plot(ship.state.pos, radarColor(ship, world), Math.round(4 * S))
  }
}

/**
 * Цвет отметки на радаре отвечает на единственный вопрос боя: стрелять или нет.
 * Захваченная цель — жёлтая, враг — красный, мирный — спокойный серо-голубой.
 * Красить торговца в цвет пирата значит врать пилоту ровно в тот момент, когда
 * он смотрит на радар, а не в окно.
 */
function radarColor(ship: ShipEntity, world: World): string {
  if (ship.id === world.lockedTargetId) return HUD_COLORS.TARGET
  return ship.faction === 'hostile' ? HUD_COLORS.DANGER : HUD_COLORS.NEUTRAL
}

function drawReadouts({ ctx, world, height }: HudFrame): void {
  const player: ShipEntity = world.player
  const x = 10 * S
  const labelWidth = 34 * S
  const barWidth = 66 * S
  const barHeight = 5 * S
  const step = 11 * S

  // Шесть строк по `step`: шкала бомбы добавила ещё одну, и отсчёт снизу это учитывает.
  let y = height - 88 * S

  if (!player.controls.flightAssist) {
    text(ctx, 'АССИСТ ВЫКЛ', x, y - step, HUD_COLORS.WARN)
  }

  const shield = player.spec.hull.shield > 0 ? player.shield / player.spec.hull.shield : 0
  const hull = player.hull / player.spec.hull.hull
  const heat = peakHeat(player)
  const energy = energyFraction(player)

  const rows: [string, number, string][] = [
    ['ЩИТ', shield, HUD_COLORS.PRIMARY],
    ['КОРП', hull, hull < 0.3 ? HUD_COLORS.DANGER : HUD_COLORS.PRIMARY],
    // Батареи: один импульс ПРО стоит десятой доли шкалы.
    ['ЭНРГ', energy, energy < 0.15 ? HUD_COLORS.DANGER : HUD_COLORS.PRIMARY],
    // Бомба копится поверх целого щита. Заряженная светится целью — её видно
    // боковым зрением, и это единственная шкала, которую пилот ждёт заполненной.
    ['БОМБА', player.bombCharge, bombReady(player) ? HUD_COLORS.TARGET : HUD_COLORS.DIM],
    ['ТЕПЛО', heat, heat > 0.7 ? HUD_COLORS.DANGER : HUD_COLORS.WARN],
    ['ТЯГА', player.controls.throttle, HUD_COLORS.PRIMARY],
  ]

  for (const [label, value, color] of rows) {
    text(ctx, label, x, y, HUD_COLORS.DIM)
    bar(ctx, x + labelWidth, y, barWidth, barHeight, value, color)
    y += step
  }

  y += 3 * S
  text(ctx, formatSpeed(player.state.vel.length()), x, y, HUD_COLORS.PRIMARY)

  const ammo = missileAmmo(player)
  if (ammo > 0) text(ctx, `РАКЕТ ${ammo}`, x + barWidth, y, HUD_COLORS.WARN)
}

/** Крейсер: множитель и причина, по которой он не включается. */
function drawCruise({ ctx, world, width }: HudFrame): void {
  const cruise = world.player.cruise

  if (cruise.block === 'mass-lock') {
    text(ctx, 'МАССОВАЯ БЛОКИРОВКА', width / 2, 10 * S, HUD_COLORS.DANGER, 'center')
    return
  }
  if (!isCruising(world.player)) return

  const fraction = (cruise.factor - 1) / (CRUISE.MAX_FACTOR - 1)
  text(ctx, `КРЕЙСЕР ×${cruise.factor.toFixed(0)}`, width / 2, 10 * S, HUD_COLORS.PRIMARY, 'center')
  bar(ctx, width / 2 - 40 * S, 22 * S, 80 * S, 4 * S, fraction, HUD_COLORS.PRIMARY)

  if (cruise.block === 'proximity') {
    text(ctx, 'ТОРМОЖЕНИЕ У ТЕЛА', width / 2, 30 * S, HUD_COLORS.WARN, 'center')
  }
}

/**
 * Энергетическая бомба: круг, резко расходящийся из корабля, и двойная засветка.
 *
 * Всё рисуется на HUD, а не в сцене и не постобработкой. Причина не в лени: круг
 * обязан попасть в ту же пиксельную сетку, что и остальной кадр, — иначе он один
 * окажется в полном разрешении экрана и выдаст, что «пиксельность» нарисованная.
 * А сфера в сцене здесь и не нужна: поражение мгновенно, пересекать ей нечего.
 *
 * Центр — середина кадра, там же, где корабль. Радиус, яркость края и заливки
 * приходят из `bombRing`, функции от возраста вспышки. Своего таймера у HUD нет
 * и быть не должно: он рисует кадр, а не помнит его.
 */
function drawBombBurst({ ctx, world, width, height }: HudFrame): void {
  const ring = bombRing(world)
  if (ring) {
    const cx = width / 2
    const cy = height / 2
    // Круг уходит за угол кадра: энергия обязана накрыть экран, а не упереться в него.
    const radius = Math.max(1, ring.radius * Math.hypot(width, height) * 0.62)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    if (ring.fill > 0.01) {
      ctx.globalAlpha = ring.fill
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()
    }

    // Кромка: три кольца, от широкого тусклого к тонкому яркому. Аддитивное
    // наложение складывает их в свечение — размытие холсту не по карману.
    if (ring.edge > 0.01) {
      const glow: [number, number, string][] = [
        [9 * S, 0.22, HUD_COLORS.PRIMARY],
        [4 * S, 0.4, HUD_COLORS.PRIMARY],
        [1.5 * S, 0.95, '#ffffff'],
      ]
      for (const [lineWidth, strength, color] of glow) {
        ctx.globalAlpha = Math.min(1, ring.edge * strength)
        ctx.lineWidth = lineWidth
        ctx.strokeStyle = color
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  const flash = bombFlash(world)
  if (flash < 0.01) return

  ctx.save()
  ctx.globalAlpha = Math.min(0.8, flash)
  ctx.fillStyle = HUD_COLORS.PRIMARY
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

/**
 * Тревоги: автобой и ракета на подходе.
 *
 * Оба индикатора — состояния МИРА, а не HUD: он их читает, а не выводит.
 * `autofightActive` смотрит, сидит ли за штурвалом пилот; `incomingMissile`
 * считает время по скорости сближения, а не по скорости ракеты.
 *
 * Мигание — единственный способ пробиться сквозь бой: неподвижную строку
 * в перестрелке не замечают. Частота растёт по мере приближения ракеты, потому
 * что «через шесть секунд» и «через одну» требуют разной степени паники.
 */
function drawAlerts({ ctx, world, width, height }: HudFrame): void {
  // Выше панели стыковки: она занимает низ по центру и перекрыла бы обе строки.
  if (autofightActive(world)) {
    text(ctx, 'АВТОБОЙ · P — СНЯТЬ', width / 2, height - 64 * S, HUD_COLORS.TARGET, 'center')
  }

  // Под полем не стреляют, и пилот обязан знать, почему у него мёртвый гашетка.
  if (world.player.cloaked) {
    text(ctx, 'МАСКИРОВКА · X — СНЯТЬ', width / 2, height - 76 * S, HUD_COLORS.NAV, 'center')
  }

  const threat = incomingMissile(world)
  if (!threat || threat.seconds > MISSILE_ALERT_SECONDS) return

  // От 1.6 Гц за шесть секунд до 6 Гц в последнюю. Горит половину периода.
  const urgency = clamp(1 - threat.seconds / MISSILE_ALERT_SECONDS, 0, 1)
  const hz = 1.6 + urgency * 4.4
  if (Math.sin(world.time * hz * Math.PI * 2) < 0) return

  text(ctx, `РАКЕТА · ${threat.seconds.toFixed(1)} С · E — ПРО`, width / 2, height - 50 * S, HUD_COLORS.DANGER, 'center')
}
