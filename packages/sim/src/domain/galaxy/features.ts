import type { StarClassId } from '../../config/galaxy'
import { quasarOf } from './quasar'
import type { StarSystem } from './types'

/**
 * Чем примечательна система — то, за чем летят ИСКАТЬ: дыра, квазар, пульсар, пара звёзд,
 * гиганты, сфера Дайсона. Не «все свойства», а то, что игрок назовёт словом.
 *
 * Правило живёт в домене, а не в карте: что считать сверхгигантом — знание о классах,
 * и при новом классе правится этот список, а не каждый экран, который фильтрует звёзды.
 */
export const SYSTEM_FEATURES = [
  'blackhole',
  'quasar',
  'pulsar',
  'binary',
  'supergiant',
  'giant',
  'browndwarf',
  'dyson',
  'dysonRuin',
] as const

export type SystemFeature = (typeof SYSTEM_FEATURES)[number]

const SUPERGIANTS: readonly StarClassId[] = ['I', 'S', 'R']

/**
 * Квазар — не класс светила, а состояние дыры ядра: активна ли она, решает зерно
 * галактики (`quasarOf`). Поэтому зерно — аргумент.
 */
export function hasFeature(system: StarSystem, feature: SystemFeature, galaxySeed: number): boolean {
  const cls = system.star.class
  switch (feature) {
    case 'blackhole':
      return cls === 'H'
    case 'quasar':
      return cls === 'H' && quasarOf(galaxySeed) !== null
    case 'pulsar':
      return cls === 'N'
    case 'binary':
      return system.companion !== null
    case 'supergiant':
      return SUPERGIANTS.includes(cls)
    case 'giant':
      return cls === 'O'
    case 'browndwarf':
      return cls === 'T'
    case 'dyson':
      return system.dyson !== null && !system.dyson.ruined
    case 'dysonRuin':
      return system.dyson !== null && system.dyson.ruined
  }
}
