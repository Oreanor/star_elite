import { Vector3 } from 'three'
import { jumpInDriveRange, type World } from '@elite/sim'

/**
 * Мост между галактическим СЛОЕМ (render) и ЛОКАТОРОМ (ui/hud).
 *
 * Буфер: [0 .. systemCount) — главные звёзды систем (индекс = systemIndex для Tab/прыжка);
 * дальше — спутники двойных (только отрисовка, не цели).
 */
export interface GalaxyRadarState {
  active: boolean
  positions: Float32Array | null
  colors: Float32Array | null
  /** Все точки (главные + спутники двойных). */
  count: number
  /** Только системы — Tab / jumpTargetIndex. */
  systemCount: number
  /** Индекс буфера спутника своей системы, или -1. */
  homeCompanionIndex: number
  originIndex: number
  anchor: Vector3
  layerScale: number
  /** Радиус сферы ЛОКАТОРА / Tab (м кадра) — уже, чем охват точек в 3D. */
  sphereRadius: number
}

const state: GalaxyRadarState = {
  active: false,
  positions: null,
  colors: null,
  count: 0,
  systemCount: 0,
  homeCompanionIndex: -1,
  originIndex: 0,
  anchor: new Vector3(),
  layerScale: 1,
  sphereRadius: 0,
}

export function galaxyRadar(): GalaxyRadarState {
  return state
}

/** Пауза Tab → новый круг с ближайшей (как у контактов / небесных). */
const CYCLE_RESTART = 1.25 // с
let _galaxyCycleAt = -1e9

/**
 * Дистанция до звезды в св.г кадра (локус борта − точка слоя).
 * Считаем в ly, не в метрах: на миллионах × вычитание огромных world-координат шумит.
 */
function starDistLySq(player: World['player'], index: number): number {
  const pos = state.positions!
  const inv = state.layerScale > 0 ? 1 / state.layerScale : 0
  const b = index * 3
  const plx = (player.state.pos.x - state.anchor.x) * inv
  const ply = (player.state.pos.y - state.anchor.y) * inv
  const plz = (player.state.pos.z - state.anchor.z) * inv
  const dx = pos[b]! - plx
  const dy = pos[b + 1]! - ply
  const dz = pos[b + 2]! - plz
  return dx * dx + dy * dy + dz * dz
}

/**
 * Круг Tab/Q: чужие в сфере локатора и в модели привода.
 * Текущую метку карты/прыжка держим в круге даже вне сферы — иначе Tab
 * «срывается» с выбранной на G звезды в пустоту без маркера.
 */
function collectGalaxyCands(world: World): { index: number; dist: number }[] {
  const rangeLy = state.layerScale > 0 ? state.sphereRadius / state.layerScale : 0
  const range2 = rangeLy * rangeLy
  const n = state.systemCount
  const cands: { index: number; dist: number }[] = []
  const seen = new Set<number>()

  for (let i = 0; i < n; i++) {
    if (i === state.originIndex) continue
    if (!jumpInDriveRange(world, i)) continue
    const d2 = starDistLySq(world.player, i)
    if (d2 > range2) continue
    cands.push({ index: i, dist: d2 })
    seen.add(i)
  }

  const pinned = world.jumpTargetIndex
  if (
    pinned != null
    && pinned !== state.originIndex
    && pinned >= 0
    && pinned < n
    && !seen.has(pinned)
    && jumpInDriveRange(world, pinned)
  ) {
    cands.push({ index: pinned, dist: starDistLySq(world.player, pinned) })
  }

  return cands
}

/** Перебор систем в сфере — только главные (не спутники двойных). */
export function cycleGalaxyStar(world: World): void {
  if (!state.active || !state.positions || state.sphereRadius <= 0) return
  const cands = collectGalaxyCands(world)
  // Пусто — не трогаем метку карты: иначе Tab гасит выбранную на G звезду.
  if (cands.length === 0) return

  cands.sort((a, b) => a.dist - b.dist)
  const fresh = world.time - _galaxyCycleAt > CYCLE_RESTART
  _galaxyCycleAt = world.time
  const curIdx = world.jumpTargetIndex
  const cur =
    fresh || curIdx == null || curIdx === state.originIndex
      ? -1
      : cands.findIndex((c) => c.index === curIdx)
  world.jumpTargetIndex = cands[(cur + 1) % cands.length]!.index
}

/**
 * Q на галактике: ближайшая из круга Tab (в сфере). Если СВОЯ ближе —
 * метку снимаем (иначе у Люрилара вечно всплывал бы сосед).
 */
export function retargetNearestGalaxyStar(world: World): void {
  if (!state.active || !state.positions || state.sphereRadius <= 0) return
  const rangeLy = state.layerScale > 0 ? state.sphereRadius / state.layerScale : 0
  const range2 = rangeLy * rangeLy

  let ownDist = starDistLySq(world.player, state.originIndex)
  if (state.homeCompanionIndex >= 0) {
    ownDist = Math.min(ownDist, starDistLySq(world.player, state.homeCompanionIndex))
  }

  // Q — только сфера локатора (без «приколотой» дальней с карты).
  const n = state.systemCount
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < n; i++) {
    if (i === state.originIndex) continue
    if (!jumpInDriveRange(world, i)) continue
    const d2 = starDistLySq(world.player, i)
    if (d2 > range2 || d2 >= bestDist) continue
    bestDist = d2
    best = i
  }

  if (best < 0) {
    world.jumpTargetIndex = null
    return
  }
  if (ownDist <= bestDist && ownDist <= range2) {
    world.jumpTargetIndex = null
    return
  }
  world.jumpTargetIndex = best
  _galaxyCycleAt = world.time
}
