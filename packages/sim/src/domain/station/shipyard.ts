import { addItem, usedCapacityOf } from '../cargo/hold'
import {
  createLoadout,
  deriveShipSpec,
  type Chassis,
  type Loadout,
  type ShipModule,
  type WeaponModule,
} from '../loadout'
import { refreshSpec } from '../world'
import type { World } from '../world/entities'

/**
 * Верфь: смена КОРПУСА, а не отдельного модуля.
 *
 * Правило живёт в домене, как и всё остальное: где нажали кнопку — не его забота.
 * Однажды то же самое исполнит сервер, ничего не правя.
 *
 * Корпус меняют вместе с ОБВЕСОМ: своё железо переезжает на новую раму. Что в её
 * слоты не влезло (у компактного корпуса их меньше) — уходит в трюм грузом. А если
 * и трюма не хватает на всё перенесённое — смена не состоится: сперва продай лишнее.
 */

export type HullError = 'not-docked' | 'no-money' | 'no-room'

/** Результат примерки обвеса на корпус: что встало в слоты и что осталось «на руках». */
export interface HullFit {
  loadout: Loadout
  /** Модули, которым в новом корпусе места нет: их предстоит везти в трюме. */
  overflow: ShipModule[]
}

/**
 * Разложить текущий обвес по слотам целевого корпуса. Жадно, по виду и классу: слот
 * берёт первый подходящий модуль. Что не разошлось по слотам и точкам подвески —
 * `overflow`: у нового корпуса их могло оказаться меньше, чем железа на старом.
 */
export function fitOntoChassis(current: Loadout, chassis: Chassis): HullFit {
  const pool = [...current.internals]
  const fitted: ShipModule[] = []
  for (const slot of chassis.slots) {
    const idx = pool.findIndex((m) => m.kind === slot.kind && m.class <= slot.maxClass)
    if (idx >= 0) fitted.push(pool.splice(idx, 1)[0]!)
  }

  // Оружие — по точкам подвески: орудийная точка несёт лазер, пилон — ракету ИЛИ
  // контейнер БПЛА (он тоже подвесной). Класс модуля не крупнее того, что точка тянет.
  const guns = current.weapons.filter((w): w is WeaponModule => w != null)
  const weapons: (WeaponModule | null)[] = chassis.hardpoints.map(() => null)
  chassis.hardpoints.forEach((hp, i) => {
    const accepts = (k: WeaponModule['kind']) => (hp.kind === 'pylon' ? k === 'missile' || k === 'drone' : k === 'laser')
    const idx = guns.findIndex((w) => accepts(w.kind) && w.class <= hp.maxClass)
    if (idx >= 0) weapons[i] = guns.splice(idx, 1)[0]!
  })

  return { loadout: createLoadout(chassis, fitted, weapons), overflow: [...pool, ...guns] }
}

/**
 * Сменить корпус, перенеся обвес. `no-room` — трюма нового корпуса не хватает на
 * текущий груз плюс всё, что не влезло в слоты: интерфейс попросит сперва продать лишнее.
 * Свежая рама заправлена под завязку (корпус, щит, заряд привода): купил — и в путь.
 */
export function swapHull(world: World, chassis: Chassis, cost: number): HullError | null {
  if (!world.docked) return 'not-docked'
  if (world.credits < cost) return 'no-money'

  const player = world.player
  const { loadout, overflow } = fitOntoChassis(player.loadout, chassis)

  // Грузоподъёмность НОВОГО корпуса против того, что придётся в нём везти: уже лежащий
  // груз плюс перенесённый в трюм обвес. Не влезло — смену отклоняем целиком, мир не тронут.
  const capacity = deriveShipSpec(loadout).cargoCapacity
  const overflowMass = overflow.reduce((m, x) => m + x.mass, 0)
  if (usedCapacityOf(player.hold) + overflowMass > capacity) return 'no-room'

  world.credits -= cost
  player.loadout = loadout
  refreshSpec(player) // пересчитает и вместимость трюма — под неё и кладём overflow
  for (const module of overflow) addItem(player.hold, { kind: 'module', module })
  player.hull = player.spec.hull.hull
  player.shield = player.spec.hull.shield
  player.jumpCharge = player.spec.jumpRange
  return null
}
