import type { StockEntry } from '../station/market'
import type { Copilot } from '../crew/copilot'
import { rankOfXp } from '../crew/rank'
import { isPortable } from '../contracts/contracts'
import type { Contract } from '../contracts/types'
import { findChassis } from '../../config/chassis'
import { findModule } from '../../config/modules'
import { addItem, createHold } from '../cargo/hold'
import { COMMODITIES, type CargoItem, type Commodity, type FigurineSpecimen } from '../cargo/items'
import { createLoadout, isMissile, isWeapon, NO_HULL_UPGRADES, type HullUpgrades, type Loadout, type ShipModule, type WeaponModule } from '../loadout'
import { chamberMissiles, isMissileRoundId, migrateLegacyMissileAmmo, missileCommodity, missileStock } from '../combat/ordnance'
import { refreshSpec } from '../world/factory'
import { combinedScale, scaleToBase } from '../station/moduleState'
import type { Acquaintance } from '../world/acquaintance'
import { emptyPlan } from '../world/contactPlan'
import type { Persona } from '../world/persona'
import type { FineRecord, World } from '../world/entities'

/** Куда пересаживать сейв со снятого из игры корпуса — стартовый корпус игрока. */
const FALLBACK_CHASSIS = 'aurora_one'

/**
 * Сохранение игрока — ТОЛЬКО он, не мир.
 *
 * Мир общий и живой: пока тебя не было, он менялся без тебя (трафик пришёл и
 * ушёл, контакты сдвинулись, цены поплыли). Поэтому сейв — не снимок мира, а
 * снимок ПИЛОТА: его корабль, кошелёк, личность, память знакомств и место
 * (система + станция как точка возврата). Всё живое окружение при загрузке
 * берётся заново — из сида и дельты, — а не размораживается отсюда.
 *
 * Хранятся ИДЕНТИФИКАТОРЫ, не объекты: модуль — это `id` (+ прокачка экземпляра),
 * товар — `id` товара. Тяжёлые характеристики выводятся заново `refreshSpec`
 * из каталога, иначе сейв дублировал бы конфиг и расходился бы с ним при первой
 * же перебалансировке. Ровно то же свойство, что позволяет не пересылать мир по
 * сети: и там, и тут правда выводится из сида/каталога, а не возится байтами.
 */

/** Модуль в сейве: id из каталога + прокачка и поломка ЭТОГО экземпляра (живут на борту, не в каталоге). */
export interface SavedModule {
  id: string
  upgrade?: number
  upgrades?: number
  fault?: number
}

export interface SavedLoadout {
  chassis: string
  internals: SavedModule[]
  /** По индексам точек подвески: null — точка пуста. */
  weapons: (SavedModule | null)[]
}

/** Модуль в трюме: тот же `SavedModule` плюс цена входа (для «выгоды» на продаже). */
export interface SavedHoldModule extends SavedModule {
  costBasis?: number
}

/** Стопка товара: id номенклатуры, количество и личная цена входа (не синхронизируется по сети). */
export interface SavedStack {
  commodity: string
  units: number
  costBasis?: number
}

export interface PlayerSave {
  /** Версия схемы: старый сейв узнаём и мигрируем, а не роняем. */
  version: 1
  galaxySeed: number
  systemIndex: number
  credits: number
  score: number
  /** Выбранное имя пилота. Не выводится ниоткуда — только хранением, иначе «ты» безымянен. */
  name: string
  /** Вид/статы/портрет пилота — чистые данные, кладутся как есть. */
  persona: Persona
  /** Личный реестр знакомств: с кем виделся и отношение. Чистые данные. */
  acquaintances: Acquaintance[]
  /** Местные штрафы; старые сейвы загружаются без долгов. */
  fines?: FineRecord[]
  /** Склады станций (`World.market`): выкупленное не воскресает перезагрузкой. Старые — без. */
  market?: Record<string, StockEntry>
  /**
   * Дела. Хранятся только те, что переживают прыжок (доставка, «привези», сопровождение), и
   * закрытые — для истории. Дела «здесь и сейчас» (спасти, охота, снос) привязаны к целям в
   * этой системе: перезагрузка их не воскрешает. Необязательно: старые сейвы — без дел.
   */
  contracts?: Contract[]
  loadout: SavedLoadout
  /** Разовые прокачки собственных х-к рамы. Необязательно: старые сейвы — заводская рама. */
  hullUp?: HullUpgrades
  hold: SavedStack[]
  /**
   * Модули в трюме. Раньше не сохранялись («трофеи момента»), но теперь железо покупают в
   * трюм за деньги — и терять купленное на перезагрузке нельзя. Необязательно: старые сейвы
   * грузятся с пустым трюмом по модулям, как и были.
   */
  holdModules?: SavedHoldModule[]
  hull: number
  shield: number
  energy: number
  jumpCharge: number
  /** Заряд батареи доп-отсека, ед. Необязателен: старые сейвы (с bombCharge) грузятся полными. */
  auxEnergy?: number
  /** Боезапас по индексам подвесок (`spec.mounts`): у ствола 0, у БПЛА — остаток. Ракеты — в трюме. */
  guns: number[]
  /**
   * Ракеты в направляющих и секунды до следующей подачи. Нет полей — сейв старый,
   * ракеты ещё лежали на стволе (`guns`) и перекладываются в трюм при загрузке.
   */
  missileReady?: number
  missileReload?: number
  /** Боевой опыт. Необязателен: старые сейвы — новичок, ранг 10. */
  pilotXp?: number
  /** Второй пилот на борту. Необязателен: старые сейвы — без него. Чистые данные. */
  copilot?: Copilot | null
}

/** Товар по id: номенклатура мала и фиксирована, разово строим индекс. */
const COMMODITY_BY_ID: ReadonlyMap<string, Commodity> = new Map(
  Object.values(COMMODITIES).map((c) => [c.id, c]),
)

/** Рыночный товар или ракета из трюма (`round:<модуль>`). Неизвестный id — undefined. */
function commodityBySavedId(id: string): Commodity | undefined {
  const known = COMMODITY_BY_ID.get(id)
  if (known) return known
  if (!isMissileRoundId(id)) return undefined
  const mod = findModule(id.slice('round:'.length))
  if (!mod || !isMissile(mod)) return undefined
  return missileCommodity(mod)
}

function serializeModule(m: ShipModule): SavedModule {
  // Прокачку и поломку пишем, только если они есть: заводской модуль остаётся коротким `{id}`.
  const out: SavedModule = { id: m.id }
  if (m.upgrade !== undefined) out.upgrade = m.upgrade
  if (m.upgrades !== undefined) out.upgrades = m.upgrades
  if (m.fault) out.fault = m.fault
  return out
}

/**
 * Восстановить модуль из каталога. Прокачанный/сломанный КЛОНИРУЕМ: `findModule`
 * возвращает синглтон каталога, и запись в него задела бы такой же модуль у всех прочих.
 * Характеристики ПЕРЕСЧИТЫВАЕМ от стока: одна метка `upgrade` без `scaleToBase` оставляла
 * заводские числа — прокачка после перезагрузки молча пропадала. Неизвестный id (модуль
 * вырезали из игры) — `null`: пропускаем, а не роняем всю загрузку.
 */
function rehydrateModule(saved: SavedModule): ShipModule | null {
  const base = findModule(saved.id)
  if (!base) return null
  if (saved.upgrade === undefined && !saved.fault) return base
  const clone: ShipModule = { ...base }
  if (saved.upgrade !== undefined) clone.upgrade = saved.upgrade
  if (saved.upgrades !== undefined) clone.upgrades = saved.upgrades
  if (saved.fault) clone.fault = saved.fault
  scaleToBase(clone, base, combinedScale(clone))
  return clone
}

/**
 * Предмет из трюма/контейнера в плоские данные и обратно — для ОБЩИХ контейнеров: что
 * выбросил один игрок, подбирает другой. Цену входа (`costBasis`) не несём: она личная.
 */
export type SavedCargoItem =
  | { kind: 'commodity'; commodity: string; units: number; specimens?: FigurineSpecimen[] }
  | { kind: 'module'; module: SavedModule }

export function serializeCargoItem(item: CargoItem): SavedCargoItem {
  if (item.kind === 'module') return { kind: 'module', module: serializeModule(item.module) }
  const out: SavedCargoItem = { kind: 'commodity', commodity: item.commodity.id, units: item.units }
  if (item.specimens?.length) out.specimens = item.specimens.map((sp) => ({ ...sp }))
  return out
}

/** null — неизвестный товар/модуль (другая версия каталога): такой контейнер пропускаем. */
export function rehydrateCargoItem(saved: SavedCargoItem): CargoItem | null {
  if (saved.kind === 'module') {
    const module = rehydrateModule(saved.module)
    return module ? { kind: 'module', module } : null
  }
  const commodity = commodityBySavedId(saved.commodity)
  if (!commodity || !(saved.units > 0)) return null
  return saved.specimens?.length
    ? { kind: 'commodity', commodity, units: saved.units, specimens: saved.specimens.map((sp) => ({ ...sp })) }
    : { kind: 'commodity', commodity, units: saved.units }
}

export function serializeLoadout(l: Loadout): SavedLoadout {
  return {
    chassis: l.chassis.id,
    internals: l.internals.map(serializeModule),
    weapons: l.weapons.map((w) => (w ? serializeModule(w) : null)),
  }
}

export function rehydrateLoadout(saved: SavedLoadout): Loadout {
  // Корпус мог быть ВЫРЕЗАН из игры (старый сейв на снятой модели, напр. «Аврора Мк III»).
  // Тогда пересаживаем на дефолтный стартовый корпус, сохранив всё железо: лишнее оружие
  // не влезет в другие точки — `createLoadout` его отбросит, это ожидаемо. Обрывать загрузку
  // из-за ретайра корпуса нельзя — иначе игрок с таким сейвом вообще не войдёт в игру.
  const chassis = findChassis(saved.chassis) ?? findChassis(FALLBACK_CHASSIS)
  if (!chassis) throw new Error(`saved chassis not found and no fallback: ${saved.chassis}`)

  const internals: ShipModule[] = []
  for (const m of saved.internals) {
    const mod = rehydrateModule(m)
    if (mod) internals.push(mod)
  }
  const weapons = saved.weapons.map((w) => {
    if (!w) return null
    const mod = rehydrateModule(w)
    return mod && isWeapon(mod) ? (mod as WeaponModule) : null
  })
  return createLoadout(chassis, internals, weapons)
}

/** Снять сейв с текущего состояния мира. Чистое чтение — ничего не меняет. */
/** Глубокая копия дела: сейв не должен держать ссылки на живой мир, и наоборот. */
function cloneContract(c: Contract): Contract {
  return JSON.parse(JSON.stringify(c)) as Contract
}

export function serializePlayer(world: World): PlayerSave {
  const p = world.player
  const hold: SavedStack[] = []
  const holdModules: SavedHoldModule[] = []
  for (const item of p.hold.items) {
    if (item.kind === 'module') {
      const saved = serializeModule(item.module)
      holdModules.push(item.costBasis !== undefined ? { ...saved, costBasis: item.costBasis } : saved)
      continue
    }
    hold.push(
      item.costBasis !== undefined
        ? { commodity: item.commodity.id, units: item.units, costBasis: item.costBasis }
        : { commodity: item.commodity.id, units: item.units },
    )
  }

  return {
    version: 1,
    galaxySeed: world.galaxySeed,
    systemIndex: world.systemIndex,
    credits: world.credits,
    score: world.score,
    // Игрок знает своё имя всегда — храним истинное (`pilotName`), оно же открытое.
    name: p.pilotName,
    // Плоские данные — мелкий клон, чтобы сейв не держал ссылку на живой мир.
    persona: { ...p.persona },
    // Журнал знакомства клонируем отдельно: без этого сейв держал бы ссылку на живой массив.
    acquaintances: world.acquaintances.map((a) => ({
      ...a,
      history: [...a.history],
      plan: { ...a.plan, queue: [...a.plan.queue] },
      entrusted: a.entrusted.map((e) => ({ ...e })),
    })),
    fines: world.fines.map((fine) => ({ ...fine })),
    market: Object.fromEntries(Object.entries(world.market).map(([k, e]) => [k, { ...e }])),
    contracts: world.contracts.filter((c) => c.status !== 'active' || isPortable(c)).map(cloneContract),
    loadout: serializeLoadout(p.loadout),
    hullUp: { ...p.hullUp },
    hold,
    holdModules,
    hull: p.hull,
    shield: p.shield,
    energy: p.energy,
    jumpCharge: p.jumpCharge,
    auxEnergy: p.auxEnergy,
    guns: p.guns.map((g) => g.ammo),
    missileReady: p.missileReady,
    missileReload: p.missileReload,
    pilotXp: world.pilotXp,
    copilot: world.copilot ? { ...world.copilot, persona: { ...world.copilot.persona } } : null,
  }
}

/**
 * Наложить сейв на мир: восстановить пилота и скаляры мира. НЕ трогает окружение
 * (тела, трафик, чужие борта) — их ставит `enterSystem` у вызывающего: этот код
 * отвечает за «кто я и что у меня», а не «где я и кто вокруг».
 *
 * Порядок важен. `refreshSpec` перестраивает `guns` и КЛАМПИТ hull/shield/energy/
 * jumpCharge к потолку сборки — поэтому текущие значения ставим ПОСЛЕ него, иначе
 * он затрёт их дефолтами прежнего корабля. Груз кладём до финального `refreshSpec`,
 * чтобы спек учёл массу гружёного трюма.
 */
export function applyPlayerSave(world: World, save: PlayerSave): void {
  world.galaxySeed = save.galaxySeed
  world.systemIndex = save.systemIndex
  world.credits = save.credits
  world.score = save.score
  // Старые сейвы журнала не знали — подставляем пустой, иначе чтение `history` падало бы.
  world.acquaintances = save.acquaintances.map((a) => ({
    ...a,
    history: a.history ? [...a.history] : [],
    credits: a.credits ?? 5_000,
    savedLoadout: a.savedLoadout ?? null,
    plan: a.plan ?? emptyPlan(),
    // Сейвы до доверенного груза о нём не знали — пустой список, а не падение на чтении.
    entrusted: a.entrusted ? a.entrusted.map((e) => ({ ...e })) : [],
  }))
  world.fines = save.fines ? save.fines.map((fine) => ({ ...fine })) : []
  world.market = save.market ? Object.fromEntries(Object.entries(save.market).map(([k, e]) => [k, { ...e }])) : {}
  world.contracts = save.contracts ? save.contracts.map(cloneContract) : []
  world.pilotXp = save.pilotXp ?? 0
  world.copilot = save.copilot ? { ...save.copilot, persona: { ...save.copilot.persona } } : null

  const p = world.player
  // Имя игрока открыто — это он сам. Ставим и отображаемое, и истинное.
  p.name = save.name
  p.pilotName = save.name
  p.persona = { ...save.persona }
  p.rank = rankOfXp(world.pilotXp)
  p.loadout = rehydrateLoadout(save.loadout)
  // Прокачки рамы — ДО refreshSpec: от них зависят HP/трюм/аукс сборки.
  p.hullUp = { ...NO_HULL_UPGRADES, ...save.hullUp }
  // Сейв с флагами чужой рамы (купил корпус, а hullUp не сбросился) — не усиляет новую.
  if (p.hullUp.chassis !== undefined && p.hullUp.chassis !== p.loadout.chassis.id) {
    p.hullUp = { ...NO_HULL_UPGRADES, chassis: p.loadout.chassis.id }
  }

  // Свежий трюм: вместимость проставит первый refreshSpec из грузовых контейнеров,
  // затем наполняем — addItem считает свободное место по уже верной вместимости.
  p.hold = createHold(0)
  refreshSpec(p)
  for (const stack of save.hold) {
    const commodity = commodityBySavedId(stack.commodity)
    if (!commodity) continue // товар вырезали из игры — пропускаем, а не роняем
    addItem(p.hold, { kind: 'commodity', commodity, units: stack.units, costBasis: stack.costBasis })
  }
  for (const saved of save.holdModules ?? []) {
    const module = rehydrateModule(saved)
    if (!module) continue // модуль вырезали из игры — пропускаем
    addItem(p.hold, saved.costBasis !== undefined ? { kind: 'module', module, costBasis: saved.costBasis } : { kind: 'module', module })
  }
  // Второй раз — уже с массой груза: спек (а с ним ускорения) отражает гружёный борт.
  refreshSpec(p)

  // Текущее состояние — строго после refreshSpec. Клампим к потолку сборки на случай,
  // если сейв старше нынешнего каталога и числа в нём больше, чем даёт корабль сейчас.
  p.hull = Math.min(save.hull, p.spec.hull.hull)
  p.shield = Math.min(save.shield, p.spec.hull.shield)
  p.energy = Math.min(save.energy, p.spec.power.capacity)
  p.jumpCharge = Math.min(save.jumpCharge, p.spec.jumpRange)
  // Старые сейвы без доп-отсека грузятся полными — потеря заряда бомбы не критична.
  p.auxEnergy = Math.min(save.auxEnergy ?? p.spec.power.auxCapacity, p.spec.power.auxCapacity)
  p.hullHeat = 0
  save.guns.forEach((ammo, i) => {
    const g = p.guns[i]
    if (g) g.ammo = ammo
  })
  // Старый сейв ракет в трюме не знал: они лежали на стволе. Новый уже привёз стойку.
  if (save.missileReady === undefined) {
    migrateLegacyMissileAmmo(p)
    refreshSpec(p)
    chamberMissiles(p)
  } else {
    p.missileReady = save.missileReady
    p.missileReload = save.missileReload ?? 0
    if (p.missileReady > missileStock(p)) p.missileReady = missileStock(p)
  }
}
