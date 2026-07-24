import type { ModuleKind, ShipModule, SlotCategory } from '../../config/schema'
import type {
  ArmourModule,
  BombModule,
  CargoModule,
  CloakModule,
  DroneModule,
  EcmModule,
  EngineModule,
  HyperdriveModule,
  LaserModule,
  MielophoneModule,
  MissileModule,
  ScoopModule,
  ShieldModule,
  ThrusterModule,
  WeaponModule,
} from '../../config/schema'

/**
 * Правила про модули: куда они просятся и как сузиться до конкретного вида.
 *
 * Сама ФОРМА модуля (какие у двигателя поля) живёт в `config/schema` — там же, где
 * каталог, который ею описан. Здесь только то, что является правилом игры: аукс-виды
 * делят один слот, а `is*` заменяют `as` при сужении.
 */

/** Виды модулей, что кладутся в универсальный слот «аукс». */
export const AUX_KINDS: ReadonlySet<ModuleKind> = new Set<ModuleKind>([
  'cloak',
  'mielophone',
  'ecm',
  'bomb',
  'scoop',
])

/**
 * В какую категорию слота просится этот вид модуля. Аукс-виды → 'aux' (общий слот),
 * прочие внутренние — сами в себя. Оружие сюда не приходит: оно на hardpoints.
 */
export function slotCategoryOf(kind: ModuleKind): SlotCategory {
  return AUX_KINDS.has(kind) ? 'aux' : (kind as SlotCategory)
}

/** Сужение по виду — вместо `as`, чтобы `any` не понадобился нигде. */
export const isEngine = (m: ShipModule): m is EngineModule => m.kind === 'engine'
export const isThrusters = (m: ShipModule): m is ThrusterModule => m.kind === 'thrusters'
export const isShield = (m: ShipModule): m is ShieldModule => m.kind === 'shield'
export const isArmour = (m: ShipModule): m is ArmourModule => m.kind === 'armour'
export const isLaser = (m: ShipModule): m is LaserModule => m.kind === 'laser'
export const isMissile = (m: ShipModule): m is MissileModule => m.kind === 'missile'
export const isCargo = (m: ShipModule): m is CargoModule => m.kind === 'cargo'
export const isHyperdrive = (m: ShipModule): m is HyperdriveModule => m.kind === 'hyperdrive'
export const isCloak = (m: ShipModule): m is CloakModule => m.kind === 'cloak'
export const isDrone = (m: ShipModule): m is DroneModule => m.kind === 'drone'
export const isMielophone = (m: ShipModule): m is MielophoneModule => m.kind === 'mielophone'
export const isEcm = (m: ShipModule): m is EcmModule => m.kind === 'ecm'
export const isBomb = (m: ShipModule): m is BombModule => m.kind === 'bomb'
export const isScoop = (m: ShipModule): m is ScoopModule => m.kind === 'scoop'
/** Любое аукс-устройство: делит общий слот, прокачке не подлежит. */
export const isAux = (m: ShipModule): boolean => AUX_KINDS.has(m.kind)

export const isWeapon = (m: ShipModule): m is WeaponModule => isLaser(m) || isMissile(m) || isDrone(m)

/**
 * Модули, без которых корабль НЕ ЛЕТИТ: двигатель (нет тяги — стоишь) и маневровые
 * (нет момента — не повернуть). Их нельзя снять в пустоту, только заменить другим
 * того же вида. Гиперпривод сюда не входит: без него не прыгнуть между звёздами,
 * но сублайт-полёт цел, а значит корабль всё ещё летит.
 */
export const isEssential = (m: ShipModule): boolean => m.kind === 'engine' || m.kind === 'thrusters'

/**
 * Схема — часть каталога, но читатели домена привыкли брать типы отсюда, и это
 * правильно: снаружи «модуль» — одно понятие, а не два файла в разных слоях.
 */
export type {
  ArmourModule,
  BombModule,
  CargoModule,
  CloakModule,
  DroneModule,
  EcmModule,
  EngineModule,
  HyperdriveModule,
  LaserModule,
  MielophoneModule,
  MissileModule,
  ModuleBase,
  ModuleKind,
  ScoopModule,
  ShieldModule,
  ShipModule,
  SlotCategory,
  ThrusterModule,
  WeaponModule,
} from '../../config/schema'
