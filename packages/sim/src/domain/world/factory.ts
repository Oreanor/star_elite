import { Euler, Quaternion, Vector3 } from 'three'
import { GRAVITY, MOON } from '../../config/bodies'
import { pirateLeaderLoadout, pirateLoadout, playerStartLoadout } from '../../config/loadouts'
import { GALAXY } from '../../config/galaxy'
import { ASTEROID, TRAFFIC, WORLD } from '../../config/world'
import { makeRng, range, signed, type Rng } from '../../core/math'
import { createAIState } from '../ai/types'
import { cargoMass, createHold } from '../cargo/hold'
import { createCruiseState } from '../cruise/drive'
import { createControls, createShipState } from '../flight/types'
import { deriveShipSpec, isDrone, isMissile, type Loadout, type WeaponModule } from '../loadout'
import type {
  AsteroidEntity,
  BodyEntity,
  Faction,
  GunState,
  OrbitDef,
  ShipEntity,
  World,
} from './entities'
import { createIdSource, type IdSource } from './ids'
import { maybeShiftOrigin } from './origin'
import { stepOrbits } from './orbits'
import type { SystemDef } from './system'
import { STARTER_SYSTEM } from './system'

/**
 * Сборка мира из описания системы. Всё, что делает место местом, приходит
 * из `SystemDef` — фабрику не нужно трогать, чтобы добавить новую систему.
 */

/** Подвеска со счётным боезапасом: ракета или контейнер БПЛА, но не ствол. */
const hasAmmo = (w: WeaponModule): w is Extract<WeaponModule, { ammo: number }> => isMissile(w) || isDrone(w)

export function makeShip(
  ids: IdSource,
  faction: Faction,
  name: string,
  loadout: Loadout,
  pos: Vector3,
  quat: Quaternion,
): ShipEntity {
  const hold = createHold(0)
  const spec = deriveShipSpec(loadout, cargoMass(hold))
  hold.capacity = spec.cargoCapacity

  const guns: GunState[] = spec.mounts.map((mount) => ({
    cooldown: 0,
    heat: 0,
    // Боезапас есть у всего, что СХОДИТ с подвески: и у ракеты, и у контейнера
    // БПЛА. Спрашивать «ракета ли это» значило бы оставить контейнер пустым.
    ammo: hasAmmo(mount.weapon) ? mount.weapon.ammo : 0,
  }))

  return {
    id: ids.next(),
    kind: 'ship',
    faction,
    name,
    loadout,
    spec,
    state: createShipState(pos, quat),
    controls: createControls(),
    hull: spec.hull.hull,
    shield: spec.hull.shield,
    hullHeat: 0,
    // Привод заряжен полностью: первый прыжок доступен без визита к звезде.
    jumpCharge: spec.jumpRange,
    lastHitAt: -1e9,
    energy: spec.power.capacity,
    ecmCooldown: 0,
    // Бомба есть только у игрока, и это НЕ привилегия физики: пират, снимающий
    // звено одной кнопкой, — не бой, а лотерея. Заряжена с первого кадра.
    bombCharge: faction === 'player' ? 1 : 0,
    cloaked: false,
    hold,
    guns,
    cruise: createCruiseState(),
    alive: true,
    wreckAt: null,
    ai: null,
    clearance: false,
    droneOf: null,
    dieAt: null,
  }
}

/** Пересобрать характеристики после смены модулей или груза. Вызывать на СОБЫТИЕ. */
export function refreshSpec(e: ShipEntity): void {
  const spec = deriveShipSpec(e.loadout, cargoMass(e.hold))
  e.spec = spec
  e.hold.capacity = spec.cargoCapacity

  // Корпус и щит могли уменьшиться — обрезаем, но не «лечим» снятием брони.
  e.hull = Math.min(e.hull, spec.hull.hull)
  e.shield = Math.min(e.shield, spec.hull.shield)
  e.energy = Math.min(e.energy, spec.power.capacity)
  // Сменили привод — заряд не может превышать дальность новой модели.
  e.jumpCharge = Math.min(e.jumpCharge, spec.jumpRange)

  // Стволы могли смениться: сохраняем боезапас там, где подвеска осталась подвеской.
  e.guns = spec.mounts.map((mount, i) => {
    const prev = e.guns[i]
    return {
      cooldown: 0,
      heat: prev?.heat ?? 0,
      ammo: hasAmmo(mount.weapon) ? (prev?.ammo ?? mount.weapon.ammo) : 0,
    }
  })
}

function makeAsteroids(rng: Rng, ids: IdSource, def: SystemDef): AsteroidEntity[] {
  const belt = def.belt
  if (!belt) return []

  const center = new Vector3(...belt.center)
  const asteroids: AsteroidEntity[] = []

  for (let i = 0; i < belt.count; i++) {
    // Тор, а не шар: пояс должен быть поясом, и внутри него должно быть куда лететь.
    const angle = rng() * Math.PI * 2
    const radius = belt.radius * (0.35 + 0.65 * Math.sqrt(rng()))
    const pos = new Vector3(
      center.x + Math.cos(angle) * radius,
      center.y + signed(rng) * belt.radius * 0.08,
      center.z + Math.sin(angle) * radius,
    )

    // Не роняем камень игроку на голову в момент старта.
    if (pos.distanceTo(new Vector3(...def.playerStart)) < 300) continue

    asteroids.push({
      id: ids.next(),
      kind: 'asteroid',
      pos,
      vel: new Vector3(signed(rng), signed(rng) * 0.3, signed(rng)).multiplyScalar(1.3),
      quat: new Quaternion().setFromEuler(new Euler(rng() * 6, rng() * 6, rng() * 6)),
      spin: new Vector3(signed(rng), signed(rng), signed(rng)).multiplyScalar(0.12),
      radius: range(rng, ASTEROID.RADIUS_MIN, ASTEROID.RADIUS_MAX),
      hull: ASTEROID.HULL,
      shape: Math.floor(rng() * ASTEROID.SHAPES),
      alive: true,
    })
  }
  return asteroids
}

const _nose = /* @__PURE__ */ new Vector3(0, 0, -1)
const _toward = /* @__PURE__ */ new Vector3()

/**
 * Развернуть нос на точку. Выход из прыжка в километре от причала спиной к нему —
 * это не «свобода», это лишний разворот вслепую в каждой новой системе.
 */
function aimAt(ship: ShipEntity, target: Vector3 | null): void {
  if (!target) {
    ship.state.quat.identity()
    return
  }
  _toward.copy(target).sub(ship.state.pos)
  if (_toward.lengthSq() < 1e-6) {
    ship.state.quat.identity()
    return
  }
  ship.state.quat.setFromUnitVectors(_nose, _toward.normalize())
}

/** Ось вращения: вертикаль, наклонённая на `tilt` в плоскости XY. */
function spinAxis(tilt: number): Vector3 {
  return new Vector3(Math.sin(tilt), Math.cos(tilt), 0).normalize()
}

/**
 * Угловая скорость кругового обращения, рад/с: ω = √(GM/r³).
 *
 * Масса планеты выводится из радиуса и плотности — назначать период вручную
 * нельзя. «Пусть оборот за десять минут» даёт луне сотни километров в секунду:
 * она проносится мимо корабля быстрее ракеты и сшибает его на ровном месте.
 * У настоящей Луны выходит месяц, и это следствие массы Земли, а не решения.
 */
function orbitRate(planetRadius: number, gas: boolean, orbitRadius: number): number {
  const density = gas ? GRAVITY.GAS_DENSITY : GRAVITY.ROCK_DENSITY
  const mass = density * (4 / 3) * Math.PI * planetRadius ** 3
  return Math.sqrt((GRAVITY.G * mass) / orbitRadius ** 3)
}

function makeMoonBodies(ids: IdSource, planet: BodyEntity, def: SystemDef['planets'][number]): BodyEntity[] {
  const gas = def.type === 'Газовый гигант'
  return def.moons.map((moon) => ({
    id: ids.next(),
    kind: 'moon' as const,
    name: moon.name,
    // Точка на орбите досчитается первым же `stepOrbits`. Здесь — центр планеты:
    // положение спутника нигде не ХРАНИТСЯ, оно следует из времени.
    pos: new Vector3(...def.pos),
    radius: moon.radius,
    color: MOON.COLOR,
    surface: 'Скалистая' as const,
    population: 0,
    spin: MOON.SPIN,
    spinAxis: spinAxis(moon.tilt),
    orbit: {
      parentId: planet.id,
      radius: moon.orbit,
      phase: moon.phase,
      rate: orbitRate(planet.radius, gas, moon.orbit),
      tilt: moon.tilt,
    },
  }))
}

/** Масса звезды из радиуса: ρ·(4/3)πR³. Как у планеты, только плотность звёздная. */
function starMass(radius: number): number {
  return GRAVITY.STAR_DENSITY * (4 / 3) * Math.PI * radius ** 3
}

/**
 * Орбита одной звезды двойной вокруг барицентра.
 *
 * Радиус обратен массе: лёгкая звезда описывает большой круг, тяжёлая — малый,
 * центр масс между ними неподвижен. Обе идут с одной угловой скоростью
 * ω = √(G·(M₁+M₂)/d³) — иначе они разъехались бы, а не кружили парой.
 */
function binaryOrbit(selfMass: number, otherMass: number, separation: number, phase: number): OrbitDef {
  const total = selfMass + otherMass
  return {
    parentId: null,
    radius: separation * (otherMass / total),
    phase,
    rate: Math.sqrt((GRAVITY.G * total) / separation ** 3),
    // Плоскость пары задаёт эклиптику: наклон ей ни к чему, планеты и так рядом с ней.
    tilt: 0,
  }
}

function makeBodies(ids: IdSource, def: SystemDef): BodyEntity[] {
  const comp = def.companion
  const m1 = starMass(def.star.radius)
  const m2 = comp ? starMass(comp.radius) : 0

  const primary: BodyEntity = {
    id: ids.next(),
    kind: 'star',
    name: def.name,
    pos: new Vector3(...def.star.pos),
    radius: def.star.radius,
    color: def.star.color,
    surface: null,
    population: 0,
    spin: 0,
    spinAxis: new Vector3(0, 1, 0),
    // Одиночная стоит в центре; главная звезда двойной обращается вокруг барицентра.
    orbit: comp ? binaryOrbit(m1, m2, comp.separation, 0) : null,
  }
  const bodies: BodyEntity[] = [primary]

  if (comp) {
    bodies.push({
      id: ids.next(),
      // Имя со звёздочкой B — так метят спутник двойной в каталогах (Сириус B).
      kind: 'star',
      name: `${def.name} B`,
      pos: new Vector3(...def.star.pos),
      radius: comp.radius,
      color: comp.color,
      surface: null,
      population: 0,
      spin: 0,
      spinAxis: new Vector3(0, 1, 0),
      // Спутник на противоположной стороне барицентра: фаза π.
      orbit: binaryOrbit(m2, m1, comp.separation, Math.PI),
    })
  }

  for (const p of def.planets) {
    const planet: BodyEntity = {
      id: ids.next(),
      kind: 'planet',
      name: p.name,
      pos: new Vector3(...p.pos),
      radius: p.radius,
      color: p.color,
      surface: p.type,
      population: p.population,
      spin: p.spin,
      spinAxis: spinAxis(p.tilt),
      orbit: null,
    }
    bodies.push(planet, ...makeMoonBodies(ids, planet, p))
  }

  if (def.station) {
    bodies.push({
      id: ids.next(),
      kind: 'station',
      name: def.station.name,
      pos: new Vector3(...def.station.pos),
      radius: def.station.radius,
      color: 0x9fb3c8,
      surface: null,
      population: 0,
      // Кориолис вращается вокруг продольной оси — так было в оригинале.
      spin: 0.08,
      spinAxis: new Vector3(0, 0, 1),
      orbit: null,
    })
  }
  return bodies
}

/** Патрули системы. Одинаково нужны и при создании мира, и при прыжке в него. */
function makePatrols(rng: Rng, ids: IdSource, def: SystemDef): ShipEntity[] {
  const ships: ShipEntity[] = []
  for (const patrol of def.patrols) {
    for (let i = 0; i < patrol.count; i++) {
      const pos = new Vector3(
        patrol.at[0] + signed(rng) * patrol.spread,
        patrol.at[1] + signed(rng) * patrol.spread * 0.35,
        patrol.at[2] + signed(rng) * patrol.spread,
      )
      const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI * 2)
      const leader = i === 0 && patrol.count > 1

      const ship = makeShip(
        ids,
        patrol.faction,
        `${patrol.name} ${i + 1}`,
        leader ? pirateLeaderLoadout() : pirateLoadout(),
        pos,
        quat,
      )
      ship.ai = createAIState(pos, rng)
      ships.push(ship)
    }
  }
  return ships
}

/**
 * Заселить мир системой. Корабль игрока, кредиты, трюм и очки ПЕРЕЖИВАЮТ смену:
 * прыгает пилот, а не вселенная.
 *
 * Всё эфемерное стирается: трассы, взрывы, ракеты и контейнеры принадлежали
 * покинутой системе. Оставить их — значит привезти чужой бой с собой.
 *
 * `epoch` растёт при каждой смене. Рендер держит меши тел и пояса с момента
 * монтирования, и узнать, что мир под ним подменили, ему больше неоткуда.
 */
export function enterSystem(
  world: World,
  def: SystemDef,
  systemIndex: number,
  /** Куда выйти. По умолчанию — туда, где система велит начинать. */
  start: readonly [number, number, number] = def.playerStart,
): void {
  const rng = makeRng(def.seed)

  world.rng = rng
  world.systemName = def.name
  world.systemIndex = systemIndex
  world.epoch += 1

  world.ships = makePatrols(rng, world.ids, def)
  world.bodies = makeBodies(world.ids, def)
  // Спутник родится в центре своей планеты: место ему даёт время, а не фабрика.
  stepOrbits(world)
  world.asteroids = makeAsteroids(rng, world.ids, def)

  world.pods = []
  world.missiles = []
  world.tracers = []
  world.explosions = []
  world.shockwaves = []
  world.lockedTargetId = null
  world.navTargetId = world.bodies.find((b) => b.kind === 'station')?.id ?? null
  world.trafficTimer = TRAFFIC.FIRST_DELAY

  world.docked = false
  world.dockArmed = true

  // Выходим из прыжка на ходу и с нулём в началe координат: плавающее начало
  // отсчёта считалось от прежней системы, и переносить его сюда бессмысленно.
  const player = world.player
  player.ai = null
  player.state.pos.set(...start)
  player.state.vel.set(0, 0, 0)
  player.state.angVel.set(0, 0, 0)
  aimAt(player, world.bodies.find((b) => b.id === world.navTargetId)?.pos ?? null)
  player.controls.throttle = WORLD.START_THROTTLE
  world.originOffset.set(0, 0, 0)
  world.originShift.set(0, 0, 0)

  maybeShiftOrigin(world)
}

export function createWorld(def: SystemDef = STARTER_SYSTEM): World {
  const rng = makeRng(def.seed)
  const ids = createIdSource()

  const player = makeShip(
    ids,
    'player',
    'Cobra',
    playerStartLoadout(),
    new Vector3(...def.playerStart),
    new Quaternion(),
  )
  // Стартуем на ходу: висеть в пустоте — плохое первое впечатление.
  player.controls.throttle = WORLD.START_THROTTLE

  const ships = makePatrols(rng, ids, def)

  const bodies = makeBodies(ids, def)
  const station = bodies.find((b) => b.kind === 'station')

  const world: World = {
    time: 0,
    player,
    ships,
    asteroids: makeAsteroids(rng, ids, def),
    pods: [],
    missiles: [],
    bodies,
    tracers: [],
    explosions: [],
    shockwaves: [],
    docked: false,
    dockArmed: true,
    lockedTargetId: null,
    navTargetId: station?.id ?? null,
    trafficTimer: TRAFFIC.FIRST_DELAY,
    originOffset: new Vector3(),
    originShift: new Vector3(),
    rng,
    ids,
    systemName: def.name,
    galaxySeed: GALAXY.SEED,
    systemIndex: WORLD.HOME_INDEX,
    epoch: 0,
    credits: WORLD.START_CREDITS,
    score: 0,
  }

  /**
   * Сдвигаем начало координат сразу, ещё до первого шага.
   *
   * Система задана в настоящих метрах: старт лежит в ста пятидесяти миллионах
   * километров от звезды. Пока мир не шагнул (а игра начинается на паузе), эти
   * координаты уходят в рендер как есть, а матрицы инстансов у GPU — float32:
   * на 10¹¹ его шаг составляет километры, и астероидное поле разъезжается ещё
   * до того, как игрок возьмёт управление.
   */
  maybeShiftOrigin(world)
  // Спутники родились в центрах своих планет: место им даёт время, а не фабрика.
  stepOrbits(world)
  return world
}
