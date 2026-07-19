import { PerspectiveCamera, type Camera } from 'three'
import type { BodyEntity, World } from '@elite/sim'
import { FLARE } from '../../render/config'
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
 * Заслоняет блик только планета: она одна закрывает звезду целиком. Корабль или
 * камень перекрывают долю диска, и честно считать эту долю значило бы читать
 * буфер глубины — цена, которой эффект не стоит.
 *
 * Картинка — анаморфный киношный блик: ядро, хроматическое кольцо, длинная
 * горизонтальная черта с коротким крестом и цепочка призраков по оптической оси.
 * Всё — градиенты canvas2d и `lighter`, без текстур и без шейдеров.
 */

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

  band(softW * 0.5, alpha * 0.45)
  band(coreW * 0.5, alpha)
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

export function drawFlare(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  width: number,
  height: number,
): void {
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
  if (power <= 0.002) return

  const disc = screenRadius(star, camera, starDistance, height)
  const glow = Math.max(disc * FLARE.GLOW_SCALE, height * FLARE.GLOW_MIN)

  // Свет складывается, а не закрашивает: под бликом обязан просвечивать корабль.
  const composite = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = 'lighter'

  // Холодный анаморфный тон + спектр звезды: у красного карлика шипы теплее, у голубого — ледяные.
  const spikeColor = mixColor(star.color, 0x6ec8ff, 0.55)
  const coreColor = mixColor(star.color, 0xffffff, 0.7)

  // Ядро + мягкий ореол цвета звезды.
  halo(ctx, starX, starY, glow, star.color, power * 0.85)
  halo(ctx, starX, starY, glow * 0.35, coreColor, power)

  // Хроматическое кольцо у лимба — тот самый «радужный обод» киношного блика.
  chromaRing(ctx, starX, starY, Math.max(glow * 0.55, height * FLARE.RING_SIZE), power * FLARE.RING_ALPHA)

  const softW = Math.max(1.5, height * FLARE.STREAK_SOFT)
  const coreW = Math.max(0.8, height * FLARE.STREAK_CORE)
  const mainLen = width * FLARE.STREAK * power

  // Главная анаморфная черта — горизонталь объектива.
  streak(ctx, starX, starY, 1, 0, mainLen, softW, coreW, spikeColor, power * 0.9)
  // Короткий крест 45°: слабее и короче, иначе звезда превращается в снежинку.
  const spikeLen = mainLen * FLARE.SPIKE_LENGTH
  const spikeA = power * FLARE.SPIKE_ALPHA
  const inv = Math.SQRT1_2
  streak(ctx, starX, starY, inv, inv, spikeLen, softW * 0.55, coreW * 0.7, spikeColor, spikeA)
  streak(ctx, starX, starY, inv, -inv, spikeLen, softW * 0.55, coreW * 0.7, spikeColor, spikeA)

  // Призраки идут по прямой «звезда — центр кадра»: оптическая ось проходит там.
  const axisX = width * 0.5 - starX
  const axisY = height * 0.5 - starY
  for (const ghost of FLARE.GHOSTS) {
    const gx = starX + axisX * (1 + ghost.at)
    const gy = starY + axisY * (1 + ghost.at)
    const color = ghost.tint == null ? star.color : mixColor(star.color, ghost.tint, 0.65)
    const a = power * ghost.alpha
    const r = height * ghost.size
    if (ghost.ring) ghostRing(ctx, gx, gy, r, color, a)
    else halo(ctx, gx, gy, r, color, a)
  }

  ctx.globalCompositeOperation = composite
}
