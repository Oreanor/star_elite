import { Vector3 } from 'three'
import { type World } from '@elite/sim'

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

const _point = /* @__PURE__ */ new Vector3()

/** Перебор систем в сфере — только главные (не спутники двойных). */
export function cycleGalaxyStar(world: World): void {
  if (!state.active || !state.positions || state.sphereRadius <= 0) return
  const player = world.player
  const range2 = state.sphereRadius * state.sphereRadius
  const pos = state.positions
  const n = state.systemCount

  const cands: { index: number; dist: number }[] = []
  for (let i = 0; i < n; i++) {
    if (i === state.originIndex) continue
    const b = i * 3
    _point.set(
      state.anchor.x + pos[b]! * state.layerScale - player.state.pos.x,
      state.anchor.y + pos[b + 1]! * state.layerScale - player.state.pos.y,
      state.anchor.z + pos[b + 2]! * state.layerScale - player.state.pos.z,
    )
    const d2 = _point.lengthSq()
    if (d2 > range2) continue
    cands.push({ index: i, dist: d2 })
  }
  if (cands.length === 0) return

  cands.sort((a, b) => a.dist - b.dist)
  const cur = cands.findIndex((c) => c.index === world.jumpTargetIndex)
  world.jumpTargetIndex = cands[(cur + 1) % cands.length]!.index
}

/** Q на галактике: сброс и ближайшая звезда в сфере (не «следующая» по кругу). */
export function retargetNearestGalaxyStar(world: World): void {
  if (!state.active || !state.positions || state.sphereRadius <= 0) return
  const player = world.player
  const range2 = state.sphereRadius * state.sphereRadius
  const pos = state.positions
  const n = state.systemCount

  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < n; i++) {
    if (i === state.originIndex) continue
    const b = i * 3
    _point.set(
      state.anchor.x + pos[b]! * state.layerScale - player.state.pos.x,
      state.anchor.y + pos[b + 1]! * state.layerScale - player.state.pos.y,
      state.anchor.z + pos[b + 2]! * state.layerScale - player.state.pos.z,
    )
    const d2 = _point.lengthSq()
    if (d2 > range2 || d2 >= bestDist) continue
    bestDist = d2
    best = i
  }
  if (best >= 0) world.jumpTargetIndex = best
}
