import type { CargoItem, Commodity, ShipModule } from '@elite/sim'
import { currentLang } from './i18n'

/**
 * Перевод ДАННЫХ, а не хрома. Домен авторит имена по-русски (товары, модули, расы) —
 * это его канон и запас на случай, если ключа тут нет. Интерфейс же переводит их по
 * `id`: домену язык знать незачем, а игроку на английском не должно лезть «Двигатель».
 *
 * Таблицы плоские и по id: новый модуль — новая строка, не ветвление. Нет строки —
 * показываем русское имя из домена, а не пустоту: игра не ломается на пропущенном
 * переводе, он лишь виден как недоделка.
 */

const COMMODITY_EN: Record<string, string> = {
  scrap: 'Scrap',
  food: 'Food',
  minerals: 'Ore',
  metals: 'Metals',
  machinery: 'Machinery',
  electronics: 'Electronics',
  slaves: 'Slaves',
  luxuries: 'Luxuries',
  narcotics: 'Narcotics',
}

const MODULE_EN: Record<string, string> = {
  engine_1e: 'Drive 1E «Civilian»',
  engine_2c: 'Drive 2C «Standard»',
  engine_3a: 'Drive 3A «Military»',
  engine_1d: 'Drive 1D «Civilian»',
  engine_2b: 'Drive 2B «Standard»',
  engine_2a: 'Drive 2A «Swift»',
  engine_3b: 'Drive 3B «Swift»',
  engine_3c: 'Drive 3C «Military»',
  rcs_1e: 'Thrusters 1E',
  rcs_2c: 'Thrusters 2C',
  rcs_3a: 'Thrusters 3A «Military»',
  rcs_1d: 'Thrusters 1D «Civilian»',
  rcs_2b: 'Thrusters 2B «Standard»',
  rcs_2a: 'Thrusters 2A «Vortex»',
  rcs_3b: 'Thrusters 3B «Vortex»',
  rcs_3c: 'Thrusters 3C «Military»',
  shield_1e: 'Shield 1E',
  shield_2c: 'Shield 2C',
  shield_3a: 'Shield 3A «Bastion»',
  shield_1d: 'Shield 1D',
  shield_2b: 'Shield 2B',
  shield_2a: 'Shield 2A «Mirage»',
  shield_3b: 'Shield 3B «Mirage»',
  shield_3c: 'Shield 3C «Bastion»',
  armour_1: 'Armour Plating',
  armour_2: 'Composite Armour',
  armour_2d: 'Armour 2D «Steel»',
  armour_3c: 'Armour 3C «Steel»',
  armour_2b: 'Armour 2B «Composite»',
  armour_1c: 'Armour 1C «Cermet»',
  armour_2a: 'Armour 2A «Cermet»',
  armour_3a: 'Armour 3A «Cermet»',
  pulse_0: 'Pulse Laser 0 «Worn»',
  pulse_1: 'Pulse Laser 1',
  pulse_2: 'Pulse Laser 2',
  beam_2: 'Beam Laser 2',
  pulse_1a: 'Pulse Laser 1A',
  beam_1: 'Beam Laser 1',
  beam_3: 'Beam Laser 3 «Blade»',
  rotary_1: 'Rotary Laser 1 «Gadfly»',
  rotary_2: 'Rotary Laser 2 «Squall»',
  plasma_2: 'Plasma Cannon 2 «Harpoon»',
  plasma_3: 'Plasma Cannon 3 «Ram»',
  missile_p: 'Missile «Hornet»',
  missile_1: 'Missile «Seeker»',
  missile_2: 'Missile «Hammer»',
  missile_pe: 'Missile 1E «Sting»',
  missile_pa: 'Missile 1A «Wasp»',
  missile_1e: 'Missile 1E «Pack»',
  missile_1b: 'Missile 1B «Hound»',
  missile_2a: 'Missile 2A «Sledge»',
  cargo_1: 'Cargo Rack 1',
  cargo_2: 'Cargo Rack 2',
  cargo_3: 'Cargo Rack 3',
  cargo_1a: 'Cargo Bay 1A «Composite»',
  cargo_2a: 'Cargo Bay 2A «Composite»',
  cargo_3a: 'Cargo Bay 3A «Composite»',
  cargo_2h: 'Cargo Hold 2E «Bulker»',
  cargo_3h: 'Cargo Hold 3E «Bulker»',
  hyper_1: 'Hyperdrive 1E «Arcane»',
  hyper_2: 'Hyperdrive 2C «Meridian»',
  hyper_3: 'Hyperdrive 3A «Deep»',
  hyper_1a: 'Hyperdrive 1C «Swift»',
  hyper_2a: 'Hyperdrive 2A «Swift»',
  hyper_2h: 'Hyperdrive 2E «Hauler»',
  hyper_3h: 'Hyperdrive 3E «Hauler»',
  drone_gun: 'Drone Laser',
  drone_bay: 'Drone Bay «Swarm»',
  drone_bay_e: 'Drone Bay «Flight»',
  drone_bay_a: 'Drone Bay «Legion»',
  cloak_1: 'Cloak Field «Veil»',
  cloak_1e: 'Cloak Field «Haze»',
  cloak_2: 'Cloak Field «Phantom»',
}

/** Раса собирается из слов («Крупные зелёные ящеры») — переводим по слову. */
const SPECIES_EN: Record<string, string> = {
  'Люди (колония)': 'Humans (colony)',
  Крупные: 'Large', Мелкие: 'Small', Рослые: 'Tall', Приземистые: 'Squat', Исполинские: 'Giant', Хрупкие: 'Frail',
  'зелёные': 'green', синие: 'blue', багровые: 'crimson', серые: 'grey', 'белёсые': 'pale', янтарные: 'amber', 'чёрные': 'black',
  'чешуйчатые': 'scaled', мохнатые: 'furred', панцирные: 'shelled', бескрылые: 'wingless', многоглазые: 'many-eyed', слизистые: 'slimy',
  'ящеры': 'lizards', птицы: 'birds', насекомые: 'insects', амфибии: 'amphibians', моллюски: 'molluscs', приматы: 'primates', ракообразные: 'crustaceans',
}

const en = (): boolean => currentLang() === 'en'

export function commodityName(c: Commodity): string {
  return en() ? COMMODITY_EN[c.id] ?? c.name : c.name
}

export function moduleName(m: ShipModule): string {
  return en() ? MODULE_EN[m.id] ?? m.name : m.name
}

/** Имя расы: сперва целиком (люди), иначе по словам — русские части через пробел. */
export function speciesName(s: string): string {
  if (!en()) return s
  if (SPECIES_EN[s]) return SPECIES_EN[s]
  return s.split(' ').map((w) => SPECIES_EN[w] ?? w).join(' ')
}

/** Имя предмета трюма на языке интерфейса — товар с количеством, модуль по id. */
export function itemDisplayName(item: CargoItem): string {
  return item.kind === 'commodity' ? `${commodityName(item.commodity)} ×${item.units}` : moduleName(item.module)
}
