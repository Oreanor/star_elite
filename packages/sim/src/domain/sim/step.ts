import { Quaternion, Vector3 } from 'three'
import { WARP } from '../../config/ai'
import { WARBASE } from '../../config/warbase'
import { CONTACTS } from '../../config/contacts'
import { PHYSICS } from '../../config/physics'
import { TIME } from '../../config/time'
import { raySphere } from '../../core/math'
import { retain } from '../../core/list'
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
  bounceOffSolid,
  isDroneShip,
  launchDrone,
  regenAux,
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
  stepWarBaseTurrets,
  stepWarBaseWrecks,
  warBaseWreckDone,
  surviveLethal,
  toggleCloak,
  tractorPods,
  tryScoop,
} from '../combat'
import { isPhased, updateCruise } from '../cruise/drive'
import { hasBomb, hasEcm } from '../loadout'
import { MIELOPHONE } from '../../config/mielophone'
import { effectiveRadius, stepScale } from '../scale/scale'
import { stepGravity } from '../flight/gravity'
import { stepJumpGateCollision } from '../flight/jumpGate'
import {
  findLandable,
  isLandableAsteroid,
  landOnSurface,
  landShip,
  meshSolidRadius,
  warBaseSolidRadius,
  stepAutoland,
  stepLanding,
} from '../flight/landing'
import { stepShip } from '../flight/model'
import { stepDocking } from '../station/docking'
import type { CrashHit, ShipEntity, WarBaseEntity, World } from '../world/entities'
import {
  canAttractFigurine,
  figurineDisplayName,
  scoopFigurinesNear,
  tractorFigurines,
} from '../world/figurines'
import {
  isNavBeltAsteroid,
  MONOLITH_NAMES,
  pruneGiantScaleLocks,
} from '../world/queries'
import { findWarBaseFixture, warBaseFixtureWorldPos } from '../world/warBase'
import { stepOrbits } from '../world/orbits'
import { maybeShiftOrigin } from '../world/origin'
import { beginTrailTick, endTrailFrame, snapMovedTrails } from '../world/poseTrail'
import { markContactLost } from '../world/acquaintance'
import { stepWarpEmergence } from '../world/warp'
import { stepDivineScale, stepDockTraffic, stepTraffic } from '../world/traffic'
import { stepTitans } from '../world/titans'
import { stepPlatforms } from '../world/platforms'
import { stepGrievances } from '../combat/grievance'
import { NULL_CONTROLLER, type Controller, type ControllerMap } from './controller'

/**
 * Шаг мира. Симуляция не знает, кто управляет кораблём: она спрашивает Controller.
 * Поэтому здесь нет ни импорта ИИ, ни импорта ввода.
 *
 * Шаг фиксированный: иначе поведение корабля зависит от герцовки монитора,
 * а синхронизация по сети становится невозможной в принципе.
 */

const _tmpAxis = new Vector3()
const _tmpQuat = new Quaternion()

// Переиспользуемый буфер: `allShips` зовётся 5 раз за шаг физики, и спред
// `[player, ...ships]` каждый раз плодил массив на выброс. Вызовы ПОСЛЕДОВАТЕЛЬНЫ и
// не вложены (внутри цикла по allShips никто снова allShips не зовёт), поэтому один
// общий буфер безопасен: следующий вызов перезаписывает предыдущий, уже отработавший.
const _allShips: ShipEntity[] = []

function allShips(world: World): ShipEntity[] {
  _allShips.length = 0
  if (world.player.alive) _allShips.push(world.player)
  for (const s of world.ships) _allShips.push(s)
  return _allShips
}

/**
 * Кто за штурвалом в этом шаге: назначенные пилоты и пилот «по умолчанию» для борта, у
 * которого назначения нет. Борт, родившийся в такте (трафик), до следующего кадра в карте
 * не значится — без пилота по умолчанию он летел бы несколько тактов без управления.
 * Кто этот пилот, решает вызывающий: домен не импортирует ИИ (см. `Controller`).
 */
interface Helm {
  assigned: ControllerMap
  unassigned: Controller
}
// Один на модуль: stepWorld не вложен, а объект на каждый кадр — мусор.
const _helm: Helm = { assigned: new Map(), unassigned: NULL_CONTROLLER }

function controllerFor(helm: Helm, ship: ShipEntity): Controller {
  return helm.assigned.get(ship.id) ?? helm.unassigned
}

/**
 * Свой такт для систем, что живут ВНЕ домена, но обязаны идти по его часам (полёт сквозь
 * гипертор в клиенте). Домен не знает, что это: он лишь зовёт хук в конце каждого такта,
 * как зовёт `Controller`, — иначе такая система шагала бы кадром, на вторых часах.
 */
export type TickHook = (dt: number) => void

export interface StepOptions {
  /** Хук в конце каждого такта (см. `TickHook`). */
  onTick?: TickHook
  /** Пилот для борта без назначения в `controllers` — обычно ИИ. Нет — борт без управления. */
  unassigned?: Controller
}

export function stepWorld(world: World, frameDt: number, controllers: ControllerMap, options: StepOptions = {}): void {
  const { onTick } = options
  _helm.assigned = controllers
  _helm.unassigned = options.unassigned ?? NULL_CONTROLLER
  const helm = _helm
  // В доке мир стоит. Иначе пираты за окном магазина продолжают охоту,
  // а игрок за стеклом ничего не может сделать. Живёт только причал — теми же тактами,
  // что и полёт: это те же часы, а не отдельный таймер экрана станции.
  if (world.docked) {
    world.originShift.set(0, 0, 0)
    const ticks = takeTicks(world, frameDt)
    for (let i = 0; i < ticks; i++) {
      advanceCalendar(world, PHYSICS.FIXED_DT)
      stepDockTraffic(world, PHYSICS.FIXED_DT)
    }
    return
  }

  // `originShift` — суммарный сдвиг игрока за кадр, который камера обязана повторить
  // (она в мировых координатах). Копится из ДВУХ источников, оба двигают игрока НЕ его
  // скоростью: орбитальное наследование в `stepOrbits` (система отсчёта станции, десятки
  // км/с) и перецентровка плавающего начала в `maybeShiftOrigin`. Обнуляем в начале кадра,
  // дальше оба только прибавляют.
  world.originShift.set(0, 0, 0)

  // Переставленное снаружи с прошлого кадра (прыжок, отчаливание) — без протяжки следа.
  snapMovedTrails(world)

  const ticks = takeTicks(world, frameDt)
  for (let i = 0; i < ticks; i++) {
    beginTrailTick(world)
    world.time += PHYSICS.FIXED_DT
    stepTick(world, helm, PHYSICS.FIXED_DT)
    onTick?.(PHYSICS.FIXED_DT)
  }
  endTrailFrame(world)
}

/** Урон, присланный по сети между тактами, — ложится здесь, в такте (см. `incomingHits`). */
function applyIncomingHits(world: World): void {
  if (world.incomingHits.length === 0) return
  for (const damage of world.incomingHits) {
    if (world.player.alive) applyDamage(world.player, damage, world.time)
  }
  world.incomingHits.length = 0
}

/**
 * Календарь мира идёт тактами (+dt), а не прыгает раз в кадр на показание часов: орбиты от
 * него, и шаг орбит обязан быть шагом такта. От общих часов (`calendarClock`) он не уходит —
 * малое расхождение гасится плавно, большое (пауза, вход) — сразу.
 */
function advanceCalendar(world: World, dt: number): void {
  // Общих часов нет — календарю не от чего идти (см. `calendarClock`).
  if (Number.isNaN(world.calendarClock)) return
  const drift = world.calendarClock - world.calendarTime
  if (Math.abs(drift) > TIME.SYNC_SNAP) {
    world.calendarTime = world.calendarClock
    return
  }
  world.calendarTime += dt + drift * Math.min(1, dt / TIME.SYNC_SLEW)
}

/**
 * НАКОПИТЕЛЬ: сколько целых тактов отыграть за этот кадр. Остаток не досчитывается
 * укороченным тактом, а ждёт следующего кадра (`stepCarry`): такт всегда ровно `FIXED_DT`,
 * и физика не зависит от герцовки. Что недошагали — догоняет рендер, показывая тела между
 * тактами (`renderAlpha`, см. `poseTrail`).
 *
 * Сверху кадр ограничен: свёрнутая вкладка не должна телепортировать мир.
 */
function takeTicks(world: World, frameDt: number): number {
  const available = world.stepCarry + Math.min(frameDt, PHYSICS.MAX_FRAME_DT)
  // Крошечный допуск: 1/60 = 2·(1/120) в плавающей точке иногда даёт 1.9999…, и целый
  // такт уезжал бы в следующий кадр, а кадр 60 Гц делал бы то один, то три такта.
  const ticks = Math.floor(available / PHYSICS.FIXED_DT + 1e-9)
  world.stepCarry = Math.max(0, available - ticks * PHYSICS.FIXED_DT)
  world.renderAlpha = Math.min(1, world.stepCarry / PHYSICS.FIXED_DT)
  return ticks
}

/**
 * ОДИН ТАКТ мира. Всё, что меняет состояние игры, живёт здесь — и физика, и «сценарий»:
 * трафик, киты, турели, обиды, уборка мёртвых.
 *
 * Раньше сценарий шёл раз в КАДР с кадровым `dt` — «чтобы не зависеть от герцовки». Но
 * таймер в секундах, убывающий на `dt` такта, от герцовки не зависит и так, а кадровый шаг
 * как раз зависел: число бросков `world.rng` в секунду росло с частотой монитора, и одно
 * зерно давало разный мир на 60 и на 144 Гц. Порядок тоже плыл: погибший корабль
 * числился живым до конца кадра, турель стреляла с точностью до кадра, а не такта.
 * Один такт — одни часы на весь мир, поэтому ничего «раз в кадр» в домене нет.
 */
function stepTick(world: World, helm: Helm, dt: number): void {
  // Календарь — первым: орбиты в этом такте встают на его новое показание.
  advanceCalendar(world, dt)
  applyIncomingHits(world)
  // Выход из прыжка двигает корабли до всего остального: этот такт их уже видит на месте.
  stepWarpEmergence(world, dt)
  // Спутники расставляются ПЕРВЫМИ: и пилот, и столкновения, и крейсерский
  // потолок должны видеть луну там, где она в это мгновение находится.
  stepOrbits(world)
  stepControllers(world, helm, dt)
  stepPhysics(world, dt)
  stepWeapons(world, helm, dt)
  stepAsteroids(world, dt)
  stepMissiles(world, dt)
  // Болты летят и заметают отрезок ПОСЛЕ движения кораблей и ракет этого шага:
  // попадание считается по свежим позициям целей, а не по вчерашним.
  stepBolts(world, dt)
  stepCollisions(world, dt)
  for (const gate of world.jumpGates) stepJumpGateCollision(world.player, gate)
  stepBodyCollisions(world, dt)
  stepScooping(world, helm, dt)
  stepDocking(world)

  cleanup(world)
  stepTraffic(world, dt)
  // Бог, идущий к причалу, ужимается до обычного борта: масштаб — свойство облика.
  stepDivineScale(world, dt)
  stepTitans(world, dt)
  stepPlatforms(world, dt)
  stepWarBaseTurrets(world, dt)
  stepGrievances(world)
  maybeShiftOrigin(world)
}

/**
 * Все решения принимаются до физики: контроллеры «жмут кнопки» в начале шага.
 * Крейсерский привод считается здесь же — он лишь пишет множитель в controls.
 */
function stepControllers(world: World, helm: Helm, dt: number): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    // Кинематический борт рулится извне — свой контроллер и крейсер ему не задаём.
    if (ship.kinematic) continue
    if (ship.warpEmerging || ship.warpDeparting) continue
    const controller = controllerFor(helm, ship)
    controller.update(ship, world, dt)
    updateCruise(ship, world, controller.wantsCruise?.(ship, world) ?? false, dt)
  }
}

function stepPhysics(world: World, dt: number): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    // Кинематический борт не интегрируем: его позу ставит внешний источник.
    if (ship.kinematic) continue
    if (ship.warpEmerging || ship.warpDeparting) continue
    if (stepAutoland(ship, world, dt)) {
      // Непрерываемая автопосадка ведёт корабль вниз сама: ни гравитации, ни интегратора.
    } else if (!stepLanding(ship, world, dt)) {
      stepGravity(ship, world, dt)
      stepShip(ship.state, ship.controls, ship.spec.tuning, dt)
      // Миелофон: рост/усадка масштаба от сигнала. До столкновений — они считаются по
      // свежему размеру этого шага.
      stepScale(ship, dt, world)
    }
    // Нагрев звездой ДО регенерации щита: если корона течёт, `applyDamage`
    // пометит попадание, и щит в этом же шаге восстанавливаться не станет.
    stepStarHeat(ship, world, dt)
    // Зарядка привода — сразу после: она читает свежий `hullHeat` этого шага.
    chargeHyperdrive(ship, dt)
    regenShield(ship, dt, world.time)
  }
}

function stepWeapons(world: World, helm: Helm, dt: number): void {
  // Струи непрерывных лучей — срез ЭТОГО шага, а не эффект с временем жизни: держат
  // гашетку — список наполнится заново, отпустили — он пуст, и луч гаснет сам собой.
  world.beams.length = 0
  for (const ship of allShips(world)) {
    // Кинематический борт не стреляет и не «остывает» локально: его залпы и
    // состояние приходят извне. Оружие по нему всё равно работает — он цель, не стрелок.
    if (ship.kinematic) continue
    coolGuns(ship, world.time, dt)
    regenEnergy(ship, dt)
    // Батарея доп-отсека (аукс) копится своим пулом — для бомбы, ПРО и маскировки.
    regenAux(ship, dt)
    if (!ship.alive) continue

    const controller = controllerFor(helm, ship)

    // Одна клавиша поднимает поле и она же опускает. Расход считается ПОСЛЕ
    // `regenEnergy`: иначе поле питалось бы восполнением того же шага.
    if (controller.wantsCloak?.(ship, world)) toggleCloak(ship)
    stepCloak(ship, dt)

    // ПРО работает и на крейсерском ходу, и под полем: ракета уже летит, а
    // импульс никого не убивает — он лишь снимает то, что летит в тебя.
    // Способность гейтится модулем — для всех, и игрока, и ИИ (принцип «неотличимы»):
    // без установленного РЭБ импульса нет, хоть контроллер и просит.
    if (controller.wantsEcm?.(ship, world) && hasEcm(ship.loadout)) fireEcm(world, ship)

    // Под маскировкой стволы обычно холодны: вся мощность в поле, и невидимка не
    // бьёт живое без ответа. Единственное исключение — СПЯЩЕЕ гнездо: спящий пират
    // и сама платформа не отвечают, и `castLaser` от замаскированного стрелка
    // засчитывает попадание только по ним. Так гнездо вырезается скрытно, а поле
    // остаётся побегом, а не безнаказанностью: живого бодрствующего под ним не задеть.
    if (ship.cloaked) {
      if (!isPhased(ship) && controller.wantsFire(ship, world)) {
        fireLasers(world, ship, ship.faction !== 'player', dt)
      }
      continue
    }

    if (controller.wantsBomb?.(ship, world) && hasBomb(ship.loadout)) fireBomb(world, ship)

    // На крейсерском ходу корабль вне фазы: лазер с относительной скоростью
    // 20 км/с — не оружие, а недоразумение.
    if (isPhased(ship)) continue

    const hostile = ship.faction !== 'player'
    if (controller.wantsFire(ship, world)) fireLasers(world, ship, hostile, dt)

    // Пилон: экипирован один тип за раз — обычная ракета или дрон-ракета. Одна клавиша.
    if (controller.wantsMissile?.(ship, world)) {
      // Камень — цель, если борта в захвате нет: ракета дробит его как бомба.
      const target =
        ship === world.player
          ? (world.lockedTargetId ?? world.lockedAsteroidId)
          : world.player.id
      if (!fireMissile(world, ship, target)) launchDrone(world, ship)
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

/** Игроку — штамп и цель для жёлтого «КРУШЕНИЕ» (HUD держит плашку, пока толкаем). */
function noteCrash(world: World, ship: ShipEntity, hit: CrashHit): void {
  if (ship !== world.player) return
  ship.lastCrashAt = world.time
  ship.lastCrashHit = hit
}

/** Неуправляемый удар о твердь: отскок без урона + пуш игроку. */
function crashBounce(
  world: World,
  ship: ShipEntity,
  center: Vector3,
  radius: number,
  dt: number,
  hit: CrashHit,
): void {
  bounceOffSolid(ship, center, radius, dt)
  noteCrash(world, ship, hit)
}

function stepCollisions(world: World, dt: number): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    // Кинематический борт не толкаем: его положение авторитетно из внешнего источника.
    if (ship.kinematic) continue
    // С GHOST_BODY весь пояс сквозной (как планеты). Ниже при росте — только нав-гиганты.
    if (ship.state.scale >= MIELOPHONE.GHOST_BODY_SCALE) continue
    const grown = ship.state.scale > 1

    for (const a of world.asteroids) {
      if (!a.alive) continue
      // Вырос — мелочь пояса сквозная; твердь только у Shift+Tab-гиганта.
      if (grown && !isNavBeltAsteroid(a)) continue
      // Крупный камень твёрдый и в крейсере. Мелочь на сверхсвете не ловим:
      // шаг больше камня, и ловить незачем.
      const landable = isLandableAsteroid(a, ship)
      if (isPhased(ship) && !landable) continue
      // Посадочная глыба: твердь ближе к текстуре, чем bounding sphere меша.
      const hitR = landable ? meshSolidRadius(a.radius) : a.radius
      if (!hitsBodySphere(ship, a.pos, hitR, dt)) continue

      // Уже на ховере над этим камнем — сфера сама держит высоту.
      if (ship.landedOn?.bodyId === a.id) continue
      // Автозаход дошёл до тверди раньше HOVER — включаем стоянку.
      if (ship.autoland === a.id) {
        const surface = findLandable(world, a.id, ship)
        if (surface) landOnSurface(ship, surface)
        ship.autoland = null
        continue
      }

      // Посадочная глыба — отскок без урона (как статуя), не таран с расколом.
      if (landable) {
        crashBounce(world, ship, a.pos, hitR, dt, { kind: 'asteroid', name: '' })
        continue
      }

      // Мелкий камень уходит в трюм — если там есть место. Тогда удара не было вовсе.
      // Черпает только игрок: боту руда не нужна, а корёжить его о камни — нужно.
      if (ship === world.player && scoopAsteroid(ship, a)) continue

      // Астероид на порядок тяжелее: он почти не сдвигается, корабль отлетает.
      const impact = resolveShipVsSphere(
        ship, a.pos, a.vel, a.radius, a.radius * ASTEROID.MASS_PER_RADIUS, world.time,
      )
      // Пуш и при росте (миелофон): урон гиганту не идёт, но «не разбивает» должно быть видно.
      noteCrash(world, ship, { kind: 'asteroid', name: '' })

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

const _fixtureAt = /* @__PURE__ */ new Vector3()

/**
 * Навесные детали базы — ТВЕРДЬ, как и её шар.
 *
 * Башня трёхкилометровой базы — шестьсот метров, пушки — по полторы-три сотни, и все они
 * торчат над обшивкой. Твёрдым был только шар, и корабль влетал в деталь насквозь: камера
 * внутри башни, а до «поверхности» и до посадки ещё полкилометра. Деталь — неровный меш,
 * нормированный в единичную сферу, поэтому твердь берётся тем же правилом, что у глыб
 * (`meshSolidRadius`), а не по описанной сфере.
 *
 * Проверяется и над поверхностью (в ховере): эшелон в двадцать метров ниже любой башни.
 */
function bounceOffFixtures(world: World, ship: ShipEntity, base: WarBaseEntity, dt: number): boolean {
  // Дешёвая отбраковка: самая высокая деталь (башня) не выходит за полтора радиуса базы.
  const reach = base.radius * (1 + 2 * WARBASE.TOWER_SIZE) + effectiveRadius(ship)
  if (base.pos.distanceToSquared(ship.state.pos) > reach * reach) return false
  for (const fix of base.fixtures) {
    if (!fix.alive) continue
    warBaseFixtureWorldPos(base, fix, world.time, _fixtureAt)
    const solid = meshSolidRadius(fix.size)
    if (!hitsBodySphere(ship, _fixtureAt, solid, dt)) continue
    crashBounce(world, ship, _fixtureAt, solid, dt, { kind: 'warbase', name: '' })
    return true
  }
  return false
}

/** Точка контакта корабля с полем станции — для вспышки. Горячий путь, без аллокаций. */
const _shieldContact = /* @__PURE__ */ new Vector3()
const _bodyPrev = /* @__PURE__ */ new Vector3()
const _bodyDir = /* @__PURE__ */ new Vector3()

/**
 * Касание сферы за шаг: точка сейчас ИЛИ отрезок «где был → где стал».
 *
 * На полном крейсере шаг — десятки тысяч км; точечная проверка пропускает целую
 * планету между кадрами. Заметание закрывает туннель: поверхность остаётся твёрдой
 * и на сверхсвете.
 */
function hitsBodySphere(
  ship: ShipEntity,
  center: Vector3,
  radius: number,
  dt: number,
): boolean {
  const reach = radius + effectiveRadius(ship)
  if (center.distanceToSquared(ship.state.pos) <= reach * reach) return true

  const speed = ship.state.vel.length()
  if (speed * dt < 1e-6) return false

  // Где были в начале шага (интегратор уже сдвинул pos).
  _bodyPrev.copy(ship.state.pos).addScaledVector(ship.state.vel, -dt)
  _bodyDir.copy(ship.state.pos).sub(_bodyPrev)
  const span = _bodyDir.length()
  if (span < 1e-9) return false
  _bodyDir.multiplyScalar(1 / span)
  const t = raySphere(_bodyPrev, _bodyDir, center, reach)
  return t >= 0 && t <= span
}

/**
 * Столкновение с крупным телом.
 *
 * Планета и луна — твёрдая кора: даже в крейсере (иначе на 29c пролетаешь насквозь
 * между шагами). Неуправляемый контакт — отскок без урона; сесть — только по L.
 * Звезда сжигает без отскока, чёрная дыра сферы не имеет.
 *
 * Станция — другое дело: врезаться в неё НЕЛЬЗЯ. У поверхности стоит защитное поле,
 * и корабль без допуска отпружинивает от него назад, теряя ход (голубая вспышка, без
 * урона). Пройти внутрь к причалу можно только с допуском (`clearance`) — его даёт
 * автостыковка по L, ведущая корабль коридором колец. Тарану дорога закрыта: слишком
 * быстрый гасит скорость о поле, а стыковка перестала быть следствием «подлетел тихо».
 */
function stepBodyCollisions(world: World, dt: number): void {
  for (const ship of allShips(world)) {
    if (!ship.alive) continue
    // Кинематический борт не толкаем и не убиваем о тела: его положение внешнее.
    if (ship.kinematic) continue
    // С GHOST_BODY_SCALE крупная твердь (планеты/звёзды/станции/статуи) сквозная.
    // При 1 < scale < GHOST_BODY твердь остаётся — это как раз Shift+Tab-навигация.
    const ghostBody = ship.state.scale >= MIELOPHONE.GHOST_BODY_SCALE

    if (!ghostBody) {
      for (const body of world.bodies) {
        // Горизонт не является твёрдой оболочкой: гравитация действует, но пройти
        // через геометрический центр ничто не запрещает.
        if (body.kind === 'blackhole') continue

        // Звезда: касание поверхности. Игрок — отскок + «корабль потерян» (щиты полные,
        // игра дальше). Бот — сгорает. Перегрев короны убивает раньше, см. stepStarHeat.
        if (body.kind === 'star') {
          if (!hitsBodySphere(ship, body.pos, body.radius, dt)) continue
          if (ship.faction === 'player') {
            bounceOffSolid(ship, body.pos, body.radius, dt)
            ship.cruise.factor = 1
            surviveLethal(ship, world.time, { kind: 'star', name: body.name })
            continue
          }
          ship.hullHeat = 1
          ship.shield = 0
          ship.cruise.factor = 1
          applyDamage(ship, ship.hull, world.time, { kind: 'star', name: body.name })
          continue
        }

        if (body.kind === 'station') {
          // Крейсер сквозь поле станции не таранит: стыковка — на боевом ходу.
          if (isPhased(ship)) continue
          // Допуск — билет сквозь поле: корабль идёт коридором на стыковку, поле молчит.
          if (ship.clearance) continue
          const shieldR = body.radius * SHIELD.RADIUS_FACTOR
          const reach = shieldR + effectiveRadius(ship)
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
            noteCrash(world, ship, { kind: 'station', name: body.name })
          }
          continue
        }

        // Планета / луна — твёрдые и в фазе крейсера.
        if (body.kind !== 'planet' && body.kind !== 'moon') continue
        if (!hitsBodySphere(ship, body.pos, body.radius, dt)) continue

        // УПРАВЛЯЕМО — мягкая посадка. НЕУПРАВЛЯЕМО — отскок без урона («КРУШЕНИЕ»).
        if (ship.autoland === body.id || ship.landedOn?.bodyId === body.id) {
          landShip(ship, body)
        } else {
          crashBounce(world, ship, body.pos, body.radius, dt, {
            kind: body.kind,
            name: body.name,
          })
        }
        break
      }

      // Статуи / статуэтки — крупная твердь, до GHOST_BODY_SCALE.
      for (const monolith of world.monoliths) {
        if (!hitsBodySphere(ship, monolith.pos, monolith.radius, dt)) continue
        crashBounce(world, ship, monolith.pos, monolith.radius, dt, {
          kind: 'monolith',
          name: MONOLITH_NAMES[monolith.variant] ?? 'Монолит',
        })
        break
      }

      for (const fig of world.figurines) {
        if (!fig.alive) continue
        if (!hitsBodySphere(ship, fig.pos, fig.radius, dt)) continue
        if (canAttractFigurine(ship, fig)) continue
        crashBounce(world, ship, fig.pos, fig.radius, dt, {
          kind: 'figurine',
          name: figurineDisplayName(fig),
        })
        break
      }
    }

    // Глыбы двора — в Shift+Tab; сквозные только с GHOST_BODY (как планеты).
    if (ghostBody) continue
    for (const rock of world.warBases) {
      if (!rock.alive) continue
      if (bounceOffFixtures(world, ship, rock, dt)) break
      const hitR = warBaseSolidRadius(rock.radius)
      if (!hitsBodySphere(ship, rock.pos, hitR, dt)) continue
      if (ship.landedOn?.bodyId === rock.id) continue
      if (ship.autoland === rock.id) {
        const surface = findLandable(world, rock.id, ship)
        if (surface) landOnSurface(ship, surface)
        ship.autoland = null
      } else {
        crashBounce(world, ship, rock.pos, hitR, dt, { kind: 'warbase', name: '' })
      }
      break
    }
  }
}

/**
 * Луч и подбор. Луч только сводит контейнер с кораблём; забирает его то же
 * правило, что работает и без луча, — иначе способов попасть в трюм стало бы два.
 *
 * Луч спрашивается у Controller, как стрельба: симуляция не знает про клавишу C.
 */
function stepScooping(world: World, helm: Helm, dt: number): void {
  const player = world.player
  const wantTractor =
    player.alive && !!controllerFor(helm, player).wantsTractor?.(player, world)

  clearTractorMarks(world)

  if (world.pods.length > 0) {
    if (wantTractor) tractorPods(world, player, dt)
    if (player.alive) scoopNearby(world, player)

    // Компаньон на поручении СБОРА черпает тем же правилом, что игрок.
    for (const ship of world.ships) {
      if (!ship.alive || ship.ai?.tasks[0]?.kind !== 'collect-cargo') continue
      tractorPods(world, ship, dt)
      scoopNearby(world, ship)
    }
  }

  // Статуэтки: луч C в окне размера миелофона, подбор при касании.
  if (wantTractor) tractorFigurines(world, player, dt)
  if (player.alive) scoopFigurinesNear(world, player)
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

  // Срок жизни беспилотника задан в СЕКУНДАХ и сверяется с `world.time` — от частоты такта
  // не зависит.
  expireDrones(world)

  retain(world.tracers, (t) => now - t.born < t.life)
  retain(world.muzzleFlashes, (f) => now - f.born < GUNNERY.MUZZLE_FLASH_LIFE)
  retain(world.explosions, (e) => now - e.born < DEBRIS.EXPLOSION_LIFE)
  retain(world.shockwaves, (w) => now - w.born < BOMB.WAVE_LIFE)
  retain(world.warps, (w) => now - w.born < WARP.FLASH_LIFE)
  retain(world.shieldFlashes, (f) => now - f.born < SHIELD.FLASH_LIFE)
  // Вести о пропавших знакомых гаснут сами, как трассеры: HUD показал — и хватит.
  retain(world.notices, (n) => now - n.at < CONTACTS.NOTICE_LIFE)

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
  retain(
    world.ships,
    (s) => !s.warpedOut && (s.alive || (s.wreckAt !== null && now - s.wreckAt < DEBRIS.WRECK_LIFE)),
  )

  // Убитый камень уже раскололся в `damageAsteroid` — здесь только выметаем мёртвых.
  // Второе место, гасящее астероид по прочности, однажды забыло бы про осколки.
  retain(world.asteroids, (a) => a.alive)
  // Военные базы: гибнут в `damageWarBaseFixture` вместе с последней деталью — тут только выметаем.
  // Снесённая база остаётся в мире, пока не отгремит её агония: каскад вспышек, затем
  // "пух" волны с разлётом лома. Вынести раньше — оборвать зрелище на полуслове.
  stepWarBaseWrecks(world)
  retain(world.warBases, (r) => !warBaseWreckDone(r, now))
  retain(world.blastwaves, (w) => now - w.born < WARBASE.WAVE_LIFE)

  expirePods(world)

  // Захваченная цель могла погибнуть — снимаем захват, а не показываем рамку в пустоте.
  if (world.lockedTargetId !== null && !world.ships.some((s) => s.id === world.lockedTargetId && s.alive)) {
    world.lockedTargetId = null
  }
  // Захваченный обломок мог быть подобран или истечь (expirePods выше) — тоже снимаем.
  if (world.lockedPodId !== null && !world.pods.some((p) => p.id === world.lockedPodId && p.alive)) {
    world.lockedPodId = null
  }
  if (world.lockedAsteroidId !== null && !world.asteroids.some((a) => a.id === world.lockedAsteroidId && a.alive)) {
    world.lockedAsteroidId = null
  }
  // Отстреленная деталь базы (или снесённая вместе с базой) — захват снимаем, как у камня:
  // рамка на том, чего уже нет, врёт прибору.
  if (world.lockedFixtureId !== null && !findWarBaseFixture(world.warBases, world.lockedFixtureId)) {
    world.lockedFixtureId = null
  }
  // Нав-цель могла быть глыбой двора / гигантом пояса / статуэткой — снимаем, если её нет.
  if (world.navTargetId !== null) {
    const id = world.navTargetId
    const stillThere =
      world.bodies.some((b) => b.id === id) ||
      world.monoliths.some((m) => m.id === id) ||
      world.figurines.some((f) => f.id === id && f.alive) ||
      world.warBases.some((r) => r.id === id && r.alive) ||
      world.asteroids.some((a) => a.id === id && a.alive)
    if (!stillThere) {
      world.navTargetId = null
      world.lockedStationId = null
    }
  }
  // Миелофон: корабли с PHASE_END, планеты/станции с GHOST_BODY — цели снимаем.
  pruneGiantScaleLocks(world)
}
