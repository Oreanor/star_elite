import { Quaternion, Vector3 } from 'three'
import { pirateLeaderLoadout, pirateLoadout, traderLoadout } from '../../config/loadouts'
import { TITAN } from '../../config/titans'
import { TRAFFIC } from '../../config/world'
import { signed, type Rng } from '../../core/math'
import type { Loadout } from '../loadout'
import { createAIState } from '../ai/types'
import { isDroneShip } from '../combat/drones'
import { makeShip } from './factory'
import { spawnTitan, titanCount } from './titans'
import type { Faction, ShipEntity, World } from './entities'

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
  readonly weight: number
  readonly approach: boolean
}

const ENCOUNTERS: readonly EncounterKind[] = [
  { id: 'trader', faction: 'neutral', name: 'Торговец', loadout: traderLoadout, min: 1, max: 1, weight: 30, approach: false },
  { id: 'convoy', faction: 'neutral', name: 'Караван', loadout: traderLoadout, min: 2, max: 3, weight: 10, approach: false },
  { id: 'pirate', faction: 'hostile', name: 'Пират', loadout: pirateLoadout, min: 1, max: 2, weight: 22, approach: true },
  { id: 'gang', faction: 'hostile', name: 'Стая', loadout: pirateLoadout, min: 3, max: 4, weight: 6, approach: true },
  { id: 'raider', faction: 'hostile', name: 'Налётчик', loadout: pirateLeaderLoadout, min: 1, max: 1, weight: 8, approach: true },
  { id: 'police', faction: 'police', name: 'Патруль', loadout: pirateLeaderLoadout, min: 1, max: 2, weight: 16, approach: false },
]

const _scratch = new Vector3()
const _offset = new Vector3()

function weightedPick(rng: Rng, table: readonly EncounterKind[]): EncounterKind {
  let total = 0
  for (const kind of table) total += kind.weight
  let roll = rng() * total
  for (const kind of table) {
    roll -= kind.weight
    if (roll <= 0) return kind
  }
  return table[table.length - 1]!
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
 * Пролетающий правит НА ПРОТИВОПОЛОЖНУЮ сторону от игрока: маршрут проходит мимо,
 * а не вокруг. Идущий на сближение правит на самого игрока.
 */
function spawnSite(world: World, kind: EncounterKind, outPos: Vector3, outHome: Vector3): void {
  const station = world.bodies.find((b) => b.kind === 'station')

  if (kind.faction === 'neutral' && station && world.rng() < TRAFFIC.STATION_SHARE) {
    randomDirection(world, _scratch)
    // Чуть в стороне от причала: рождённый в горловине корабль таранит станцию.
    outPos.copy(station.pos).addScaledVector(_scratch, station.radius * 3)
    outHome.copy(station.pos).addScaledVector(_scratch, TRAFFIC.DESTINATION_RANGE)
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

  const ship = makeShip(world.ids, kind.faction, kind.name, kind.loadout(), pos.clone(), quat)
  // Дом — не место рождения, а НАЗНАЧЕНИЕ: патрульный круг бота вьётся вокруг дома,
  // значит корабль сперва долетит до цели, а уже там начнёт кружить.
  ship.ai = createAIState(home, world.rng)
  ship.controls.throttle = 0.7

  world.ships.push(ship)
  return ship
}

/** Одна встреча: от одиночки до стаи. Возвращает всех, кому нужен пилот. */
function spawnEncounter(world: World): ShipEntity[] {
  const kind = weightedPick(world.rng, ENCOUNTERS)
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
    return s.state.pos.distanceToSquared(world.player.state.pos) <= limitSq
  })
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

  world.trafficTimer -= dt
  if (world.trafficTimer > 0) return []

  rearm(world)

  // Не всякая попытка — встреча. Пустой космос обязан оставаться пустым чаще,
  // чем населённым, иначе корабли перестают что-либо значить. А вдали от миров
  // он пустее: маршруты сходятся у планет, и встречи вместе с ними.
  if (world.rng() >= TRAFFIC.CHANCE * crowding(world)) return []

  // Раз в несколько встреч вместо кораблей приходит КИТ — город поколений. Он
  // живёт своим списком и пилота не требует, поэтому возвращаем пусто. Кит редок
  // и одинок: за его потолком встреча становится обычной.
  if (world.rng() < TITAN.ENCOUNTER_SHARE && titanCount(world) < TITAN.MAX) {
    spawnTitan(world)
    return []
  }

  if (trafficCount(world) >= TRAFFIC.MAX) return []

  return spawnEncounter(world)
}
