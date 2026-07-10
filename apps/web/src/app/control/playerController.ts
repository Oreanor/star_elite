import type { Controller, ShipEntity, World } from '@elite/sim'
import {
  aiController,
  autofightActive,
  autofightSpent,
  boostMult,
  clamp,
  deadzoneScale,
  disengageAutofight,
  engageAutofight,
} from '@elite/sim'
import { consumePress, input, isHeld } from '../../platform/input/input'

/**
 * Игрок. Реализует тот же `Controller`, что и бот: заполняет ShipControls.
 * Симуляция не знает ни про мышь, ни про клавиатуру — в этом весь смысл.
 *
 * Схема управления:
 *   мышь задаёт ЖЕЛАЕМУЮ УГЛОВУЮ СКОРОСТЬ, а не угол;
 *   крен только ручной — A/D. Автокоординации нет, и не будет: она требует
 *   мирового «верха», которого в космосе не существует.
 *
 * Закрутился — так и летишь закрученным. Кадр выправляет камера, а не физика.
 */

/** Скорость изменения тяги клавишами W/S, доля в секунду. */
const THROTTLE_RATE = 0.9

/**
 * Мёртвая зона ручки, доля отклонения. При SENSITIVITY = 420 это ~8 пикселей мыши:
 * больше дрожи руки и меньше осознанного движения.
 */
const STICK_DEADZONE = 0.02

/**
 * «Бочка» — двойное нажатие A или D.
 *
 * Домен про неё ничего не знает: это просто контроллер, который на время
 * прижимает крен и поперечную тягу. Уклонение получается физикой, а не
 * неуязвимостью — ракета промахивается потому, что корабль сошёл с её линии.
 *
 * Меряется УГЛОМ, а не секундами. По времени бочка при крене 3.08 рад/с
 * успевала провернуть 220° и замирала вверх ногами. Полный оборот заканчивается
 * ровно там, где начался, при любых маневровых.
 *
 * Тяга держится в НЕПОДВИЖНОМ направлении: в связанных осях она вращается
 * навстречу крену. Иначе за оборот корабль опишет окружность радиусом a/ω²
 * (метра три) и вернётся на прежнюю линию — красиво и бесполезно.
 */
const BARREL = {
  /**
   * Второе нажатие должно уложиться в это окно, с.
   *
   * Было 0.3 — и обычный перехват крена (отпустил A, тут же нажал снова) читался
   * как двойной тап, отправляя корабль в незаказанный оборот. Намеренную бочку
   * крутят быстро, случайную — нет.
   */
  TAP_WINDOW: 0.18,
  /** Ровно один оборот. */
  FULL_TURN: Math.PI * 2,
  /** Предохранитель: если крена нет вовсе, бочка не должна длиться вечно. */
  MAX_DURATION: 3.5,
  /** Пауза между бочками, с. Без неё ими просто летают боком. */
  COOLDOWN: 2.2,
} as const

export interface PlayerIntent {
  /** Держит ли клавишу крейсерского хода. */
  cruise: boolean
  /** Хочет пустить ракету (однократно, гасится после выстрела). */
  missile: boolean
  /** Хочет пустить противоракетный импульс (однократно). */
  ecm: boolean
  /** Держит тяговый луч (C). Не однократное действие — удержание. */
  tractor: boolean
  /** Тяга, 0..1. Живёт между кадрами, поэтому хранится тут, а не в ShipControls. */
  throttle: number
  /**
   * Временная прибавка к тяге от правой кнопки, 0..1−throttle.
   * Отдельно от `throttle`, потому что рукоять газа она НЕ двигает: отпустил —
   * прибавка стекает обратно в ноль, и корабль возвращается на выставленный ход.
   */
  surge: number
  flightAssist: boolean

  /** Направление бочки: −1 влево (A), +1 вправо (D). 0 — не крутимся. */
  barrelDir: -1 | 0 | 1
  /** Сколько уже провернули, рад. Бочка кончается на полном обороте. */
  barrelAngle: number
  /** Предохранитель по времени, с. */
  barrelElapsed: number
  barrelCooldown: number
  /** Окна ожидания второго нажатия. */
  tapLeft: number
  tapRight: number
}

export function createIntent(): PlayerIntent {
  return {
    cruise: false,
    missile: false,
    ecm: false,
    tractor: false,
    throttle: 0.45,
    surge: 0,
    flightAssist: true,
    barrelDir: 0,
    barrelAngle: 0,
    barrelElapsed: 0,
    barrelCooldown: 0,
    tapLeft: 0,
    tapRight: 0,
  }
}

/** Двойной тап. Возвращает направление бочки или 0. */
function pollBarrelTap(intent: PlayerIntent, dt: number): -1 | 0 | 1 {
  intent.tapLeft = Math.max(0, intent.tapLeft - dt)
  intent.tapRight = Math.max(0, intent.tapRight - dt)
  intent.barrelCooldown = Math.max(0, intent.barrelCooldown - dt)

  // consumePress гасит нажатие: на следующем шаге физики того же кадра его уже нет.
  const tappedA = consumePress('KeyA')
  const tappedD = consumePress('KeyD')

  if (tappedA) {
    if (intent.tapLeft > 0) {
      intent.tapLeft = 0
      return -1
    }
    intent.tapLeft = BARREL.TAP_WINDOW
    intent.tapRight = 0 // A после D — это не двойное нажатие
  }
  if (tappedD) {
    if (intent.tapRight > 0) {
      intent.tapRight = 0
      return 1
    }
    intent.tapRight = BARREL.TAP_WINDOW
    intent.tapLeft = 0
  }
  return 0
}

/**
 * Ведёт бочку до полного оборота, толкая корабль в неподвижную сторону.
 *
 * Крен идёт вокруг связанной оси Z, поэтому неподвижное в мире направление
 * в связанных осях поворачивается на −θ. Отсюда синус с косинусом: маневровые
 * перекладывают тягу с бортовых на верхние и обратно, удерживая её на месте.
 */
function driveBarrelRoll(ship: ShipEntity, intent: PlayerIntent, dt: number): void {
  const c = ship.controls
  const dir = intent.barrelDir

  c.roll = dir
  intent.barrelElapsed += dt
  // Угол берём из ФАКТИЧЕСКОЙ угловой скорости: раскрутка маневровых не мгновенна.
  intent.barrelAngle += Math.abs(ship.state.angVel.z) * dt

  const theta = intent.barrelAngle * dir
  c.strafe = Math.cos(theta) * dir
  c.strafeUp = -Math.sin(theta) * dir

  if (intent.barrelAngle >= BARREL.FULL_TURN || intent.barrelElapsed >= BARREL.MAX_DURATION) {
    intent.barrelDir = 0
    intent.barrelCooldown = BARREL.COOLDOWN
    c.roll = 0
    c.strafe = 0
    c.strafeUp = 0
  }
}

/**
 * Автобой по клавише P. Тумблер живёт здесь, потому что это РЕШЕНИЕ игрока,
 * а не правило мира: правила (кого бить, когда отпустить штурвал) домен знает сам.
 *
 * Пока автобой ведёт корабль, ввод не читается вовсе — иначе мышь дралась бы
 * с пилотом за одну и ту же ручку. Бочку сбрасываем: докручивать чужой оборот
 * автопилоту незачем.
 */
function pollAutofight(world: World, intent: PlayerIntent): boolean {
  if (consumePress('KeyP')) {
    if (autofightActive(world)) {
      disengageAutofight(world)
    } else if (engageAutofight(world)) {
      intent.barrelDir = 0
      intent.surge = 0
    }
  }

  if (!autofightActive(world)) return false

  // Цель погибла, ушла за горизонт или мы сами мертвы — штурвал возвращается.
  if (autofightSpent(world)) {
    disengageAutofight(world)
    return false
  }
  return true
}

export function createPlayerController(intent: PlayerIntent): Controller {
  return {
    update(ship: ShipEntity, world: World, dt: number): void {
      if (pollAutofight(world, intent)) {
        // Тот же пилот, что и у пиратов. Никаких привилегий: он ведёт корабль
        // через тот же ShipControls, и физика не знает, кто за штурвалом.
        aiController.update(ship, world, dt)
        // Рукоять газа синхронизируем с тем, что выставил автопилот: иначе,
        // отпустив штурвал, корабль скачком вернулся бы на прежний ход.
        intent.throttle = clamp(ship.controls.throttle, 0, 1)
        return
      }

      const c = ship.controls

      // W/S двигают саму рукоять газа: выставленное ими держится, пока не сдвинешь.
      if (isHeld('KeyW')) intent.throttle += THROTTLE_RATE * dt
      if (isHeld('KeyS')) intent.throttle -= THROTTLE_RATE * dt
      intent.throttle = clamp(intent.throttle, 0, 1)

      /**
       * ПКМ — временный газ поверх рукояти, с той же скоростью, что и W.
       *
       * Прибавка ограничена сверху свободным ходом до единицы: копить её впустую
       * незачем, иначе после отпускания она полсекунды стекала бы с невидимого
       * запаса, а тяга всё это время стояла бы на максимуме.
       */
      const headroom = 1 - intent.throttle
      const surgeDelta = input.throttleUp ? THROTTLE_RATE * dt : -THROTTLE_RATE * dt
      intent.surge = clamp(intent.surge + surgeDelta, 0, headroom)

      c.throttle = intent.throttle + intent.surge

      /**
       * Мышь — виртуальная ручка. Отклонение = команда угловой скорости.
       *
       * Мёртвая зона обязательна: отклонение копится из движений мыши и само
       * в ноль не возвращается. Замерено, что остаток в 0.005 — это два пикселя,
       * меньше дрожи руки — уводил нос на 13° за минуту. Зона круглая, поэтому
       * порог одинаков по всем направлениям, а не только по осям.
       */
      const stick = Math.hypot(input.stickX, input.stickY)
      const scale = deadzoneScale(stick, STICK_DEADZONE)
      c.pitch = input.stickY * scale
      c.yaw = input.stickX * scale

      const tap = pollBarrelTap(intent, dt)
      if (tap !== 0 && intent.barrelDir === 0 && intent.barrelCooldown <= 0) {
        intent.barrelDir = tap
        intent.barrelAngle = 0
        intent.barrelElapsed = 0
      }

      if (intent.barrelDir !== 0) {
        driveBarrelRoll(ship, intent, dt)
      } else {
        // A/D — единственный источник крена. Ни физика, ни ассист его не трогают.
        c.roll = (isHeld('KeyA') ? 1 : 0) - (isHeld('KeyD') ? 1 : 0)
        c.strafe = 0
        c.strafeUp = 0
      }

      // Руль направления снят с клавиш: плоский разворот дублировал рыскание мышью,
      // а E понадобилась под ПРО. Домен `rudder` сохраняет — им правит физика и тест.
      c.rudder = 0

      c.flightAssist = intent.flightAssist

      // Форсаж — свойство установленного двигателя, а не константа игры.
      // Поставил военный — форсаж стал мощнее, и это посчитано, а не назначено.
      const boosting = isHeld('ShiftLeft') || isHeld('ShiftRight')
      c.boost = boosting ? boostMult(ship.loadout) : 1
      c.retro = isHeld('ControlLeft') || isHeld('ControlRight') ? 1 : 0

      intent.cruise = isHeld('KeyJ')
      // Луч — удержание, а не нажатие: пока держишь C, он тянет.
      intent.tractor = isHeld('KeyC')
    },

    // Пока автобой ведёт корабль, гашетку жмёт он же. Спрашивать мышь тут было бы
    // странно: игрок отдал управление целиком, а не наполовину.
    wantsFire(ship: ShipEntity, world: World): boolean {
      if (autofightActive(world)) return aiController.wantsFire(ship, world)
      return input.firing || isHeld('Space')
    },

    wantsMissile(ship: ShipEntity, world: World): boolean {
      if (autofightActive(world)) return aiController.wantsMissile?.(ship, world) ?? false
      if (!intent.missile) return false
      // Однократно: иначе одно нажатие опустошает все пилоны за кадр.
      intent.missile = false
      return true
    },

    wantsEcm(ship: ShipEntity, world: World): boolean {
      if (autofightActive(world)) return aiController.wantsEcm?.(ship, world) ?? false
      if (!intent.ecm) return false
      intent.ecm = false
      return true
    },

    wantsCruise(_ship: ShipEntity, world: World): boolean {
      return autofightActive(world) ? false : intent.cruise
    },

    wantsTractor(_ship: ShipEntity, world: World): boolean {
      return autofightActive(world) ? false : intent.tractor
    },
  }
}
