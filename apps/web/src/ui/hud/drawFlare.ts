import { PerspectiveCamera, Vector3, type Camera } from 'three'
import type { BodyEntity, World } from '@elite/sim'
import { FLARE, GALAXY_LAYER } from '../../render/config'
import { galaxyRadar } from '../../render/scene/galaxyRadar'
import { projectPoint } from './project'

/**
 * Засвет и блики от звезды.
 *
 * Рисуются на РАСТРЕ HUD, а не в сцене и не в DOM. Причина та же, по которой
 * HUD — растр: блик обязан жить в той же пиксельной сетке, что и звезда, иначе
 * при увеличении ближайшим соседом он поплывёт относительно неё на полпикселя.
 * И причина обратная тоже: блик — не объект мира, его нельзя облететь и нельзя
 * заслонить крылом. Он появляется в объективе, то есть уже после кадра.
 *
 * В системе — ближайшая BodyEntity-звезда (+ окклюзия планетами).
 * В галактическом слое — только АКТИВНАЯ (jumpTarget): ярко с флейрами; остальные спокойны.
 */

const _galPos = new Vector3()

/** Экранный радиус тела в пикселях внутреннего буфера. */
function screenRadius(body: BodyEntity, camera: Camera, distance: number, height: number): number {
  if (!(camera instanceof PerspectiveCamera)) return 0
  const halfFov = Math.tan(((camera.fov * 0.5) / 180) * Math.PI)
  return (body.radius / Math.max(distance, 1) / halfFov) * (height * 0.5)
}

/**
 * Сколько света от звезды доходит до объектива, 0..1. Планета гасит его не
 * рывком, а по мере наползания на диск: скачок читался бы как мигание лампы.
 */
function occlusion(
  star: BodyEntity,
  starX: number,
  starY: number,
  starDistance: number,
  world: World,
  camera: Camera,
  width: number,
  height: number,
): number {
  let light = 1

  for (const body of world.bodies) {
    if (body === star || body.kind === 'star') continue

    const p = projectPoint(body.pos, camera, width, height)
    // Тело за камерой или дальше звезды заслонить её не может.
    if (p.behind || p.distance >= starDistance) continue

    const r = screenRadius(body, camera, p.distance, height)
    if (r < 1) continue

    const d = Math.hypot(p.x - starX, p.y - starY)
    // Мягкий край шириной в десятую радиуса: терминатор планеты не бритва.
    const edge = Math.max(2, r * 0.1)
    light = Math.min(light, Math.max(0, (d - (r - edge)) / edge))
    if (light <= 0) return 0
  }

  return light
}

/** `#rrggbb` из числа three. Канвасу нужна строка, и собирать её каждый кадр — грех. */
const cssCache = new Map<number, [number, number, number]>()
function rgb(color: number): [number, number, number] {
  let c = cssCache.get(color)
  if (!c) {
    c = [(color >> 16) & 255, (color >> 8) & 255, color & 255]
    cssCache.set(color, c)
  }
  return c
}

/** Смешать два цвета 0..1 → новый `#rrggbb`. */
function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255
  const ag = (a >> 8) & 255
  const ab = a & 255
  const br = (b >> 16) & 255
  const bg = (b >> 8) & 255
  const bb = b & 255
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return (r << 16) | (g << 8) | bl
}

/** Радиальный градиент «ядро → прозрачность». Основа и ореола, и призраков. */
function halo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number, alpha: number): void {
  if (r < 0.5 || alpha <= 0.002) return
  const [red, green, blue] = rgb(color)
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
  gradient.addColorStop(0, `rgba(${red},${green},${blue},${alpha})`)
  gradient.addColorStop(0.35, `rgba(${red},${green},${blue},${alpha * 0.35})`)
  gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** Обод-призрак: апертурное кольцо, а не залитый диск. */
function ghostRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number, alpha: number): void {
  if (r < 1 || alpha <= 0.002) return
  const [red, green, blue] = rgb(color)
  const inner = r * 0.55
  const gradient = ctx.createRadialGradient(x, y, inner, x, y, r)
  gradient.addColorStop(0, `rgba(${red},${green},${blue},0)`)
  gradient.addColorStop(0.55, `rgba(${red},${green},${blue},${alpha * 0.15})`)
  gradient.addColorStop(0.85, `rgba(${red},${green},${blue},${alpha})`)
  gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Анаморфная черта (или шип креста) вдоль единичного направления `(dx, dy)`.
 * Два слоя: широкий мягкий + тонкий яркий керн — иначе на 320px это просто палка.
 */
function streak(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  length: number,
  softW: number,
  coreW: number,
  color: number,
  alpha: number,
): void {
  if (length < 2 || alpha <= 0.002) return
  const [red, green, blue] = rgb(color)
  const hx = dx * length
  const hy = dy * length
  // Перпендикуляр к направлению — толщина черты.
  const px = -dy
  const py = dx

  const band = (halfW: number, a: number) => {
    if (halfW < 0.4) return
    const gradient = ctx.createLinearGradient(x - hx, y - hy, x + hx, y + hy)
    gradient.addColorStop(0, `rgba(${red},${green},${blue},0)`)
    gradient.addColorStop(0.45, `rgba(${red},${green},${blue},${a})`)
    gradient.addColorStop(0.5, `rgba(${red},${green},${blue},${a * 1.15})`)
    gradient.addColorStop(0.55, `rgba(${red},${green},${blue},${a})`)
    gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(x - hx + px * halfW, y - hy + py * halfW)
    ctx.lineTo(x + hx + px * halfW, y + hy + py * halfW)
    ctx.lineTo(x + hx - px * halfW, y + hy - py * halfW)
    ctx.lineTo(x - hx - px * halfW, y - hy - py * halfW)
    ctx.closePath()
    ctx.fill()
  }

  // Продольный gradient сам по себе не умеет гаснуть ПОПЕРЁК луча: одна широкая
  // полоса оставляла вокруг звезды заметный прямоугольник. Вложенные полосы дают
  // поперечный профиль без временного canvas и фильтра blur; сумма яркости прежняя.
  band(softW * 0.5, alpha * 0.03)
  band(softW * 0.4, alpha * 0.06)
  band(softW * 0.3, alpha * 0.09)
  band(softW * 0.2, alpha * 0.12)
  band(softW * 0.1, alpha * 0.15)
  band(coreW * 0.75, alpha * 0.18)
  band(coreW * 0.5, alpha * 0.82)
}

/** Радужное кольцо у ядра: внутренняя кромка тёплая, внешняя — холодная. */
function chromaRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  if (r < 1.5 || alpha <= 0.002) return
  const inner = r * 0.35
  const gradient = ctx.createRadialGradient(x, y, inner, x, y, r)
  gradient.addColorStop(0, `rgba(255,180,80,0)`)
  gradient.addColorStop(0.35, `rgba(255,140,60,${alpha * 0.55})`)
  gradient.addColorStop(0.55, `rgba(255,90,140,${alpha * 0.35})`)
  gradient.addColorStop(0.75, `rgba(120,160,255,${alpha * 0.45})`)
  gradient.addColorStop(1, `rgba(80,120,255,0)`)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** Общая отрисовка анаморфного блика в точке кадра. */
function paintLensFlare(
  ctx: CanvasRenderingContext2D,
  starX: number,
  starY: number,
  starColor: number,
  disc: number,
  power: number,
  width: number,
  height: number,
): void {
  if (power <= 0.002) return

  const glow = Math.max(disc * FLARE.GLOW_SCALE, height * FLARE.GLOW_MIN)

  const composite = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = 'lighter'

  const spikeColor = mixColor(starColor, 0x6ec8ff, 0.55)
  const coreColor = mixColor(starColor, 0xffffff, 0.7)

  halo(ctx, starX, starY, glow, starColor, power * 0.85)
  halo(ctx, starX, starY, glow * 0.35, coreColor, power)

  chromaRing(ctx, starX, starY, Math.max(glow * 0.55, height * FLARE.RING_SIZE), power * FLARE.RING_ALPHA)

  const softW = Math.max(1.5, height * FLARE.STREAK_SOFT)
  const coreW = Math.max(0.8, height * FLARE.STREAK_CORE)
  const mainLen = width * FLARE.STREAK * power

  streak(ctx, starX, starY, 1, 0, mainLen, softW, coreW, spikeColor, power * 0.9)
  const spikeLen = mainLen * FLARE.SPIKE_LENGTH
  const spikeA = power * FLARE.SPIKE_ALPHA
  const inv = Math.SQRT1_2
  streak(ctx, starX, starY, inv, inv, spikeLen, softW * 0.55, coreW * 0.7, spikeColor, spikeA)
  streak(ctx, starX, starY, inv, -inv, spikeLen, softW * 0.55, coreW * 0.7, spikeColor, spikeA)

  const axisX = width * 0.5 - starX
  const axisY = height * 0.5 - starY
  for (const ghost of FLARE.GHOSTS) {
    const gx = starX + axisX * (1 + ghost.at)
    const gy = starY + axisY * (1 + ghost.at)
    const color = ghost.tint == null ? starColor : mixColor(starColor, ghost.tint, 0.65)
    const a = power * ghost.alpha
    const r = height * ghost.size
    if (ghost.ring) ghostRing(ctx, gx, gy, r, color, a)
    else halo(ctx, gx, gy, r, color, a)
  }

  const halfMin = Math.min(width, height) * 0.5
  const edgeDist = Math.min(starX, width - starX, starY, height - starY)
  const edgeBoost = 1 - Math.max(0, Math.min(1, edgeDist / (halfMin * FLARE.RAY_EDGE)))
  if (edgeBoost > 0.05) {
    const axisLen = Math.hypot(axisX, axisY) || 1
    const baseAng = Math.atan2(axisY / axisLen, axisX / axisLen)
    const rayLen = Math.hypot(width, height) * 0.5 * FLARE.RAY_LENGTH * power
    const rayA = power * FLARE.RAY_ALPHA * edgeBoost
    const raySoft = softW * 0.7
    const rayCore = coreW * 0.5
    const mid = (FLARE.RAYS - 1) * 0.5
    for (let i = 0; i < FLARE.RAYS; i++) {
      const ang = baseAng + (i - mid) * 0.055
      const dx = Math.cos(ang)
      const dy = Math.sin(ang)
      streak(
        ctx,
        starX,
        starY,
        dx,
        dy,
        rayLen * (0.7 + 0.3 * (1 - Math.abs(i - mid) / mid)),
        raySoft,
        rayCore,
        spikeColor,
        rayA * (1 - Math.abs(i - mid) * 0.08),
      )
    }
  }

  const side = Math.abs(starX - width * 0.5) / (width * 0.5)
  if (side > 0.2) {
    const glassA = power * FLARE.GLASS_ALPHA * Math.min(1, (side - 0.2) / 0.55)
    if (glassA > 0.01) {
      const gy = height * FLARE.GLASS_Y
      const gh = height * FLARE.GLASS_HEIGHT
      const [red, green, blue] = rgb(mixColor(starColor, 0xffffff, 0.4))
      const g = ctx.createLinearGradient(0, gy - gh, 0, gy + gh)
      g.addColorStop(0, `rgba(${red},${green},${blue},0)`)
      g.addColorStop(0.45, `rgba(${red},${green},${blue},${glassA})`)
      g.addColorStop(0.55, `rgba(${red},${green},${blue},${glassA * 0.7})`)
      g.addColorStop(1, `rgba(${red},${green},${blue},0)`)
      ctx.fillStyle = g
      const shift = (starX - width * 0.5) * 0.15
      ctx.fillRect(shift, gy - gh, width, gh * 2)
    }
  }

  ctx.globalCompositeOperation = composite
}

/** Флейр выбранной звезды галактики (jumpTarget). Без выбора — тишина. */
function drawGalaxyTargetFlare(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  width: number,
  height: number,
): void {
  const gr = galaxyRadar()
  if (!gr.positions || !gr.colors) return
  const tgt = world.jumpTargetIndex
  if (tgt == null || tgt < 0 || tgt >= gr.systemCount) return
  if (tgt === world.systemIndex) return

  const b = tgt * 3
  const pos = gr.positions
  const col = gr.colors
  _galPos.set(
    gr.anchor.x + pos[b]! * gr.layerScale,
    gr.anchor.y + pos[b + 1]! * gr.layerScale,
    gr.anchor.z + pos[b + 2]! * gr.layerScale,
  )
  const p = projectPoint(_galPos, camera, width, height)
  if (p.behind) return

  const margin = Math.min(width, height) * 0.25
  const outside = Math.max(0, -p.x, p.x - width, -p.y, p.y - height)
  if (outside > margin) return
  const framing = 1 - outside / margin

  const starColor =
    (Math.round(col[b]! * 255) << 16) | (Math.round(col[b + 1]! * 255) << 8) | Math.round(col[b + 2]! * 255)
  const power = FLARE.INTENSITY * GALAXY_LAYER.ACTIVE_FLARE * framing
  // Диск «с потолка»: у точки слоя нет BodyEntity.radius — читаемый блик от высоты кадра.
  const disc = height * FLARE.GLOW_MIN * 0.55
  paintLensFlare(ctx, p.x, p.y, starColor, disc, power, width, height)
}

export function drawFlare(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  width: number,
  height: number,
): void {
  // Галактический слой: блик только у активной цели; системное солнце здесь молчит.
  if (galaxyRadar().active) {
    drawGalaxyTargetFlare(ctx, camera, world, width, height)
    return
  }

  // У двойной блик даёт ближайшая к камере звезда: их разнос — миллионы
  // километров, и с близи одна из пары явно крупнее и ярче другой.
  let star: BodyEntity | null = null
  let nearest = Infinity
  for (const body of world.bodies) {
    if (body.kind !== 'star') continue
    const d = body.pos.distanceToSquared(camera.position)
    if (d < nearest) {
      nearest = d
      star = body
    }
  }
  if (!star) return

  const p = projectPoint(star.pos, camera, width, height)
  if (p.behind) return

  // Звезда за краем кадра в объектив не светит: блик — это переотражение того,
  // что попало на матрицу. Мягкий край в четверть кадра гасит вход и выход.
  const margin = Math.min(width, height) * 0.25
  const outside = Math.max(0, -p.x, p.x - width, -p.y, p.y - height)
  if (outside > margin) return
  const framing = 1 - outside / margin

  // `projectPoint` возвращает переиспользуемый объект, а `occlusion` зовёт её снова.
  const starX = p.x
  const starY = p.y
  const starDistance = p.distance

  const light = occlusion(star, starX, starY, starDistance, world, camera, width, height)
  if (light <= 0) return

  const power = FLARE.INTENSITY * light * framing
  const disc = screenRadius(star, camera, starDistance, height)
  paintLensFlare(ctx, starX, starY, star.color, disc, power, width, height)
}
