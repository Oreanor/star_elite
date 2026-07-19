import { Quaternion, Vector3 } from 'three'
import { MONOLITH } from '../../config/monoliths'
import { SALVAGE } from '../../config/weapons'
import { range, signed } from '../../core/math'
import type { Rng } from '../../core/math'
import { addItem, freeCapacity } from '../cargo/hold'
import { COMMODITIES, itemMass, type CargoItem, type Commodity } from '../cargo/items'
import { forward } from '../flight/axes'
import { allModules } from '../loadout'
import type { CargoPodEntity, ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'

/**
 * Трофеи. Сбитый корабль оставляет контейнеры — его же модули и груз из трюма.
 * Это замыкает петлю: апгрейд можно не купить, а снять с того, кого ты сбил.
 */

const _rel = new Vector3()
const _nose = new Vector3()
const _toPod = new Vector3()
const _jetPos = new Vector3()

function spawnPod(
  world: World,
  pos: Vector3,
  vel: Vector3,
  item: CargoItem,
  opts?: { debris?: NonNullable<CargoPodEntity['debris']>; kick?: number },
): void {
  const rng = world.rng
  const kick = opts?.kick ?? 9
  const pod: CargoPodEntity = {
    id: world.ids.next(),
    kind: 'pod',
    pos: pos.clone(),
    // Скорость обломка наследуется лишь частично, разлёт добавляется сверху:
    // иначе контейнеры висят слипшейся кучей.
    vel: vel
      .clone()
      .multiplyScalar(SALVAGE.POD_VELOCITY_INHERIT)
      .add(new Vector3(signed(rng), signed(rng), signed(rng)).multiplyScalar(kick)),
    quat: new Quaternion(),
    spin: new Vector3(signed(rng), signed(rng), signed(rng)).multiplyScalar(0.6),
    item,
    born: world.time,
    alive: true,
    tractored: false,
    debris: opts?.debris,
  }
  world.pods.push(pod)
}

/**
 * Осколок взорванной глыбы двора: руда в трюм, вид — простой камень с текстурой облика.
 * `kick` сильнее обычного ящика: километровый развал должен разлететься заметно.
 */
export function spawnRockDebrisPod(
  world: World,
  pos: Vector3,
  vel: Vector3,
  shape: number,
  radius: number,
  units: number,
  kick: number,
): void {
  spawnPod(
    world,
    pos,
    vel,
    { kind: 'commodity', commodity: COMMODITIES.MINERALS, units },
    { debris: { shape, radius }, kick },
  )
}

/**
 * Номенклатура добычи. Данные, а не ветвления: новый товар в `COMMODITIES`
 * сам попадает в трофеи, без правки этой функции (OCP).
 *
 * Лом исключён: он и так падает с каждого обломка отдельной строкой ниже,
 * и удваивать его в списке значило бы утроить его частоту.
 */
const LOOT_TABLE: readonly Commodity[] = Object.values(COMMODITIES).filter(
  (c) => c.id !== COMMODITIES.SCRAP.id && c.id !== COMMODITIES.FIGURINE.id,
)

/** Случайная добыча из трюма пирата. `null` — не повезло, трюм был пуст. */
function rollLoot(rng: Rng): CargoItem | null {
  if (rng() >= SALVAGE.LOOT_CHANCE) return null

  const commodity = LOOT_TABLE[Math.floor(rng() * LOOT_TABLE.length)]
  if (!commodity) return null

  const units = 1 + Math.floor(rng() * SALVAGE.LOOT_UNITS_MAX)
  return { kind: 'commodity', commodity, units }
}

/**
 * Что выпало из обломка. Каждый модуль проверяется своим `salvageChance`:
 * дорогое железо чаще сгорает вместе с кораблём, дешёвое достаётся победителю.
 */
export function spawnWreckage(world: World, wreck: ShipEntity): void {
  const rng = world.rng

  const survivors = allModules(wreck.loadout).filter((m) => rng() < m.salvageChance)
  // Иначе с крупного корабля высыпается десяток контейнеров и сцена превращается в свалку.
  survivors.length = Math.min(survivors.length, SALVAGE.MAX_MODULES_PER_WRECK)

  for (const module of survivors) {
    spawnPod(world, wreck.state.pos, wreck.state.vel, { kind: 'module', module })
  }

  // Груз из трюма переживает гибель корабля целиком.
  for (const item of wreck.hold.items) {
    spawnPod(world, wreck.state.pos, wreck.state.vel, item)
  }

  // Добыча пирата: трюм у него не заполняется симуляцией, но возил он не воздух.
  const loot = rollLoot(rng)
  if (loot) spawnPod(world, wreck.state.pos, wreck.state.vel, loot)

  // Обломки: что-то ценное было и в самом корпусе.
  const scrap = 1 + Math.floor(rng() * 3)
  spawnPod(world, wreck.state.pos, wreck.state.vel, {
    kind: 'commodity',
    commodity: COMMODITIES.SCRAP,
    units: scrap,
  })
}

/**
 * Почему контейнер не подбирается. `null` — подбирается.
 *
 * Причина отдельным типом, а не булевым «нельзя»: HUD обязан объяснить пилоту,
 * что делать — тормозить или разгружаться. Правило живёт здесь в единственном
 * экземпляре, и `tryScoop` спрашивает ровно его: два независимых условия входа
 * однажды разойдутся, и надпись начнёт врать.
 */
export type ScoopBlock = 'range' | 'speed' | 'full' | null

/**
 * Что помешает подбору, КОГДА ТЫ ДОЛЕТИШЬ. Дистанцию не проверяет намеренно.
 *
 * Подбор срабатывает сам и мгновенно, стоит войти в радиус. Поэтому лампа
 * «ЗАХВАТ», зажжённая по факту подбора, горела бы ровно один кадр — и то уже
 * над пустотой. Пилоту надо знать заранее: тормозить, разгружаться или просто
 * подлетать. Это и есть готовность, а не результат.
 */
export function scoopReadiness(ship: ShipEntity, pod: CargoPodEntity): Exclude<ScoopBlock, 'range'> {
  // Влететь в контейнер на боевой скорости — значит разбить его.
  const closingSpeed = _rel.copy(pod.vel).sub(ship.state.vel).length()
  if (closingSpeed > SALVAGE.SCOOP_MAX_REL_SPEED) return 'speed'

  if (itemMass(pod.item) > freeCapacity(ship.hold)) return 'full'
  return null
}

export function scoopBlock(ship: ShipEntity, pod: CargoPodEntity): ScoopBlock {
  if (!pod.alive || !ship.alive) return 'range'

  const distance = pod.pos.distanceTo(ship.state.pos)
  if (distance > SALVAGE.SCOOP_RADIUS + ship.spec.hull.radius) return 'range'

  /**
   * Влетел корпусом — забрал. Контейнер размером с бочку просто проваливается
   * в грузовой люк, и спрашивать про относительную скорость поздно: столкновение
   * уже состоялось. Порог скорости остаётся для МЯГКОГО захвата на подлёте.
   */
  if (distance <= ship.spec.hull.radius) {
    return itemMass(pod.item) > freeCapacity(ship.hold) ? 'full' : null
  }

  return scoopReadiness(ship, pod)
}

export function canScoopAt(ship: ShipEntity, pod: CargoPodEntity): boolean {
  return scoopBlock(ship, pod) === null
}

/**
 * Тяговый луч. Тянет живые контейнеры в передней полусфере к кораблю и гасит
 * их скорость относительно него.
 *
 * Подбор отсюда НЕ вызывается: луч только сводит контейнер с кораблём, а забирает
 * его обычное правило `tryScoop`, то же самое, что работает и без луча. Иначе
 * появилось бы два способа оказаться в трюме, и однажды они разошлись бы.
 *
 * Помечает притянутое `tractored`, чтобы рендер знал, куда рисовать луч: домен
 * не рисует, но и рендеру нельзя переписывать правило конуса у себя.
 */
export function tractorPods(world: World, ship: ShipEntity, dt: number): void {
  if (!ship.alive) return

  forward(ship.state.quat, _nose)
  const reach = SALVAGE.TRACTOR_RANGE

  for (const pod of world.pods) {
    if (!pod.alive) continue

    _toPod.copy(pod.pos).sub(ship.state.pos)
    const distance = _toPod.length()
    if (distance > reach || distance < 1e-3) continue

    _toPod.divideScalar(distance)
    if (_toPod.dot(_nose) < SALVAGE.TRACTOR_CONE) continue

    pod.tractored = true

    // Тянем к кораблю: направление обратно тому, что от корабля к контейнеру.
    pod.vel.addScaledVector(_toPod, -SALVAGE.TRACTOR_ACCEL * dt)

    // И уравниваем скорости — иначе контейнер проскакивает мимо и уходит по дуге.
    _rel.copy(ship.state.vel).sub(pod.vel)
    pod.vel.addScaledVector(_rel, Math.min(1, SALVAGE.TRACTOR_MATCH * dt))
  }
}

/** Луч светит один шаг: без сброса метка осталась бы гореть на весь полёт. */
export function clearTractorMarks(world: World): void {
  for (const pod of world.pods) pod.tractored = false
}

/**
 * Подбор. Требует не только близости, но и малой относительной скорости —
 * если только корабль не влетел в контейнер корпусом.
 *
 * @returns подобранный предмет, либо null.
 */
export function tryScoop(ship: ShipEntity, pod: CargoPodEntity): CargoItem | null {
  if (scoopBlock(ship, pod) !== null) return null

  if (!addItem(ship.hold, pod.item)) return null
  pod.alive = false

  // Груз имеет массу, масса — ускорения. `sellCargo` пересобирает spec при выгрузке;
  // забыть это при загрузке значит везти тонны, которые физика не чувствует.
  refreshSpec(ship)
  return pod.item
}

/**
 * Контейнер с рудой из расколотого камня. Тот же `spawnPod`, что и у трофеев:
 * второй способ рождать контейнеры однажды разошёлся бы с первым в мелочах —
 * в разлёте, в сроке жизни, в наследовании скорости.
 */
export function spawnOrePod(world: World, pos: Vector3, vel: Vector3, units: number): void {
  spawnPod(world, pos, vel, { kind: 'commodity', commodity: COMMODITIES.MINERALS, units })
}

/**
 * Рассыпать товар ПОЛЕМ контейнеров. Тот же `spawnPod`, что у трофеев и руды:
 * один способ рождать контейнеры на всех. Металл с расстрелянной платформы
 * приходит сюда — это груда обломков, а не единый куб. Единицы делятся поровну,
 * остаток достаётся последнему контейнеру: сумма ровно `totalUnits`, ни на грамм
 * больше — вещество из ничего не рождается.
 */
export function spawnCommodityPods(
  world: World,
  pos: Vector3,
  vel: Vector3,
  commodity: Commodity,
  totalUnits: number,
  pods: number,
): void {
  if (totalUnits <= 0) return
  const n = Math.max(1, Math.min(pods, totalUnits))
  const per = Math.floor(totalUnits / n)
  let left = totalUnits
  for (let i = 0; i < n; i++) {
    const units = i === n - 1 ? left : per
    left -= units
    if (units > 0) spawnPod(world, pos, vel, { kind: 'commodity', commodity, units })
  }
}

/**
 * Выброс по носу: точка в нескольких метрах впереди, полёт — как у трофея
 * (контейнер) или осколка глыбы (руда). Тот же `spawnPod`, второй путь не плодим.
 */
function spitPodAhead(world: World, ship: ShipEntity, item: CargoItem): void {
  const dist = range(world.rng, SALVAGE.JETTISON_AHEAD_MIN, SALVAGE.JETTISON_AHEAD_MAX)
  forward(ship.state.quat, _nose)
  _jetPos.copy(ship.state.pos).addScaledVector(_nose, dist)

  const ore = item.kind === 'commodity' && item.commodity.id === COMMODITIES.MINERALS.id
  if (ore) {
    // Руда — камнем: тот же вид и разлёт, что у осколков двора статуи.
    spawnPod(world, _jetPos, ship.state.vel, item, {
      debris: {
        shape: Math.floor(world.rng() * MONOLITH.ROCK_SHAPES),
        radius: MONOLITH.ROCK_DEBRIS_RADIUS * (0.7 + world.rng() * 0.6),
      },
      kick: MONOLITH.ROCK_DEBRIS_SPEED,
    })
    return
  }

  // Обычный груз / модуль — ящик с тем же kick и кувырком, что трофей с обломка.
  spawnPod(world, _jetPos, ship.state.vel, item)
}

/**
 * Выбросить один предмет трюма в космос контейнером по носу.
 */
export function jettisonItem(world: World, ship: ShipEntity, index: number): boolean {
  if (world.docked) return false
  const item = ship.hold.items[index]
  if (!item) return false
  spitPodAhead(world, ship, item)
  ship.hold.items.splice(index, 1)
  refreshSpec(ship)
  return true
}

/**
 * Выбросить весь груз за борт по носу.
 *
 * Пересобираем характеристики: груз имеет массу, масса — ускорения. Освободившийся
 * трюм обязан отразиться на манёвре сразу, а не при следующей стыковке.
 */
export function jettisonCargo(world: World, ship: ShipEntity): number {
  const dropped = ship.hold.items.length
  for (const item of ship.hold.items) spitPodAhead(world, ship, item)
  ship.hold.items = []
  if (dropped > 0) refreshSpec(ship)
  return dropped
}

/**
 * Снять с корабля всё вооружение и выбросить его контейнерами.
 *
 * Разоружённый корабль остаётся живым и летающим: это не смерть, а капитуляция.
 * Стволов у него больше нет физически, а не «запрещено стрелять» — иначе однажды
 * кто-нибудь снял бы запрет, и безоружный пират открыл бы огонь.
 */
export function jettisonWeapons(world: World, ship: ShipEntity): number {
  let dropped = 0
  ship.loadout.weapons = ship.loadout.weapons.map((weapon) => {
    if (!weapon) return null
    spitPodAhead(world, ship, { kind: 'module', module: weapon })
    dropped += 1
    return null
  })
  if (dropped > 0) refreshSpec(ship)
  return dropped
}

/** Контейнеры не живут вечно: иначе система зарастает мусором за час боёв. */
export function expirePods(world: World): void {
  const now = world.time
  world.pods = world.pods.filter((p) => p.alive && now - p.born < SALVAGE.POD_LIFETIME)
}
