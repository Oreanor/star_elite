import { Vector3, type Camera } from 'three'
import {
  AUTODOCK,
  CRUISE,
  DOCKING,
  GUNNERY,
  STAR_HEAT,
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
  pendingHail,
  scooping,
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
import { t } from '../i18n'
import { properName, shipTypeName } from '../i18n/dataNames'
import { drawFlare } from './drawFlare'
import { angularSize, formatDistance, formatSpeed, projectPoint } from './project'
import {
  PORTRAIT_GRID,
  loadSheet,
  pilotEmotion,
  portraitCell,
  portraitIndex,
  portraitSheet,
  sheetReady,
} from '../portrait'

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
  drawTargetPortrait(frame)
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
      ? t('hud.holdFull')
      : readiness === null
        ? t('hud.podGrab', { item: itemName(pod.item) })
        : pod.tractored
          ? t('hud.podBeam', { item: itemName(pod.item) })
          : t('hud.podPull', { item: itemName(pod.item) })

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
      ? // Не «автопилот»: пилот и так видит, что руль не его. Важнее, что станция
        // взяла его под защиту, — и это единственное место, где об этом говорят.
        t('hud.dockCorridor', { range: formatDistance(range) })
      : state === 'ready'
        ? t('hud.dockReady')
        : state === 'too-fast'
          ? t('hud.dockTooFast', { speed: DOCKING.MAX_SPEED })
          : t('hud.dockHint', { range: formatDistance(range) })

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
    // Захваченную цель красим фосфором (голубым): среди красных рамок врагов она —
    // единственная не-красная, и глаз сразу находит, ЗА КЕМ гоняться. Исключение —
    // живой игрок: он остаётся РОЗОВЫМ даже залоченным (что выбран — видно по HP-полосам
    // и подписи ниже), чтобы человек не терялся в цвете захвата, когда листаешь Tab по людям.
    const color = locked && !ship.kinematic ? HUD_COLORS.PRIMARY : radarColor(ship, world)

    // Минимум крупный: корабль в 12 м на километре занимает меньше пикселя,
    // и без рамки его физически не найти глазом.
    const size = Math.max(14 * S, Math.min(90 * S, angularSize(ship.spec.hull.radius, p.distance) * height * 1.2))
    corners(ctx, p.x, p.y, size, color)

    // Дистанция у каждого врага, а не только у захваченного: она нужна, чтобы
    // понять, кто рядом, а кто в километре.
    text(ctx, formatDistance(p.distance), p.x, p.y + size / 2 + 3 * S, color, 'center')

    // Знакомого подписываем ВСЕГДА и по имени — со значком ◈, чтобы среди безликих
    // отметок он читался как «этого ты знаешь». Незнакомца называем лишь захваченного.
    const known = ship.acquaintanceId != null
    if (locked || known) {
      const label = known ? `◈ ${ship.name}` : shipTypeName(ship.name)
      text(ctx, label, p.x, p.y + size / 2 + 13 * S, known ? HUD_COLORS.PRIMARY : color, 'center')
    }

    if (locked) {
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

  /**
   * Стрелка нужна тому, кого ищут: врагу и захваченному. Мирный за спиной —
   * не новость, а стрелка на каждого встречного превратила бы край кадра в частокол.
   */
  for (const ship of world.ships) {
    if (!ship.alive || !isVisible(ship)) continue
    const locked = ship.id === world.lockedTargetId
    if (ship.faction !== 'hostile' && !locked) continue
    // Стрелка захваченной цели — голубая, как и её рамка (живой игрок — розовым, как и
    // его рамка): среди красных треугольников сразу видно, куда вращать нос к ВЫБРАННОМУ.
    offscreenArrow(frame, ship.state.pos, locked && !ship.kinematic ? HUD_COLORS.PRIMARY : radarColor(ship, world))
  }

  // Цвет тела, а не отдельный «цвет навигации»: жёлтая стрелка ведёт к звезде,
  // белая — к причалу. Пилот уже выучил это на локаторе.
  const nav = findBody(world, world.navTargetId)
  if (nav) offscreenArrow(frame, nav.pos, bodyColor(nav))
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
/**
 * Рамка вокруг цели навигации: ромб, а не круг.
 *
 * Круг сливается и со звездой, и с диском планеты, к которому он приклеен.
 * Ромб в кадре не встречается больше нигде, поэтому глаз находит его сразу —
 * ровно как выделенную звезду на карте, откуда цель и назначена.
 */
function navReticle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const r = 8 * S
  ctx.strokeStyle = color
  ctx.lineWidth = S
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
  ctx.stroke()
}

/** Ближе этого порога (px HUD) две подписи мешаются — вторичную гасим. */
const LABEL_MIN_GAP = 14 * S

interface Marker {
  pos: Vector3
  name: string
  color: string
  /** Активная цель навигации — крупная точка, ромб и безусловная подпись. */
  nav: boolean
  /** Ориентир (звезда, планета, кит): подпись безусловна, соседям не уступает. */
  primary: boolean
}

/** Приоритет подписи: цель важнее ориентира, ориентир важнее спутника. */
function labelRank(m: Marker): number {
  if (m.nav) return 0
  if (m.primary) return 1
  return 2
}

function collectMarkers(world: World): Marker[] {
  const out: Marker[] = []
  for (const body of world.bodies) {
    out.push({
      pos: body.pos,
      // Имена планет/лун/причалов собраны из слогов — в англ. локали романизируем.
      name: properName(body.name),
      // Тот же цвет, что и на локаторе: звезда жёлтая, причал белый, планета
      // фосфорная. Пилот не переучивается, переводя взгляд с круга в окно.
      color: bodyColor(body),
      nav: body.id === world.navTargetId,
      // Станция и спутник вторичны — их подпись уступает планете, к которой они
      // липнут. Звезда и планета — ориентиры, подписаны всегда.
      primary: body.kind === 'star' || body.kind === 'planet',
    })
  }
  // Киты — тоже ориентиры: их МАРКУ пилот должен прочесть, это событие в системе.
  for (const titan of world.titans) {
    out.push({ pos: titan.pos, name: properName(titan.name), color: HUD_COLORS.NEUTRAL, nav: false, primary: true })
  }
  return out
}

function drawBodyMarkers({ ctx, camera, world, width, height }: HudFrame): void {
  const shown: Array<{ m: Marker; x: number; y: number; distance: number }> = []
  for (const m of collectMarkers(world)) {
    const p = projectPoint(m.pos, camera, width, height)
    if (p.behind || !isOnScreen(p.x, p.y, width, height)) continue
    // projectPoint отдаёт переиспользуемый объект — копируем числа сразу.
    shown.push({ m, x: p.x, y: p.y, distance: p.distance })
  }

  // Подписываем по важности: сперва цель и ориентиры (они занимают место), затем
  // вторичные — и только если рядом ещё не тесно. Так у далёкой планеты со
  // станцией и роем спутников, слившихся в одну точку, остаётся одна подпись —
  // планеты. Различишь их по отдельности (подлетев) — подписи разъедутся сами.
  shown.sort((a, b) => labelRank(a.m) - labelRank(b.m))

  const placed: Array<{ x: number; y: number }> = []
  for (const { m, x, y, distance } of shown) {
    // Цель навигации — точка потолще: цвет на звёздном фоне различим плохо, а
    // разница в размере читается даже боковым зрением.
    dot(ctx, x, y, m.nav ? 2.5 * S : 1.5 * S, m.color)
    if (m.nav) navReticle(ctx, x, y, m.color)

    // Ориентир и активная цель подпись не уступают: планету видно всегда, а
    // выбранную станцию (пусть у другой планеты) — потому что это цель. Вторичный
    // же объект вплотную к уже подписанному молчит, чтобы не плодить кашу.
    const forced = m.primary || m.nav
    if (!forced && placed.some((q) => Math.hypot(q.x - x, q.y - y) < LABEL_MIN_GAP)) continue

    // Подпись отодвинута за рамку: иначе имя ложится ей на грань и не читается.
    const gap = (m.nav ? 12 : 6) * S
    text(ctx, m.name, x + gap, y - 5 * S, m.color)
    text(ctx, formatDistance(distance), x + gap, y + 5 * S, m.color)
    placed.push({ x, y })
  }
}

/**
 * Портрет захваченной цели — «того, кто с тобой» — над локатором справа. Лицо
 * вырезается из листа расы ПО КООРДИНАТАМ (клетка index в сетке 6×6), эмоция — из
 * состояния борта. Пока листа нет, рамка с инициалом держит место; догрузится —
 * лицо встанет само. Невидимку (в маскировке) не показываем, как и локатор.
 */
function drawTargetPortrait({ ctx, world, width, height }: HudFrame): void {
  if (world.lockedTargetId == null) return
  const ship = world.ships.find((s) => s.id === world.lockedTargetId)
  if (!ship || !ship.alive || !isVisible(ship)) return

  const size = 66 * S
  const x = width - 12 * S - size
  // Над локатором: его верхняя кромка — height − 2·radius(36) − отступ(12).
  const radarTop = height - 72 * S - 12 * S
  const y = radarTop - 8 * S - size - 7 * S // ещё выше на строку имени

  ctx.strokeStyle = HUD_COLORS.DIM
  ctx.lineWidth = 1
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(size), Math.round(size))

  const sheet = loadSheet(portraitSheet(ship.persona.species, pilotEmotion(ship, world)))
  if (sheetReady(sheet)) {
    const cell = sheet.naturalWidth / PORTRAIT_GRID
    const { col, row } = portraitCell(portraitIndex(ship))
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(sheet, col * cell, row * cell, cell, cell, Math.round(x), Math.round(y), Math.round(size), Math.round(size))
  } else {
    text(ctx, (ship.name.trim().charAt(0) || '?').toUpperCase(), x + size / 2, y + size / 2 - 5 * S, HUD_COLORS.DIM, 'center')
  }

  // Имя под портретом — кто это.
  text(ctx, ship.name.toUpperCase(), x + size / 2, y + size + 2 * S, HUD_COLORS.PRIMARY, 'center')
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
    shape: 'square' | 'round' | 'diamond' = 'square',
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
    const scaled = k * radius
    const px = cx + (x / flat) * scaled
    const py = cy - (z / flat) * scaled

    // Высота над плоскостью корабля — вертикальный штрих, как в Elite.
    const lift = Math.max(-10 * S, Math.min(10 * S, (_point.dot(_up) / distance) * 20 * S))
    if (Math.abs(lift) > S) line(ctx, px, py, px, py - lift, HUD_COLORS.DIM)

    const my = py - lift
    if (shape === 'round') {
      dot(ctx, px, my, Math.max(1, size / 2), color)
    } else if (shape === 'diamond') {
      // Ромб — квадрат на угол. Держим компактным: станция не должна раздуваться
      // крупнее планеты рядом.
      const r = size / 2
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(Math.round(px), Math.round(my - r))
      ctx.lineTo(Math.round(px + r), Math.round(my))
      ctx.lineTo(Math.round(px), Math.round(my + r))
      ctx.lineTo(Math.round(px - r), Math.round(my))
      ctx.fill()
    } else {
      ctx.fillStyle = color
      ctx.fillRect(Math.round(px - size / 2), Math.round(my - size / 2), size, size)
    }
    if (ring) circle(ctx, px, my, size, color)
  }

  // Цель навигации обведена кольцом: на логарифмической шкале, где все тела жмутся
  // к ободу, отметки стоят вплотную, и одного размера мало.
  // Небесные тела — это МЕСТА, а не цели, и форма говорит об этом раньше цвета:
  // звезда и планета круглые, станция — ромбом (рукотворное среди природного),
  // а всё подвижное останется квадратом. Цель навигации крупнее и в кольце.
  for (const body of world.bodies) {
    const nav = body.id === world.navTargetId
    const shape = body.kind === 'station' ? 'diamond' : 'round'
    // Звезда — крупнее прочих: она центр системы и ориентир, а не рядовая метка.
    const base = body.kind === 'star' ? 5 : 3
    plot(body.pos, bodyColor(body), Math.round((nav ? base + 1 : base) * S), nav, shape)
  }

  // Камни — только ближние: пояс в двести шестьдесят отметок залил бы обод серым,
  // а нужен он затем, чтобы не влететь в глыбу, то есть на дистанции боя.
  for (const rock of world.asteroids) {
    if (!rock.alive) continue
    if (rock.pos.distanceToSquared(player.state.pos) > ROCK_RANGE * ROCK_RANGE) continue
    plot(rock.pos, HUD_COLORS.ROCK, Math.round(2 * S))
  }

  for (const pod of world.pods) if (pod.alive) plot(pod.pos, HUD_COLORS.WARN, Math.round(2 * S))

  // Киты — крупной нейтральной отметкой: их видно за десятки километров, и на
  // локаторе они читаются как ориентир, а не как цель. Кольцом, чтобы не путать
  // с рядовым нейтралом-торговцем: это не корабль, это город.
  for (const titan of world.titans) plot(titan.pos, HUD_COLORS.NEUTRAL, Math.round(5 * S), true)

  // Пиратские платформы-гнёзда — крупной красной отметкой в кольце: это враждебная
  // СТРУКТУРА, а не рядовой истребитель. Кольцо отличает её от точки-корабля, а
  // красный отвечает на тот же вопрос боя — стрелять.
  for (const platform of world.platforms) {
    if (!platform.alive) continue
    plot(platform.pos, HUD_COLORS.DANGER, Math.round(5 * S), true)
  }

  // Локатор невидимку не берёт — то же правило, что у захвата и у головки ракеты.
  // Знакомого выделяем кольцом, как захваченного: среди точек он должен читаться особо.
  for (const ship of world.ships) {
    if (!isVisible(ship)) continue
    const marked = ship.id === world.lockedTargetId || ship.acquaintanceId != null
    plot(ship.state.pos, radarColor(ship, world), Math.round(3 * S), marked)
  }
}

/** Дальше этого локатор не разбирает дистанцию, м: отметка прижата к ободу. */
const RADAR_RANGE = 20_000
/** Ближе этого камни рисуются, м. Дальше они — не препятствие, а пейзаж. */
const ROCK_RANGE = 4_000

/** Что это. Звезда жёлтая, причал белый, планета — фосфор консоли. */
function bodyColor(body: BodyEntity): string {
  if (body.kind === 'star') return HUD_COLORS.STAR
  if (body.kind === 'station') return HUD_COLORS.STATION
  return HUD_COLORS.PRIMARY
}

/**
 * Цвет отметки корабля отвечает на единственный вопрос боя: стрелять или нет.
 * Враг — красный, свой — зелёный, чужой-но-не-враг — спокойный серо-голубой.
 * Красить торговца в цвет пирата значит врать пилоту ровно в тот момент, когда
 * он смотрит на радар, а не в окно.
 *
 * Захваченная цель цвета не меняет: жёлтым горит звезда, и второй жёлтый на
 * локаторе превратил бы каждый бой в вопрос «это цель или светило?». Захват —
 * кольцо вокруг отметки: форма, а не цвет.
 */
function radarColor(ship: ShipEntity, world: World): string {
  if (ship.faction === 'hostile') return HUD_COLORS.DANGER
  // Живой игрок — розовым, ПОСЛЕ проверки на врага: враждебный человек должен
  // гореть красным (в бою читается «стрелять?»), а мирный — отличаться от NPC.
  if (ship.kinematic) return HUD_COLORS.PLAYER
  // Свои — зелёным: беспилотник обязан читаться союзником, а не встречным
  // торговцем. Различает их сторона, а не то, кем они рождены.
  return ship.faction === world.player.faction ? HUD_COLORS.ALLY : HUD_COLORS.NEUTRAL
}

function drawReadouts({ ctx, world, height }: HudFrame): void {
  const player: ShipEntity = world.player
  const x = 10 * S
  const labelWidth = 34 * S
  const barWidth = 66 * S
  const barHeight = 5 * S
  const step = 11 * S

  // Восемь строк по `step`: к прочим добавились нагрев корпуса и заряд привода.
  let y = height - 110 * S

  if (!player.controls.flightAssist) {
    text(ctx, t('hud.assistOff'), x, y - step, HUD_COLORS.WARN)
  }

  const shield = player.spec.hull.shield > 0 ? player.shield / player.spec.hull.shield : 0
  const hull = player.hull / player.spec.hull.hull
  const laser = peakHeat(player)
  const energy = energyFraction(player)
  const temp = player.hullHeat
  // Заряд привода как доля предела модели. Нет привода — шкала пустая и тусклая.
  const jump = player.spec.jumpRange > 0 ? player.jumpCharge / player.spec.jumpRange : 0
  const jumpColor = player.spec.jumpRange <= 0 ? HUD_COLORS.DIM : scooping(player) ? HUD_COLORS.TARGET : HUD_COLORS.PRIMARY

  const rows: [string, number, string][] = [
    [t('hud.shield'), shield, HUD_COLORS.PRIMARY],
    [t('hud.hull'), hull, hull < 0.3 ? HUD_COLORS.DANGER : HUD_COLORS.PRIMARY],
    // Батареи: один импульс ПРО стоит десятой доли шкалы.
    [t('hud.energy'), energy, energy < 0.15 ? HUD_COLORS.DANGER : HUD_COLORS.PRIMARY],
    // Бомба копится поверх целого щита. Заряженная светится целью — её видно
    // боковым зрением, и это единственная шкала, которую пилот ждёт заполненной.
    [t('hud.bomb'), player.bombCharge, bombReady(player) ? HUD_COLORS.TARGET : HUD_COLORS.DIM],
    // Нагрев СТВОЛА от стрельбы — отдельно от нагрева корпуса звездой.
    [t('hud.laser'), laser, laser > 0.7 ? HUD_COLORS.DANGER : HUD_COLORS.WARN],
    // Температура КОРПУСА от близкой звезды. За порогом течёт щит, потом обшивка.
    [t('hud.temp'), temp, temp > STAR_HEAT.LEAK_THRESHOLD ? HUD_COLORS.DANGER : temp > 0.5 ? HUD_COLORS.WARN : HUD_COLORS.DIM],
    // Заряд гиперпривода: тратится прыжком, черпается у звезды (светится целью).
    [t('hud.jump'), jump, jumpColor],
    [t('hud.throttle'), player.controls.throttle, HUD_COLORS.PRIMARY],
  ]

  for (const [label, value, color] of rows) {
    text(ctx, label, x, y, HUD_COLORS.DIM)
    bar(ctx, x + labelWidth, y, barWidth, barHeight, value, color)
    y += step
  }

  y += 3 * S
  text(ctx, formatSpeed(player.state.vel.length()), x, y, HUD_COLORS.PRIMARY)

  const ammo = missileAmmo(player)
  if (ammo > 0) text(ctx, t('hud.missiles', { ammo }), x + barWidth, y, HUD_COLORS.WARN)
}

/** Крейсер: множитель и причина, по которой он не включается. */
function drawCruise({ ctx, world, width }: HudFrame): void {
  const cruise = world.player.cruise

  // Перегрев корпуса важнее любой надписи про крейсер: он убивает. За порогом
  // течи кричим красным, до него — предупреждаем жёлтым, что жар близок.
  const temp = world.player.hullHeat
  if (temp > STAR_HEAT.LEAK_THRESHOLD) {
    text(ctx, t('hud.overheat'), width / 2, 10 * S, HUD_COLORS.DANGER, 'center')
    return
  }
  if (temp > 0.6) {
    text(ctx, t('hud.hullHot'), width / 2, 10 * S, HUD_COLORS.WARN, 'center')
    return
  }
  // Прогрелся достаточно, чтобы черпать топливо, но ещё не горишь: удержись здесь.
  if (scooping(world.player)) {
    text(ctx, t('hud.refuel'), width / 2, 10 * S, HUD_COLORS.TARGET, 'center')
    return
  }

  if (cruise.block === 'mass-lock') {
    text(ctx, t('hud.massLock'), width / 2, 10 * S, HUD_COLORS.DANGER, 'center')
    return
  }
  if (!isCruising(world.player)) return

  const fraction = (cruise.factor - 1) / (CRUISE.MAX_FACTOR - 1)
  text(ctx, t('hud.cruise', { factor: cruise.factor.toFixed(0) }), width / 2, 10 * S, HUD_COLORS.PRIMARY, 'center')
  bar(ctx, width / 2 - 40 * S, 22 * S, 80 * S, 4 * S, fraction, HUD_COLORS.PRIMARY)

  if (cruise.block === 'proximity') {
    text(ctx, t('hud.gravityBrake'), width / 2, 30 * S, HUD_COLORS.WARN, 'center')
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
  // Обиженный вызывает по связи (ты его задел): входящий вызов сверху по центру,
  // мягко мигает — «ответь по T, разряди, пока не перелило во враги». Не тревога,
  // а социальный сигнал: цвет цели, не опасности. Пока говоришь — окно поверх скроет.
  const hail = pendingHail(world)
  if (hail && Math.sin(world.time * Math.PI * 2) > -0.5) {
    text(ctx, t('hud.hail', { name: hail.name.toUpperCase() }), width / 2, 46 * S, HUD_COLORS.TARGET, 'center')
  }

  // Пропал знакомый — вероятно, погиб. Весть держится секунды (`CONTACTS.NOTICE_LIFE`,
  // уборка гасит) и мягко мигает: это утрата, не боевая тревога, но и не рядовой лог.
  // Показываем самую свежую — если разом пришло несколько, старшие подождут своей уборки.
  const notice = world.notices[world.notices.length - 1]
  if (notice && Math.sin(world.time * Math.PI * 2) > -0.5) {
    text(ctx, t('hud.contactLost', { name: notice.name.toUpperCase() }), width / 2, 64 * S, HUD_COLORS.DANGER, 'center')
  }

  // Выше панели стыковки: она занимает низ по центру и перекрыла бы обе строки.
  if (autofightActive(world)) {
    text(ctx, t('hud.autofight'), width / 2, height - 64 * S, HUD_COLORS.TARGET, 'center')
  }

  // Под полем не стреляют, и пилот обязан знать, почему у него мёртвый гашетка.
  if (world.player.cloaked) {
    text(ctx, t('hud.cloak'), width / 2, height - 76 * S, HUD_COLORS.NAV, 'center')
  }

  const threat = incomingMissile(world)
  if (!threat || threat.seconds > MISSILE_ALERT_SECONDS) return

  // От 1.6 Гц за шесть секунд до 6 Гц в последнюю. Горит половину периода.
  const urgency = clamp(1 - threat.seconds / MISSILE_ALERT_SECONDS, 0, 1)
  const hz = 1.6 + urgency * 4.4
  if (Math.sin(world.time * hz * Math.PI * 2) < 0) return

  text(ctx, t('hud.missileWarn', { seconds: threat.seconds.toFixed(1) }), width / 2, height - 50 * S, HUD_COLORS.DANGER, 'center')
}
