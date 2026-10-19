import { missileRackOf } from '../../config/chassis'
import { SHOP } from '../../config/station'
import { GUNNERY } from '../../config/weapons'
import type { Commodity } from '../cargo/items'
import { addCommodity, cargoMass, commodityUnits, freeCapacity, takeCommodity } from '../cargo/hold'
import { deriveShipSpec, isMissile, type MissileModule, type WeaponMount } from '../loadout'
import type { ShipEntity } from '../world/entities'

/**
 * Ракеты — груз, не обойма модуля.
 *
 * Покупаешь сколько влезет в трюм, каждая — тонна, и эта тонна честно едет в массу
 * корабля. На пилонах сразу только стойка рамы (`missileRack`): их можно выпустить
 * без ожидания. Отстрелял всю стойку — столько же секунд перезарядки. За это время
 * ракеты из трюма садятся на пилоны одна за одной, а пуск молчит, пока не сели все.
 *
 * `ammo` у модуля — сколько ракет корабль берёт С ЗАВОДА, не потолок. Потолок — трюм.
 */

const ROUND_PREFIX = 'round:'

/** Кэш: подача идёт каждый такт, а собирать товар заново — аллокация в горячем пути. */
const ROUNDS = new Map<string, Commodity>()

export function missileCommodity(module: MissileModule): Commodity {
  let found = ROUNDS.get(module.id)
  if (!found) {
    found = {
      id: `${ROUND_PREFIX}${module.id}`,
      name: module.name,
      description: 'Боезапас пусковой. Тонна за штуку, место — в грузовом отсеке.',
      unitMass: 1,
      basePrice: SHOP.MISSILE_ROUND_COST,
      tier: 1,
      contraband: false,
    }
    ROUNDS.set(module.id, found)
  }
  return found
}

/** Ракета в трюме, а не рыночный товар: прилавок её не выставляет. */
export function isMissileRoundId(id: string): boolean {
  return id.startsWith(ROUND_PREFIX)
}

/** Пусковая, которая сейчас стоит. На всех пилонах один тип — берём первый. */
export function fittedMissile(ship: ShipEntity): MissileModule | null {
  for (const mount of ship.spec.mounts) {
    if (isMissile(mount.weapon)) return mount.weapon
  }
  return null
}

/** Сколько ракет этого типа лежит в трюме, включая уже стоящие в направляющих. */
export function missileStock(ship: ShipEntity): number {
  const fitted = fittedMissile(ship)
  if (!fitted) return 0
  return commodityUnits(ship.hold, missileCommodity(fitted).id)
}

/** Сколько ещё можно купить: свободные тонны отсека. Нет пусковой — некуда. */
export function missileRoom(ship: ShipEntity): number {
  const fitted = fittedMissile(ship)
  if (!fitted) return 0
  const mass = missileCommodity(fitted).unitMass
  if (mass <= 0) return 0
  return Math.floor(freeCapacity(ship.hold) / mass)
}

/**
 * Масса трюма сменилась (купил или пустил ракету), а стволы трогать нельзя:
 * полный `refreshSpec` обнуляет перезарядку пусковой, и залп слипается в один кадр.
 */
export function retuneMissileMass(ship: ShipEntity): void {
  ship.spec = deriveShipSpec(ship.loadout, cargoMass(ship.hold), ship.hullUp)
  ship.hold.capacity = ship.spec.cargoCapacity
}

/**
 * Выдать заводской боезапас, если этого типа в трюме ещё нет.
 * Сборка корабля и тестовая пересадка на снаряжённую раму. Покупка пусковой
 * сама ракет не кладёт — их докупают, — и повторный вызов не доливает потраченное.
 */
export function issueFactoryMissiles(ship: ShipEntity): void {
  const seeded = factoryMissileRounds(ship.spec.mounts)
  if (!seeded) return
  if (commodityUnits(ship.hold, missileCommodity(seeded.module).id) > 0) return
  addCommodity(ship.hold, missileCommodity(seeded.module), seeded.rounds)
  retuneMissileMass(ship)
  chamberMissiles(ship)
}

/** Стойка этой рамы: четыре или восемь. */
function rackOf(ship: ShipEntity): number {
  return missileRackOf(ship.loadout.chassis)
}

/** Сколько молчит пуск, пока стойка садится целиком: секунда на ракету. */
function reloadSpan(ship: ShipEntity): number {
  return rackOf(ship) * GUNNERY.MISSILE_SEAT
}

/** Стойка полная сразу: на станции и с завода ждать подачи нечего. */
export function chamberMissiles(ship: ShipEntity): void {
  ship.missileReady = Math.min(rackOf(ship), missileStock(ship))
  ship.missileReload = 0
}

/**
 * Перезарядка стойки. Таймер заводит только пуск последней ракеты залпа: пока на пилоне
 * ещё висит ракета, отсчёт не идёт. За время стойки на пилоны садится по одной
 * в секунду, но пуск закрыт до конца — иначе первая севшая снова уходила бы сразу.
 */
export function stepMissileReload(ship: ShipEntity, dt: number): void {
  const stock = missileStock(ship)
  if (stock <= 0) {
    ship.missileReady = 0
    ship.missileReload = 0
    return
  }
  if (ship.missileReady > stock) ship.missileReady = stock
  if (ship.missileReload <= 0) return

  const span = reloadSpan(ship)
  const rack = rackOf(ship)
  ship.missileReload = Math.max(0, ship.missileReload - dt)
  // Секунда на ракету: стойка из восьми молчит восемь секунд и сажает восемь штук.
  const elapsed = span - ship.missileReload
  const seated = Math.min(rack, stock, Math.floor(elapsed / GUNNERY.MISSILE_SEAT + 1e-9))
  ship.missileReady = seated
  if (ship.missileReload <= 0) {
    ship.missileReady = Math.min(rack, stock)
    ship.missileReload = 0
  }
}

/** Стойка пуста, а в трюме ещё есть — пошла перезарядка на всю стойку. Уже идёт — не сбрасывать. */
export function armMissileReload(ship: ShipEntity): void {
  // Пока на пилоне есть хоть одна — это ещё тот же залп, не перезарядка.
  if (ship.missileReady > 0 || missileStock(ship) <= 0) return
  if (ship.missileReload <= 0) ship.missileReload = reloadSpan(ship)
}

/** Снять одну ракету с трюма. Нет стопки — пуск не из чего кормить. */
export function spendMissile(ship: ShipEntity): boolean {
  const fitted = fittedMissile(ship)
  if (!fitted) return false
  return takeCommodity(ship.hold, missileCommodity(fitted).id, 1) === 1
}

/**
 * Заводской боезапас модулей — сколько ракет положить в трюм при сборке.
 * `ammo` модуля здесь — выдача с завода, не потолок покупки.
 */
export function factoryMissileRounds(mounts: readonly WeaponMount[]): { module: MissileModule; rounds: number } | null {
  let rounds = 0
  let module: MissileModule | null = null
  for (const mount of mounts) {
    if (!isMissile(mount.weapon)) continue
    rounds += mount.weapon.ammo
    module = mount.weapon
  }
  if (!module || rounds <= 0) return null
  return { module, rounds }
}

/**
 * Старый сейв хранил ракеты на стволе. Перекладываем в трюм и обнуляем ствол,
 * чтобы следующий заход не прибавил их второй раз.
 */
export function migrateLegacyMissileAmmo(ship: ShipEntity): void {
  const fitted = fittedMissile(ship)
  if (!fitted) return
  let rounds = 0
  ship.spec.mounts.forEach((mount, i) => {
    if (!isMissile(mount.weapon)) return
    const gun = ship.guns[i]
    if (!gun || gun.ammo <= 0) return
    rounds += gun.ammo
    gun.ammo = 0
  })
  if (rounds <= 0) return
  addCommodity(ship.hold, missileCommodity(fitted), rounds)
}
