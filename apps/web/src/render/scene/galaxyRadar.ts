import { Vector3 } from 'three'
import { type World } from '@elite/sim'
import { GALAXY_LAYER } from '../config'

/**
 * Мост между галактическим СЛОЕМ (render) и ЛОКАТОРОМ (ui/hud): слой знает, где сейчас
 * стоят звёзды галактики и как он сжат по росту, а локатор должен их нарисовать. Тот же
 * приём общей мутабельной ячейки, что у `jumpFx`/`bombFeel`: ни стейта React, ни пропсов
 * в кадре. Слой пишет сюда раз в кадр, HUD читает.
 *
 * Координаты звёзд ЛОКАЛЬНЫЕ (в св.годах, как в геометрии слоя): мир-позиция звезды =
 * `anchor + p·layerScale`, где anchor — локальный якорь слоя этого кадра. Так HUD считает
 * то же, что видит игрок, без дублирования генерации галактики.
 */
export interface GalaxyRadarState {
  /** Слой проснулся и проявлен (opacity>0): есть что показывать. */
  active: boolean
  /** Локальные координаты звёзд, 3 на звезду (те же, что в буфере геометрии слоя). */
  positions: Float32Array | null
  /** Цвета звёзд, 3 (r,g,b) на звезду. */
  colors: Float32Array | null
  count: number
  /** Индекс СВОЕЙ звезды (текущей системы): она в локальном начале (p≈0), всегда у якоря.
   *  Локатор рисует её ВСЕГДА и подписывает — даже когда прочие ещё вне сферы видимости:
   *  так подмена «система → звезда галактики» бесшовна, а игрок видит точку отсчёта. */
  originIndex: number
  /** Локальный якорь слоя ЭТОГО кадра (points.position). */
  anchor: Vector3
  /** Метров кадра в одном св.году: мир-позиция звезды = anchor + p·layerScale. */
  layerScale: number
}

const state: GalaxyRadarState = {
  active: false,
  positions: null,
  colors: null,
  count: 0,
  originIndex: 0,
  anchor: new Vector3(),
  layerScale: 1,
}

export function galaxyRadar(): GalaxyRadarState {
  return state
}

const _point = /* @__PURE__ */ new Vector3()

/**
 * Перебор ЗВЁЗД ГАЛАКТИКИ носом — тот же жест, что Tab по кораблям в системе (`cycleLock`),
 * но на галактическом масштабе. Кандидаты — ровно те звёзды, что ГОРЯТ на локаторе (в сфере
 * видимости слоя), кроме своей. Сортируем по углу от носа и на каждый вызов берём следующую
 * по кругу. Пишем в `world.jumpTargetIndex` — тот же «выбор звезды», что метит карта галактики
 * и куда прыгает H: Tab, локатор и карта смотрят на одну звезду. Индекс в буфере слоя равен
 * индексу системы в `generateGalaxy`, поэтому годится как `jumpTargetIndex` напрямую.
 */
export function cycleGalaxyStar(world: World): void {
  if (!state.active || !state.positions) return
  const player = world.player
  const range2 = GALAXY_LAYER.SPHERE_RADIUS_M * GALAXY_LAYER.SPHERE_RADIUS_M
  const pos = state.positions

  const cands: { index: number; dist: number }[] = []
  for (let i = 0; i < state.count; i++) {
    if (i === state.originIndex) continue // своя звезда не выбирается — она точка отсчёта
    const b = i * 3
    _point.set(
      state.anchor.x + pos[b]! * state.layerScale - player.state.pos.x,
      state.anchor.y + pos[b + 1]! * state.layerScale - player.state.pos.y,
      state.anchor.z + pos[b + 2]! * state.layerScale - player.state.pos.z,
    )
    const d2 = _point.lengthSq()
    if (d2 > range2) continue // вне сферы видимости — на локаторе её нет
    cands.push({ index: i, dist: d2 })
  }
  if (cands.length === 0) return

  // В ПОРЯДКЕ УДАЛЕНИЯ: ближайшая звезда — первая, дальше по кругу к дальним. Так листание
  // предсказуемо (ближе → дальше), а не скачет по углу к носу. Текущая есть — берём следующую.
  cands.sort((a, b) => a.dist - b.dist)
  const cur = cands.findIndex((c) => c.index === world.jumpTargetIndex)
  world.jumpTargetIndex = cands[(cur + 1) % cands.length]!.index
}
