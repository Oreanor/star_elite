import { findChassis } from '../../config/chassis'
import { findModule } from '../../config/modules'
import { addItem, createHold } from '../cargo/hold'
import { COMMODITIES, type Commodity } from '../cargo/items'
import { createLoadout, isWeapon, type Loadout, type ShipModule, type WeaponModule } from '../loadout'
import { refreshSpec } from '../world/factory'
import type { Acquaintance } from '../world/acquaintance'
import type { Persona } from '../world/persona'
import type { World } from '../world/entities'

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

/** Модуль в сейве: id из каталога + прокачка ЭТОГО экземпляра (живёт на борту, не в каталоге). */
export interface SavedModule {
  id: string
  upgrade?: number
}

export interface SavedLoadout {
  chassis: string
  internals: SavedModule[]
  /** По индексам точек подвески: null — точка пуста. */
  weapons: (SavedModule | null)[]
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
  loadout: SavedLoadout
  hold: SavedStack[]
  hull: number
  shield: number
  energy: number
  jumpCharge: number
  /** Заряд батареи доп-отсека, ед. Необязателен: старые сейвы (с bombCharge) грузятся полными. */
  auxEnergy?: number
  /** Боезапас по индексам подвесок (`spec.mounts`): у ствола 0, у ракеты/БПЛА — остаток. */
  guns: number[]
}

/** Товар по id: номенклатура мала и фиксирована, разово строим индекс. */
const COMMODITY_BY_ID: ReadonlyMap<string, Commodity> = new Map(
  Object.values(COMMODITIES).map((c) => [c.id, c]),
)

function serializeModule(m: ShipModule): SavedModule {
  // Прокачку пишем, только если она есть: заводской модуль остаётся коротким `{id}`.
  return m.upgrade !== undefined ? { id: m.id, upgrade: m.upgrade } : { id: m.id }
}

/**
 * Восстановить модуль из каталога. Прокачанный КЛОНИРУЕМ, прежде чем ставить
 * `upgrade`: `findModule` возвращает синглтон каталога, и запись в него усилила бы
 * такой же модуль у всех прочих. Неизвестный id (модуль вырезали из игры) —
 * `null`: пропускаем, а не роняем всю загрузку.
 */
function rehydrateModule(saved: SavedModule): ShipModule | null {
  const base = findModule(saved.id)
  if (!base) return null
  return saved.upgrade !== undefined ? { ...base, upgrade: saved.upgrade } : base
}

function serializeLoadout(l: Loadout): SavedLoadout {
  return {
    chassis: l.chassis.id,
    internals: l.internals.map(serializeModule),
    weapons: l.weapons.map((w) => (w ? serializeModule(w) : null)),
  }
}

function rehydrateLoadout(saved: SavedLoadout): Loadout {
  const chassis = findChassis(saved.chassis)
  // Корпус — не мелочь, которую можно пропустить: без него сборки нет. Битый сейв
  // (корпус вырезали из игры) честнее оборвать, чем молча подставить чужой корабль.
  if (!chassis) throw new Error(`saved chassis not found: ${saved.chassis}`)

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
export function serializePlayer(world: World): PlayerSave {
  const p = world.player
  const hold: SavedStack[] = []
  for (const item of p.hold.items) {
    // Снятые модули в трюме не сохраняем: это трофеи момента, не часть личности
    // пилота. Останутся у обломков в живом мире, если он их обронил.
    if (item.kind !== 'commodity') continue
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
    acquaintances: world.acquaintances.map((a) => ({ ...a })),
    loadout: serializeLoadout(p.loadout),
    hold,
    hull: p.hull,
    shield: p.shield,
    energy: p.energy,
    jumpCharge: p.jumpCharge,
    auxEnergy: p.auxEnergy,
    guns: p.guns.map((g) => g.ammo),
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
  world.acquaintances = save.acquaintances.map((a) => ({ ...a }))

  const p = world.player
  // Имя игрока открыто — это он сам. Ставим и отображаемое, и истинное.
  p.name = save.name
  p.pilotName = save.name
  p.persona = { ...save.persona }
  p.loadout = rehydrateLoadout(save.loadout)

  // Свежий трюм: вместимость проставит первый refreshSpec из грузовых контейнеров,
  // затем наполняем — addItem считает свободное место по уже верной вместимости.
  p.hold = createHold(0)
  refreshSpec(p)
  for (const stack of save.hold) {
    const commodity = COMMODITY_BY_ID.get(stack.commodity)
    if (!commodity) continue // товар вырезали из игры — пропускаем, а не роняем
    addItem(p.hold, { kind: 'commodity', commodity, units: stack.units, costBasis: stack.costBasis })
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
}
