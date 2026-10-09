import { Vector3, type Camera } from 'three'
import {
  canDockAt,
  stanceTo,
  applyDelta,
  generateGalaxy,
  shownPosition,
  type BodyEntity,
  type ShipEntity,
  type StarSystem,
  type World,
} from '@elite/sim'
import { HUD_SCALE } from '../../render/config'
import { HUD_COLORS, corners, text } from './draw'
import { t } from '../i18n'
import { formatDistance, projectPoint } from './project'
import { type PortalAperture } from './aperture'

/**
 * Общее для приборов HUD: кадр, масштаб, проекция на экран, стрелки за кадром, цвета меток.
 * Сами приборы — по своим файлам (локатор, карточки целей, показания, плашки, куст): у
 * каждого своя причина меняться.
 */

export type DockState = 'engaged' | 'ready' | 'approach'

/** Звезда жёлтая, дыра фиолетовая, причал белый, планета/луна — голубые. Таблица, не if. */
export const BODY_COLOR: Partial<Record<BodyEntity['kind'], string>> = {
  star: HUD_COLORS.STAR,
  blackhole: HUD_COLORS.BLACKHOLE,
  station: HUD_COLORS.STATION,
}

/**
 * Цвет нав-цели = цвет значка на локаторе. Таблица по роду:
 * база белая (рукотворная сфера), камень/статуя коричневые (пилот не учит второй тон),
 * прочее — по телу. Новый род — строка, а не очередной if.
 */
export const NAV_COLOR: Record<string, string> = {
  warbase: HUD_COLORS.STATION,
  monolith: HUD_COLORS.MONOLITH,
  figurine: HUD_COLORS.MONOLITH,
  asteroid: HUD_COLORS.MONOLITH,
  star: HUD_COLORS.STAR,
  blackhole: HUD_COLORS.BLACKHOLE,
  station: HUD_COLORS.STATION,
}

/**
 * Радар: вид сверху, нос — вверх. Показывает и корабли, и тела, поэтому шкала
 * логарифмическая: иначе планета в 400 км сплющит всё остальное к центру.
 */
// Имя выбранной звезды галактики по индексу. `generateGalaxy` детерминирован, но 2500
// систем в кадре считать нельзя — кэшируем результат по зерну (меняется редко, на прыжке).
let _galSeed: number | null = null

let _galSys: ReturnType<typeof generateGalaxy> = []

export const S = HUD_SCALE

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

/** Ракета ближе этого по времени — тревога. Дальше пилоту не о чем волноваться, с. */
export const MISSILE_ALERT_SECONDS = 6

export function dockState(world: World, station: BodyEntity, autodock: boolean): DockState {
  if (autodock) return 'engaged'
  if (canDockAt(world.player, station)) return 'ready'
  return 'approach'
}

export function isOnScreen(x: number, y: number, width: number, height: number, margin = 0): boolean {
  return x >= -margin && x <= width + margin && y >= -margin && y <= height + margin
}

/**
 * РЕАЛЬНАЯ дистанция от КОРАБЛЯ до точки, м. `projectPoint().distance` мерит от КАМЕРЫ, а
 * на большом масштабе (миелофон) камера отъезжает на сотни км за корму гиганта — её дистанция
 * враньё. Пилот меряет от СЕБЯ. На обычном масштабе камера у корпуса, разница незаметна.
 */
export function shipDistance(world: World, pos: Vector3): number {
  return world.player.state.pos.distanceTo(pos)
}

/**
 * Треугольник у края кадра. Цвет — тип/отношение; `filled` — активная цель
 * (заливка), иначе обводка: за кадром иначе не отличить «свой» среди одноцветных.
 * `label`: строка вместо дистанции; null — без подписи; undefined — дистанция.
 */
export function offscreenArrow(
  { ctx, camera, world, width, height }: HudFrame,
  pos: Vector3,
  color: string,
  filled = false,
  label?: string | null,
): void {
  // Позицию тела показываем там же, где оно нарисовано, — между тактами (см. `poseTrail`).
  const p = projectPoint(shownPosition(world, pos, _arrowAt), camera, width, height)
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

/** Рамочка активной цели в окне — того же цвета, что значок. */
export function navReticle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  corners(ctx, x, y, 16 * S, color, 2)
}

/** Остаток / карта в св.г — для подписи звезды галактики. */
export function formatLy(ly: number): string {
  const n = !Number.isFinite(ly) || ly < 0 ? 0 : ly
  const s = n >= 10 ? String(Math.round(n)) : n >= 1 ? n.toFixed(1) : n.toFixed(2)
  return `${s} ${t('unit.ly')}`
}

/**
 * Галактику для HUD строим лениво и КЭШИРУЕМ по зерну — как в `facts.ts`: 2500 систем один
 * раз на сессию, а не на кадр. Нужны лишь координаты выбранной звезды и своей системы.
 */
let hudGalaxy: { seed: number; epoch: number; systems: StarSystem[] } | null = null

export function hudGalaxyFor(world: World): StarSystem[] {
  const seed = world.galaxySeed
  const epoch = world.galaxyEpoch
  if (!hudGalaxy || hudGalaxy.seed !== seed || hudGalaxy.epoch !== epoch) {
    // База из зерна + правки бога: прикреплённая звезда учитывает перекроенную карту.
    hudGalaxy = { seed, epoch, systems: applyDelta(generateGalaxy(seed), world.galaxyDelta) }
  }
  return hudGalaxy.systems
}

const _arrowAt = new Vector3()

export function galaxyStarName(seed: number, index: number): string | null {
  if (seed !== _galSeed) {
    _galSys = generateGalaxy(seed)
    _galSeed = seed
  }
  return _galSys[index]?.name ?? null
}

/** Шрифт HUD заданного кегля. Кегль в пикселях внутреннего буфера, как и всё в S. */
export const hudFont = (px: number) => `${Math.round(px)}px "Consolas", "DejaVu Sans Mono", monospace`

export function bodyColor(body: BodyEntity): string {
  return BODY_COLOR[body.kind] ?? HUD_COLORS.PLANET
}

export function navMarkerColor(nav: { kind: string }): string {
  return NAV_COLOR[nav.kind] ?? HUD_COLORS.PLANET
}

/** Враг красный, друг/свой зелёный, нейтрал серый, живой игрок — розовый. */
export function radarColor(ship: ShipEntity, world: World): string {
  if (ship.kinematic) return HUD_COLORS.PLAYER
  const stance = stanceTo(world, ship)
  if (stance === 'hostile') return HUD_COLORS.DANGER
  if (stance === 'friendly') return HUD_COLORS.ALLY
  return HUD_COLORS.NEUTRAL
}
