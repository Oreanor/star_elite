import { Vector3, type Camera, type PerspectiveCamera } from 'three'
import {
  AUTODOCK,
  CRUISE,
  GUNNERY,
  MIELOPHONE,
  STAR_HEAT,
  canDockAt,
  findBody,
  findStation,
  autofightActive,
  auxFraction,
  clamp,
  incomingMissile,
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
import { currentGameDate } from '../clock'
import { GALAXY_LAYER, HUD_SCALE } from '../../render/config'
import { undocking, consumePendingBonVoyage } from '../../app/control/undockFx'
import { drawUndockTunnel } from './drawUndock'
import { galaxyRadar } from '../../render/scene/galaxyRadar'
import { HUD_COLORS, bar, circle, corners, dot, ellipse, line, text } from './draw'
import { t, type Key } from '../i18n'
import { chassisName, occupationName, properName, shipTypeName } from '../i18n/dataNames'
import { drawFlare } from './drawFlare'
import { angularSize, formatDistance, formatScale, projectPoint, scaleParts, speedParts } from './project'
import { activeWarning, pushWarning, type Plate } from './warnings'
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
  /** За штурвалом автопилот стыковки. Состояние сессии, а не мира: домен о нём не знает. */
  autodock: boolean
  /** За штурвалом автопилот-к-цели (лети к захваченному). Тоже состояние сессии. */
  flyto: boolean
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
  drawDate(frame)

  // Экран смерти — React-оверлей: там нужны кнопки и курсор.
  if (!world.player.alive) return

  // Приборы СИСТЕМЫ (метки тел, цели, контейнеры, стрелки, локатор, портрет, стыковка)
  // молчат, когда борт вырос за PHASE_START (=1000): к этому масштабу единичный мир
  // растворяется, тела далеко и не для точной наводки, а камера у потолка отвода стоит в
  // сотне км позади корпуса — дистанции и метки начинают глючить. Остаётся полётная суть:
  // прицел, вектор скорости, показания, крейсер, тревоги.
  if (world.player.state.scale < MIELOPHONE.PHASE_START) {
    drawBodyMarkers(frame)
    drawTargets(frame)
    drawPods(frame)
    drawOffscreenArrows(frame)
    drawTargetPortrait(frame)
  }

  drawGunsight(frame)
  drawFlightPathMarker(frame)
  // Локатор рисуется всегда, но за PHASE_START внутри — пустая рамка с «НЕТ ДАННЫХ»:
  // отметки системы там глючат (тела далеко, камера в сотне км позади корпуса).
  drawRadar(frame)
  drawReadouts(frame)
  const warningPlate = gatherWarnings(frame)
  drawAlerts(frame)

  // Последним: круг бомбы бьёт поверх всего, включая прицел.
  drawBombBurst(frame)

  // Тоннель вылета гасит HUD чёрным — плашку «доброго пути» рисуем ПОСЛЕ него,
  // иначе голубой пуш не виден над кольцами.
  if (undocking()) drawUndockTunnel(ctx, width, height)
  if (warningPlate) paintWarningPlate(frame, warningPlate)
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

/**
 * Игровая дата в левом верхнем углу — симметрично счётчику кадров справа. Тускло:
 * HUD, станция и журналы — общий календарь (`app/net/worldClock`), не `world.time`.
 */
function drawDate({ ctx }: HudFrame): void {
  text(ctx, currentGameDate(), 6 * S, 5 * S, HUD_COLORS.DIM, 'left')
}

type DockState = 'engaged' | 'ready' | 'approach'

function dockState(world: World, station: BodyEntity, autodock: boolean): DockState {
  if (autodock) return 'engaged'
  if (canDockAt(world.player, station)) return 'ready'
  return 'approach'
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
    // и без рамки его физически не найти глазом. Захваченную обводим ТОЛЩЕ (и голубым
    // из `color` выше): активная цель должна выделяться понятнее любой другой рамки.
    const size = Math.max(14 * S, Math.min(90 * S, angularSize(ship.spec.hull.radius, p.distance) * height * 1.2))
    corners(ctx, p.x, p.y, size, color, locked ? 2.5 : 1)

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
      // Щит и корпус цели — две полоски стопкой над рамкой. Энергию не показываем:
      // её ничто не тратит, шкала всегда была бы полной (см. убранную БАТ).
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
    // Стрелка захваченной цели — ВСЕГДА голубая и КРУПНЕЕ прочих: за кадром её сигнал
    // один (цвет+размер), и она должна выделяться понятнее любой другой. Оставь её
    // розовой/красной (как радар) и одного размера — захваченный сольётся с чужими
    // стрелками, и непонятно, куда вращать нос к ВЫБРАННОМУ.
    offscreenArrow(frame, ship.state.pos, locked ? HUD_COLORS.PRIMARY : radarColor(ship, world), locked)
  }

  // Цвет тела, а не отдельный «цвет навигации»: жёлтая стрелка ведёт к звезде,
  // белая — к причалу. Пилот уже выучил это на локаторе.
  const nav = findBody(world, world.navTargetId)
  if (nav) offscreenArrow(frame, nav.pos, bodyColor(nav))
}

/** Рисует треугольник у края кадра, если точка за кадром. Иначе молчит. */
function offscreenArrow({ ctx, camera, width, height }: HudFrame, pos: Vector3, color: string, emphasis = false): void {
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
  const size = emphasis ? 12 * S : 7 * S // захваченная цель — крупнее прочих

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
      primary: body.kind === 'star' || body.kind === 'planet' || body.kind === 'blackhole',
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
    // Рамка-прицел вокруг цели — только в обычном полёте. В масштабе (миелофон) система
    // уже далеко и не для точной навигации: жирная рамка поверх тел лишь мельтешит, точки
    // достаточно. Порог общий с запретом стыковки — «я гигант» здесь значит одно и то же.
    if (m.nav && world.player.state.scale <= 1) navReticle(ctx, x, y, m.color)

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
 * Портрет захваченной цели — «того, кто с тобой» — НАД локатором справа. Лицо
 * вырезается из листа расы ПО КООРДИНАТАМ (клетка index в сетке 6×6), эмоция — из
 * состояния борта. Пока листа нет, рамка с инициалом держит место; догрузится —
 * лицо встанет само. Невидимку (в маскировке) не показываем, как и локатор.
 */
function drawTargetPortrait({ ctx, world, width, height }: HudFrame): void {
  if (world.lockedTargetId == null) return
  const ship = world.ships.find((s) => s.id === world.lockedTargetId)
  if (!ship || !ship.alive || !isVisible(ship)) return

  // HUD рисуется в уменьшенном внутреннем разрешении и растягивается, поэтому размер
  // тут «крупнее», чем то же число в DOM. 48 — компактный портрет цели.
  const size = 48 * S
  // Стоит НАД локатором (тот вернулся в правый нижний угол): портрет центрирован по его
  // оси, а снизу — три строки мелкой подписи (имя/род/корабль) до самого обода локатора.
  const radiusX = 47 * 1.5 * S
  const radiusY = 47 * 0.75 * S
  const radarCx = width - radiusX - 12 * S
  const radarTop = height - 2 * radiusY - 12 * S
  const x = radarCx - size / 2
  const y = radarTop - size - 24 * S

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

  // Под портретом — ИМЯ, РОД занятий и КОРАБЛЬ, а не одна роль «Торговец»: с кем имеешь
  // дело, видно так же полно, как на плашке у причала. Шрифт МЕЛЬЧЕ основного (три строки
  // должны влезть под компактный портрет); после — возвращаем базовый, иначе поедет весь HUD.
  const midX = x + size / 2
  const nameY = y + size + 2 * S
  const baseFont = ctx.font
  ctx.font = `${Math.round(6 * S)}px "Consolas", "DejaVu Sans Mono", monospace`
  text(ctx, ship.pilotName.toUpperCase(), midX, nameY, HUD_COLORS.PRIMARY, 'center')
  text(ctx, occupationName(ship.originKind, ship.faction).toUpperCase(), midX, nameY + 7 * S, HUD_COLORS.DIM, 'center')
  text(ctx, chassisName(ship.loadout.chassis.name).toUpperCase(), midX, nameY + 14 * S, HUD_COLORS.DIM, 'center')
  ctx.font = baseFont
}

/**
 * Радар: вид сверху, нос — вверх. Показывает и корабли, и тела, поэтому шкала
 * логарифмическая: иначе планета в 400 км сплющит всё остальное к центру.
 */
function drawRadar({ ctx, camera, world, width, height }: HudFrame): void {
  const radiusX = 47 * 1.5 * S // ширина эллипса локатора (прежняя, ~70): читается на скорости
  const radiusY = 47 * 0.75 * S // высота на 25% МЕНЬШЕ прежней (47→35): локатор стал площе
  const cx = width - radiusX - 12 * S // снова в правом нижнем углу: по центру он мешал
  const cy = height - radiusY - 12 * S
  const FRAME_W = 2 // обод и лучи чуть толще одинарной линии — крупный локатор их держит

  ellipse(ctx, cx, cy, radiusX, radiusY, HUD_COLORS.DIM, FRAME_W)
  ellipse(ctx, cx, cy, radiusX / 2, radiusY / 2, HUD_COLORS.DIM, FRAME_W)
  line(ctx, cx, cy - 3 * S, cx, cy + 3 * S, HUD_COLORS.DIM, FRAME_W)
  line(ctx, cx - 3 * S, cy, cx + 3 * S, cy, HUD_COLORS.DIM, FRAME_W)

  // За масштабом (миелофон) система осталась далеко, зато проявилась ГАЛАКТИКА — и локатор
  // переключается на неё: показывает звёзды в СФЕРЕ ВИДИМОСТИ слоя (те же, что горят в
  // мире), чтобы найти, куда лететь. Пока галактика ещё не проявилась (борт вырос, но слой
  // спит/прозрачен) — честно «НЕТ ДАННЫХ».
  if (world.player.state.scale >= MIELOPHONE.PHASE_START) {
    const gr = galaxyRadar()
    if (!gr.active || !gr.positions || !gr.colors) {
      text(ctx, t('hud.noData'), cx, cy - 4 * S, HUD_COLORS.DIM, 'center')
      return
    }

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
    // Дальность локатора = сфера видимости слоя: в круге ровно те звёзды, что зажжены.
    const range = GALAXY_LAYER.SPHERE_RADIUS_M
    const pos = gr.positions
    const col = gr.colors

    // Проецирует звезду (индекс·3) на локатор. `force` игнорирует сферу видимости (для
    // своей звезды — её показываем всегда). Возвращает экранную точку или null.
    const projStar = (b: number, force: boolean): { px: number; my: number } | null => {
      // Мир-позиция звезды = якорь слоя + локальные·масштаб; сразу берём относительно борта.
      _point.set(
        gr.anchor.x + pos[b]! * gr.layerScale - player.state.pos.x,
        gr.anchor.y + pos[b + 1]! * gr.layerScale - player.state.pos.y,
        gr.anchor.z + pos[b + 2]! * gr.layerScale - player.state.pos.z,
      )
      const distSq = _point.lengthSq()
      if (!force && distSq > range * range) return null // вне сферы видимости
      const distance = Math.sqrt(distSq) || 1
      const x = _point.dot(_right)
      const z = _point.dot(_fwd)
      const flat = Math.hypot(x, z)
      if (flat < 1e-3) return { px: cx, my: cy } // прямо над/под кораблём — в центр
      // Линейно (не лог): локатор здесь — top-down мини-карта окрестности. За сферой (своя
      // звезда, если отлетел) прижимаем к ободу.
      const k = Math.min(1, distance / range)
      const px = cx + (x / flat) * k * radiusX
      const py = cy - (z / flat) * k * radiusY
      const lift = Math.max(-10 * S, Math.min(10 * S, (_point.dot(_up) / distance) * 20 * S))
      const my = py - lift
      if (Math.abs(lift) > S) line(ctx, px, py, px, my, HUD_COLORS.DIM)
      return { px, my }
    }

    for (let i = 0; i < gr.count; i++) {
      if (i === gr.originIndex) continue // своя звезда — отдельно, всегда и с подписью
      const b = i * 3
      const p = projStar(b, false)
      if (!p) continue
      const color = `rgb(${Math.round(col[b]! * 255)},${Math.round(col[b + 1]! * 255)},${Math.round(col[b + 2]! * 255)})`
      dot(ctx, p.px, p.my, Math.max(1, 1.5 * S), color)
    }

    // СВОЯ звезда (текущая система) — ВСЕГДА, кольцом и подписью, даже вне сферы: это
    // бесшовная подмена «система → звезда галактики» и точка отсчёта. Прочие подтянутся
    // на радар по мере роста — игрок видит, куда всё сходится.
    const own = projStar(gr.originIndex * 3, true)
    if (own) {
      dot(ctx, own.px, own.my, Math.max(1, 2 * S), HUD_COLORS.PRIMARY)
      circle(ctx, own.px, own.my, 3 * S, HUD_COLORS.PRIMARY)
      text(ctx, properName(world.systemName), own.px - 5 * S, own.my - 3 * S, HUD_COLORS.PRIMARY, 'right')
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
    // Эллипс: по горизонтали шкала шире (radiusX), по вертикали как была (radiusY).
    const px = cx + (x / flat) * k * radiusX
    const py = cy - (z / flat) * k * radiusY

    // Высота над плоскостью корабля — вертикальный штрих, как в Elite.
    const lift = Math.max(-10 * S, Math.min(10 * S, (_point.dot(_up) / distance) * 20 * S))
    if (Math.abs(lift) > S) line(ctx, px, py, px, py - lift, HUD_COLORS.DIM)

    const my = py - lift
    if (shape === 'round') {
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
    const base = body.kind === 'star' || body.kind === 'blackhole' ? 5 : 3
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
  if (body.kind === 'blackhole') return '#5a2868'
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

/** Шрифт HUD заданного кегля. Кегль в пикселях внутреннего буфера, как и всё в S. */
const hudFont = (px: number) => `${Math.round(px)}px "Consolas", "DejaVu Sans Mono", monospace`

/**
 * Тренд-стрелка «растёт/падает». Треугольник вверх — величина увеличивается, вниз —
 * уменьшается. Ноль — молчит: индикатор нужен, только когда есть что показать.
 */
function trendArrow(ctx: CanvasRenderingContext2D, x: number, cy: number, dir: number, color: string): void {
  if (dir === 0) return
  const w = 4 * S
  const h = 6 * S
  ctx.fillStyle = color
  ctx.beginPath()
  if (dir > 0) {
    ctx.moveTo(x, cy - h)
    ctx.lineTo(x + w, cy + h)
    ctx.lineTo(x - w, cy + h)
  } else {
    ctx.moveTo(x, cy + h)
    ctx.lineTo(x + w, cy - h)
    ctx.lineTo(x - w, cy - h)
  }
  ctx.closePath()
  ctx.fill()
}

/** Черепашка: панцирь-кружок и четыре лапки-луча по диагоналям. Одна ракета в обойме. */
function turtle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  circle(ctx, cx, cy, r, color)
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    line(ctx, cx + sx * r * 0.6, cy + sy * r * 0.6, cx + sx * r * 1.5, cy + sy * r * 1.5, color)
  }
}

// Прошлые значения — чтобы отличить рост от падения. HUD один на корабль, поэтому
// модульная память безопасна: второго игрока в кадре нет.
let _prevSpeed = 0
let _prevScale = 1

// Подпись плашки масштабирования выбирается ОДИН раз на сессию удержания (иначе она
// мигала бы между вариантами каждый кадр). По умолчанию сухое «РЕКАЛИБРОВКА», и лишь
// изредка (ALICE_CHANCE) — цитата из «Алисы». `_scaleSign` помнит знак текущей сессии.
let _scaleSign = 0
let _scaleLabelKey: Key = 'hud.scalePlate'
const ALICE_CHANCE = 0.2

/**
 * Крупная величина: цифра большим кеглем, единица вдвое мельче справа, тренд-стрелка
 * рядом. `unitSuffix` рисуется на базовой линии низа цифры, чтобы не «висеть» вверху.
 * @returns правый край нарисованного (для соседних блоков).
 */
function bigValue(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  value: string,
  unit: string,
  color: string,
  trend: number,
  maxWidth: number,
): void {
  const gap = 3 * S
  const arrow = 12 * S // отступ до тренд-стрелки плюс её ширина
  // База мельче прежней (было 18) и ужимается ещё, если число+единица+стрелка не влезают
  // в свою половину: «1.2млн м/с ▲» иначе наползало бы на соседний столбец.
  let big = 15 * S
  let small = big * 0.5
  ctx.font = hudFont(big)
  let numW = ctx.measureText(value).width
  ctx.font = hudFont(small)
  let unitW = ctx.measureText(unit).width
  const total = numW + gap + unitW + arrow
  if (total > maxWidth) {
    const k = maxWidth / total
    big *= k
    small *= k
    ctx.font = hudFont(big)
    numW = ctx.measureText(value).width
    ctx.font = hudFont(small)
    unitW = ctx.measureText(unit).width
  }
  const baseFont = ctx.font
  ctx.font = hudFont(big)
  text(ctx, value, x, top, color)
  ctx.font = hudFont(small)
  text(ctx, unit, x + numW + gap, top + big - small, color)
  ctx.font = baseFont
  trendArrow(ctx, x + numW + gap + unitW + 8 * S, top + big / 2, trend, color)
}

function drawReadouts({ ctx, world, height }: HudFrame): void {
  const player: ShipEntity = world.player
  const x = 10 * S
  const labelWidth = 34 * S
  const barWidth = 66 * S
  const columnWidth = labelWidth + barWidth
  const halfWidth = columnWidth / 2
  const barHeight = 5 * S
  const step = 11 * S
  const baseFont = ctx.font

  // ── Скорость и масштаб — САМЫМИ ПЕРВЫМИ, крупной цифрой ──────────────────────
  const speedTop = height - 150 * S
  shipAxes(player.state.quat, _fwd, _right, _up)
  const vel = player.state.vel
  const speedMag = vel.length()

  // Тренд по МОДУЛЮ скорости: разгон — вверх, торможение — вниз, ровный ход — ничего.
  // Мёртвая зона относительная: на сверхсветовом крейсере абсолютный дребезг огромен.
  const speedEps = Math.max(0.5, speedMag * 0.002)
  const dv = speedMag - _prevSpeed
  const speedTrend = dv > speedEps ? 1 : dv < -speedEps ? -1 : 0
  _prevSpeed = speedMag

  // Назад — с минусом (U+2212): реверс это не «ноль хода», а движение против носа.
  const sp = speedParts(speedMag)
  const reversing = vel.dot(_fwd) < -1
  bigValue(ctx, x, speedTop, reversing ? `−${sp.value}` : sp.value, sp.unit, HUD_COLORS.PRIMARY, speedTrend, halfWidth)

  // Множитель крейсера — СРЕДНИМ кеглем под скоростью. Скорость уже сверхсветовая
  // (vel уже умножен на factor); ×N лишь говорит, насколько разогнан ход. Показываем,
  // только когда крейсер реально включён, иначе «×1» висело бы всегда.
  const factor = player.cruise.factor
  if (factor > CRUISE.IDLE_EPSILON) {
    ctx.font = hudFont(13 * S)
    text(ctx, `×${formatScale(factor)}`, x, speedTop + 18 * S + 2 * S, HUD_COLORS.WARN)
    ctx.font = baseFont
  }

  // Масштаб (миелофон) — справа, жёлтым, так же крупно. Появляется, только когда
  // прибор установлен: без него о масштабе речи нет.
  if (player.spec.hasMielophone) {
    const scale = player.state.scale
    const ds = scale - _prevScale
    const scaleEps = Math.max(1e-3, _prevScale * 0.002)
    const scaleTrend = ds > scaleEps ? 1 : ds < -scaleEps ? -1 : 0
    _prevScale = scale
    const sc = scaleParts(scale)
    bigValue(ctx, x + halfWidth, speedTop, sc.value, sc.unit, HUD_COLORS.TARGET, scaleTrend, halfWidth)
  }

  // ── Шкалы состояния: восемь строк по `step` ─────────────────────────────────
  let y = height - 110 * S

  if (!player.controls.flightAssist) {
    text(ctx, t('hud.assistOff'), x, y - step, HUD_COLORS.WARN)
  }

  const shield = player.spec.hull.shield > 0 ? player.shield / player.spec.hull.shield : 0
  const hull = player.hull / player.spec.hull.hull
  const laser = peakHeat(player)
  const aux = auxFraction(player)
  const temp = player.hullHeat
  // Заряд привода как доля предела модели. Нет привода — шкала пустая и тусклая.
  const jump = player.spec.jumpRange > 0 ? player.jumpCharge / player.spec.jumpRange : 0
  const jumpColor = player.spec.jumpRange <= 0 ? HUD_COLORS.DIM : scooping(player) ? HUD_COLORS.TARGET : HUD_COLORS.PRIMARY

  const rows: [string, number, string][] = [
    // Тяга — первой строкой, сразу под цифрами скорости: главный орган хода на виду.
    // Жёлтая шкала; задний ход — тот же цвет, по модулю.
    [t('hud.throttle'), Math.abs(player.controls.throttle), HUD_COLORS.WARN],
    [t('hud.shield'), shield, HUD_COLORS.PRIMARY],
    [t('hud.hull'), hull, hull < 0.3 ? HUD_COLORS.DANGER : HUD_COLORS.PRIMARY],
    // Главной батареи (БАТ) на HUD больше нет: её ничто не расходовало (полёт/форсаж/оружие
    // энергию не тратят) — декоративная шкала убрана. Осталась аукс-батарея, которую тратят реально.
    // Батарея ДОП-ОТСЕКА (аукс): общий запас бомбы, ПРО и маскировки. Голубая шкала;
    // на нуле красная — ни импульса, ни поля.
    [t('hud.aux'), aux, aux < 0.15 ? HUD_COLORS.DANGER : HUD_COLORS.PRIMARY],
    // Нагрев СТВОЛА от стрельбы — отдельно от нагрева корпуса звездой.
    [t('hud.laser'), laser, laser > 0.7 ? HUD_COLORS.DANGER : HUD_COLORS.WARN],
    // Температура КОРПУСА от близкой звезды. За порогом течёт щит, потом обшивка.
    [t('hud.temp'), temp, temp > STAR_HEAT.LEAK_THRESHOLD ? HUD_COLORS.DANGER : temp > 0.5 ? HUD_COLORS.WARN : HUD_COLORS.DIM],
    // Заряд гиперпривода: тратится прыжком, черпается у звезды (светится целью).
    [t('hud.jump'), jump, jumpColor],
  ]

  for (const [label, value, color] of rows) {
    text(ctx, label, x, y, HUD_COLORS.DIM)
    bar(ctx, x + labelWidth, y, barWidth, barHeight, value, color)
    y += step
  }

  // ── РАКЕТ: обойма черепашками ───────────────────────────────────────────────
  const ammo = missileAmmo(player)
  if (ammo > 0) {
    y += 4 * S
    text(ctx, t('hud.rockets'), x, y, HUD_COLORS.DIM)
    // Восемь значков должны уместиться в ширину столбца (barWidth): мельче панцирь,
    // чуть шире шаг — на глаз черепашки не слипаются, а обойма влезает целиком.
    const r = 2 * S
    const gap = 8 * S
    const iconX = x + labelWidth + 3 * S
    const iconY = y + 5 * S
    const maxIcons = 8 // столько ракет в обойме максимум — рисуем все, без «остатка числом»
    const shown = Math.min(ammo, maxIcons)
    for (let i = 0; i < shown; i++) turtle(ctx, iconX + i * gap, iconY, r, HUD_COLORS.WARN)
    // Страховка, если обойму когда-нибудь расширят: остаток — числом.
    if (ammo > maxIcons) text(ctx, `×${ammo}`, iconX + shown * gap + 2 * S, y, HUD_COLORS.WARN)
  }
}

/**
 * Уголковая рамка плашки: четыре L-образных угла прямоугольника. Сплошная рамка
 * давила бы на кадр — уголки читаются как «важно», но не запирают вид под собой.
 */
function bracketRect(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  lineW: number,
): void {
  const arm = Math.min(w * 0.18, h * 0.5)
  const l = cx - w / 2
  const r = cx + w / 2
  const tp = cy - h / 2
  const bt = cy + h / 2
  for (const [px, py, sx, sy] of [[l, tp, 1, 1], [r, tp, -1, 1], [l, bt, 1, -1], [r, bt, -1, -1]] as const) {
    line(ctx, px, py, px + sx * arm, py, color, lineW)
    line(ctx, px, py, px, py + sy * arm, color, lineW)
  }
}

/**
 * Плашки-предупреждения — ЕДИНЫЙ канал ситуативных сообщений (см. `warnings.ts`).
 * Здесь собираются ЧИТАЕМЫЕ из мира состояния и заявляются в очередь; транзиентные
 * «нет ракет/лазера/…» приходят из ввода (`playerController`). Рисуется ОДНА самая
 * важная живая плашка по центру-верху: уголковая рамка, полупрозрачный фон в её цвет
 * (~22%) и мигающая надпись. Старые разрозненные строки-предупреждения этим и заменены.
 */
/** Собирает живую плашку-предупреждение; рисование — отдельно (`paintWarningPlate`). */
function gatherWarnings(frame: HudFrame): Plate | null {
  const { world, autodock } = frame
  const player = world.player
  const now = world.time

  if (consumePendingBonVoyage()) pushWarning('bonVoyage', now)

  // ── Читаемые из мира состояния ──────────────────────────────────────────────
  const temp = player.hullHeat
  if (temp > STAR_HEAT.LEAK_THRESHOLD) pushWarning('overheat', now)
  else if (temp > 0.6) pushWarning('hullHot', now)

  if (player.hull / player.spec.hull.hull < 0.25) pushWarning('hullCritical', now)
  if (peakHeat(player) >= 1) pushWarning('laserHot', now)
  if (player.cruise.block === 'mass-lock') pushWarning('massLock', now)
  else if (player.cruise.block === 'proximity') pushWarning('gravityBrake', now)
  if (scooping(player)) pushWarning('refuel', now)

  // При отчаливании это выход на орбиту, а не приглашение немедленно стыковаться назад.
  if (undocking()) {
    pushWarning('orbitExit', now, { repeat: 0 })
  // Стыковка — только в обычном размере: гигант (миелофон) в причал не влезет.
  } else if (player.state.scale <= 1) {
    const station = findStation(world)
    if (station) {
      const range = stationRange(player, station)
      if (range <= AUTODOCK.ENGAGE_RANGE) {
        const st = dockState(world, station, autodock)
        if (st === 'ready') pushWarning('dockReady', now)
        else if (st === 'engaged') pushWarning('dockCorridor', now, { label: t('hud.dockCorridor', { range: formatDistance(range) }) })
      }
    }
  }

  // Входящая ракета: чем ближе, тем чаще мигает; `repeat:0` держит плашку на экране,
  // пока ракета в воздухе, — это угроза жизни, а не разовая весть.
  const threat = incomingMissile(world)
  if (threat && threat.seconds <= MISSILE_ALERT_SECONDS) {
    const urgency = clamp(1 - threat.seconds / MISSILE_ALERT_SECONDS, 0, 1)
    pushWarning('missileIn', now, {
      label: t('hud.missileWarn', { seconds: threat.seconds.toFixed(1) }),
      hz: 2 + urgency * 4,
      repeat: 0,
    })
  }

  // Социальные вести — вызов по связи и гибель/уход знакомого — тем же каналом.
  const hail = pendingHail(world)
  if (hail) pushWarning('hail', now, { label: t('hud.hail', { name: hail.name.toUpperCase() }) })

  const notice = world.notices[world.notices.length - 1]
  if (notice) {
    const left = notice.kind === 'player-left'
    pushWarning(left ? 'playerLeft' : 'contactLost', now, {
      label: t(left ? 'hud.playerLeft' : 'hud.contactLost', { name: notice.name.toUpperCase() }),
    })
  }

  // ── Показываем самую важную живую плашку ────────────────────────────────────
  // Крейсерский разгон (удержание Z) — не транзиентная весть, а СОСТОЯНИЕ: мигает,
  // пока держишь, и гаснет в тот же миг, как отпустил (флаг `cruise.engaged`, не тающий
  // `factor`). Оттого рисуем её отдельным «синтетическим» плашко-состоянием, а не через
  // очередь `pushWarning` (та живёт WARN_LIFE и не погасла бы сразу). Реальные предупреждения
  // важнее — если есть живая плашка из очереди, показываем её, а форсаж уступает.
  const boostPlate: Plate | null = player.cruise.engaged
    ? { color: HUD_COLORS.PRIMARY, hz: 0, rank: 0, label: t('hud.boostPlate'), born: now }
    : null
  const autofightPlate: Plate | null = autofightActive(world)
    ? { color: HUD_COLORS.PRIMARY, hz: 0, rank: 0, label: t('hud.autofightPlate'), born: now }
    : null
  const autopilotPlate: Plate | null = frame.flyto
    ? { color: HUD_COLORS.PRIMARY, hz: 0, rank: 0, label: t('hud.autopilotPlate'), born: now }
    : null
  // Масштабирование миелофоном (клавиша роста) — ЖЁЛТОЕ состояние. Тот же принцип, что
  // у форсажа: пока держишь `grow`, мигает; отпустил — гаснет. Обычно сухое «РЕКАЛИБРОВКА»,
  // и лишь изредка (ALICE_CHANCE) — цитата из «Алисы»: рост — «чудесатее», сжатие — «подзорная
  // труба». Подпись выбираем РАЗ на сессию удержания (модульная память), а не каждый кадр.
  const grow = player.controls.grow
  const growSign = Math.sign(grow)
  if (growSign === 0) {
    _scaleSign = 0
  } else if (growSign !== _scaleSign) {
    _scaleSign = growSign
    _scaleLabelKey =
      Math.random() < ALICE_CHANCE ? (grow > 0 ? 'hud.growPlate' : 'hud.shrinkPlate') : 'hud.scalePlate'
  }
  const scalePlate: Plate | null =
    growSign !== 0 ? { color: HUD_COLORS.WARN, hz: 1.5, rank: 0, label: t(_scaleLabelKey), born: now } : null
  // Реальные предупреждения важнее; из состояний масштаб (нарратив) впереди форсажа.
  return activeWarning(now) ?? autofightPlate ?? autopilotPlate ?? scalePlate ?? boostPlate
}

function paintWarningPlate(frame: HudFrame, plate: Plate): void {
  const { ctx, world, width } = frame
  const now = world.time

  const baseFont = ctx.font
  const pad = 44 * S
  // Плашка вверху по центру — места по ширине много, но не до самых краёв. Если подпись
  // (с полями) не влезает в доступную ширину, УЖИМАЕМ шрифт под неё, а не обрезаем текст.
  const maxW = width - 24 * S
  let fontPx = 15 * S
  ctx.font = hudFont(fontPx)
  let textW = ctx.measureText(plate.label).width
  if (textW + pad > maxW) {
    fontPx = Math.max(8 * S, (fontPx * (maxW - pad)) / textW)
    ctx.font = hudFont(fontPx)
    textW = ctx.measureText(plate.label).width
  }
  const font = hudFont(fontPx)
  const bw = Math.min(maxW, textW + pad)
  ctx.font = baseFont
  const bh = 30 * S
  // Вверху по центру, с тем же отступом от кромки, что у даты и счётчика кадров (~8px):
  // не вплотную к краю, но и не в глубине кадра, где перекрыло бы прицел.
  const cx = width / 2
  const cy = 8 * S + bh / 2

  // Полупрозрачный фон в цвет рамки: плашку видно, но мир под ней всё ещё читается.
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = plate.color
  ctx.fillRect(Math.round(cx - bw / 2), Math.round(cy - bh / 2), Math.round(bw), Math.round(bh))
  ctx.restore()

  // Рамка стоит ровно, мигает только надпись: рамка держит место, текст просит взгляд.
  bracketRect(ctx, cx, cy, bw, bh, plate.color, 3)
  const lit = plate.hz <= 0 || Math.sin(now * plate.hz * Math.PI * 2) > -0.35
  if (lit) {
    ctx.font = font
    // Центрируем по высоте под текущий кегль (baseline='top'): при ужатом шрифте не съедет.
    text(ctx, plate.label, cx, cy - fontPx / 2, plate.color, 'center')
    ctx.font = baseFont
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
 * Постоянные режимы у нижней кромки, для которых нет верхней плашки.
 * Автобой и автопилот-к-цели — голубые пуши в `gatherWarnings`.
 */
function drawAlerts({ ctx, world, width, height }: HudFrame): void {
  // Под полем не стреляют, и пилот обязан знать, почему у него мёртвый гашетка.
  if (world.player.cloaked) {
    text(ctx, t('hud.cloak'), width / 2, height - 132 * S, HUD_COLORS.NAV, 'center')
  }
}
