import { Quaternion, Vector3 } from 'three'
import { pirateLoadout } from '../../config/loadouts'
import { PLATFORM } from '../../config/platform'
import { DEBRIS } from '../../config/world'
import { signed } from '../../core/math'
import { createAIState } from '../ai/types'
import { COMMODITIES } from '../cargo/items'
import { spawnExplosion } from '../combat/effects'
import { spawnCommodityPods } from '../combat/salvage'
import { makeShip } from './factory'
import type { PlatformEntity, ShipEntity, World } from './entities'

/**
 * Пиратские платформы-гнёзда.
 *
 * Стационарный «авианосец» со спящим звеном на палубе. Живёт своим списком, мимо
 * трафика, но её ядро — цель для луча, а экипаж — обычные пираты, лишь до поры
 * недвижимые (флаг `ai.dormant`).
 *
 * Единый принцип пробуждения: ЗАМАСКИРОВАННЫЙ ИГРОК НЕОБНАРУЖИМ. Открытого будит
 * близость или сигнал тревоги от повреждённого корпуса; под полем не будит ничто —
 * гнездо можно вырезать по одному прямо на палубе, пока платформа не взорвётся.
 */

const _dir = new Vector3()
const _face = new Vector3()
const _slot = new Vector3()
const _still = new Vector3()

/** Единичный вектор в случайную сторону. */
function randomDir(world: World, out: Vector3): Vector3 {
  do {
    out.set(signed(world.rng), signed(world.rng), signed(world.rng))
  } while (out.lengthSq() < 1e-6)
  return out.normalize()
}

/**
 * Родить платформу со спящим экипажем. Появляется поодаль от игрока, в пределах
 * локатора — гнездо надо заметить и подойти. Возвращает пиратов: приложение
 * раздаёт им пилотов (тот же общий `aiController`, он уважает флаг `dormant`).
 */
export function spawnPlatform(world: World): ShipEntity[] {
  const pos = new Vector3().copy(world.player.state.pos).addScaledVector(randomDir(world, _dir), PLATFORM.SPAWN_RANGE)
  // Палубой к игроку: нос платформы (−Z) смотрит на точку старта, силуэт читается сразу.
  _face.copy(world.player.state.pos).sub(pos)
  if (_face.lengthSq() < 1e-6) _face.set(0, 0, -1)
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), _face.normalize())

  const platform: PlatformEntity = {
    id: world.ids.next(),
    kind: 'platform',
    variant: Math.floor(world.rng() * PLATFORM.VARIANTS),
    name: 'Пиратская платформа',
    pos,
    quat,
    radius: PLATFORM.RADIUS,
    extent: PLATFORM.EXTENT,
    spin: 0.02,
    hull: PLATFORM.HULL,
    maxHull: PLATFORM.HULL,
    alive: true,
    wreckAt: null,
    triggered: false,
    crew: [],
  }
  world.platforms.push(platform)

  const count = PLATFORM.CREW_MIN + Math.floor(world.rng() * (PLATFORM.CREW_MAX - PLATFORM.CREW_MIN + 1))
  const born: ShipEntity[] = []
  for (let i = 0; i < count; i++) {
    // Места по кольцу палубы, на выносе DECK_RADIUS — ЗА сферой столкновений ядра,
    // чтобы каждого можно было снять по одному, не задев корпус платформы. Смещение
    // задано в связанных осях платформы и повёрнуто её ориентацией.
    const a = (i / count) * Math.PI * 2
    _slot.set(Math.cos(a) * PLATFORM.DECK_RADIUS, 18, Math.sin(a) * PLATFORM.DECK_RADIUS * 0.45).applyQuaternion(quat)
    const shipPos = new Vector3().copy(pos).add(_slot)

    const ship = makeShip(world.ids, 'hostile', 'Пират', pirateLoadout(), shipPos, quat.clone(), world.rng)
    ship.originKind = 'platform'
    ship.ai = createAIState(pos, world.rng)
    ship.ai.dormant = true
    ship.controls.throttle = 0
    world.ships.push(ship)
    platform.crew.push(ship.id)
    born.push(ship)
  }
  return born
}

/** Поднять гнездо: снять сон со всего живого экипажа. Дальше они — обычные пираты. */
function wakeCrew(world: World, platform: PlatformEntity): void {
  platform.triggered = true
  for (const id of platform.crew) {
    const ship = world.ships.find((s) => s.id === id)
    if (ship?.ai) ship.ai.dormant = false
  }
}

/**
 * Добить спящих в детонации. Проснувшиеся уже слетели с палубы и дерутся своим
 * ходом — их не трогаем; гибнут лишь те, кто остался на борту недвижим.
 */
function destroyDormantCrew(world: World, platform: PlatformEntity): void {
  for (const id of platform.crew) {
    const ship = world.ships.find((s) => s.id === id)
    if (ship?.alive && ship.ai?.dormant) ship.alive = false
  }
}

/** Убрать спящий экипаж вместе с ушедшим за горизонт гнездом: он принадлежал ему. */
function removeDormantCrew(world: World, platform: PlatformEntity): void {
  const doomed = new Set(platform.crew)
  world.ships = world.ships.filter((s) => !(doomed.has(s.id) && s.ai?.dormant))
}

/**
 * Металл с расстрелянной платформы. Взрыв сжигает бо́льшую часть — подбираемого
 * остаётся ровно на несколько трюмов игрока. Считаем от ВМЕСТИМОСТИ игрока в
 * момент гибели: «три трюма» одинаково щедры и для скаута, и для грузовика.
 */
function dropPlatformMetal(world: World, platform: PlatformEntity): void {
  const total = Math.round(PLATFORM.SCRAP_HOLDS * world.player.hold.capacity)
  spawnCommodityPods(world, platform.pos, _still, COMMODITIES.METALS, total, PLATFORM.SCRAP_PODS)
}

/**
 * Шаг платформ. По секундам, раз в кадр — как трафик и киты, не раз в шаг физики.
 * Урон по ядру наносит `fireLasers`; здесь — пробуждение, гибель и уборка.
 */
export function stepPlatforms(world: World, _dt: number): void {
  const player = world.player

  for (const platform of world.platforms) {
    if (!platform.alive) continue

    // Гибель проверяем ПЕРВОЙ. Если ядро уже уничтожено, будить некого: спящие на
    // борту гибнут в детонации, а кто поднялся ранними попаданиями — уже слетел с
    // палубы и уцелел. Иначе тот же шаг, что взрывает платформу, успел бы разбудить
    // экипаж «сигналом тревоги», и добивать в взрыве стало бы некого.
    if (platform.hull <= 0) {
      platform.alive = false
      platform.wreckAt = world.time
      spawnExplosion(world, platform.pos, _still, PLATFORM.EXPLOSION_SCALE)
      destroyDormantCrew(world, platform)
      dropPlatformMetal(world, platform)
      continue
    }

    // Пробуждение — только от ОТКРЫТОГО игрока. Близость гнезда или сигнал тревоги
    // от повреждённого корпуса. Под маскировкой — молчание, спят дальше.
    if (!platform.triggered && player.alive && !player.cloaked) {
      const near = platform.pos.distanceTo(player.state.pos) - platform.radius < PLATFORM.WAKE_RANGE
      const damaged = platform.hull < platform.maxHull
      if (near || damaged) wakeCrew(world, platform)
    }
  }

  despawnPlatforms(world)
}

/**
 * Уборка. Отыгравший взрыв обломок держим короткий срок (как у корабля), затем
 * снимаем. Ушедшее за горизонт нетронутое гнездо убираем вместе со спящими.
 */
function despawnPlatforms(world: World): void {
  const now = world.time
  const limitSq = PLATFORM.DESPAWN_RANGE * PLATFORM.DESPAWN_RANGE

  world.platforms = world.platforms.filter((platform) => {
    if (!platform.alive) return platform.wreckAt !== null && now - platform.wreckAt < DEBRIS.WRECK_LIFE
    if (platform.pos.distanceToSquared(world.player.state.pos) > limitSq) {
      removeDormantCrew(world, platform)
      return false
    }
    return true
  })
}
