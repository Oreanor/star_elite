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
  navTarget,
  MONOLITH_NAMES,
  autofightActive,
  auxFraction,
  canAutoland,
  applyDelta,
  clamp,
  distanceLy,
  generateGalaxy,
  incomingMissile,
  nearestLandable,
  itemName,
  missileAmmo,
  nearestPod,
  laserOverheated,
  peakHeat,
  pendingHail,
  scooping,
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
    drawTargetPanels(frame)
  } else {
    // В масштабе (миелофон вырос за PHASE_START) общий фон меток погашен — тела далеко и
    // глючат. Но ВЫБРАННУЮ цель пилот терять не должен: рисуем ровно её — рамку на ней и
    // стрелку за кадром — до самого пробуждения галактического слоя (тот берёт звёзды на себя).
    drawTargetLock(frame)
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

    const ready = scoopReadiness(player, pod) === null
    const color = ready ? HUD_COLORS.PRIMARY : HUD_COLORS.WARN
    if (locked && !isOnScreen(p.x, p.y, width, height, 10 * S)) {
      offscreenArrow(frame, pod.pos, color, true)
      continue
    }
    // Рамка мелкая намеренно: контейнер — не цель, и путать его с кораблём нельзя. Захваченный —
    // крупнее и с дистанцией: видно, ЧТО именно выбрано листанием.
    corners(ctx, p.x, p.y, (locked ? 14 : 9) * S, color, locked ? 2 : 1)
    if (locked) text(ctx, formatDistance(shipDistance(world, pod.pos)), p.x, p.y + (locked ? 18 : 12) * S, color, 'center')
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

/** Рамки враждебных кораблей. Захваченная выделена цветом и подписана. */
function drawTargets({ ctx, camera, world, width, height }: HudFrame): void {
  for (const ship of world.ships) {
    if (!ship.alive || ship.divine) continue // бог Слово в космосе не рисуется — он бот в станции

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
    // понять, кто рядом, а кто в километре. От КОРАБЛЯ, не от камеры (см. shipDistance).
    text(ctx, formatDistance(shipDistance(world, ship.state.pos)), p.x, p.y + size / 2 + 3 * S, color, 'center')

    /**
     * Подписываем КАЖДЫЙ борт, а не только захваченный. Голая рамка не говорит ничего: в кадре
     * висят одинаковые уголки, и кто из них торговец, кто пират, а кто твой знакомый — не понять,
     * пока не переберёшь их Tab'ом по одному.
     *
     * Знакомый — по ИМЕНИ и со значком ◈: среди безликих отметок он обязан читаться как «этого
     * ты знаешь». Прочие — по типу встречи («Пират», «Торговец»): имени его ты ещё не знаешь,
     * и выдавать чужое имя до знакомства нельзя — оно открывается разговором.
     */
    const known = ship.acquaintanceId != null
    const label = known ? `◈ ${ship.name}` : shipTypeName(ship.name)
    text(ctx, label, p.x, p.y + size / 2 + 13 * S, known ? HUD_COLORS.PRIMARY : color, 'center')

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
    if (!ship.alive || !isVisible(ship) || ship.divine) continue // бог Слово — не цель в космосе
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

/**
 * Рисует треугольник у края кадра, если точка за кадром. Иначе молчит.
 * `label`: строка — подпись у стрелки вместо дистанции; null — без подписи; undefined — дистанция.
 */
function offscreenArrow(
  { ctx, camera, world, width, height }: HudFrame,
  pos: Vector3,
  color: string,
  emphasis = false,
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
  const size = emphasis ? 12 * S : 7 * S // захваченная цель — крупнее прочих

  // Треугольник, смотрящий наружу.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(ax + dx * size, ay + dy * size)
  ctx.lineTo(ax - dy * size * 0.6 - dx * size * 0.4, ay + dx * size * 0.6 - dy * size * 0.4)
  ctx.lineTo(ax + dy * size * 0.6 - dx * size * 0.4, ay - dx * size * 0.6 - dy * size * 0.4)
  ctx.closePath()
  ctx.fill()

  const caption = label === undefined ? formatDistance(shipDistance(world, pos)) : label
  if (caption) text(ctx, caption, ax - dx * size * 2.4, ay - dy * size * 2.4 - 4 * S, color, 'center')
}

/**
 * Маркеры ТЕКУЩЕЙ ЦЕЛИ в масштабе (миелофон вырос за PHASE_START, общий фон меток погашен).
 * Пилот не должен терять выбранное, как бы крупно он ни рос и как бы далеко цель ни была:
 * рисуем ровно выбранное — рамку на самой цели (в кадре) и стрелку курса к ней (за кадром),
 * по мир-позиции. Захваченный борт, контейнер, нав-тело (звезда/планета/станция) — все три.
 */
function drawTargetLock(frame: HudFrame): void {
  const { ctx, camera, world, width, height } = frame

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

  // Захваченный борт (бог Слово в космосе не цель).
  const locked = world.lockedTargetId != null ? world.ships.find((s) => s.id === world.lockedTargetId) : null
  if (locked && locked.alive && isVisible(locked) && !locked.divine) {
    mark(locked.state.pos, HUD_COLORS.PRIMARY, locked.acquaintanceId != null ? `◈ ${locked.name}` : null)
  }
  // Захваченный контейнер-обломок.
  const pod = world.lockedPodId != null ? world.pods.find((p) => p.id === world.lockedPodId) : null
  if (pod && pod.alive) mark(pod.pos, HUD_COLORS.PRIMARY, null)
  // Нав-тело: звезда/планета/станция — цвет тот же, что на локаторе; до поверхности у крупных.
  const nav = findBody(world, world.navTargetId)
  if (nav) {
    const surfaceR = nav.kind === 'planet' || nav.kind === 'moon' || nav.kind === 'star' ? nav.radius : 0
    mark(nav.pos, bodyColor(nav), properName(nav.name), surfaceR)
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
  if (galaxyRadar().active) return // слой проснулся — звезду метит drawRadar
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
  const caption = `${properName(star.name)} · ${Math.round(distanceLy(origin, star))} св.лет`

  const p = projectPoint(_gtar, camera, width, height)
  if (!p.behind && isOnScreen(p.x, p.y, width, height, 20 * S)) {
    navReticle(ctx, p.x, p.y, color)
    text(ctx, caption, p.x, p.y + 12 * S, color, 'center')
  } else {
    offscreenArrow(frame, _gtar, color, true, caption)
  }
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
  /** Радиус тела, м: дистанцию показываем до ПОВЕРХНОСТИ (минус радиус) — на неё садишься,
   *  а не в центр. 0 у точечных (станция, кит): у них центр и есть «поверхность». */
  surfaceR: number
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
      color: MONOLITH_COLOR,
      nav: m.id === world.navTargetId,
      primary: true,
      // Габарит статуи — километры: дистанцию меряем до ПОВЕРХНОСТИ, как у планеты, иначе
      // «5 км до центра» читается как «врезался», хотя ты ещё снаружи.
      surfaceR: m.radius,
    })
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
  for (const { m, x, y } of shown) {
    // Цель навигации — точка потолще: цвет на звёздном фоне различим плохо, а
    // разница в размере читается даже боковым зрением.
    dot(ctx, x, y, m.nav ? 2.5 * S : 1.5 * S, m.color)
    // Рамка-прицел вокруг цели навигации — всегда, на любом масштабе (пока метки вообще
    // рисуются): выбранную звезду/планету пилот метит и в лёгком зуме, а не только в упор.
    // За PHASE_START общий фон гаснет, и там цель ведёт отдельный `drawTargetLock`.
    if (m.nav) navReticle(ctx, x, y, m.color)

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
    text(ctx, formatDistance(Math.max(0, shipDistance(world, m.pos) - m.surfaceR)), x + gap, y + 5 * S, m.color)
    placed.push({ x, y })
  }
}

/** Клетка панели цели, м. Три строки подписи под ней — оттого шаг больше самой клетки. */
const CELL = 48
const CELL_STEP = 48 + 26

/** Подпись под клеткой: до трёх строк мелким кеглем. Возвращает базовый шрифт на место. */
function cellCaption(ctx: CanvasRenderingContext2D, midX: number, y: number, lines: [string, string?, string?]): void {
  const baseFont = ctx.font
  ctx.font = `${Math.round(6 * S)}px "Consolas", "DejaVu Sans Mono", monospace`
  text(ctx, lines[0].toUpperCase(), midX, y, HUD_COLORS.PRIMARY, 'center')
  if (lines[1]) text(ctx, lines[1].toUpperCase(), midX, y + 7 * S, HUD_COLORS.DIM, 'center')
  if (lines[2]) text(ctx, lines[2].toUpperCase(), midX, y + 14 * S, HUD_COLORS.DIM, 'center')
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
 * ПАНЕЛИ ЦЕЛЕЙ — стопкой над локатором справа, снизу вверх. Целей ДВЕ и они независимы:
 * контакт (Tab) и нав-цель (Shift+Tab). Рисуется только ВЫБРАННОЕ — одна клетка, две или ни одной.
 *
 * Цвет рамки говорит, что это: КРАСНАЯ — контакт (живой персонаж или контейнер, с ним говорят
 * и по нему бьют), ГОЛУБАЯ — нав-цель (крупное: звезда, планета, луна, станция, монолит). Раньше
 * панель была одна и только для борта, оттого захват станции или статуи ничем не отзывался, и
 * было не понять, что вообще выбрано.
 *
 * У персонажа в клетке — лицо (вырезается из листа расы по координатам, эмоция из состояния).
 * У крупного портрета нет и быть не может, поэтому кружок его цвета — но подпись ОБЯЗАТЕЛЬНА:
 * что это и как зовётся.
 */
function drawTargetPanels(frame: HudFrame): void {
  const { ctx, world, width, height } = frame
  // Локатор в правом нижнем углу — стопка растёт от его верхней кромки вверх.
  const radiusX = 47 * 1.5 * S
  const radiusY = 47 * 0.75 * S
  const radarCx = width - radiusX - 12 * S
  const radarTop = height - 2 * radiusY - 12 * S
  const size = CELL * S
  const x = radarCx - size / 2
  let slot = 0

  /** Одна клетка: рамка своего цвета, содержимое рисует `body`, снизу подпись. */
  const cell = (color: string, lines: [string, string?, string?], body: (x: number, y: number) => void): void => {
    const y = radarTop - size - 24 * S - slot * CELL_STEP * S
    body(x, y)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(size), Math.round(size))
    cellCaption(ctx, x + size / 2, y + size + 2 * S, lines)
    slot++
  }

  // ── КОНТАКТ (Tab) — красным. Персонаж: лицо, имя, род занятий, корабль.
  const ship = world.lockedTargetId == null ? null : world.ships.find((s) => s.id === world.lockedTargetId)
  if (ship && ship.alive && isVisible(ship)) {
    cell(
      HUD_COLORS.DANGER,
      [ship.pilotName, occupationName(ship.originKind, ship.faction), chassisName(ship.loadout.chassis.name)],
      (cx, cy) => {
        const sheet = loadSheet(portraitSheet(ship.persona.species, pilotEmotion(ship, world)))
        if (sheetReady(sheet)) {
          const c = sheet.naturalWidth / PORTRAIT_GRID
          const { col, row } = portraitCell(portraitIndex(ship))
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(sheet, col * c, row * c, c, c, Math.round(cx), Math.round(cy), Math.round(size), Math.round(size))
        } else {
          // Лист ещё грузится — инициал держит место, лицо встанет само.
          text(ctx, (ship.name.trim().charAt(0) || '?').toUpperCase(), cx + size / 2, cy + size / 2 - 5 * S, HUD_COLORS.DIM, 'center')
        }
      },
    )
  } else if (world.lockedPodId != null) {
    // Контейнер — тоже контакт (останки борта), но лица у него нет: кружок.
    const pod = world.pods.find((p) => p.id === world.lockedPodId && p.alive)
    if (pod) cell(HUD_COLORS.DANGER, [t('locator.kind.pod')], (cx, cy) => cellIcon(ctx, cx, cy, HUD_COLORS.WARN))
  }

  // ── НАВ-ЦЕЛЬ (Shift+Tab) — голубым. Крупное: кружок своего цвета + что это и как зовётся.
  const nav = navTarget(world)
  if (nav) {
    const kindKey = `locator.kind.${nav.kind}` as Key
    const body = world.bodies.find((b) => b.id === nav.id)
    // Цвет — тот же, что метит тело на локаторе: значок и метка обязаны совпасть, иначе
    // «кружок в панели» и «точка на радаре» читаются как разные объекты.
    const color = body ? bodyColor(body) : MONOLITH_COLOR
    cell(HUD_COLORS.PRIMARY, [properName(nav.name), t(kindKey)], (cx, cy) => cellIcon(ctx, cx, cy, color))
  }
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

function drawRadar(frame: HudFrame): void {
  const { ctx, camera, world, width, height } = frame
  const radiusX = 47 * 1.5 * S // ширина эллипса локатора (прежняя, ~70): читается на скорости
  const radiusY = 47 * 0.75 * S // высота на 25% МЕНЬШЕ прежней (47→35): локатор стал площе
  const cx = width - radiusX - 12 * S // снова в правом нижнем углу: по центру он мешал
  const cy = height - radiusY - 12 * S
  const FRAME_W = 2 // обод и лучи чуть толще одинарной линии — крупный локатор их держит

  ellipse(ctx, cx, cy, radiusX, radiusY, HUD_COLORS.DIM, FRAME_W)
  ellipse(ctx, cx, cy, radiusX / 2, radiusY / 2, HUD_COLORS.DIM, FRAME_W)
  line(ctx, cx, cy - 3 * S, cx, cy + 3 * S, HUD_COLORS.DIM, FRAME_W)
  line(ctx, cx - 3 * S, cy, cx + 3 * S, cy, HUD_COLORS.DIM, FRAME_W)

  // Локатор переключается на ГАЛАКТИКУ, только когда слой ПРОЯВИЛСЯ (gr.active) — тогда в
  // сфере видимости есть звёзды. Раньше переключали по одному масштабу (PHASE_START=1000),
  // но слой спит до WAKE_SCALE=5e8 — между ними зиял мёртвый «НЕТ ДАННЫХ» на десятки тысяч ×.
  // Пока галактика не проснулась, показываем СИСТЕМУ: её тела ещё на своих местах и видны.
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

    // ВЫБРАННАЯ звезда (Tab / карта галактики → jumpTargetIndex): кольцо и подпись цветом
    // цели (NAV), ВСЕГДА (force) — даже вне сферы, чтобы знать курс на невидимую пока звезду.
    const tgt = world.jumpTargetIndex
    if (tgt != null && tgt !== gr.originIndex && tgt >= 0 && tgt < gr.count) {
      const tp = projStar(tgt * 3, true)
      if (tp) {
        dot(ctx, tp.px, tp.my, Math.max(1, 1.5 * S), HUD_COLORS.NAV)
        circle(ctx, tp.px, tp.my, 3.5 * S, HUD_COLORS.NAV)
        const name = galaxyStarName(world.galaxySeed, tgt)
        if (name) text(ctx, properName(name), tp.px + 5 * S, tp.my - 3 * S, HUD_COLORS.NAV, 'left')
      }

      // Прицельная РЕТИКУЛА выбранной звезды ПРЯМО В КАДРЕ (не на локаторе): звезда реально
      // горит шаром в 3D, поэтому метим её ТАМ, где она видна, — наводишь нос на скобки, как
      // на захваченный борт. Локатор (вид сверху) для наведения неточен: высоту он свернул в
      // короткую «палку», оттого метка «плавала то выше, то ниже». За кадром — стрелка курса.
      const b = tgt * 3
      _gtar.set(
        gr.anchor.x + pos[b]! * gr.layerScale,
        gr.anchor.y + pos[b + 1]! * gr.layerScale,
        gr.anchor.z + pos[b + 2]! * gr.layerScale,
      )
      const sp = projectPoint(_gtar, camera, width, height)
      if (!sp.behind && isOnScreen(sp.x, sp.y, width, height, 20 * S)) {
        corners(ctx, sp.x, sp.y, 16 * S, HUD_COLORS.NAV, 2)
        const name = galaxyStarName(world.galaxySeed, tgt)
        if (name) text(ctx, properName(name), sp.x, sp.y + 16 * S, HUD_COLORS.NAV, 'center')
      } else {
        offscreenArrow(frame, _gtar, HUD_COLORS.NAV, true)
      }
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

    // Подпись выбранной цели: одно слово рядом с отметкой — чтобы её было видно СРАЗУ, а не
    // искать глазами кольцо среди прижатых к ободу точек. Кегль мелкий, шрифт возвращаем.
    if (label) {
      const baseFont = ctx.font
      ctx.font = `${Math.round(6 * S)}px "Consolas", "DejaVu Sans Mono", monospace`
      text(ctx, label.toUpperCase(), px + size + 3 * S, my - 3 * S, color, 'left')
      ctx.font = baseFont
    }
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
    plot(body.pos, bodyColor(body), Math.round((nav ? base + 1 : base) * S), nav, shape, nav ? properName(body.name) : undefined)
  }

  // СТАТУИ. Они не тела (свой список — ни орбит, ни гравитации), поэтому на локатор их надо
  // класть отдельно. Без этого километровые монолиты не отмечались вовсе — «непонятно, где они».
  // Ромб, как у станции: рукотворное среди природного. Цвет камня отличает их от причала.
  for (const m of world.monoliths) {
    const nav = m.id === world.navTargetId
    plot(m.pos, MONOLITH_COLOR, Math.round((nav ? 5 : 4) * S), nav, 'diamond', nav ? MONOLITH_NAMES[m.variant] : undefined)
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
    if (!isVisible(ship) || ship.divine) continue // бог Слово не светится на локаторе — его нет в космосе
    const marked = ship.id === world.lockedTargetId || ship.acquaintanceId != null
    plot(ship.state.pos, radarColor(ship, world), Math.round(3 * S), marked)
  }
}

/** Дальше этого локатор не разбирает дистанцию, м: отметка прижата к ободу. */
const RADAR_RANGE = 20_000
/** Ближе этого камни рисуются, м. Дальше они — не препятствие, а пейзаж. */
const ROCK_RANGE = 4_000

/** Камень статуи: цвета в домене у неё нет — она декорация, а не тело. */
const MONOLITH_COLOR = '#8d8677'

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
  // `condense` ужимает по горизонтали ровно настолько, чтобы вписать в ~94% половины.
  // Кегль крупный (≈вдвое против прежнего) — значения держим в 3–4 разряда (см. *Parts),
  // иначе `condense` ужал бы цифру в нитку.
  const BASE = 28 * S
  const STRETCH_Y = 1.3
  ctx.font = hudFont(BASE)
  const natW = ctx.measureText(value).width
  const condense = Math.min(0.9, (maxWidth * 0.94) / Math.max(1, natW))
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

function drawReadouts({ ctx, world, height }: HudFrame): void {
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
        // Скорость подхода больше не отдельное предупреждение: автостыковка сама гасит
        // подлёт, так что «сбрось скорость до N» ушло — остаётся обычная подсказка.
        else pushWarning('dockHint', now, { label: t('hud.dockHint', { range: formatDistance(range) }), repeat: 0 })
      }
    }
  }

  // Автопосадка: в окне высот над планетой/луной — жёлтый пуш с текущей высотой. Само
  // `canAutoland` держит окно (не садимся, не сидим, высота в [PROMPT_LO, PROMPT_HI]).
  if (canAutoland(world)) {
    const near = nearestLandable(world, player)
    if (near) {
      pushWarning('landPrompt', now, { label: t('hud.landPrompt', { alt: formatDistance(near.altitude) }) })
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

