import { Quaternion, Vector3 } from 'three'
import { PHYSICS } from '../../config/physics'
import { BOMB, GUNNERY, SALVAGE } from '../../config/weapons'
import { ASTEROID, DEBRIS, SCORE } from '../../config/world'
import {
  clearTractorMarks,
  coolGuns,
  expireDrones,
  expirePods,
  fireBomb,
  fireEcm,
  fireLasers,
  fireMissile,
  isDroneShip,
  launchDrone,
  regenBomb,
  regenEnergy,
  regenShield,
  resolveShipVsSphere,
  scoopAsteroid,
  shatter,
  spawnExplosion,
  spawnWreckage,
  stepCloak,
  stepMissiles,
  toggleCloak,
  tractorPods,
  tryScoop,
} from '../combat'
import { isPhased, updateCruise } from '../cruise/drive'
import { stepShip } from '../flight/model'
import { stepDocking } from '../station/docking'
import type { ShipEntity, World } from '../world/entities'
import { maybeShiftOrigin } from '../world/origin'
import { stepTraffic } from '../world/traffic'
import { NULL_CONTROLLER, type ControllerMap } from './controller'

/**
 * Шаг мира. Симуляция не знает, кто управляет кораблём: она спрашивает Controller.
 * Поэтому здесь нет ни импорта ИИ, ни импорта ввода.
 *
 * Шаг фиксированный: иначе поведение корабля зависит от герцовки монитора,
 * а синхронизация по сети становится невозможной в принципе.
 */

const _tmpAxis = new Vector3()
const _tmpQuat = new Quaternion()

function allShips(world: World): ShipEntity[] {
  return world.player.alive ? [world.player, ...world.ships] : world.ships
}

function controllerFor(controllers: ControllerMap, ship: ShipEntity) {
  return controllers.get(ship.id) ?? NULL_CONTROLLER
}

export function stepWorld(world: World, frameDt: number, controllers: ControllerMap): void {
  // В доке мир стоит. Иначе пираты за окном магазина продолжают охоту,
  // а игрок за стеклом ничего не может сделать.
  if (world.docked) {
    world.originShift.set(0, 0, 0)
    return
  }

  // Накопитель ограничен сверху: свёрнутая вкладка не должна телепортировать мир.
  let remaining = Math.min(frameDt, PHYSICS.MAX_FRAME_DT)

  while (remaining > 0) {
    const dt = Math.min(PHYSICS.FIXED_DT, remaining)
    remaining -= dt
    world.time += dt

    stepControllers(world, controllers, dt)
    stepPhysics(world, dt)
    stepWeapons(world, controllers, dt)
    stepAsteroids(world, dt)
    stepMissiles(world, dt)
    stepCollisions(world)
    stepScooping(world, controllers, dt)
    stepDocking(world)
  }

  cleanup(world)
  // Трафик — раз в кадр и по СЕКУНДАМ, а не по шагам физики: иначе торговцы
  // вылетали бы вдвое чаще на 120 Гц, чем на 60.
  stepTraffic(world, Math.min(frameDt, PHYSICS.MAX_FRAME_DT))
  maybeShiftOrigin(world)
}

/**
 * Все решения принимаются до физики: контроллеры «жмут кнопки» в начале шага.
 * Крейсерский привод считается здесь же — он лишь пишет множитель в controls.
 */
function stepControllers(world: World, controllers: ControllerMap, dt: number): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    const controller = controllerFor(controllers, ship)
    controller.update(ship, world, dt)
    updateCruise(ship, world, controller.wantsCruise?.(ship, world) ?? false, dt)
  }
}

function stepPhysics(world: World, dt: number): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    stepShip(ship.state, ship.controls, ship.spec.tuning, dt)
    regenShield(ship, dt, world.time)
  }
}

function stepWeapons(world: World, controllers: ControllerMap, dt: number): void {
  for (const ship of allShips(world)) {
    coolGuns(ship, dt)
    regenEnergy(ship, dt)
    // После щита: `regenShield` уже отработал в этом шаге, в `stepPhysics`.
    regenBomb(ship, dt)
    if (!ship.alive) continue

    const controller = controllerFor(controllers, ship)

    // Одна клавиша поднимает поле и она же опускает. Расход считается ПОСЛЕ
    // `regenEnergy`: иначе поле питалось бы восполнением того же шага.
    if (controller.wantsCloak?.(ship, world)) toggleCloak(ship)
    stepCloak(ship, dt)

    // ПРО работает и на крейсерском ходу, и под полем: ракета уже летит, а
    // импульс никого не убивает — он лишь снимает то, что летит в тебя.
    if (controller.wantsEcm?.(ship, world)) fireEcm(world, ship)

    // Под маскировкой не стреляют: излучатели обесточены, вся мощность в поле.
    // Иначе невидимка бьёт без ответа, и поле перестаёт быть побегом.
    if (ship.cloaked) continue

    if (controller.wantsBomb?.(ship, world)) fireBomb(world, ship)
    if (controller.wantsDrone?.(ship, world)) launchDrone(world, ship)

    // На крейсерском ходу корабль вне фазы: лазер с относительной скоростью
    // 20 км/с — не оружие, а недоразумение.
    if (isPhased(ship)) continue

    const hostile = ship.faction !== 'player'
    if (controller.wantsFire(ship, world)) fireLasers(world, ship, hostile)

    if (controller.wantsMissile?.(ship, world)) {
      const target = ship === world.player ? world.lockedTargetId : world.player.id
      fireMissile(world, ship, target)
    }
  }
}

function stepAsteroids(world: World, dt: number): void {
  for (const a of world.asteroids) {
    if (!a.alive) continue
    a.pos.addScaledVector(a.vel, dt)

    const angle = a.spin.length() * dt
    if (angle > 1e-9) {
      _tmpAxis.copy(a.spin).normalize()
      a.quat.multiply(_tmpQuat.setFromAxisAngle(_tmpAxis, angle)).normalize()
    }
  }

  for (const pod of world.pods) {
    if (!pod.alive) continue
    pod.pos.addScaledVector(pod.vel, dt)

    const angle = pod.spin.length() * dt
    if (angle > 1e-9) {
      _tmpAxis.copy(pod.spin).normalize()
      pod.quat.multiply(_tmpQuat.setFromAxisAngle(_tmpAxis, angle)).normalize()
    }
  }
}

function stepCollisions(world: World): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    // Вне фазы: на 20 км/с шаг физики — 165 м, больше любого астероида.
    // Столкновение всё равно не сработало бы — корабль пролетел бы насквозь.
    if (isPhased(ship)) continue

    for (const a of world.asteroids) {
      if (!a.alive) continue
      const reach = a.radius + ship.spec.hull.radius
      if (a.pos.distanceToSquared(ship.state.pos) > reach * reach) continue

      // Мелкий камень уходит в трюм — если там есть место. Тогда удара не было вовсе.
      // Черпает только игрок: боту руда не нужна, а корёжить его о камни — нужно.
      if (ship === world.player && scoopAsteroid(ship, a)) continue

      // Астероид на порядок тяжелее: он почти не сдвигается, корабль отлетает.
      const impact = resolveShipVsSphere(
        ship, a.pos, a.vel, a.radius, a.radius * ASTEROID.MASS_PER_RADIUS, world.time,
      )

      /**
       * Настоящий удар колет камень. Касание — нет.
       *
       * Без порога пояс рассыпался бы в пыль от одного медленного прохода:
       * осколки рождаются вплотную к корпусу, тут же снова касаются его и колются
       * дальше. Порог по УРОНУ, а не по скорости: он уже учитывает и массу, и
       * угол, под которым корабль пришёл.
       */
      if (impact >= ASTEROID.SHATTER_DAMAGE) shatter(world, a)
    }
  }
}

/**
 * Луч и подбор. Луч только сводит контейнер с кораблём; забирает его то же
 * правило, что работает и без луча, — иначе способов попасть в трюм стало бы два.
 *
 * Луч спрашивается у Controller, как стрельба: симуляция не знает про клавишу C.
 */
function stepScooping(world: World, controllers: ControllerMap, dt: number): void {
  const player = world.player
  if (!player.alive || world.pods.length === 0) return

  clearTractorMarks(world)
  if (controllerFor(controllers, player).wantsTractor?.(player, world)) {
    tractorPods(world, player, dt)
  }

  for (const pod of world.pods) {
    if (!pod.alive) continue
    if (pod.pos.distanceToSquared(player.state.pos) > (SALVAGE.SCOOP_RADIUS + player.spec.hull.radius) ** 2) continue
    tryScoop(player, pod)
  }
}

/** Уборка эфемерного — раз в кадр, а не раз в шаг физики. */
function cleanup(world: World): void {
  const now = world.time

  // Срок жизни беспилотника задан в СЕКУНДАХ, поэтому истекает раз в кадр,
  // а не раз в шаг физики: от герцовки он зависеть не должен.
  expireDrones(world)

  world.tracers = world.tracers.filter((t) => now - t.born < GUNNERY.TRACER_LIFE)
  world.explosions = world.explosions.filter((e) => now - e.born < DEBRIS.EXPLOSION_LIFE)
  world.shockwaves = world.shockwaves.filter((w) => now - w.born < BOMB.WAVE_LIFE)

  for (const ship of world.ships) {
    if (ship.alive || ship.wreckAt !== null) continue
    // Момент гибели: взрыв и трофеи — ровно один раз.
    ship.wreckAt = now

    // Беспилотник — расходник: ни взрыва корабельного калибра, ни трофеев.
    // Иначе рой из четырёх аппаратов засыпал бы систему контейнерами с их же
    // двигателями, и «прикрытие» превратилось бы в станок для печати денег.
    if (isDroneShip(ship)) continue

    spawnExplosion(world, ship.state.pos, ship.state.vel, DEBRIS.SHIP_EXPLOSION_SCALE)
    spawnWreckage(world, ship)
    if (ship.faction === 'hostile') {
      world.score += SCORE.HOSTILE_KILL
      // Награда начисляется за ГИБЕЛЬ, а не за попадание: добить чужой обломок нельзя.
      world.credits += SCORE.HOSTILE_BOUNTY
    }
  }

  // Обломок держим, пока взрыв не отыграет.
  world.ships = world.ships.filter((s) => s.alive || (s.wreckAt !== null && now - s.wreckAt < DEBRIS.WRECK_LIFE))

  // Убитый камень уже раскололся в `damageAsteroid` — здесь только выметаем мёртвых.
  // Второе место, гасящее астероид по прочности, однажды забыло бы про осколки.
  world.asteroids = world.asteroids.filter((a) => a.alive)

  expirePods(world)

  // Захваченная цель могла погибнуть — снимаем захват, а не показываем рамку в пустоте.
  if (world.lockedTargetId !== null && !world.ships.some((s) => s.id === world.lockedTargetId && s.alive)) {
    world.lockedTargetId = null
  }
}
