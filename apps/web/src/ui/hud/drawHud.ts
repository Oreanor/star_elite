import { Vector3, type Camera, type PerspectiveCamera } from 'three'
import {
  AUTODOCK,
  CRUISE,
  LANDING,
  GUNNERY,
  MIELOPHONE,
  STAR_CLASSES,
  STAR_HEAT,
  asteroidMass,
  canDockAt,
  findBody,
  findStation,
  navTarget,
  MONOLITH_NAMES,
  figurineDisplayName,
  NAV_ASTEROID_NAME,
  stanceTo,
  autofightActive,
  auxFraction,
  applyDelta,
  clamp,
  distanceLy,
  generateGalaxy,
  incomingMissile,
  landingCue,
  nearestLandable,
  itemMass,
  itemName,
  missileAmmo,
  nearestPod,
  laserOverheated,
  peakHeat,
  pendingHail,
  scooping,
  isStationBot,
  isVisible,
  scoopReadiness,
  shipAxes,
  stationRange,
  type BodyEntity,
  type ShipEntity,
  type StarSystem,
  type World,
} from '@elite/sim'
import { bombFlash, bombRing } from '../../render/bombFeel'
import { currentGameDate } from '../clock'
import { HUD_SCALE, TORUS } from '../../render/config'
import { undocking, consumePendingBonVoyage } from '../../app/control/undockFx'
import { drawUndockTunnel } from './drawUndock'
import { galaxyRadar, galaxyRadarUsable } from '../../render/scene/galaxyRadar'
import { HUD_COLORS, bar, circle, corners, dot, ellipse, line, text } from './draw'
import { t, type Key } from '../i18n'
import { chassisName, occupationName, properName, starClassName } from '../i18n/dataNames'
import { formatStat } from '../station/format'
import { drawFlare } from './drawFlare'
import { angularSize, formatDistance, formatScale, projectPoint, scaleParts, speedParts } from './project'
import { activeWarning, pushWarning, WARN_LIFE, type Plate } from './warnings'
import { apertureEllipse, insideAperture, type PortalAperture } from './aperture'
import {
  PORTRAIT_GRID,
  loadSheet,
  pilotEmotion,
  portraitCell,
  portraitIndex,
  portraitSheet,
  sheetReady,
} from '../portrait'
import { drawStarBall } from './starPortrait'
import { drawPlanetBall } from './planetPortrait'
import { drawAsteroidChunk, drawPodCrate, drawStationWheel, drawWarBaseIcon } from './objectPortrait'

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
const _gtar = new Vector3()

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
  /**
   * Едем по КУСТУ вселенной. Система спрятана целиком, поэтому приборы наведения по ней
   * (метки тел, цели, локатор, стрелки, прицел) молчат — они мерили бы спрятанный мир и
   * забивали бы экран народом и планетами, которых уже не видно. Остаётся полётная суть.
   */
  bush: boolean
  /**
   * Тяга сквозь тор (`torusFlight`): в комнате борт стоит, `controls.throttle`=0, и прибор ТЯГА
   * был бы мёртв. Кормим его отсюда — W/S/ПКМ видно на шкале. Вне комнаты 0 (берётся throttle).
   */
  torusThrust: number
  /**
   * Положения ДОМА (твоя галактика) и КРЕСТА (монумент) относительно корабля в комнате тора — для
   * HUD-рамок и меток локатора. `null`, когда узел за полюсом или вне комнаты.
   */
  torusHome: { x: number; y: number; z: number } | null
  torusMonument: { x: number; y: number; z: number } | null
  /** Имена дома и монумента — подписи под их маркерами. Берутся из узлов вселенной. */
  torusHomeName: string
  torusMonumentName: string
  /** Выбранная Tab галактика: положение и имя. Помечается жёлтым, к ней и ведёт автопилот. */
  torusTarget: { x: number; y: number; z: number; name: string } | null
  /** Подписи ближайших галактик (узлы решётки = именованные галактики), либо null вне комнаты. */
  torusLabels: { count: number; items: { x: number; y: number; z: number; name: string }[] } | null
  /** Сглаженная частота кадров. Ни на что в игре не влияет — только показывается. */
  fps: number
  /**
   * Открытое кольцо прыжка. Подписи своей системы в дырку не лезут, подписи системы
   * назначения рисуются ТОЛЬКО в ней: stencil-маска портала на 2D-канвас не действует.
   */
  aperture: PortalAperture | null
  /** Кольцо раскрывается прямо сейчас (H держат) — голубая плашка состояния. */
  portalGrowing: boolean
}

export function drawHud(frame: HudFrame): void {
  const { ctx, width, height, world } = frame

  ctx.clearRect(0, 0, width, height)
  ctx.font = `${Math.round(9 * S)}px "Consolas", "DejaVu Sans Mono", monospace`

  // Блик объектива — первым: он лежит на кадре, а приборы лежат на нём.
  //
  // Миров может быть ДВА: свой и тот, что виден в кольце портала. Звезда за кольцом
  // светит в объектив не хуже своей, но живёт в другом мире и со своей камерой, поэтому
  // блик ей нужно рисовать отдельно — иначе система за кольцом стоит без засвета, а он
  // и есть главный признак, что там солнце. Окно непрозрачно, значит источник ровно один:
  // своя звезда светит, пока не заслонена дыркой, чужая — пока видна В дырке.
  const flareHole = apertureEllipse(frame.aperture, frame.camera, width, height)
  drawFlare(ctx, frame.camera, world, width, height, flareHole ? { ellipse: flareHole, inside: false } : undefined)
  const flareWorld = frame.aperture?.world
  const flareCamera = frame.aperture?.camera
  if (flareHole && flareWorld && flareCamera) {
    drawFlare(ctx, flareCamera, flareWorld, width, height, { ellipse: flareHole, inside: true })
  }

  // Счётчик кадров рисуется ДО проверки на гибель: узнать, во что превратилась
  // частота, важнее всего именно тогда, когда на экране взрыв.
  drawFps(frame)
  drawDate(frame)

  // Экран смерти — React-оверлей: там нужны кнопки и курсор.
  if (!world.player.alive) return

  // НА КУСТЕ система спрятана — вся навигация по ней молчит (иначе локатор забит народом,
  // станциями и планетами скрытого мира). Остаётся полётная суть: показания и тревоги.
  if (frame.bush) {
    drawReadouts(frame)
    // Перекрестье по НОСУ. В комнате оно не прицел, а КУРС: поток S³ идёт туда, куда смотрит
    // нос, и без этой метки «куда я лечу» приходится угадывать по тому, как поехала решётка.
    drawGunsight(frame)
    drawTorusLabels(frame)
    drawTorusMarkers(frame)
    drawBushLocator(frame)
    const plate = gatherWarnings(frame)
    if (plate) paintWarningPlate(frame, plate)
    return
  }

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
    drawTargetPanels(frame)
  } else {
    // В масштабе (миелофон вырос за PHASE_START) общий фон меток погашен — тела далеко и
    // глючат. Но ВЫБРАННУЮ цель пилот терять не должен: рисуем ровно её — рамку на ней и
    // стрелку за кадром — до самого пробуждения галактического слоя (тот берёт звёзды на себя).
    drawTargetLock(frame)
    // Галактика: портрет над локатором — кружок класса при переборе Tab (иначе панель молчит).
    if (galaxyRadar().active) drawTargetPanels(frame)
  }

  // Прикреплённая с карты звезда (jumpTargetIndex) — целью В ПОЛЁТЕ на любом масштабе, пока
  // слой галактики спит. Сам guard внутри: проснулся слой — метит он (drawRadar), тут тихо.
  drawPinnedStar(frame)

  drawGunsight(frame)
  drawFlightPathMarker(frame)
  // Локатор рисуется всегда, но за PHASE_START внутри — пустая рамка с «НЕТ ДАННЫХ»:
  // отметки системы там глючат (тела далеко, камера в сотне км позади корпуса).
  drawRadar(frame)
  drawReadouts(frame)
  const warningPlate = gatherWarnings(frame)

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

    const locked = pod.id === world.lockedPodId
    const p = projectPoint(pod.pos, camera, width, height)
    // Захваченный обломок отмечаем ВСЕГДА (как захваченный борт), даже вне дальности меток и
    // за кадром — иначе выбранная Tab'ом цель терялась бы. Прочие — только вблизи.
    if (p.behind || (!locked && (p.distance > POD_MARK_RANGE || !isOnScreen(p.x, p.y, width, height, 10 * S)))) continue

    const color = HUD_COLORS.WARN
    if (locked && !isOnScreen(p.x, p.y, width, height, 10 * S)) {
      offscreenArrow(frame, pod.pos, color, true)
      continue
    }
    // Квадрат = рукотворное мелкое. Рамочка цвета значка — только у активного.
    const s = Math.max(1, 2.5 * S - 2)
    ctx.fillStyle = color
    ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), Math.round(s), Math.round(s))
    if (locked) {
      corners(ctx, p.x, p.y, 14 * S, color, 2)
      text(ctx, formatDistance(shipDistance(world, pod.pos)), p.x, p.y + 18 * S, color, 'center')
    }
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
  // Вес отдельно от имени: пилот решает, влезет ли трофей, ещё до сближения.
  text(ctx, formatStat('mass', itemMass(pod.item)), p.x, p.y + 22 * S, color, 'center')
  text(ctx, formatDistance(shipDistance(world, pod.pos)), p.x, p.y - 18 * S, color, 'center')
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

/**
 * РЕАЛЬНАЯ дистанция от КОРАБЛЯ до точки, м. `projectPoint().distance` мерит от КАМЕРЫ, а
 * на большом масштабе (миелофон) камера отъезжает на сотни км за корму гиганта — её дистанция
 * враньё. Пилот меряет от СЕБЯ. На обычном масштабе камера у корпуса, разница незаметна.
 */
function shipDistance(world: World, pos: Vector3): number {
  return world.player.state.pos.distanceTo(pos)
}

/**
 * Корабли в окне. Квадрат цвета отношения (красный/зелёный/серый); голубая рамочка —
 * только у активного Tab-захвата. Отношение читается из точки и подписи, не из рамки.
 */
function drawTargets({ ctx, camera, world, width, height }: HudFrame): void {
  for (const ship of world.ships) {
    // Бог, СИДЯЩИЙ в станции, — собеседник, а не борт: в космосе его нет. Встречный бог
    // (приходит громадой и ужимается у причала) — обычный корабль и метится как все.
    if (!ship.alive || isStationBot(ship)) continue

    const p = projectPoint(ship.state.pos, camera, width, height)
    if (p.behind || !isOnScreen(p.x, p.y, width, height, 20 * S)) continue

    const locked = ship.id === world.lockedTargetId
    const color = radarColor(ship, world)

    // Маленький квадрат-метка: без него борт на километре — пылинка. Рамочка — лишь у выбранного.
    const mark = Math.max(1, 3 * S - 2)
    ctx.fillStyle = color
    ctx.fillRect(Math.round(p.x - mark / 2), Math.round(p.y - mark / 2), Math.round(mark), Math.round(mark))

    const size = Math.max(14 * S, Math.min(90 * S, angularSize(ship.spec.hull.radius, p.distance) * height * 1.2))
    // Рамочка того же цвета, что квадрат: отношение уже в цвете, активность — в наличии рамки.
    if (locked) corners(ctx, p.x, p.y, size, color, 2.5)

    text(ctx, formatDistance(shipDistance(world, ship.state.pos)), p.x, p.y + size / 2 + 3 * S, color, 'center')

    // В космосе на борту — его название (◈ если уже знакомы).
    const known = ship.acquaintanceId != null
    const label = known ? `◈ ${ship.name}` : ship.name
    text(ctx, label, p.x, p.y + size / 2 + 13 * S, color, 'center')

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
    if (!ship.alive || !isVisible(ship) || isStationBot(ship)) continue
    const locked = ship.id === world.lockedTargetId
    if (ship.faction !== 'hostile' && !locked) continue
    // Цвет = отношение; заливка = активный, контур = прочие. Иначе за кадром
    // два красных треугольника не скажут, какой выбран Tab'ом.
    offscreenArrow(frame, ship.state.pos, radarColor(ship, world), locked)
  }

  const nav = navTarget(world)
  if (nav) offscreenArrow(frame, nav.pos, navMarkerColor(nav), true)
}

/**
 * Треугольник у края кадра. Цвет — тип/отношение; `filled` — активная цель
 * (заливка), иначе обводка: за кадром иначе не отличить «свой» среди одноцветных.
 * `label`: строка вместо дистанции; null — без подписи; undefined — дистанция.
 */
function offscreenArrow(
  { ctx, camera, world, width, height }: HudFrame,
  pos: Vector3,
  color: string,
  filled = false,
  label?: string | null,
): void {
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
  const size = filled ? 11 * S : 7 * S

  ctx.beginPath()
  ctx.moveTo(ax + dx * size, ay + dy * size)
  ctx.lineTo(ax - dy * size * 0.6 - dx * size * 0.4, ay + dx * size * 0.6 - dy * size * 0.4)
  ctx.lineTo(ax + dy * size * 0.6 - dx * size * 0.4, ay - dx * size * 0.6 - dy * size * 0.4)
  ctx.closePath()
  if (filled) {
    ctx.fillStyle = color
    ctx.fill()
  } else {
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1, S)
    ctx.stroke()
  }

  const caption = label === undefined ? formatDistance(shipDistance(world, pos)) : label
  if (caption) text(ctx, caption, ax - dx * size * 2.4, ay - dy * size * 2.4 - 4 * S, color, 'center')
}

/**
 * Маркеры ТЕКУЩЕЙ ЦЕЛИ в масштабе (миелофон вырос за PHASE_START, общий фон меток погашен).
 * Пилот не должен терять выбранное, как бы крупно он ни рос и как бы далеко цель ни была:
 * рисуем ровно выбранное — рамку на самой цели (в кадре) и стрелку курса к ней (за кадром),
 * по мир-позиции. Захваченный борт, контейнер, нав-цель (тело или монолит) — все три.
 * Выше GHOST_BODY система растворилась: только звезда / дыра (станцию больше не метим).
 */
function drawTargetLock(frame: HudFrame): void {
  const { ctx, camera, world, width, height } = frame
  const stellarOnly = world.player.state.scale >= MIELOPHONE.GHOST_BODY_SCALE

  // `surfaceR` — радиус тела: дистанцию к крупному телу меряем до поверхности, не до центра.
  const mark = (pos: Vector3, color: string, label: string | null, surfaceR = 0): void => {
    const p = projectPoint(pos, camera, width, height)
    if (!p.behind && isOnScreen(p.x, p.y, width, height, 20 * S)) {
      corners(ctx, p.x, p.y, 16 * S, color, 2)
      text(ctx, formatDistance(Math.max(0, shipDistance(world, pos) - surfaceR)), p.x, p.y + 16 * S, color, 'center')
      if (label) text(ctx, label, p.x, p.y - 20 * S, color, 'center')
    } else {
      offscreenArrow(frame, pos, color, true)
    }
  }

  // В масштабе — то, что в фокусе портрета. Цвет рамки = цвет значка.
  if (world.targetFocus === 'contact') {
    if (stellarOnly) return
    const locked = world.lockedTargetId != null ? world.ships.find((s) => s.id === world.lockedTargetId) : null
    if (locked && locked.alive && isVisible(locked) && !isStationBot(locked)) {
      mark(locked.state.pos, radarColor(locked, world), locked.acquaintanceId != null ? `◈ ${locked.name}` : null)
    }
    const pod = world.lockedPodId != null ? world.pods.find((p) => p.id === world.lockedPodId) : null
    if (pod && pod.alive) mark(pod.pos, HUD_COLORS.WARN, null)
  } else {
    const nav = navTarget(world)
    if (!nav) return
    if (stellarOnly && nav.kind !== 'star' && nav.kind !== 'blackhole') return
    const surfaceR =
      nav.kind === 'planet' ||
      nav.kind === 'moon' ||
      nav.kind === 'star' ||
      nav.kind === 'monolith' ||
      nav.kind === 'figurine' ||
      nav.kind === 'asteroid'
        ? nav.radius
        : 0
    mark(nav.pos, navMarkerColor(nav), properName(nav.name), surfaceR)
  }
}

/**
 * Галактику для HUD строим лениво и КЭШИРУЕМ по зерну — как в `facts.ts`: 2500 систем один
 * раз на сессию, а не на кадр. Нужны лишь координаты выбранной звезды и своей системы.
 */
let hudGalaxy: { seed: number; epoch: number; systems: StarSystem[] } | null = null
function hudGalaxyFor(world: World): StarSystem[] {
  const seed = world.galaxySeed
  const epoch = world.galaxyEpoch
  if (!hudGalaxy || hudGalaxy.seed !== seed || hudGalaxy.epoch !== epoch) {
    // База из зерна + правки бога: прикреплённая звезда учитывает перекроенную карту.
    hudGalaxy = { seed, epoch, systems: applyDelta(generateGalaxy(seed), world.galaxyDelta) }
  }
  return hudGalaxy.systems
}

const _pinDir = /* @__PURE__ */ new Vector3()

/**
 * Маркер ПРИКРЕПЛЁННОЙ звезды — выбранной на карте галактики (`jumpTargetIndex`) — В ПОЛЁТЕ.
 *
 * Пока галактический слой спит, сама звезда не нарисована (и не должна быть) — но НАПРАВЛЕНИЕ
 * на неё задано геометрией галактики и вычислимо на ЛЮБОМ масштабе. Отображение осей — ровно
 * как у слоя: ly(x,y) → мир(x,z), толщина по Y. Значит рамку на её направлении и стрелку курса
 * можно нарисовать всегда: цель, выбранная на карте, светится в кадре, как бы далеко ни была.
 *
 * Когда слой ПРОСНУЛСЯ (`gr.active`), звезду ведёт он сам (`drawRadar`) — здесь молчим, не двоим.
 */
function drawPinnedStar(frame: HudFrame): void {
  const { ctx, camera, world, width, height } = frame
  // Уступаем ТОЛЬКО тому, кто действительно нарисует. Прежняя проверка смотрела на голый
  // флаг `active`, а он переживал размонтирование слоя (или его поднимал превью-мир за
  // порталом): маркер не рисовал никто — ни здесь, ни в `drawRadar`, — и выбранная на карте
  // звезда пропадала совсем. `galaxyRadarUsable` требует живых буферов, а не намерения.
  if (galaxyRadarUsable()) return
  const tgt = world.jumpTargetIndex
  if (tgt == null || tgt === world.systemIndex) return

  const systems = hudGalaxyFor(world)
  const star = systems[tgt]
  const origin = systems[world.systemIndex]
  if (!star || !origin) return

  // Направление на звезду в МИРОВЫХ осях — тем же отображением, что кладёт слой галактики.
  _pinDir.set(star.x - origin.x, star.z - origin.z, star.y - origin.y)
  if (_pinDir.lengthSq() < 1e-9) return
  _pinDir.normalize()

  // Звезда практически на бесконечности: проецируем точку далеко по направлению от борта.
  // Дистанцию к ней меряем не в метрах (их триллионы), а в СВЕТОВЫХ ГОДАХ — из геометрии.
  const FAR = 1e9 // м — заведомо дальше любого тела системы, но в пределах проекции
  _gtar.copy(world.player.state.pos).addScaledVector(_pinDir, FAR)
  const color = `#${star.star.color.toString(16).padStart(6, '0')}`
  const title = properName(star.name)
  const range = formatLy(distanceLy(origin, star))

  const p = projectPoint(_gtar, camera, width, height)
  if (!p.behind && isOnScreen(p.x, p.y, width, height, 20 * S)) {
    navReticle(ctx, p.x, p.y, color)
    text(ctx, title, p.x, p.y + 12 * S, color, 'center')
    text(ctx, range, p.x, p.y + 20 * S, color, 'center')
  } else {
    offscreenArrow(frame, _gtar, color, true, `${title} · ${range}`)
  }
}

/** Рамочка активной цели в окне — того же цвета, что значок. */
function navReticle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  corners(ctx, x, y, 16 * S, color, 2)
}

/** Остаток / карта в св.г — для подписи звезды галактики. */
function formatLy(ly: number): string {
  const n = !Number.isFinite(ly) || ly < 0 ? 0 : ly
  const s = n >= 10 ? String(Math.round(n)) : n >= 1 ? n.toFixed(1) : n.toFixed(2)
  return `${s} ${t('unit.ly')}`
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
  /** Радиус тела, м: дистанцию показываем до ПОВЕРХНОСТИ (минус радиус) — на неё садишься,
   *  а не в центр. 0 у точечных (станция, кит): у них центр и есть «поверхность». */
  surfaceR: number
  /** Борт: подпись уступает любому месту навигации — их в кадре десяток, а мест единицы. */
  minor?: boolean
}

/** Приоритет подписи: цель важнее ориентира, ориентир важнее спутника, борт — последний. */
function labelRank(m: Marker): number {
  if (m.nav) return 0
  if (m.primary) return 1
  return m.minor ? 3 : 2
}

/**
 * `ships` — брать ли БОРТА. В своём мире они не нужны: там их ведут локатор и захват по
 * Tab. А сквозь кольцо портала нет ни того, ни другого — трафик за окном неотличим от
 * звёзд, хотя именно он и решает, стоит ли туда лететь. Поэтому метки бортов включает
 * только проход мира за кольцом.
 */
function collectMarkers(world: World, ships = false): Marker[] {
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
      // До поверхности садишься, а не в центр: у крупных тел (планета/луна/звезда) дистанцию
      // меряем от поверхности. Станция/чёрная дыра — точечные ориентиры, у них центр.
      surfaceR:
        body.kind === 'planet' || body.kind === 'moon' || body.kind === 'star' ? body.radius : 0,
    })
  }
  // Киты — тоже ориентиры: их МАРКУ пилот должен прочесть, это событие в системе.
  for (const titan of world.titans) {
    out.push({ pos: titan.pos, name: properName(titan.name), color: HUD_COLORS.NEUTRAL, nav: false, primary: true, surfaceR: 0 })
  }
  // Статуи — ориентиры того же рода: десять километров камня, их видно с полсистемы, и подпись
  // им нужна не меньше, чем планете. Своим списком (не тела), потому кладём отдельно.
  for (const m of world.monoliths) {
    out.push({
      pos: m.pos,
      name: MONOLITH_NAMES[m.variant] ?? 'Монолит',
      color: HUD_COLORS.MONOLITH,
      nav: m.id === world.navTargetId,
      primary: true,
      // Габарит статуи — километры: дистанцию меряем до ПОВЕРХНОСТИ, как у планеты, иначе
      // «5 км до центра» читается как «врезался», хотя ты ещё снаружи.
      surfaceR: m.radius,
    })
  }
  for (const f of world.figurines) {
    if (!f.alive) continue
    out.push({
      pos: f.pos,
      name: figurineDisplayName(f),
      color: HUD_COLORS.MONOLITH,
      nav: f.id === world.navTargetId,
      primary: true,
      surfaceR: f.radius,
    })
  }
  // Военные базы — белый ориентир со своим ИМЕНЕМ: рукотворная сфера на снос, а не камень.
  // Всегда подписаны (primary): крупная цель, её видно с полсистемы.
  for (const base of world.warBases) {
    if (!base.alive) continue
    out.push({
      pos: base.pos,
      name: properName(base.name),
      color: HUD_COLORS.STATION,
      nav: base.id === world.navTargetId,
      primary: true,
      surfaceR: base.radius,
    })
  }
  if (ships) {
    for (const ship of world.ships) {
      if (!ship.alive || ship.cloaked) continue
      out.push({
        // Род занятий, а не имя: сквозь окно решают не «как зовут», а «кто это» —
        // пират там ждёт или торговец. Цвет тот же, что на локаторе (`radarColor`).
        pos: ship.state.pos,
        name: occupationName(ship.originKind, ship.faction),
        color: radarColor(ship, world),
        nav: false,
        primary: false,
        surfaceR: 0,
        minor: true,
      })
    }
  }
  return out
}

function drawBodyMarkers({ ctx, camera, world, width, height, aperture }: HudFrame): void {
  // Мир хранится у каждой метки: за кольцом стоит ВТОРАЯ система со своим floating
  // origin и своим кораблём, и дистанцию до её тел надо мерить в её координатах.
  const shown: Array<{ m: Marker; x: number; y: number; distance: number; from: World }> = []
  const hole = apertureEllipse(aperture, camera, width, height)

  for (const m of collectMarkers(world)) {
    const p = projectPoint(m.pos, camera, width, height)
    if (p.behind || !isOnScreen(p.x, p.y, width, height)) continue
    // Подпись своей системы, попавшая в дырку, лежала бы поверх чужого неба —
    // ровно того, что stencil из кадра вырезал. Гасим.
    if (hole && insideAperture(hole, p.x, p.y)) continue
    // projectPoint отдаёт переиспользуемый объект — копируем числа сразу.
    shown.push({ m, x: p.x, y: p.y, distance: p.distance, from: world })
  }

  // Симметрично: тела системы назначения подписываются, но только внутри кольца.
  // Мир за маской — не декорация, а тот самый World, который примет игрок, поэтому
  // метки честные и указывают туда, куда он прилетит.
  const destWorld = aperture?.world
  const destCamera = aperture?.camera
  if (hole && destWorld && destCamera) {
    for (const m of collectMarkers(destWorld, true)) {
      const p = projectPoint(m.pos, destCamera, width, height)
      if (p.behind || !isOnScreen(p.x, p.y, width, height)) continue
      if (!insideAperture(hole, p.x, p.y)) continue
      shown.push({ m, x: p.x, y: p.y, distance: p.distance, from: destWorld })
    }
  }

  // Подписываем по важности: сперва цель и ориентиры (они занимают место), затем
  // вторичные — и только если рядом ещё не тесно. Так у далёкой планеты со
  // станцией и роем спутников, слившихся в одну точку, остаётся одна подпись —
  // планеты. Различишь их по отдельности (подлетев) — подписи разъедутся сами.
  shown.sort((a, b) => labelRank(a.m) - labelRank(b.m))

  const placed: Array<{ x: number; y: number }> = []
  for (const { m, x, y, from } of shown) {
    // Цель навигации — точка чуть крупнее прочих: цвет на звёздном фоне слаб, а
    // разница в размере читается даже боковым зрением.
    dot(ctx, x, y, Math.max(1, (m.nav ? 1.5 * S : 1 * S) - 1), m.color)
    // Рамка-прицел вокруг цели навигации — всегда, на любом масштабе (пока метки вообще
    // рисуются): выбранную звезду/планету пилот метит и в лёгком зуме, а не только в упор.
    // За PHASE_START общий фон гаснет, и там цель ведёт отдельный `drawTargetLock`.
    if (m.nav) navReticle(ctx, x, y, m.color) // цвет тела; активность = наличие рамки

    // Ориентир и активная цель подпись не уступают: планету видно всегда, а
    // выбранную станцию (пусть у другой планеты) — потому что это цель. Вторичный
    // же объект вплотную к уже подписанному молчит, чтобы не плодить кашу.
    const forced = m.primary || m.nav
    if (!forced && placed.some((q) => Math.hypot(q.x - x, q.y - y) < LABEL_MIN_GAP)) continue

    // Подпись отодвинута за рамку: иначе имя ложится ей на грань и не читается.
    const gap = (m.nav ? 12 : 6) * S
    text(ctx, m.name, x + gap, y - 5 * S, m.color)
    // До ПОВЕРХНОСТИ, а не до центра: садишься на поверхность, и «12 км» до неё честнее, чем
    // до ядра сквозь тело. И от КОРАБЛЯ, не от камеры (на масштабе камера далеко за кормой).
    text(ctx, formatDistance(Math.max(0, shipDistance(from, m.pos) - m.surfaceR)), x + gap, y + 5 * S, m.color)
    placed.push({ x, y })
  }
}

/** Клетка панели цели над локатором. */
const CELL = 48

/** Подпись под клеткой: до четырёх строк мелким кеглем. Возвращает базовый шрифт на место. */
function cellCaption(ctx: CanvasRenderingContext2D, midX: number, y: number, lines: [string, string?, string?, string?]): void {
  const baseFont = ctx.font
  ctx.font = `${Math.round(6 * S)}px "Consolas", "DejaVu Sans Mono", monospace`
  text(ctx, lines[0].toUpperCase(), midX, y, HUD_COLORS.PRIMARY, 'center')
  if (lines[1]) text(ctx, lines[1].toUpperCase(), midX, y + 7 * S, HUD_COLORS.DIM, 'center')
  if (lines[2]) text(ctx, lines[2].toUpperCase(), midX, y + 14 * S, HUD_COLORS.DIM, 'center')
  if (lines[3]) text(ctx, lines[3].toUpperCase(), midX, y + 21 * S, HUD_COLORS.DIM, 'center')
  ctx.font = baseFont
}

/** Кружок-значок объекта в клетке: у крупного тела портрета нет, но цвет и форма есть. */
function cellIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const cx = x + (CELL * S) / 2
  const cy = y + (CELL * S) / 2
  const r = (CELL * S) / 2 - 8 * S
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Звезда галактики в портрете: тот же размер шара, что у планеты (рыбий глаз + плазма).
 */
function cellStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  classId: string,
  time: number,
): void {
  const cell = CELL * S
  const cx = x + cell / 2
  const cy = y + cell / 2
  drawStarBall(ctx, cx, cy, cell / 2 - 8 * S, color, classId, time)
}

/**
 * Одна клетка над локатором: текущий фокус (`targetFocus`). Новый выбор гасит старый
 * круг — в портрете ровно одна цель. Рамка = цвет значка.
 */
function drawTargetPanels(frame: HudFrame): void {
  const { ctx, world, width, height } = frame
  const radiusX = 47 * 1.5 * S
  const radiusY = 47 * 0.75 * S
  const radarCx = width - radiusX - 12 * S
  const radarTop = height - 2 * radiusY - 12 * S
  const size = CELL * S
  const x = radarCx - size / 2
  // Чуть выше локатора: место под 3 строки подписи (занятие · отношение · корпус).
  const y = radarTop - size - 36 * S

  const cell = (
    color: string,
    lines: [string, string?, string?, string?],
    body: (x: number, y: number) => void,
    /** Состояние захваченного борта. Метки в космосе мелки и уезжают за кадр — читать
     *  «добивать или уходить» пилот должен здесь, под портретом. */
    bars?: { shield: number; hull: number },
  ): void => {
    body(x, y)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(size), Math.round(size))
    let captionY = y + size + 2 * S
    if (bars) {
      // Порядок и цвета — как у собственных полосок слева: щит голубой сверху, корпус
      // красный под ним. Пилот не переучивается, переводя взгляд с борта на цель.
      bar(ctx, x, captionY, size, 2 * S, bars.shield, HUD_COLORS.PRIMARY)
      bar(ctx, x, captionY + 3 * S, size, 2 * S, bars.hull, HUD_COLORS.DANGER)
      captionY += 8 * S
    }
    cellCaption(ctx, x + size / 2, captionY, lines)
  }

  // Перебор звёзд галактики (Tab при активном слое) — не контакт и не нав системы.
  const gr = galaxyRadar()
  if (gr.active) {
    const tgt = world.jumpTargetIndex
    if (tgt == null || tgt === world.systemIndex || tgt < 0 || tgt >= gr.systemCount) return
    const sys = hudGalaxyFor(world)[tgt]
    if (!sys) return
    const color = `#${sys.star.color.toString(16).padStart(6, '0')}`
    const b = tgt * 3
    const pos = gr.positions
    let remLy = 0
    if (pos && gr.layerScale > 0) {
      _gtar.set(
        gr.anchor.x + pos[b]! * gr.layerScale,
        gr.anchor.y + pos[b + 1]! * gr.layerScale,
        gr.anchor.z + pos[b + 2]! * gr.layerScale,
      )
      remLy = shipDistance(world, _gtar) / gr.layerScale
    }
    cell(
      color,
      [properName(sys.name), starClassName(sys.star), formatLy(remLy)],
      (cx, cy) => cellStar(ctx, cx, cy, color, sys.star.class, world.time),
    )
    return
  }

  if (world.targetFocus === 'contact') {
    const ship = world.lockedTargetId == null ? null : world.ships.find((s) => s.id === world.lockedTargetId)
    if (ship && ship.alive && isVisible(ship)) {
      const color = radarColor(ship, world)
      const stance = stanceTo(world, ship)
      const stanceKey = (`dialogue.stance.${stance}`) as Key
      cell(color, [
        ship.pilotName,
        `${occupationName(ship.originKind, ship.faction)} · ${t(stanceKey)}`,
        chassisName(ship.loadout.chassis.name),
        formatDistance(shipDistance(world, ship.state.pos)),
      ], (cx, cy) => {
        const sheet = loadSheet(portraitSheet(ship.persona.species, pilotEmotion(ship, world)))
        if (sheetReady(sheet)) {
          const c = sheet.naturalWidth / PORTRAIT_GRID
          const { col, row } = portraitCell(portraitIndex(ship))
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(sheet, col * c, row * c, c, c, Math.round(cx), Math.round(cy), Math.round(size), Math.round(size))
        } else {
          text(ctx, (ship.name.trim().charAt(0) || '?').toUpperCase(), cx + size / 2, cy + size / 2 - 5 * S, HUD_COLORS.DIM, 'center')
        }
      }, {
        // У бога щит бесконечный — полоска и должна стоять полной: это не «цел пока»,
        // а свойство. Пилот видит, что бить бесполезно, ещё до первого выстрела.
        shield: ship.divine ? 1 : ship.spec.hull.shield > 0 ? ship.shield / ship.spec.hull.shield : 0,
        hull: ship.divine ? 1 : ship.hull / ship.spec.hull.hull,
      })
      return
    }
    const pod = world.lockedPodId != null ? world.pods.find((p) => p.id === world.lockedPodId && p.alive) : null
    if (pod) {
      cell(HUD_COLORS.WARN, [t('locator.kind.pod'), formatDistance(shipDistance(world, pod.pos))], (cx, cy) => {
        drawPodCrate(ctx, cx + size / 2, cy + size / 2, size, HUD_COLORS.WARN, world.time)
      })
      return
    }
    const rock = world.lockedAsteroidId != null
      ? world.asteroids.find((a) => a.id === world.lockedAsteroidId && a.alive)
      : null
    if (rock) {
      cell(
        HUD_COLORS.ROCK,
        [
          t('locator.kind.asteroid'),
          formatStat('mass', asteroidMass(rock.radius)),
          formatDistance(Math.max(0, shipDistance(world, rock.pos) - rock.radius)),
        ],
        (cx, cy) => {
          drawAsteroidChunk(ctx, cx + size / 2, cy + size / 2, size, HUD_COLORS.ROCK, rock.id, world.time)
        },
      )
    }
    return
  }

  const nav = navTarget(world)
  if (!nav) return
  const kindKey = `locator.kind.${nav.kind}` as Key
  const color = navMarkerColor(nav)
  const navMass =
    nav.kind === 'asteroid' ? formatStat('mass', asteroidMass(nav.radius)) : undefined
  cell(color, [
    properName(nav.name),
    t(kindKey),
    navMass,
    formatDistance(Math.max(0, shipDistance(world, nav.pos) - nav.radius)),
  ], (cx, cy) => {
    const px = cx + size / 2
    const py = cy + size / 2
    const ballR = size / 2 - 8 * S
    switch (nav.kind) {
      case 'planet':
      case 'moon': {
        const body = findBody(world, nav.id)
        if (body) return drawPlanetBall(ctx, px, py, ballR, color, body, world.time)
        break
      }
      case 'star': {
        const body = findBody(world, nav.id)
        if (body) {
          const classId = STAR_CLASSES.find((c) => c.color === body.color)?.id ?? ''
          return drawStarBall(ctx, px, py, ballR, color, classId, world.time)
        }
        break
      }
      case 'station':
        return drawStationWheel(ctx, px, py, size, color, world.time)
      case 'warbase':
        return drawWarBaseIcon(ctx, px, py, size, color, world.time)
      case 'asteroid':
        return drawAsteroidChunk(ctx, px, py, size, color, nav.id, world.time)
    }
    cellIcon(ctx, cx, cy, color)
  })
}

/**
 * Радар: вид сверху, нос — вверх. Показывает и корабли, и тела, поэтому шкала
 * логарифмическая: иначе планета в 400 км сплющит всё остальное к центру.
 */
// Имя выбранной звезды галактики по индексу. `generateGalaxy` детерминирован, но 2500
// систем в кадре считать нельзя — кэшируем результат по зерну (меняется редко, на прыжке).
let _galSeed: number | null = null
let _galSys: ReturnType<typeof generateGalaxy> = []
function galaxyStarName(seed: number, index: number): string | null {
  if (seed !== _galSeed) {
    _galSys = generateGalaxy(seed)
    _galSeed = seed
  }
  return _galSys[index]?.name ?? null
}

/**
 * HUD-МАРКЕРЫ КОМНАТЫ: рамки-прицелы с подписями на ДОМЕ (твоя галактика) и КРЕСТЕ (монумент).
 * Пуфы все светятся и дом/крест среди них теряются — жёсткая рамка с именем делает цель
 * безошибочной. Активная цель автопилота ярче (жёлтая), спящая — голубая. За кадром — стрелка.
 */
function markOne(
  frame: HudFrame,
  pos: { x: number; y: number; z: number },
  name: string,
  color: string,
): void {
  const { ctx, camera, width, height } = frame
  _gtar.set(pos.x, pos.y, pos.z)
  const p = projectPoint(_gtar, camera, width, height)
  if (!p.behind && isOnScreen(p.x, p.y, width, height, 20 * S)) {
    navReticle(ctx, p.x, p.y, color)
    text(ctx, name, p.x, p.y + 12 * S, color, 'center')
  } else {
    offscreenArrow(frame, _gtar, color, true, name)
  }
}

/**
 * ПОДПИСИ ближайших галактик: узлы решётки — именованные галактики, но подписываем только
 * ближайшие (LABEL_COUNT), чтобы не заклепать экран. Тускло, без рамки — рамки только у целей.
 */
function drawTorusLabels(frame: HudFrame): void {
  const { ctx, camera, width, height, torusLabels } = frame
  if (!torusLabels) return
  ctx.font = hudFont(8 * S)
  for (let i = 0; i < torusLabels.count; i++) {
    const lab = torusLabels.items[i]!
    if (!lab.name) continue
    _gtar.set(lab.x, lab.y, lab.z)
    const p = projectPoint(_gtar, camera, width, height)
    if (p.behind || !isOnScreen(p.x, p.y, width, height, 0)) continue
    text(ctx, lab.name, p.x, p.y + 6 * S, HUD_COLORS.DIM, 'center')
  }
}

function drawTorusMarkers(frame: HudFrame): void {
  const { torusHome, torusMonument, torusHomeName, torusMonumentName, torusTarget } = frame
  if (torusHome) markOne(frame, torusHome, torusHomeName, '#66e0ff')
  if (torusMonument) markOne(frame, torusMonument, torusMonumentName, '#66e0ff')
  // Выбранная Tab галактика — поверх и жёлтым: она может совпасть с домом или крестом,
  // и тогда важнее показать, что ведём именно туда.
  if (torusTarget) markOne(frame, torusTarget, torusTarget.name, HUD_COLORS.TARGET)
}

/**
 * ЛОКАТОР КОМНАТЫ ТОРА: та же круговая шкала, что у системного радара, но с двумя метками —
 * ДОМ (твоя галактика) и КРЕСТ (монумент) по направлению от корабля. В пустоте всегда видно, где
 * они и куда рулить. Активная цель автопилота ярче. Вынос от центра — по дистанции проекции.
 */
function bushBlip(
  frame: HudFrame,
  pos: { x: number; y: number; z: number },
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  label: string,
  active: boolean,
): void {
  const { ctx } = frame
  _point.set(pos.x, pos.y, pos.z)
  const distance = _point.length() || 1
  const x = _point.dot(_right)
  const z = _point.dot(_fwd)
  const flat = Math.hypot(x, z)
  const k = Math.min(1, distance / (TORUS.SCALE * 3))
  const px = flat < 1e-6 ? cx : cx + (x / flat) * k * radiusX
  const py = flat < 1e-6 ? cy : cy - (z / flat) * k * radiusY
  const lift = Math.max(-10 * S, Math.min(10 * S, (_point.dot(_up) / distance) * 20 * S))
  const my = py - lift
  if (Math.abs(lift) > S) line(ctx, px, py, px, my, HUD_COLORS.DIM)
  const color = active ? HUD_COLORS.TARGET : '#66e0ff'
  const r = 3 * S
  line(ctx, px - r, my, px + r, my, color, active ? 2 : 1)
  line(ctx, px, my - r, px, my + r, color, active ? 2 : 1)
  ctx.font = hudFont(9 * S)
  text(ctx, label, px + r + 2 * S, my - 4 * S, color)
}

function drawBushLocator(frame: HudFrame): void {
  const { ctx, world, width, height, torusHome, torusMonument, torusHomeName, torusMonumentName, torusTarget } = frame
  const radiusX = 47 * 1.5 * S
  const radiusY = 47 * 0.75 * S
  const cx = width - radiusX - 12 * S
  const cy = height - radiusY - 12 * S
  const FRAME_W = 2

  ellipse(ctx, cx, cy, radiusX, radiusY, HUD_COLORS.DIM, FRAME_W)
  ellipse(ctx, cx, cy, radiusX / 2, radiusY / 2, HUD_COLORS.DIM, FRAME_W)
  line(ctx, cx, cy - 3 * S, cx, cy + 3 * S, HUD_COLORS.DIM, FRAME_W)
  line(ctx, cx - 3 * S, cy, cx + 3 * S, cy, HUD_COLORS.DIM, FRAME_W)

  shipAxes(world.player.state.quat, _fwd, _right, _up)
  if (torusHome) bushBlip(frame, torusHome, cx, cy, radiusX, radiusY, torusHomeName, false)
  if (torusMonument) bushBlip(frame, torusMonument, cx, cy, radiusX, radiusY, torusMonumentName, false)
  if (torusTarget) bushBlip(frame, torusTarget, cx, cy, radiusX, radiusY, torusTarget.name, true)
}

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
function drawAltimeter(frame: HudFrame, cx: number, top: number, bottom: number): void {
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

function drawRadar(frame: HudFrame): void {
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
    plot(m.pos, HUD_COLORS.MONOLITH, Math.round((nav ? 3 : 2) * S), nav, 'round', nav ? MONOLITH_NAMES[m.variant] : undefined)
  }

  for (const f of world.figurines) {
    if (!f.alive) continue
    const nav = f.id === world.navTargetId
    plot(f.pos, HUD_COLORS.MONOLITH, Math.round((nav ? 3 : 2) * S), nav, 'round', nav ? figurineDisplayName(f) : undefined)
  }

  for (const base of world.warBases) {
    if (!base.alive) continue
    const nav = base.id === world.navTargetId
    // Белым и КОЛЕЧКОМ: рукотворная сфера, а не бурая точка камня.
    plot(base.pos, HUD_COLORS.STATION, Math.round((nav ? 3 : 2) * S), true, 'ring', nav ? properName(base.name) : undefined)
  }

  for (const rock of world.asteroids) {
    if (!rock.alive) continue
    const nav = rock.id === world.navTargetId
    // Нав-глыбу держим на радаре всегда; мелочь — только рядом.
    if (!nav && rock.pos.distanceToSquared(player.state.pos) > ROCK_RANGE * ROCK_RANGE) continue
    const color = nav ? HUD_COLORS.MONOLITH : HUD_COLORS.ROCK
    const locked = rock.id === world.lockedAsteroidId
    plot(rock.pos, color, Math.round((nav ? 3 : 1.5) * S), nav || locked, 'round', nav ? NAV_ASTEROID_NAME : undefined)
  }

  for (const pod of world.pods) {
    if (!pod.alive) continue
    plot(pod.pos, HUD_COLORS.WARN, Math.round(1.5 * S), pod.id === world.lockedPodId)
  }

  // Киты / платформы — крупнее рядового борта, без кольца (кольцо = только активный захват).
  for (const titan of world.titans) plot(titan.pos, HUD_COLORS.NEUTRAL, Math.round(3 * S), false, 'round')
  for (const platform of world.platforms) {
    if (!platform.alive) continue
    plot(platform.pos, HUD_COLORS.DANGER, Math.round(3 * S), false, 'square')
  }

  for (const ship of world.ships) {
    if (!isVisible(ship) || isStationBot(ship)) continue
    plot(ship.state.pos, radarColor(ship, world), Math.round(2 * S), ship.id === world.lockedTargetId)
  }
}

/** Дальше этого локатор не разбирает дистанцию, м: отметка прижата к ободу. */
const RADAR_RANGE = 20_000
/** Ближе этого камни рисуются, м. Дальше они — не препятствие, а пейзаж. */
const ROCK_RANGE = 4_000

/** Звезда жёлтая, дыра фиолетовая, причал белый, планета/луна — голубые. */
function bodyColor(body: BodyEntity): string {
  if (body.kind === 'star') return HUD_COLORS.STAR
  if (body.kind === 'blackhole') return HUD_COLORS.BLACKHOLE
  if (body.kind === 'station') return HUD_COLORS.STATION
  return HUD_COLORS.PLANET
}

/** Цвет нав-цели = цвет значка на локаторе. */
function navMarkerColor(nav: { kind: string }): string {
  // Военная база — белая: рукотворная сфера, а не бурый камень. Отдельный тон, свой значок.
  if (nav.kind === 'warbase') return HUD_COLORS.STATION
  // Астероид — тот же коричневый, что статуя: пилот не учит второй тон «камня».
  if (nav.kind === 'monolith' || nav.kind === 'figurine' || nav.kind === 'asteroid') {
    return HUD_COLORS.MONOLITH
  }
  if (nav.kind === 'star') return HUD_COLORS.STAR
  if (nav.kind === 'blackhole') return HUD_COLORS.BLACKHOLE
  if (nav.kind === 'station') return HUD_COLORS.STATION
  return HUD_COLORS.PLANET
}

/** Враг красный, друг/свой зелёный, нейтрал серый, живой игрок — розовый. */
function radarColor(ship: ShipEntity, world: World): string {
  if (ship.kinematic) return HUD_COLORS.PLAYER
  const stance = stanceTo(world, ship)
  if (stance === 'hostile') return HUD_COLORS.DANGER
  if (stance === 'friendly') return HUD_COLORS.ALLY
  return HUD_COLORS.NEUTRAL
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
 * Крупная величина «приборного» вида: число ВЫТЯНУТОЙ цифрой (техно-look — вертикальный
 * растяг моноширинного кегля, горизонтально ужато под ~половину гауджа), единица мельче
 * ПОД числом, а необязательный множитель (крейсер) — мельче СВЕРХУ. Тренд-стрелка справа.
 *
 * Вытягивание — трансформом канваса, а не сменой шрифта: грузить TTF в пиксельный HUD
 * незачем (он всё равно пикселизуется), а `scale(condense, stretch)` даёт ту же вытянутую
 * футуристичную цифру из уже готовой Consolas. Место под множитель резервируем всегда,
 * чтобы цифра не прыгала, когда крейсер включают-выключают.
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
  above: string | null = null,
  /** Поднять единицу измерения обратно на столько px: число с множителем спускаем, а её нет. */
  unitLift = 0,
): void {
  const entryFont = ctx.font
  const aboveH = 11 * S // зарезервированная полоса под множитель — всегда, есть он или нет

  // Множитель — мелким сверху, тем же тёплым цветом предупреждения, что и раньше.
  if (above) {
    ctx.font = hudFont(11 * S)
    text(ctx, above, x, top, HUD_COLORS.WARN)
  }
  const numTop = top + aboveH + 1 * S

  // Большое ВЫТЯНУТОЕ число. Кегль задаёт высоту, `STRETCH_Y` тянет по вертикали,
  // `condense` ужимает по горизонтали, чтобы вписать в долю половины колонки.
  // Кегль крупный — значения держим в 3–4 разряда (см. *Parts), иначе `condense`
  // ужал бы цифру в нитку. Не жать в 94% ширины: иначе смена кегля почти невидима —
  // цифра просто сильнее/слабее сжимается под ту же полку.
  const BASE = 24 * S // было 28: −4 пункта кегля
  const STRETCH_Y = 1.2
  ctx.font = hudFont(BASE)
  const natW = ctx.measureText(value).width
  const condense = Math.min(0.85, (maxWidth * 0.78) / Math.max(1, natW))
  ctx.save()
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.translate(Math.round(x), Math.round(numTop))
  ctx.scale(condense, STRETCH_Y)
  ctx.font = hudFont(BASE)
  ctx.fillText(value, 0, 0)
  ctx.restore()
  const numW = condense * natW
  const numH = BASE * STRETCH_Y

  // Единица измерения — мельче и ПОД числом, не сбоку. `unitLift` возвращает её вверх,
  // когда число с множителем намеренно спущено, а единица должна остаться на месте.
  ctx.font = hudFont(11 * S)
  text(ctx, unit, x, numTop + numH + 1 * S - unitLift, color)

  // Тренд-стрелка — справа от числа, на его середине.
  trendArrow(ctx, x + numW + 6 * S, numTop + numH / 2, trend, color)
  ctx.font = entryFont
}

function drawReadouts({ ctx, world, height, bush, torusThrust }: HudFrame): void {
  const player: ShipEntity = world.player
  const x = 10 * S
  const labelWidth = 34 * S
  const barWidth = 66 * S
  const columnWidth = labelWidth + barWidth
  const halfWidth = columnWidth / 2
  const barHeight = 5 * S
  const step = 11 * S

  // ── Скорость и масштаб — САМЫМИ ПЕРВЫМИ, крупной цифрой ──────────────────────
  // Подняли выше: кегль стал ~вдвое крупнее, и блок (множитель сверху → число → единица
  // снизу) иначе наползал бы на шкалы состояния ниже.
  const speedTop = height - 185 * S
  shipAxes(player.state.quat, _fwd, _right, _up)
  const vel = player.state.vel
  const speedMag = vel.length()

  // Тренд по МОДУЛЮ скорости: разгон — вверх, торможение — вниз, ровный ход — ничего.
  // Мёртвая зона относительная: на сверхсветовом крейсере абсолютный дребезг огромен.
  const speedEps = Math.max(0.5, speedMag * 0.002)
  const dv = speedMag - _prevSpeed
  const speedTrend = dv > speedEps ? 1 : dv < -speedEps ? -1 : 0
  _prevSpeed = speedMag

  // Множитель крейсера — СВЕРХУ скорости (мелким). Скорость уже сверхсветовая (vel уже
  // умножен на factor); ×N лишь говорит, насколько разогнан ход. Показываем, только когда
  // крейсер реально включён, иначе «×1» висело бы всегда.
  const factor = player.cruise.factor
  const mult = factor > CRUISE.IDLE_EPSILON ? `×${formatScale(factor)}` : null

  // Назад — с минусом (U+2212): реверс это не «ноль хода», а движение против носа.
  const sp = speedParts(speedMag)
  const reversing = vel.dot(_fwd) < -1
  // Число спущено на NUM_DROP px, а единица «м/с» поднята ровно обратно — осталась на месте.
  // Тем же сдвигом рисуем и масштаб справа, чтобы обе крупные цифры стояли на одной линии.
  const NUM_DROP = 5 * S
  bigValue(ctx, x, speedTop + NUM_DROP, reversing ? `−${sp.value}` : sp.value, sp.unit, HUD_COLORS.PRIMARY, speedTrend, halfWidth, mult, NUM_DROP)

  // Масштаб (миелофон) — справа, жёлтым, так же крупно. Появляется, только когда
  // прибор установлен: без него о масштабе речи нет.
  if (player.spec.hasMielophone) {
    const scale = player.state.scale
    const ds = scale - _prevScale
    const scaleEps = Math.max(1e-3, _prevScale * 0.002)
    const scaleTrend = ds > scaleEps ? 1 : ds < -scaleEps ? -1 : 0
    _prevScale = scale
    const sc = scaleParts(scale)
    // Тот же NUM_DROP и подъём единицы, что у скорости, — цифры масштаба и скорости на одной линии.
    bigValue(ctx, x + halfWidth, speedTop + NUM_DROP, sc.value, sc.unit, HUD_COLORS.TARGET, scaleTrend, halfWidth, null, NUM_DROP)
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

  // В комнате тора тяга идёт не в физику (борт стоит), а в поток S³ — берём её из кадра. Это тот
  // же сектор газа 0..1, что у пилота, поэтому шкала ведёт себя ровно как в мире.
  const throttleShown = bush ? Math.abs(torusThrust) : Math.abs(player.controls.throttle)

  const rows: [string, number, string][] = [
    // Тяга — первой строкой, сразу под цифрами скорости: главный орган хода на виду.
    // Жёлтая шкала; задний ход — тот же цвет, по модулю.
    [t('hud.throttle'), throttleShown, HUD_COLORS.WARN],
    [t('hud.shield'), shield, HUD_COLORS.PRIMARY],
    [t('hud.hull'), hull, hull < 0.3 ? HUD_COLORS.DANGER : HUD_COLORS.PRIMARY],
    // Главной батареи (БАТ) на HUD больше нет: её ничто не расходовало (полёт/форсаж/оружие
    // энергию не тратят) — декоративная шкала убрана. Осталась аукс-батарея, которую тратят реально.
    // Батарея ДОП-ОТСЕКА (аукс): общий запас бомбы, ПРО и маскировки. Голубая шкала;
    // на нуле красная — ни импульса, ни поля.
    [t('hud.aux'), aux, aux < 0.15 ? HUD_COLORS.DANGER : HUD_COLORS.PRIMARY],
    // Нагрев СТВОЛА от стрельбы — отдельно от нагрева корпуса звездой.
    [t('hud.laser'), laser, laser > 0.7 ? HUD_COLORS.DANGER : HUD_COLORS.WARN],
    // Температура КОРПУСА от близкой звезды. На пороге разрушения корпус гибнет мгновенно;
    // жёлтая с WARN (пора отворачивать), красная с CRITICAL (последнее окно).
    [t('hud.temp'), temp, temp >= STAR_HEAT.CRITICAL ? HUD_COLORS.DANGER : temp >= STAR_HEAT.WARN ? HUD_COLORS.WARN : HUD_COLORS.DIM],
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
  // Температура корпуса от звезды: WARN..CRITICAL — жёлтый «ПЕРЕГРЕВ», выше — красный
  // «КРИТИЧЕСКИЙ ПЕРЕГРЕВ» (за ним корпус разрушается мгновенно — домен, см. stepStarHeat).
  const temp = player.hullHeat
  if (temp >= STAR_HEAT.CRITICAL) pushWarning('overheat', now)
  else if (temp >= STAR_HEAT.WARN) pushWarning('hullHot', now)

  if (player.hull / player.spec.hull.hull < 0.25) pushWarning('hullCritical', now)
  // Ствол в отключке перегрева: жёлтая мигающая «ПЕРЕГРЕВ ЛАЗЕРА · ОХЛАЖДЕНИЕ» все 5 секунд.
  if (laserOverheated(player, now)) pushWarning('laserHot', now)
  if (player.cruise.block === 'mass-lock') pushWarning('massLock', now)
  else if (player.cruise.block === 'proximity') pushWarning('gravityBrake', now)
  if (scooping(player)) pushWarning('refuel', now)
  // Раскрытие гиперкольца — состояние: держат H, кольцо растёт. Отпустил — плашка гаснет
  // сама, как всякий пуш без подтверждения. `repeat: 0` — не приглушать повтором.
  if (frame.portalGrowing) pushWarning('portalOpening', now, { repeat: 0 })

  // Посадка на поверхность важнее стыковки: у двора Люцифера Кориолис иначе
  // перебивал пуш глыбы. Сначала куе посадки — стыковку тогда не предлагаем.
  const land = player.landedOn ? null : landingCue(world)

  // При отчаливании это выход на орбиту, а не приглашение немедленно стыковаться назад.
  if (undocking()) {
    pushWarning('orbitExit', now, { repeat: 0 })
  // Стыковка — только в обычном размере и когда не садимся на поверхность.
  } else if (player.state.scale <= 1 && !land) {
    const station = findStation(world)
    if (station) {
      const range = stationRange(player, station)
      if (range <= AUTODOCK.ENGAGE_RANGE) {
        const st = dockState(world, station, autodock)
        if (st === 'ready') pushWarning('dockReady', now)
        else if (st === 'engaged') pushWarning('dockCorridor', now, { label: t('hud.dockCorridor', { range: formatDistance(range) }) })
        // Скорость подхода больше не отдельное предупреждение: автостыковка сама гасит
        // подлёт, так что «сбрось скорость до N» ушло — остаётся обычная подсказка.
        else pushWarning('dockHint', now, { label: t('hud.dockHint', { range: formatDistance(range) }), repeat: 0 })
      }
    }
  }

  // На поверхности — отлип. Иначе: 500…200 м подготовка, 200…100 м — нажмите L.
  if (player.landedOn) {
    pushWarning('landDetach', now, { repeat: 0 })
  } else if (land) {
    const alt = formatDistance(land.altitude)
    if (land.phase === 'prompt') {
      pushWarning('landPrompt', now, { label: t('hud.landPrompt', { alt }), repeat: 0 })
    } else {
      pushWarning('landApproach', now, { label: t('hud.landApproach', { alt }), repeat: 0 })
    }
  }

  // Удар/отскок: домен ставит `lastCrashAt` каждый кадр контакта — держим пуш, пока прёшь в твердь
  // (в т.ч. выросшим миелофоном: без урона, но «не разбивает» должно быть видно).
  // Подпись — тип и имя цели: иначе при росте в «пустоте» удар нечитаем.
  if (now - player.lastCrashAt < 0.08) {
    const hit = player.lastCrashHit
    const kindKey = hit
      ? (`locator.kind.${hit.kind}` as 'locator.kind.planet')
      : null
    const kind = kindKey ? t(kindKey).toUpperCase() : ''
    const name = hit?.name ? properName(hit.name).toUpperCase() : ''
    const label =
      hit && name
        ? t('hud.crashHit', { kind, name })
        : hit
          ? t('hud.crashHitAnon', { kind })
          : t('hud.crash')
    pushWarning('crash', now, { label, repeat: 0 })
  }

  // «Корабль потерян»: игрок не уходит в Game Over — щиты полные, красный пуш с причиной.
  if (now - player.lastLostAt < WARN_LIFE) {
    const hit = player.lastLostHit
    const kindKey = hit
      ? (`locator.kind.${hit.kind}` as 'locator.kind.planet')
      : null
    const kind = kindKey ? t(kindKey).toUpperCase() : ''
    const name = hit?.name ? properName(hit.name).toUpperCase() : ''
    const label =
      hit && name
        ? t('hud.shipLostHit', { kind, name })
        : hit
          ? t('hud.shipLostAnon', { kind })
          : t('hud.shipLost')
    pushWarning('shipLost', now, { label, repeat: 0 })
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
  // Маскировка — тоже СОСТОЯНИЕ (пока `cloaked`), а не транзиентная весть: мигающая плашка
  // вверху, как у форсажа и рекалибровки, а не сухая строка у нижней кромки. Голубая (NAV).
  const cloakPlate: Plate | null = player.cloaked
    ? { color: HUD_COLORS.NAV, hz: 1.2, rank: 0, label: t('hud.cloak'), born: now }
    : null
  // Реальные предупреждения важнее; из состояний масштаб и маскировка (важные режимы)
  // впереди форсажа.
  return activeWarning(now) ?? autofightPlate ?? autopilotPlate ?? cloakPlate ?? scalePlate ?? boostPlate
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
  // не вплотную к краю, но и не в глубине кадра, где перекрыло бы прицел. Плюс 20 px
  // вниз по просьбе: плашки-пуши сидят чуть ниже верхней кромки.
  const cx = width / 2
  const cy = 8 * S + bh / 2 + 20 * S

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

