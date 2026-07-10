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

export function drawFlare(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  width: number,
  height: number,
): void {
  const star = world.bodies.find((b) => b.kind === 'star')
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

  halo(ctx, starX, starY, glow, star.color, power)

  // Анаморфная черта: горизонтальная, потому что горизонтальна оправа объектива.
  const streak = width * FLARE.STREAK * power
  if (streak > 2) {
    const [red, green, blue] = rgb(star.color)
    const gradient = ctx.createLinearGradient(starX - streak, starY, starX + streak, starY)
    gradient.addColorStop(0, `rgba(${red},${green},${blue},0)`)
    gradient.addColorStop(0.5, `rgba(${red},${green},${blue},${power * 0.55})`)
    gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(starX - streak, starY - 1, streak * 2, 3)
  }

  // Призраки идут по прямой «звезда — центр кадра»: оптическая ось проходит там.
  // Смещение 0 сажает призрак ровно в центр, отрицательное — не дотягивает до него.
  const axisX = width * 0.5 - starX
  const axisY = height * 0.5 - starY
  for (const ghost of FLARE.GHOSTS) {
    halo(
      ctx,
      starX + axisX * (1 + ghost.at),
      starY + axisY * (1 + ghost.at),
      height * ghost.size,
      star.color,
      power * ghost.alpha,
    )
  }

  ctx.globalCompositeOperation = composite
}
