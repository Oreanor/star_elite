import { Vector3 } from 'three'
import {
  CRUISE,
  STAR_HEAT,
  auxFraction,
  missileAmmo,
  laserOverheated,
  meanHeat,
  scooping,
  shipAxes,
  type ShipEntity,
} from '@elite/sim'
import { HUD_COLORS, bar, circle, line, text } from './draw'
import { t } from '../i18n'
import { formatScale, scaleParts, speedParts } from './project'
import { HudFrame, S, hudFont } from './hudShared'

/**
 * Показания полёта слева: скорость, множитель крейсера, шкалы тяги, щита, корпуса, батарей,
 * нагрева, прыжка и ракет. Своя причина меняться — состав и вид приборной колонки.
 */

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()

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

export function drawReadouts({ ctx, world, height, bush, torusThrust }: HudFrame): void {
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
  // Шкала — СРЕДНЕЕ по стволам: один перегретый из трёх не должен читаться как «нечем стрелять».
  const laser = meanHeat(player)
  // Мигание — от МИРОВОГО времени, а не от кадра: частота не должна зависеть от fps.
  const laserLocked = laserOverheated(player, world.time)
  const blink = Math.sin(world.time * 14) > 0
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
    // Нагрев СТВОЛА от стрельбы — отдельно от нагрева корпуса звездой. В отключке перегрева
    // полоса стоит на упоре (домен держит heat=1) и МИГАЕТ: не «почти остыл», а «ствол занят».
    [t('hud.laser'), laser, laserLocked ? (blink ? HUD_COLORS.DANGER : HUD_COLORS.DIM) : laser > 0.7 ? HUD_COLORS.DANGER : HUD_COLORS.WARN],
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
