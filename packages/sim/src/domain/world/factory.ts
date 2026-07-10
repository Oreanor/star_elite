import { Euler, Quaternion, Vector3 } from 'three'
import { pirateLeaderLoadout, pirateLoadout, playerStartLoadout } from '../../config/loadouts'
import { GALAXY } from '../../config/galaxy'
import { ASTEROID, WORLD } from '../../config/world'
import { makeRng, range, signed, type Rng } from '../../core/math'
import { createAIState } from '../ai/types'
import { cargoMass, createHold } from '../cargo/hold'
import { createCruiseState } from '../cruise/drive'
import { createControls, createShipState } from '../flight/types'
import { deriveShipSpec, isMissile, type Loadout } from '../loadout'
import type {
  AsteroidEntity,
  BodyEntity,
  Faction,
  GunState,
  ShipEntity,
  World,
} from './entities'
import { createIdSource, type IdSource } from './ids'
import { maybeShiftOrigin } from './origin'
import type { SystemDef } from './system'
import { STARTER_SYSTEM } from './system'

/**
 * Сборка мира из описания системы. Всё, что делает место местом, приходит
 * из `SystemDef` — фабрику не нужно трогать, чтобы добавить новую систему.
 */

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
    ammo: isMissile(mount.weapon) ? mount.weapon.ammo : 0,
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
    lastHitAt: -1e9,
    energy: spec.power.capacity,
    ecmCooldown: 0,
    hold,
    guns,
    cruise: createCruiseState(),
    alive: true,
    wreckAt: null,
    ai: null,
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

  // Стволы могли смениться: сохраняем боезапас там, где оружие осталось ракетным.
  e.guns = spec.mounts.map((mount, i) => {
    const prev = e.guns[i]
    return {
      cooldown: 0,
      heat: prev?.heat ?? 0,
      ammo: isMissile(mount.weapon) ? (prev?.ammo ?? mount.weapon.ammo) : 0,
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

/** Ось вращения: вертикаль, наклонённая на `tilt` в плоскости XY. */
function spinAxis(tilt: number): Vector3 {
  return new Vector3(Math.sin(tilt), Math.cos(tilt), 0).normalize()
}

function makeBodies(ids: IdSource, def: SystemDef): BodyEntity[] {
  const bodies: BodyEntity[] = [
    {
      id: ids.next(),
      kind: 'star',
      name: def.name,
      pos: new Vector3(...def.star.pos),
      radius: def.star.radius,
      color: def.star.color,
      surface: null,
      spin: 0,
      spinAxis: new Vector3(0, 1, 0),
    },
  ]

  for (const p of def.planets) {
    bodies.push({
      id: ids.next(),
      kind: 'planet',
      name: p.name,
      pos: new Vector3(...p.pos),
      radius: p.radius,
      color: p.color,
      surface: p.type,
      spin: p.spin,
      spinAxis: spinAxis(p.tilt),
    })
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
      // Кориолис вращается вокруг продольной оси — так было в оригинале.
      spin: 0.08,
      spinAxis: new Vector3(0, 0, 1),
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
export function enterSystem(world: World, def: SystemDef, systemIndex: number): void {
  const rng = makeRng(def.seed)

  world.rng = rng
  world.systemName = def.name
  world.systemIndex = systemIndex
  world.epoch += 1

  world.ships = makePatrols(rng, world.ids, def)
  world.bodies = makeBodies(world.ids, def)
  world.asteroids = makeAsteroids(rng, world.ids, def)

  world.pods = []
  world.missiles = []
  world.tracers = []
  world.explosions = []
  world.lockedTargetId = null
  world.navTargetId = world.bodies.find((b) => b.kind === 'station')?.id ?? null

  world.docked = false
  world.dockArmed = true

  // Выходим из прыжка на ходу и с нулём в началe координат: плавающее начало
  // отсчёта считалось от прежней системы, и переносить его сюда бессмысленно.
  const player = world.player
  player.ai = null
  player.state.pos.set(...def.playerStart)
  player.state.vel.set(0, 0, 0)
  player.state.angVel.set(0, 0, 0)
  player.state.quat.identity()
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
    docked: false,
    dockArmed: true,
    lockedTargetId: null,
    navTargetId: station?.id ?? null,
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
  return world
}
