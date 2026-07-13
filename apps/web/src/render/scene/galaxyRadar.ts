import { Vector3 } from 'three'

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
  anchor: new Vector3(),
  layerScale: 1,
}

export function galaxyRadar(): GalaxyRadarState {
  return state
}
