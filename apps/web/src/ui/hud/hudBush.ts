import { Vector3 } from 'three'
import {
  shipAxes,
} from '@elite/sim'
import { TORUS } from '../../render/config'
import { HUD_COLORS, ellipse, line, text } from './draw'
import { properName } from '../i18n/dataNames'
import { projectPoint } from './project'
import { HudFrame, S, hudFont, isOnScreen, navReticle, offscreenArrow } from './hudShared'

/**
 * Приборы комнаты-гипертора («куста» вселенной): рамки дома, креста и выбранной галактики,
 * подписи ближайших галактик и локатор комнаты. Живут, только пока игрок в комнате.
 */

const _fwd = new Vector3()
const _gtar = new Vector3()
const _point = new Vector3()
const _right = new Vector3()
const _up = new Vector3()

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
export function drawTorusLabels(frame: HudFrame): void {
  const { ctx, camera, width, height, torusLabels } = frame
  if (!torusLabels) return
  ctx.font = hudFont(8 * S)
  for (let i = 0; i < torusLabels.count; i++) {
    const lab = torusLabels.items[i]!
    if (!lab.name) continue
    _gtar.set(lab.x, lab.y, lab.z)
    const p = projectPoint(_gtar, camera, width, height)
    if (p.behind || !isOnScreen(p.x, p.y, width, height, 0)) continue
    text(ctx, properName(lab.name), p.x, p.y + 6 * S, HUD_COLORS.DIM, 'center')
  }
}

export function drawTorusMarkers(frame: HudFrame): void {
  const { torusHome, torusMonument, torusHomeName, torusMonumentName, torusTarget } = frame
  if (torusHome) markOne(frame, torusHome, torusHomeName, '#66e0ff')
  if (torusMonument) markOne(frame, torusMonument, torusMonumentName, '#66e0ff')
  // Выбранная Tab галактика — поверх и жёлтым: она может совпасть с домом или крестом,
  // и тогда важнее показать, что ведём именно туда.
  if (torusTarget) markOne(frame, torusTarget, properName(torusTarget.name), HUD_COLORS.TARGET)
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

export function drawBushLocator(frame: HudFrame): void {
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
