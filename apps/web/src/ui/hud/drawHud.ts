import { Quaternion, Vector3 } from 'three'
import {
  GUNNERY,
  MIELOPHONE,
  navTarget,
  MONOLITH_NAMES,
  distanceLy,
  itemMass,
  itemName,
  nearestPod,
  peakHeat,
  isStationBot,
  aimDirection,
  isVisible,
  scoopReadiness,
  renderPos,
  renderQuat,
  shownPosition,
  lockedShipId,
  lockedPodId,
  type World,
} from '@elite/sim'
import { bombFlash, bombRing } from '../../render/bombFeel'
import { currentGameDate } from '../clock'
import { undocking } from '../../session/undockFx'
import { drawUndockTunnel } from './drawUndock'
import { galaxyRadar, galaxyRadarUsable } from '../../render/scene/galaxyRadar'
import { HUD_COLORS, bar, circle, corners, dot, line, text } from './draw'
import { t } from '../i18n'
import { figurineTitleLocal, occupationName, properName } from '../i18n/dataNames'
import { formatStat } from '../station/format'
import { drawFlare } from './drawFlare'
import { angularSize, formatDistance, projectPoint } from './project'
import { apertureEllipse, insideAperture } from './aperture'
import { HudFrame, S, bodyColor, fitHudScale, formatLy, hudGalaxyFor, isOnScreen, navMarkerColor, navReticle, offscreenArrow, radarColor, shipDistance } from './hudShared'
import { drawBushLocator, drawTorusLabels, drawTorusMarkers } from './hudBush'
import { drawRadar } from './hudRadar'
import { drawReadouts } from './hudReadouts'
import { drawTargetPanels } from './hudTargetPanels'
import { gatherWarnings, paintWarningPlate } from './hudWarnings'

/**
 * Вся отрисовка HUD. Императивная, в кадре, без React.
 *
 * Все РАЗМЕРЫ умножаются на HUD_SCALE. Координаты спроецированных целей — нет:
 * рамка обязана стоять там, где корабль.
 */

const _fwd = new Vector3()
const _point = new Vector3()
/** Место детали базы в кадре: база вращается, точка считается на лету. */
const _velocityDir = new Vector3()
const _gtar = new Vector3()
/** Позиции/поворот для ПОКАЗА — между тактами (см. `poseTrail`); живут до конца вызова. */
const _shownAt = new Vector3()
const _shownQuat = new Quaternion()

export function drawHud(frame: HudFrame): void {
  const { ctx, width, height, world } = frame
  // Масштаб HUD — под размер окна, до всякой отрисовки этого кадра.
  fitHudScale(width, height)

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

    const locked = pod.id === lockedPodId(world)
    const p = projectPoint(shownPosition(world, pod.pos, _shownAt), camera, width, height)
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

  const p = projectPoint(shownPosition(world, pod.pos, _shownAt), camera, width, height)
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

/**
 * Прицел — там, где СХОДЯТСЯ СТВОЛЫ, а не там, где мышь.
 * Мышь у нас виртуальная ручка: она задаёт угловую скорость, а не точку.
 *
 * Обычно линия огня идёт по носу, и перекрестье стоит на нём. Над поверхностью корпус
 * держат ровным (тяга обязана идти вдоль сферы), и целится ЛИНИЯ ОГНЯ: `aimDirection` —
 * та же функция, по которой домен сводит стволы. Одна формула на прицел и на выстрел,
 * иначе перекрестье перестанет означать «куда попадёт».
 */
function drawGunsight({ ctx, camera, world, width, height }: HudFrame): void {
  // Прицел строим от ПОКАЗАННОГО корабля: камера и корпус стоят там же, между тактами.
  const state = world.player.state
  aimDirection(renderQuat(world, state, _shownQuat), world.player.controls.aimPitch, _fwd)
  _point.copy(renderPos(world, state, _shownAt)).addScaledVector(_fwd, GUNNERY.CONVERGENCE)

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
  _point.copy(renderPos(world, state, _shownAt)).addScaledVector(_velocityDir, 200)

  const p = projectPoint(_point, camera, width, height)
  if (p.behind) return

  const color = HUD_COLORS.DIM
  circle(ctx, p.x, p.y, 3 * S, color)
  line(ctx, p.x - 7 * S, p.y, p.x - 3 * S, p.y, color)
  line(ctx, p.x + 3 * S, p.y, p.x + 7 * S, p.y, color)
  line(ctx, p.x, p.y - 7 * S, p.x, p.y - 3 * S, color)
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

    const p = projectPoint(shownPosition(world, ship.state.pos, _shownAt), camera, width, height)
    if (p.behind || !isOnScreen(p.x, p.y, width, height, 20 * S)) continue

    const locked = ship.id === lockedShipId(world)
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
    // Имя пилота домен пишет по-русски (это его канон) — на экран оно идёт через
    // `properName`, иначе на нерусском языке в кадре висит кириллица.
    const pilot = properName(ship.name)
    const label = known ? `◈ ${pilot}` : pilot
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
    const locked = ship.id === lockedShipId(world)
    if (ship.faction !== 'hostile' && !locked) continue
    // Цвет = отношение; заливка = активный, контур = прочие. Иначе за кадром
    // два красных треугольника не скажут, какой выбран Tab'ом.
    offscreenArrow(frame, ship.state.pos, radarColor(ship, world), locked)
  }

  const nav = navTarget(world)
  if (nav) offscreenArrow(frame, nav.pos, navMarkerColor(nav), true)
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
    const p = projectPoint(shownPosition(world, pos, _shownAt), camera, width, height)
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
    const locked = lockedShipId(world) != null ? world.ships.find((s) => s.id === lockedShipId(world)) : null
    if (locked && locked.alive && isVisible(locked) && !isStationBot(locked)) {
      mark(locked.state.pos, radarColor(locked, world), locked.acquaintanceId != null ? `◈ ${properName(locked.name)}` : null)
    }
    const pod = lockedPodId(world) != null ? world.pods.find((p) => p.id === lockedPodId(world)) : null
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
  _gtar.copy(renderPos(world, world.player.state, _shownAt)).addScaledVector(_pinDir, FAR)
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

/** Ближе этого порога (px HUD) две подписи мешаются — вторичную гасим. */
/** Минимальный зазор подписей целей; зависит от масштаба HUD, поэтому функция, а не константа. */
const labelMinGap = () => 14 * S

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
      name: properName(MONOLITH_NAMES[m.variant] ?? MONOLITH_NAMES[0]!),
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
      name: figurineTitleLocal(f.titleId),
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
    const p = projectPoint(shownPosition(world, m.pos, _shownAt), camera, width, height)
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
      const p = projectPoint(shownPosition(destWorld, m.pos, _shownAt), destCamera, width, height)
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
    if (!forced && placed.some((q) => Math.hypot(q.x - x, q.y - y) < labelMinGap())) continue

    // Подпись отодвинута за рамку: иначе имя ложится ей на грань и не читается.
    const gap = (m.nav ? 12 : 6) * S
    text(ctx, m.name, x + gap, y - 5 * S, m.color)
    // До ПОВЕРХНОСТИ, а не до центра: садишься на поверхность, и «12 км» до неё честнее, чем
    // до ядра сквозь тело. И от КОРАБЛЯ, не от камеры (на масштабе камера далеко за кормой).
    text(ctx, formatDistance(Math.max(0, shipDistance(from, m.pos) - m.surfaceR)), x + gap, y + 5 * S, m.color)
    placed.push({ x, y })
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
