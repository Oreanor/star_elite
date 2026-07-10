import type { Controller, Manoeuvre, ManoeuvreKind, ShipEntity, World } from '@elite/sim'
import {
  aiController,
  autofightActive,
  autofightSpent,
  beginManoeuvre,
  boostMult,
  clamp,
  coolManoeuvre,
  createManoeuvre,
  deadzoneScale,
  disengageAutofight,
  engageAutofight,
  manoeuvreHoldsCamera as holdsCamera,
  manoeuvring as busy,
  stepManoeuvre,
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
 * Фигуры пилотажа — двойное нажатие клавиши.
 *
 * Сами фигуры живут в домене (`aerobatics.ts`): это правила полёта, и тест
 * проверяет их без браузера, мыши и React. Здесь остаётся ровно то, чего домену
 * знать не положено, — КАКОЙ КЛАВИШЕЙ их просят.
 *
 *   AA — бочка влево      DD — бочка вправо
 *   WW — петля            SS — разворот на 180°
 *
 * Раскладка не случайна: крен просят клавишами крена, тангаж — клавишами тяги.
 * Петля продолжает движение вперёд, разворот ставит нос назад — как и одиночные
 * нажатия тех же клавиш, которые прибавляют и убавляют ход.
 */

/**
 * Второе нажатие должно уложиться в это окно, с. У клавиш крена оно короче.
 *
 * Обычный перехват крена (отпустил A, тут же нажал снова) при широком окне
 * читался двойным тапом и отправлял корабль в незаказанный оборот. С рукоятью
 * газа так не бывает: её двигают удержанием, а не дробью. Поэтому W и S могут
 * позволить себе окно вдвое шире — в 0.18 с попадал не всякий палец.
 */
const TAP_WINDOW_ROLL = 0.18
const TAP_WINDOW_THRUST = 0.34

/** Клавиша, её окно и что она заказывает вторым нажатием. Данные, а не `if` (OCP). */
interface TapKey {
  code: string
  window: number
  kind: ManoeuvreKind
  dir: -1 | 1
}

const TAPS: readonly TapKey[] = [
  { code: 'KeyA', window: TAP_WINDOW_ROLL, kind: 'barrel', dir: -1 },
  { code: 'KeyD', window: TAP_WINDOW_ROLL, kind: 'barrel', dir: 1 },
  { code: 'KeyW', window: TAP_WINDOW_THRUST, kind: 'loop', dir: 1 },
  { code: 'KeyS', window: TAP_WINDOW_THRUST, kind: 'reversal', dir: 1 },
]

export interface PlayerIntent {
  /** Держит ли клавишу крейсерского хода. */
  cruise: boolean
  /** Хочет пустить ракету (однократно, гасится после выстрела). */
  missile: boolean
  /** Хочет пустить противоракетный импульс (однократно). */
  ecm: boolean
  /** Хочет подорвать энергетическую бомбу (однократно). */
  bomb: boolean
  /** Хочет переключить маскировочное поле (однократно). Тумблер, а не удержание. */
  cloak: boolean
  /** Хочет выпустить беспилотник (однократно). */
  drone: boolean
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

  /** Текущая фигура пилотажа. Пока она идёт, ручку держит контроллер. */
  manoeuvre: Manoeuvre
  /** Сколько осталось от окна второго нажатия, по клавише. */
  taps: Map<string, number>
}

export function createIntent(): PlayerIntent {
  return {
    cruise: false,
    missile: false,
    ecm: false,
    bomb: false,
    cloak: false,
    drone: false,
    tractor: false,
    throttle: 0.45,
    surge: 0,
    flightAssist: true,
    manoeuvre: createManoeuvre(),
    taps: new Map(TAPS.map((t) => [t.code, 0])),
  }
}

/** Идёт ли фигура. Спрашивают и контроллер, и камера — правило одно. */
export const manoeuvring = (intent: PlayerIntent): boolean => busy(intent.manoeuvre)

/** Держит ли фигура камеру неподвижной. Петля и разворот — держат, бочка нет. */
export const manoeuvreHoldsCamera = (intent: PlayerIntent): boolean => holdsCamera(intent.manoeuvre)

/**
 * Двойной тап. Возвращает заказанную фигуру или null.
 *
 * Окно у каждой клавиши своё, но взводится ТОЛЬКО оно: A после D — это не
 * двойное нажатие, а смена намерения. Иначе перекладка крена читалась бы фигурой.
 */
function pollTap(intent: PlayerIntent, dt: number): TapKey | null {
  coolManoeuvre(intent.manoeuvre, dt)
  for (const [code, left] of intent.taps) intent.taps.set(code, Math.max(0, left - dt))

  for (const tap of TAPS) {
    // consumePress гасит нажатие: на следующем шаге физики того же кадра его уже нет.
    if (!consumePress(tap.code)) continue

    if ((intent.taps.get(tap.code) ?? 0) > 0) {
      intent.taps.set(tap.code, 0)
      return tap
    }

    // Взводим своё окно и гасим чужие: дробь по РАЗНЫМ клавишам фигурой не считается.
    for (const other of TAPS) intent.taps.set(other.code, other === tap ? tap.window : 0)
  }
  return null
}

/**
 * Автобой по клавише P. Тумблер живёт здесь, потому что это РЕШЕНИЕ игрока,
 * а не правило мира: правила (кого бить, когда отпустить штурвал) домен знает сам.
 *
 * Пока автобой ведёт корабль, ввод не читается вовсе — иначе мышь дралась бы
 * с пилотом за одну и ту же ручку. Фигуру сбрасываем: докручивать чужой оборот
 * автопилоту незачем.
 */
function pollAutofight(world: World, intent: PlayerIntent): boolean {
  if (consumePress('KeyP')) {
    if (autofightActive(world)) {
      disengageAutofight(world)
    } else if (engageAutofight(world)) {
      intent.manoeuvre.kind = null
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

      /**
       * W/S двигают саму рукоять газа: выставленное ими держится, пока не сдвинешь.
       *
       * Во время фигуры — не двигают. Петля заказывается двойным нажатием W, и
       * второе нажатие остаётся ЗАЖАТЫМ на все четыре секунды оборота: рукоять
       * успевала уехать на полный ход, петля раздувалась вдвое, а по выходе
       * корабль уносился прочь на форсажном режиме, которого пилот не просил.
       */
      if (!manoeuvring(intent)) {
        if (isHeld('KeyW')) intent.throttle += THROTTLE_RATE * dt
        if (isHeld('KeyS')) intent.throttle -= THROTTLE_RATE * dt
        intent.throttle = clamp(intent.throttle, 0, 1)
      }

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

      const tap = pollTap(intent, dt)
      if (tap) beginManoeuvre(intent.manoeuvre, tap.kind, tap.dir)

      if (stepManoeuvre(ship, intent.manoeuvre, dt)) {
        // Петлю фигура ведёт целиком: мышь не должна спорить с ней за тангаж
        // и уводить корабль с круга рысканием. В бочке ручка остаётся у пилота —
        // она и задумана как уклонение НА ходу, с сохранением прицела.
        if (manoeuvreHoldsCamera(intent)) c.yaw = 0
      } else {
        // A/D — единственный источник крена. Ни физика, ни ассист его не трогают.
        c.roll = (isHeld('KeyA') ? 1 : 0) - (isHeld('KeyD') ? 1 : 0)
        c.strafe = 0
        c.strafeUp = 0
      }

      // Руль направления снят с клавиш: плоский разворот дублировал рыскание мышью,
      // а E понадобилась под ПРО. Домен `rudder` сохраняет — им правит физика и тест.
      c.rudder = 0

      /**
       * Фигуру ведёт лётный компьютер, даже если пилот летает по-ньютоновски.
       * Без ассиста скорость на петле не падает, круг остаётся прежним, и
       * заданный радиус превращается в пожелание.
       */
      c.flightAssist = intent.flightAssist || manoeuvring(intent)

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

    /**
     * Бомбу автобою не отдаём: их три на вылет, и решать, когда сжечь одну,
     * обязан пилот. Бот, у которого «сложно», нажал бы её в первом же бою.
     */
    wantsBomb(): boolean {
      if (!intent.bomb) return false
      intent.bomb = false
      return true
    },

    /**
     * Поле — тоже дело пилота. Бот, которому «страшно», прятался бы вечно:
     * под полем не стреляют, и автобой перестал бы быть боем.
     */
    wantsCloak(): boolean {
      if (!intent.cloak) return false
      intent.cloak = false
      return true
    },

    /** Рой автобою не отдаём: он не знает, когда прикрытие нужнее ракеты. */
    wantsDrone(): boolean {
      if (!intent.drone) return false
      intent.drone = false
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
