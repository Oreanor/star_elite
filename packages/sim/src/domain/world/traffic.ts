import { Quaternion, Vector3 } from 'three'
import { freighterLoadout, pirateLeaderLoadout, pirateLoadout, traderLoadout } from '../../config/loadouts'
import { NPC_DOCK } from '../../config/station'
import { TITAN } from '../../config/titans'
import { PLATFORM } from '../../config/platform'
import { TRAFFIC } from '../../config/world'
import { signed, type Rng } from '../../core/math'
import type { Loadout } from '../loadout'
import { createAIState } from '../ai/types'
import { residentAcquaintances } from './acquaintance'
import { spawnPlatform } from './platforms'
import { spawnWarpFlash } from './warp'
import { addCommodity } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { isDroneShip } from '../combat/drones'
import { makeShip, refreshSpec } from './factory'
import { spawnTitan, titanCount } from './titans'
import type { BodyEntity, Faction, ShipEntity, World } from './entities'

/** Направление ворот причала: завсегдатаи заходят на стыковку с этой стороны. */
const _gateDir = new Vector3(NPC_DOCK.GATE[0], NPC_DOCK.GATE[1], NPC_DOCK.GATE[2]).normalize()

/**
 * Встречи в космосе.
 *
 * Это не «спавнер пиратов». Раз в несколько десятков секунд бросается кость, и
 * чаще всего не выпадает ничего: пустой космос — тоже событие, и без него
 * появление корабля перестаёт что-либо значить. Выпало — приходит ГРУППА, и кто
 * это будет, решает таблица, а не `if`.
 *
 * Кто с кем дерётся, здесь не решается вовсе: пират нападает потому, что
 * `isHostileTo` считает его врагом, а полиция бьёт пирата по той же причине.
 * Трафику достаточно родить корабль нужной фракции и отпустить.
 *
 * Темп задан ПЕРЕЗАРЯДОМ В СЕКУНДАХ. Бросок `rng() < p` внутри шага физики — это
 * не «редко»: при 120 Гц он срабатывает вдвое чаще, чем при 60, и трафик менялся
 * бы вместе с частотой шага.
 *
 * Рождение и смерть кораблей — событие для слоя приложения: контроллеры новым
 * кораблям раздаёт он. Симуляция об этом не знает и знать не должна.
 */

/**
 * Что может встретиться. Новая встреча — новая строка, а не новая ветка (OCP).
 *
 * `approach` — правит ли группа НА игрока. Пират правит: он за этим и пришёл.
 * Торговец летит своей дорогой и проходит мимо; полицейский патруль тоже идёт
 * по маршруту, но встанет на бой сам, стоило ему увидеть пирата.
 */
interface EncounterKind {
  readonly id: string
  readonly faction: Faction
  readonly name: string
  readonly loadout: () => Loadout
  readonly min: number
  readonly max: number
  /** Базовый вес в середине пути. Смещается `farBias` по удалённости от цивилизации. */
  readonly weight: number
  /**
   * Как удалённость от обитаемого мира двигает шанс встречи, −1..+1.
   *
   * Космос у станции патрулируется и полон торговцев; в пустоте между мирами
   * закон не достаёт, и там кормится пират. Поэтому вес не постоянный: у самого
   * причала (`r→0`) он умножается на `1 − farBias`, в глубокой пустоте (`r→1`) —
   * на `1 + farBias`. Пирату ставим плюс (дальше — чаще), торговцу и патрулю минус
   * (жмутся к обитаемому). На полпути (`r=0.5`) вес равен базовому — отсюда и число.
   */
  readonly farBias: number
  readonly approach: boolean
  /** Тонн товара в трюме. Груз высыпается при гибели — ради него и нападают. */
  readonly cargo?: number
  /** Прикрытие: сколько истребителей идёт рядом, на чём и чьей фракции. */
  readonly escort?: { readonly count: number; readonly loadout: () => Loadout; readonly faction: Faction }
}

export const ENCOUNTERS: readonly EncounterKind[] = [
  { id: 'trader', faction: 'neutral', name: 'Торговец', loadout: traderLoadout, min: 1, max: 1, weight: 36, farBias: -0.5, approach: false },
  { id: 'convoy', faction: 'neutral', name: 'Караван', loadout: traderLoadout, min: 2, max: 3, weight: 13, farBias: -0.5, approach: false },
  { id: 'pirate', faction: 'hostile', name: 'Пират', loadout: pirateLoadout, min: 1, max: 2, weight: 22, farBias: 0.9, approach: true },
  { id: 'gang', faction: 'hostile', name: 'Стая', loadout: pirateLoadout, min: 3, max: 4, weight: 6, farBias: 0.9, approach: true },
  { id: 'raider', faction: 'hostile', name: 'Налётчик', loadout: pirateLeaderLoadout, min: 1, max: 1, weight: 8, farBias: 0.9, approach: true },
  { id: 'police', faction: 'police', name: 'Патруль', loadout: pirateLeaderLoadout, min: 1, max: 2, weight: 16, farBias: -0.6, approach: false },
  // Тяжёлый грузовик под прикрытием звена. Неповоротлив и набит товаром: сбей —
  // и высыпется весь трюм. Эскорт полицейский: он сам ищет налётчиков рядом с баржей.
  {
    id: 'freighter', faction: 'neutral', name: 'Грузовик', loadout: freighterLoadout,
    min: 1, max: 1, weight: 7, farBias: -0.4, approach: false, cargo: 140,
    escort: { count: 3, loadout: pirateLeaderLoadout, faction: 'police' },
  },
]

const _scratch = new Vector3()
const _offset = new Vector3()
const _site = new Vector3()
const _anchor = new Vector3()

/** Вес встречи с поправкой на удалённость: у станции — торговцы и патруль, в пустоте — пираты. */
export function biasedWeight(kind: EncounterKind, remoteness: number): number {
  // r=0 → множитель (1−farBias), r=1 → (1+farBias), линейно между. Пол 0.02, чтобы
  // редкая встреча совсем не исчезала: пират у станции возможен, просто почти небывал.
  return Math.max(0.02, kind.weight * (1 + kind.farBias * (2 * remoteness - 1)))
}

function weightedPick(rng: Rng, table: readonly EncounterKind[], remoteness: number): EncounterKind {
  let total = 0
  for (const kind of table) total += biasedWeight(kind, remoteness)
  let roll = rng() * total
  for (const kind of table) {
    roll -= biasedWeight(kind, remoteness)
    if (roll <= 0) return kind
  }
  return table[table.length - 1]!
}

/**
 * Насколько глухое место, 0..1. Ноль — у обитаемого мира или причала, единица —
 * пустота между мирами. Меряется по ближайшему НАСЕЛЁННОМУ телу (станция или мир
 * с населением): закон и торговля жмутся к жилью, а не к любой каменюке. Если в
 * системе жить негде вовсе — она вся фронтир, и всюду единица.
 */
export function remoteness(world: World): number {
  let nearest = Infinity
  for (const body of world.bodies) {
    const inhabited = body.kind === 'station' || body.population > 0
    if (!inhabited) continue
    const altitude = Math.max(0, body.pos.distanceTo(world.player.state.pos) - body.radius)
    if (altitude < nearest) nearest = altitude
  }
  if (!Number.isFinite(nearest)) return 1
  return nearest / (nearest + TRAFFIC.QUIET_RANGE)
}

/** Единичный вектор в случайную сторону. Записывает в `out`. */
function randomDirection(world: World, out: Vector3): Vector3 {
  do {
    out.set(signed(world.rng), signed(world.rng), signed(world.rng))
  } while (out.lengthSq() < 1e-6)
  return out.normalize()
}

/** Свои и беспилотники не в счёт: потолок считает ВСТРЕЧЕННЫХ. */
const trafficCount = (world: World): number =>
  world.ships.filter((s) => s.alive && !isDroneShip(s) && s.ai?.escortOf == null).length

/**
 * Где родится группа и куда полетит.
 *
 * Мирные иногда отваливают от причала — станция без исходящего движения выглядит
 * покинутой. Остальные приходят из пустоты на таком удалении, с которого их видно
 * только на локаторе.
 *
 * Враждебные у самого причала не рождаются: над станцией полиция, и пират, всплывший
 * из ничего у ворот, — это баг на вид. Если игрок у причала, налётчик приходит с кромки
 * зоны и правит внутрь; пока летит, его встречает патруль.
 *
 * Пролетающий правит НА ПРОТИВОПОЛОЖНУЮ сторону от игрока: маршрут проходит мимо,
 * а не вокруг. Идущий на сближение правит на самого игрока.
 */
function spawnSite(world: World, kind: EncounterKind, outPos: Vector3, outHome: Vector3): void {
  const station = world.bodies.find((b) => b.kind === 'station')

  if (kind.faction === 'neutral' && station && world.rng() < TRAFFIC.STATION_SHARE) {
    // Отчаливают с ПРОТИВОПОЛОЖНОЙ воротам стороны: на стыковку заходят с одной,
    // вылетают с другой — станция работает на просвет, потоки не сходятся в горловине.
    _scratch.set(-NPC_DOCK.GATE[0], -NPC_DOCK.GATE[1], -NPC_DOCK.GATE[2])
    // Небольшой разброс, чтобы вылетающие не сыпались из одной точки.
    _scratch.addScaledVector(randomDirection(world, _offset), 0.3).normalize()
    outPos.copy(station.pos).addScaledVector(_scratch, station.radius * 3)
    outHome.copy(station.pos).addScaledVector(_scratch, TRAFFIC.DESTINATION_RANGE)
    return
  }

  // Пират у причала — только с дальней кромки: рождается на фиксированном удалении ОТ
  // СТАНЦИИ (не от игрока), чтобы не всплыть над воротами, и правит на игрока.
  if (
    kind.faction === 'hostile' &&
    station &&
    station.pos.distanceTo(world.player.state.pos) < TRAFFIC.STATION_KEEPOUT
  ) {
    randomDirection(world, _scratch)
    outPos.copy(station.pos).addScaledVector(_scratch, TRAFFIC.PIRATE_STATION_DIST)
    outHome.copy(world.player.state.pos)
    return
  }

  randomDirection(world, _scratch)
  const distance = TRAFFIC.SPAWN_MIN + world.rng() * (TRAFFIC.SPAWN_MAX - TRAFFIC.SPAWN_MIN)
  outPos.copy(world.player.state.pos).addScaledVector(_scratch, distance)

  if (kind.approach) outHome.copy(world.player.state.pos)
  else outHome.copy(world.player.state.pos).addScaledVector(_scratch, -TRAFFIC.DESTINATION_RANGE)
}

function spawnOne(world: World, kind: EncounterKind, pos: Vector3, home: Vector3): ShipEntity {
  const quat = new Quaternion().setFromUnitVectors(
    new Vector3(0, 0, -1),
    _offset.copy(home).sub(pos).normalize(),
  )

  const ship = makeShip(world.ids, kind.faction, kind.name, kind.loadout(), pos.clone(), quat, world.rng)
  // Помним, каким типом рождён: по нему воссоздадим борт, если игрок с ним заговорит
  // и однажды встретит снова.
  ship.originKind = kind.id
  // Дом — не место рождения, а НАЗНАЧЕНИЕ: патрульный круг бота вьётся вокруг дома,
  // значит корабль сперва долетит до цели, а уже там начнёт кружить.
  ship.ai = createAIState(home, world.rng)
  ship.controls.throttle = 0.7

  world.ships.push(ship)
  return ship
}

/**
 * Набить трюм балк-грузом. Легальным: пират нападает ради тонн, а не контрабанды,
 * а весь груз потом высыпается обломками. Два разных товара — чтобы добыча не была
 * однообразной. `refreshSpec` пересчитывает массу: гружёная баржа летает ещё тяжелее.
 */
function stockFreighter(world: World, ship: ShipEntity, tons: number): void {
  const goods = [COMMODITIES.MINERALS, COMMODITIES.METALS, COMMODITIES.MACHINERY, COMMODITIES.FOOD, COMMODITIES.ELECTRONICS]
  const a = goods[Math.floor(world.rng() * goods.length)]!
  const b = goods[Math.floor(world.rng() * goods.length)]!
  addCommodity(ship.hold, a, Math.floor((tons * 0.6) / a.unitMass))
  addCommodity(ship.hold, b, Math.floor((tons * 0.4) / b.unitMass))
  refreshSpec(ship)
}

/**
 * Прикрытие вокруг подопечного. Эскорт помечен `escortOf`: он держится у баржи
 * (его дом — её место) и, если фракция боевая, сам ищет рядом врагов. Из потолка
 * и вычистки трафика он исключён по этой же метке — прикрытие не бросают на полпути.
 */
function spawnEscort(world: World, escort: NonNullable<EncounterKind['escort']>, patron: ShipEntity): ShipEntity[] {
  const born: ShipEntity[] = []
  for (let i = 0; i < escort.count; i++) {
    randomDirection(world, _offset).multiplyScalar(patron.spec.hull.radius * 2 + world.rng() * TRAFFIC.GROUP_SPREAD)
    const pos = _scratch.copy(patron.state.pos).add(_offset)
    const ship = makeShip(world.ids, escort.faction, 'Эскорт', escort.loadout(), pos.clone(), patron.state.quat.clone(), world.rng)
    ship.ai = createAIState(patron.state.pos, world.rng)
    ship.ai.escortOf = patron.id
    ship.controls.throttle = 0.7
    world.ships.push(ship)
    born.push(ship)
  }
  return born
}

/**
 * Выставить на радар всех знакомых, чьё место — эта система. Не «встреча» и не бросок
 * кости: со знакомыми случайных встреч нет, их положение известно всегда с точностью до
 * системы. Раз контакт числится ЗДЕСЬ (`residentAcquaintances`), он обязан быть на
 * радаре с самого прибытия — не всплыть внезапно из пустоты посреди полёта. Зовётся
 * один раз при входе в систему (после `enterSystem`), не из ритма трафика.
 *
 * Борт воссоздаётся тем же типом встречи, что когда-то его родил, но с прежним именем,
 * характером, фракцией и памятью. Ставим у обитаемого мира (столица/станция) — там его
 * и «место жительства», и туда же указывает `contactWhereabouts` для отсутствующих.
 */
export function spawnResidentContacts(world: World): ShipEntity[] {
  const residents = residentAcquaintances(world)
  if (residents.length === 0) return []

  const anchor = residentAnchor(world)
  const born: ShipEntity[] = []
  for (const rec of residents) {
    const kind = ENCOUNTERS.find((k) => k.id === rec.kindId) ?? ENCOUNTERS[0]!
    // Рассадка вокруг якоря, детерминированно от `world.rng` (свежий после enterSystem).
    randomDirection(world, _scratch)
    const pos = _site.copy(anchor).addScaledVector(_scratch, TRAFFIC.SPAWN_MIN * (0.6 + world.rng() * 0.8))
    const ship = spawnOne(world, kind, pos, anchor)

    // Тот же пилот, не новый: имя открыто (знакомы), характер и фракция — из записи.
    ship.name = rec.name
    ship.pilotName = rec.name
    ship.persona = rec.persona
    ship.faction = rec.faction
    ship.acquaintanceId = rec.id
    // Снова свиделись: ты вернулся в его систему и застал его на радаре. Отсюда бот
    // при разговоре знает, что вы не впервые (`metBefore`), а не встречает как чужого.
    rec.meetings += 1
    born.push(ship)
  }
  return born
}

/** У какого тела селить знакомых: причал, иначе самый людный мир, иначе — рядом с игроком. */
function residentAnchor(world: World): Vector3 {
  const station = world.bodies.find((b) => b.kind === 'station')
  if (station) return _anchor.copy(station.pos)
  let best: BodyEntity | null = null
  for (const b of world.bodies) if (b.population > 0 && (!best || b.population > best.population)) best = b
  return _anchor.copy(best ? best.pos : world.player.state.pos)
}

/** Одна встреча: от одиночки до стаи. Возвращает всех, кому нужен пилот. */
function spawnEncounter(world: World): ShipEntity[] {
  const born = bornEncounter(world)
  // Приход в систему видно со стороны: на месте появления — вспышка перехода.
  // Одна на группу, в её центре: звено выходит из прыжка вместе, а не поштучно.
  const lead = born[0]
  if (lead) spawnWarpFlash(world, lead.state.pos, true)
  return born
}

function bornEncounter(world: World): ShipEntity[] {
  const kind = weightedPick(world.rng, ENCOUNTERS, remoteness(world))
  const count = kind.min + Math.floor(world.rng() * (kind.max - kind.min + 1))

  const centre = new Vector3()
  const home = new Vector3()
  spawnSite(world, kind, centre, home)

  const born: ShipEntity[] = []
  for (let i = 0; i < count; i++) {
    if (trafficCount(world) >= TRAFFIC.MAX) break
    randomDirection(world, _offset).multiplyScalar(world.rng() * TRAFFIC.GROUP_SPREAD)
    born.push(spawnOne(world, kind, _scratch.copy(centre).add(_offset), home))
  }

  // Груз и прикрытие — после того, как туша родилась: эскорт строится вокруг неё,
  // а трюм набивается ей же. Родившихся эскортников тоже отдаём приложению — им
  // нужен пилот, иначе звено молча дрейфует.
  const patron = born[0]
  if (patron) {
    if (kind.cargo) for (const ship of born) stockFreighter(world, ship, kind.cargo)
    if (kind.escort) born.push(...spawnEscort(world, kind.escort, patron))
  }

  // Часть мирных караванов идёт СТЫКОВАТЬСЯ, а не мимо: они выстраиваются в очередь
  // к причалу и швартуются по одному. Гигант-грузовик к причалу не лезет — только
  // лёгкие торговцы. Отмечаем весь борт: караван из троих и покажет очередь наглядно.
  const station = world.bodies.find((b) => b.kind === 'station')
  if (station && (kind.id === 'trader' || kind.id === 'convoy') && world.rng() < TRAFFIC.DOCK_SHARE) {
    for (const ship of born) if (ship.ai) ship.ai.dock = 'inbound'
  }
  return born
}

/**
 * Сколько бортов сейчас В ЦИКЛЕ причала — заходят или стоят. Это и есть «жизнь»
 * станции: не декорация, а реальные корабли в общей стыковке. Отстоявшийся уходит
 * (`dock='done'`) и из счёта выпадает — тогда приток добирает норму заново.
 */
function stationRegulars(world: World): number {
  return world.ships.filter(
    (s) => s.alive && !isDroneShip(s) && s.faction === 'neutral' && (s.ai?.dock === 'inbound' || s.ai?.dock === 'berthed'),
  ).length
}

/** Родить одного завсегдатая: торговец заходит на стыковку со стороны ворот. Trader — ENCOUNTERS[0]. */
function spawnStationRegular(world: World, station: BodyEntity): ShipEntity {
  // Заход со стороны ворот, с небольшим разбросом, чтобы пара не сыпалась из точки.
  _scratch.copy(_gateDir).addScaledVector(randomDirection(world, _offset), 0.35).normalize()
  const pos = _site.copy(station.pos).addScaledVector(_scratch, station.radius + TRAFFIC.STATION_APPROACH)
  const ship = spawnOne(world, ENCOUNTERS[0]!, pos, _offset.copy(station.pos))
  if (ship.ai) ship.ai.dock = 'inbound'
  return ship
}

/**
 * Поддержать жизнь у причала, пока игрок рядом со станцией: держим у неё несколько
 * заходящих на стыковку. Новоприбывший тут же считается `inbound`, поэтому за кадр
 * добавляем не больше одного — перебора нет, а число само доберёт норму и удержит её
 * по мере того, как отстоявшиеся уходят. Возвращает родившихся: им нужен пилот.
 */
function stepStationLife(world: World): ShipEntity[] {
  const station = world.bodies.find((b) => b.kind === 'station')
  if (!station) return []
  if (station.pos.distanceTo(world.player.state.pos) > TRAFFIC.STATION_LIFE_RANGE) return []
  if (stationRegulars(world) >= TRAFFIC.STATION_REGULARS) return []
  if (trafficCount(world) >= TRAFFIC.MAX) return []
  return [spawnStationRegular(world, station)]
}

/**
 * Жизнь причала, пока игрок ПРИСТЫКОВАН и мир стоит. Обычный шаг в доке заморожен
 * (`stepWorld` выходит сразу), поэтому смену лиц у причала ведём отдельно и по СЕКУНДАМ
 * реального времени (`dt`): у стоящих тикает стоянка, отстоявшийся отходит (`dock='done'` —
 * когда отчалишь, улетит сам), а на освободившееся место иногда швартуется новый
 * завсегдатай — сразу в `berthed`, ведь его подхода из дока всё равно не видно.
 *
 * Детерминированно от `world.rng`. Возвращает true, если состав причала изменился —
 * приложению это сигнал перерисовать плашки. Контроллер новичку слой приложения раздаст
 * сам, когда мир оживёт (`syncControllers`): стоящему у причала он пока не нужен.
 */
export function stepDockedBerth(world: World, dt: number): boolean {
  const station = world.bodies.find((b) => b.kind === 'station')
  if (!station) return false
  let changed = false

  // Стоянка тикает и в доке — вручную по dt, ведь world.time стоит. Отстоявшийся отходит.
  for (const s of world.ships) {
    if (!s.alive || !s.ai || s.ai.dock !== 'berthed' || s.faction !== 'neutral' || isDroneShip(s)) continue
    s.ai.dockTimer -= dt
    if (s.ai.dockTimer <= 0) {
      s.ai.dock = 'done'
      s.clearance = false
      if (world.dockOccupantId === s.id) world.dockOccupantId = null
      changed = true
    }
  }

  // Новый гость — не чаще раза в DOCKED_BERTH_PERIOD секунд и только если причал не полон.
  const berthed = world.ships.filter(
    (s) => s.alive && s.ai?.dock === 'berthed' && s.faction === 'neutral' && !isDroneShip(s),
  ).length
  if (berthed < TRAFFIC.STATION_REGULARS && trafficCount(world) < TRAFFIC.MAX && world.rng() < dt / TRAFFIC.DOCKED_BERTH_PERIOD) {
    const ship = spawnStationRegular(world, station)
    if (ship.ai) {
      // Сразу у причала: подхода не видно, стоянку даём с разбросом, чтобы уходили вразнобой.
      ship.ai.dock = 'berthed'
      ship.ai.dockTimer = NPC_DOCK.DWELL * (0.6 + world.rng() * 0.9)
    }
    ship.clearance = true
    changed = true
  }
  return changed
}

/**
 * Чужой бой в глуши: пираты уже насели на кого-то, когда игрок подходит. Обе стороны
 * рождаются рядом на кромке радара и сходятся сами — ИИ считает их врагами по фракции
 * (`isHostileTo`), драться их никто не заставляет. Игрок волен вмешаться или пройти
 * мимо; помощь пиратам его не обеляет — они враждебны и к нему.
 */
function spawnSkirmish(world: World): ShipEntity[] {
  randomDirection(world, _scratch)
  const distance = TRAFFIC.SPAWN_MIN + world.rng() * (TRAFFIC.SPAWN_MAX - TRAFFIC.SPAWN_MIN)
  const centre = new Vector3().copy(world.player.state.pos).addScaledVector(_scratch, distance)

  // Место схватки — общий дом обеих сторон: они держатся тут и дерутся, а не гонятся
  // за игроком через полсистемы. Точки рождения разнесены в пределах строя.
  const nearCentre = (): Vector3 =>
    _site.copy(centre).addScaledVector(randomDirection(world, _offset), 0.2 + world.rng() * TRAFFIC.GROUP_SPREAD)

  const born: ShipEntity[] = []
  const pirateKind = ENCOUNTERS.find((k) => k.id === 'pirate')!
  const raiders = 2 + Math.floor(world.rng() * 2) // 2–3 налётчика
  for (let i = 0; i < raiders && trafficCount(world) < TRAFFIC.MAX; i++) {
    born.push(spawnOne(world, pirateKind, nearCentre(), centre))
  }

  // Жертва: то патруль (даёт настоящий бой), то одинокий торговец (его можно спасти).
  // Бросок ОДИН и до поиска: `rng()` внутри предиката `find` катился бы на каждом
  // элементе и не совпал бы ни с чем.
  const victimId = world.rng() < 0.5 ? 'police' : 'trader'
  const victimKind = ENCOUNTERS.find((k) => k.id === victimId)!
  const victims = victimKind.min + Math.floor(world.rng() * (victimKind.max - victimKind.min + 1))
  for (let i = 0; i < victims && trafficCount(world) < TRAFFIC.MAX; i++) {
    born.push(spawnOne(world, victimKind, nearCentre(), centre))
  }
  return born
}

/**
 * Убрать тех, кто ушёл за горизонт событий игрока.
 *
 * Захваченную цель не трогаем: пилот на неё смотрит, и корабль, растворившийся
 * в рамке прицела, выглядит поломкой, а не уходом за пределы радара. Наёмника —
 * тем более: за него заплачено.
 *
 * Убираем ЛЮБУЮ фракцию, а не только мирных. Пират, потерявший игрока и ушедший
 * за шестнадцать километров, не вернётся никогда — он просто копится в списке.
 */
function despawnDistant(world: World): void {
  const limitSq = TRAFFIC.DESPAWN_RANGE * TRAFFIC.DESPAWN_RANGE
  world.ships = world.ships.filter((s) => {
    if (!s.alive || isDroneShip(s)) return true
    if (s.id === world.lockedTargetId) return true
    if (s.ai?.escortOf != null) return true
    // ЗНАКОМЫЙ (с ним говорили) не растворяется, как прочий трафик: он отслеживается,
    // помечен на картах и всегда на связи. Прохожие копятся и гибнут — знакомые живут.
    if (s.acquaintanceId != null) return true
    // Спящий экипаж принадлежит платформе, а не трафику: его жизненным циклом
    // (пробуждением и уборкой вместе с гнездом) распоряжается stepPlatforms.
    if (s.ai?.dormant) return true
    // Стыкующегося у причала не бросаем: он привязан к станции, как захваченная цель.
    // Иначе улетевший к причалу игрок вернулся бы к пустому причалу с зависшей очередью.
    if (s.ai?.dock === 'berthed' || s.id === world.dockOccupantId) return true
    return s.state.pos.distanceToSquared(world.player.state.pos) <= limitSq
  })

  // Причал держит только живой стыкующийся. Погиб, ушёл или уже отчалил — освобождаем
  // место, иначе очередь встанет навсегда, а к причалу никто больше не подойдёт.
  const occupant = world.dockOccupantId
  if (occupant != null) {
    const ship = world.ships.find((s) => s.id === occupant)
    if (!ship || !ship.alive || ship.ai?.dock == null || ship.ai.dock === 'done') {
      world.dockOccupantId = null
    }
  }
}

/**
 * Насколько людно там, где сейчас корабль, 0..1.
 *
 * Меряется по ближайшему МИРУ — планете или причалу, но не по звезде: у звезды
 * не живут, к ней не возят руду, и висеть возле короны в ожидании торговца
 * незачем. Расстояние берётся до поверхности: у газового гиганта радиус
 * семьдесят тысяч километров, и от его центра «сто тысяч» означало бы «внутри».
 */
function crowding(world: World): number {
  let nearest = Infinity
  for (const body of world.bodies) {
    if (body.kind === 'star') continue
    const altitude = Math.max(0, body.pos.distanceTo(world.player.state.pos) - body.radius)
    if (altitude < nearest) nearest = altitude
  }
  if (!Number.isFinite(nearest)) return 1
  return 1 / (1 + nearest / TRAFFIC.QUIET_RANGE)
}

/** Следующая попытка — со случайным разбросом, чтобы встречи не шли по метроному. */
function rearm(world: World): void {
  world.trafficTimer = TRAFFIC.INTERVAL * (1 + signed(world.rng) * TRAFFIC.INTERVAL_JITTER)
}

/** Шаг трафика. Возвращает родившихся: приложению надо дать им пилотов. */
export function stepTraffic(world: World, dt: number): ShipEntity[] {
  despawnDistant(world)

  // Жизнь у причала — вне ритма встреч и вне первой задержки: станция обязана
  // выглядеть живой сразу, а не через полминуты. Родившихся копим и вернём вместе.
  const born = stepStationLife(world)

  world.trafficTimer -= dt
  if (world.trafficTimer > 0) return born

  rearm(world)

  // Не всякая попытка — встреча. Пустой космос обязан оставаться пустым чаще,
  // чем населённым, иначе корабли перестают что-либо значить. А вдали от миров
  // он пустее: маршруты сходятся у планет, и встречи вместе с ними.
  if (world.rng() >= TRAFFIC.CHANCE * crowding(world)) return born

  // Раз в несколько встреч вместо кораблей приходит КИТ — город поколений. Он
  // живёт своим списком и пилота не требует, поэтому возвращаем накопленное. Кит
  // редок и одинок: за его потолком встреча становится обычной.
  if (world.rng() < TITAN.ENCOUNTER_SHARE && titanCount(world) < TITAN.MAX) {
    spawnTitan(world)
    return born
  }

  // Изредка вместо кораблей приходит спящее ГНЕЗДО — пиратская платформа. Как и
  // кит, живёт своим списком, но экипажу нужны пилоты, поэтому его и возвращаем.
  // Гнездо — событие, а не рядовая встреча: спавним его помимо потолка трафика.
  if (world.rng() < PLATFORM.ENCOUNTER_SHARE && world.platforms.length < PLATFORM.MAX) {
    return born.concat(spawnPlatform(world))
  }

  if (trafficCount(world) >= TRAFFIC.MAX) return born

  // В глуши рядовую встречу изредка подменяет ЧУЖОЙ БОЙ. Только вдали от жилья:
  // короткое замыкание по `&&` бережёт поток RNG у станции — там ветка не бросается.
  if (remoteness(world) >= TRAFFIC.SKIRMISH_MIN_REMOTE && world.rng() < TRAFFIC.SKIRMISH_SHARE) {
    return born.concat(spawnSkirmish(world))
  }

  return born.concat(spawnEncounter(world))
}
