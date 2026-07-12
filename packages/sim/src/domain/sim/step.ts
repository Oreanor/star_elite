import { Quaternion, Vector3 } from 'three'
import { WARP } from '../../config/ai'
import { CONTACTS } from '../../config/contacts'
import { PHYSICS } from '../../config/physics'
import { BOMB, GUNNERY, SALVAGE } from '../../config/weapons'
import { ASTEROID, DEBRIS, SCORE } from '../../config/world'
import { SHIELD } from '../../config/station'
import {
  applyDamage,
  clearTractorMarks,
  coolGuns,
  expireDrones,
  expirePods,
  fireBomb,
  fireEcm,
  fireLasers,
  fireMissile,
  bounceOffShield,
  isDroneShip,
  launchDrone,
  regenBomb,
  regenEnergy,
  regenShield,
  resolveShipVsSphere,
  scoopAsteroid,
  shatter,
  chargeHyperdrive,
  spawnExplosion,
  spawnShieldFlash,
  spawnWreckage,
  stepCloak,
  stepStarHeat,
  stepMissiles,
  stepBolts,
  toggleCloak,
  tractorPods,
  tryScoop,
} from '../combat'
import { isPhased, updateCruise } from '../cruise/drive'
import { stepShip } from '../flight/model'
import { stepDocking } from '../station/docking'
import type { ShipEntity, World } from '../world/entities'
import { stepOrbits } from '../world/orbits'
import { maybeShiftOrigin } from '../world/origin'
import { markContactLost } from '../world/acquaintance'
import { stepTraffic } from '../world/traffic'
import { stepTitans } from '../world/titans'
import { stepPlatforms } from '../world/platforms'
import { stepGrievances } from '../combat/grievance'
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

    // Спутники расставляются ПЕРВЫМИ: и пилот, и столкновения, и крейсерский
    // потолок должны видеть луну там, где она в это мгновение находится.
    stepOrbits(world)
    stepControllers(world, controllers, dt)
    stepPhysics(world, dt)
    stepWeapons(world, controllers, dt)
    stepAsteroids(world, dt)
    stepMissiles(world, dt)
    // Болты летят и заметают отрезок ПОСЛЕ движения кораблей и ракет этого шага:
    // попадание считается по свежим позициям целей, а не по вчерашним.
    stepBolts(world, dt)
    stepCollisions(world)
    stepBodyCollisions(world)
    stepScooping(world, controllers, dt)
    stepDocking(world)
  }

  cleanup(world)
  // Трафик и киты — раз в кадр и по СЕКУНДАМ, а не по шагам физики: иначе они
  // появлялись бы и двигались вдвое чаще на 120 Гц, чем на 60.
  const frame = Math.min(frameDt, PHYSICS.MAX_FRAME_DT)
  stepTraffic(world, frame)
  stepTitans(world, frame)
  stepPlatforms(world, frame)
  // Претензии за случайные попадания гаснут по секундам, а не по шагам физики.
  stepGrievances(world)
  maybeShiftOrigin(world)
}

/**
 * Все решения принимаются до физики: контроллеры «жмут кнопки» в начале шага.
 * Крейсерский привод считается здесь же — он лишь пишет множитель в controls.
 */
function stepControllers(world: World, controllers: ControllerMap, dt: number): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    // Кинематический борт рулится извне — свой контроллер и крейсер ему не задаём.
    if (ship.kinematic) continue
    const controller = controllerFor(controllers, ship)
    controller.update(ship, world, dt)
    updateCruise(ship, world, controller.wantsCruise?.(ship, world) ?? false, dt)
  }
}

function stepPhysics(world: World, dt: number): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    // Кинематический борт не интегрируем: его позу ставит внешний источник.
    if (ship.kinematic) continue
    stepShip(ship.state, ship.controls, ship.spec.tuning, dt)
    // Нагрев звездой ДО регенерации щита: если корона течёт, `applyDamage`
    // пометит попадание, и щит в этом же шаге восстанавливаться не станет.
    stepStarHeat(ship, world, dt)
    // Зарядка привода — сразу после: она читает свежий `hullHeat` этого шага.
    chargeHyperdrive(ship, dt)
    regenShield(ship, dt, world.time)
  }
}

function stepWeapons(world: World, controllers: ControllerMap, dt: number): void {
  for (const ship of allShips(world)) {
    // Кинематический борт не стреляет и не «остывает» локально: его залпы и
    // состояние приходят извне. Оружие по нему всё равно работает — он цель, не стрелок.
    if (ship.kinematic) continue
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

    // Под маскировкой стволы обычно холодны: вся мощность в поле, и невидимка не
    // бьёт живое без ответа. Единственное исключение — СПЯЩЕЕ гнездо: спящий пират
    // и сама платформа не отвечают, и `castLaser` от замаскированного стрелка
    // засчитывает попадание только по ним. Так гнездо вырезается скрытно, а поле
    // остаётся побегом, а не безнаказанностью: живого бодрствующего под ним не задеть.
    if (ship.cloaked) {
      if (!isPhased(ship) && controller.wantsFire(ship, world)) {
        fireLasers(world, ship, ship.faction !== 'player')
      }
      continue
    }

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
    // Кинематический борт не толкаем: его положение авторитетно из внешнего источника.
    if (ship.kinematic) continue
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

/** Точка контакта корабля с полем станции — для вспышки. Горячий путь, без аллокаций. */
const _shieldContact = /* @__PURE__ */ new Vector3()

/**
 * Столкновение с крупным телом.
 *
 * Планета и звезда не «наносят урон» — они кончают полёт. Считать отскок от
 * шара в шесть тысяч километров, у которого корабль вязнет на скорости в двести
 * метров в секунду, значит моделировать вход в атмосферу, посадку и прочность
 * корпуса. Ничего этого нет, и притворяться незачем: удар о твердь смертелен.
 *
 * Станция — другое дело: врезаться в неё НЕЛЬЗЯ. У поверхности стоит защитное поле,
 * и корабль без допуска отпружинивает от него назад, теряя ход (голубая вспышка, без
 * урона). Пройти внутрь к причалу можно только с допуском (`clearance`) — его даёт
 * автостыковка по L, ведущая корабль коридором колец. Тарану дорога закрыта: слишком
 * быстрый гасит скорость о поле, а стыковка перестала быть следствием «подлетел тихо».
 */
function stepBodyCollisions(world: World): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    // Кинематический борт не толкаем и не убиваем о тела: его положение внешнее.
    if (ship.kinematic) continue
    // Вне фазы: на крейсерском ходу шаг физики длиннее радиуса планеты, и
    // столкновение всё равно не сработало бы. От тел крейсер уводит масс-лок.
    if (isPhased(ship)) continue

    for (const body of world.bodies) {
      if (body.kind === 'station') {
        // Допуск — билет сквозь поле: корабль идёт коридором на стыковку, поле молчит.
        if (ship.clearance) continue
        const shieldR = body.radius * SHIELD.RADIUS_FACTOR
        const reach = shieldR + ship.spec.hull.radius
        if (body.pos.distanceToSquared(ship.state.pos) > reach * reach) continue
        // Вспышка при любом касании поля (`impact >= 0`), но ЯРКОСТЬ — по силе удара:
        // упор тягой еле светится (поле «на месте», но не слепит), таран — в полную силу.
        // `-1` значит контакта не было — тогда молчим.
        const impact = bounceOffShield(ship, body.pos, shieldR, _shieldContact)
        if (impact >= 0) {
          const intensity = Math.max(
            SHIELD.FLASH_MIN_INTENSITY,
            Math.min(1, impact / SHIELD.FLASH_REF_SPEED),
          )
          spawnShieldFlash(world, _shieldContact, body.pos, intensity)
        }
        continue
      }

      const reach = body.radius + ship.spec.hull.radius
      if (body.pos.distanceToSquared(ship.state.pos) > reach * reach) continue

      // Щит от планеты не спасает: он держит лучи и обломки, а не кору.
      ship.shield = 0
      applyDamage(ship, ship.hull, world.time)
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
  if (world.pods.length === 0) return
  const player = world.player

  clearTractorMarks(world)

  if (player.alive && controllerFor(controllers, player).wantsTractor?.(player, world)) {
    tractorPods(world, player, dt)
  }
  if (player.alive) scoopNearby(world, player)

  // Компаньон на поручении СБОРА черпает тем же правилом, что игрок: тяговый луч
  // притягивает, `tryScoop` забирает при касании. Так «собери грузы» и вправду набивает
  // его трюм, а не остаётся словами. Прочие боты груз не трогают — у них нет такой задачи.
  for (const ship of world.ships) {
    if (!ship.alive || ship.ai?.tasks[0]?.kind !== 'collect-cargo') continue
    tractorPods(world, ship, dt)
    scoopNearby(world, ship)
  }
}

/** Забрать все контейнеры в радиусе подбора корабля. Общее правило для игрока и бота. */
function scoopNearby(world: World, ship: ShipEntity): void {
  for (const pod of world.pods) {
    if (!pod.alive) continue
    if (pod.pos.distanceToSquared(ship.state.pos) > (SALVAGE.SCOOP_RADIUS + ship.spec.hull.radius) ** 2) continue
    tryScoop(ship, pod)
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
  world.warps = world.warps.filter((w) => now - w.born < WARP.FLASH_LIFE)
  world.shieldFlashes = world.shieldFlashes.filter((f) => now - f.born < SHIELD.FLASH_LIFE)
  // Вести о пропавших знакомых гаснут сами, как трассеры: HUD показал — и хватит.
  world.notices = world.notices.filter((n) => now - n.at < CONTACTS.NOTICE_LIFE)

  for (const ship of world.ships) {
    if (ship.alive || ship.wreckAt !== null) continue
    // Момент гибели: взрыв и трофеи — ровно один раз.
    ship.wreckAt = now

    // Знакомый погиб у тебя на глазах: пилот — не корабль, но этот пилот больше не
    // пересядет. Метим запись мёртвой и шлём весть — иначе он бы «воскрес» в трафике.
    if (ship.acquaintanceId != null) {
      const record = world.acquaintances.find((a) => a.id === ship.acquaintanceId)
      if (record) markContactLost(world, record)
    }

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

  // Обломок держим, пока взрыв не отыграет. Ушедшего прыжком снимаем молча: он не
  // погиб (alive всё ещё true, взрыва не было) — его просто больше нет в системе.
  world.ships = world.ships.filter(
    (s) => !s.warpedOut && (s.alive || (s.wreckAt !== null && now - s.wreckAt < DEBRIS.WRECK_LIFE)),
  )

  // Убитый камень уже раскололся в `damageAsteroid` — здесь только выметаем мёртвых.
  // Второе место, гасящее астероид по прочности, однажды забыло бы про осколки.
  world.asteroids = world.asteroids.filter((a) => a.alive)

  expirePods(world)

  // Захваченная цель могла погибнуть — снимаем захват, а не показываем рамку в пустоте.
  if (world.lockedTargetId !== null && !world.ships.some((s) => s.id === world.lockedTargetId && s.alive)) {
    world.lockedTargetId = null
  }
}
