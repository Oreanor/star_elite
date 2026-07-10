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
 * Фигуры пилотажа — двойное нажатие клавиши.
 *
 * Домен про них ничего не знает: это просто контроллер, который на время сам
 * держит ручку. Уклонение получается ФИЗИКОЙ, а не неуязвимостью — ракета
 * промахивается потому, что корабль сошёл с её линии, а преследователь
 * проскакивает вперёд потому, что не смог повторить.
 *
 * Каждая фигура меряется УГЛОМ, а не секундами. По времени бочка при крене
 * 3.08 рад/с успевала провернуть 220° и замирала вверх ногами. Оборот,
 * отмеренный углом, кончается ровно там, где начался, при любых маневровых.
 */

/** Что именно крутим. Новая фигура — новая запись здесь, а не новый `if`. */
export type ManoeuvreKind = 'barrel' | 'loop' | 'reversal'

const MANOEUVRE = {
  /**
   * Второе нажатие должно уложиться в это окно, с.
   *
   * Было 0.3 — и обычный перехват крена (отпустил A, тут же нажал снова) читался
   * как двойной тап, отправляя корабль в незаказанный оборот. Намеренную фигуру
   * крутят быстро, случайную — нет.
   */
  TAP_WINDOW: 0.18,
  HALF_TURN: Math.PI,
  FULL_TURN: Math.PI * 2,
  /**
   * Предохранитель по времени, с. Петля идёт вокруг тангажа, а он самая
   * медленная ось: 2π при 1.33 рад/с — почти пять секунд. Бочке хватило бы 3.5,
   * но общий потолок проще одного на фигуру и ничего не портит: он аварийный.
   */
  MAX_DURATION: 9,
  /** Пауза между фигурами, с. Без неё ими просто летают. */
  COOLDOWN: 2.2,
  /**
   * Радиус петли, м. Не тяга и не «доля газа»: у петли есть ровно один размер,
   * и он считается, а не подбирается.
   *
   * Корабль на петле летит по кругу радиусом v/ω. На полном ходу (200 м/с) и
   * тангаже 1.33 рад/с это 150 м — но `throttle` в момент двойного нажатия W
   * стоит уже на единице, потому что W его и поднимает, и с форсажем круг
   * распухает до полукилометра: корабль улетает вперёд вместо того, чтобы
   * пропустить преследователя. Задаём радиус, из него выводим скорость: v = ω·R.
   */
  LOOP_RADIUS: 110,
} as const

/** Есть ли фигура, и какая. `null` — штурвал у пилота. */
export interface Manoeuvre {
  kind: ManoeuvreKind | null
  /** Направление бочки: −1 влево, +1 вправо. Для петель роли не играет. */
  dir: -1 | 1
  /** Сколько провернули по текущей оси, рад. */
  angle: number
  /** Разворот идёт в два приёма: полупетля, затем докрутка крена. */
  phase: 0 | 1
  elapsed: number
  cooldown: number
}

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
  /** Окна ожидания второго нажатия, по клавише. */
  tapA: number
  tapD: number
  tapW: number
  tapS: number
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
    manoeuvre: { kind: null, dir: 1, angle: 0, phase: 0, elapsed: 0, cooldown: 0 },
    tapA: 0,
    tapD: 0,
    tapW: 0,
    tapS: 0,
  }
}

/** Идёт ли фигура. Спрашивает и контроллер, и камера — правило одно. */
export const manoeuvring = (intent: PlayerIntent): boolean => intent.manoeuvre.kind !== null

/**
 * Держит ли фигура камеру неподвижной.
 *
 * Петля и разворот — фигуры, а не вираж: камера в них не гонится за носом,
 * а спокойно ждёт, пока корабль обойдёт круг. У бочки другое лекарство —
 * ей не передаётся крен, но курс камера подхватывает как обычно.
 */
export const manoeuvreHoldsCamera = (intent: PlayerIntent): boolean =>
  intent.manoeuvre.kind === 'loop' || intent.manoeuvre.kind === 'reversal'

/**
 * Двойной тап. Возвращает начатую фигуру или null.
 *
 * Окно у каждой клавиши своё, но взводится ТОЛЬКО оно: A после D — это не
 * двойное нажатие, а смена намерения. Иначе перекладка крена читалась бы фигурой.
 */
function pollTap(intent: PlayerIntent, dt: number): { kind: ManoeuvreKind; dir: -1 | 1 } | null {
  intent.tapA = Math.max(0, intent.tapA - dt)
  intent.tapD = Math.max(0, intent.tapD - dt)
  intent.tapW = Math.max(0, intent.tapW - dt)
  intent.tapS = Math.max(0, intent.tapS - dt)
  intent.manoeuvre.cooldown = Math.max(0, intent.manoeuvre.cooldown - dt)

  // consumePress гасит нажатие: на следующем шаге физики того же кадра его уже нет.
  const tappedA = consumePress('KeyA')
  const tappedD = consumePress('KeyD')
  const tappedW = consumePress('KeyW')
  const tappedS = consumePress('KeyS')

  if (tappedA) {
    if (intent.tapA > 0) {
      intent.tapA = 0
      return { kind: 'barrel', dir: -1 }
    }
    intent.tapA = MANOEUVRE.TAP_WINDOW
    intent.tapD = 0
  }
  if (tappedD) {
    if (intent.tapD > 0) {
      intent.tapD = 0
      return { kind: 'reversal', dir: 1 }
    }
    intent.tapD = MANOEUVRE.TAP_WINDOW
    intent.tapA = 0
  }
  // W — петля через верх, S — через низ. Одна фигура, разный знак тангажа:
  // отдельного `kind` для этого не нужно, различие живёт в данных.
  if (tappedW) {
    if (intent.tapW > 0) {
      intent.tapW = 0
      return { kind: 'loop', dir: 1 }
    }
    intent.tapW = MANOEUVRE.TAP_WINDOW
    intent.tapS = 0
  }
  if (tappedS) {
    if (intent.tapS > 0) {
      intent.tapS = 0
      return { kind: 'loop', dir: -1 }
    }
    intent.tapS = MANOEUVRE.TAP_WINDOW
    intent.tapW = 0
  }
  return null
}

function endManoeuvre(ship: ShipEntity, m: Manoeuvre): void {
  const c = ship.controls
  m.kind = null
  m.cooldown = MANOEUVRE.COOLDOWN
  c.roll = 0
  c.pitch = 0
  c.strafe = 0
  c.strafeUp = 0
}

/**
 * Бочка: полный оборот вокруг носа, с тягой в НЕПОДВИЖНОМ направлении.
 *
 * Крен идёт вокруг связанной оси Z, поэтому неподвижное в мире направление
 * в связанных осях поворачивается на −θ. Отсюда синус с косинусом: маневровые
 * перекладывают тягу с бортовых на верхние и обратно, удерживая её на месте.
 * Без этого за оборот корабль опишет окружность радиусом a/ω² (метра три)
 * и вернётся на прежнюю линию — красиво и бесполезно.
 */
function driveBarrel(ship: ShipEntity, m: Manoeuvre, dt: number): void {
  const c = ship.controls
  c.roll = m.dir
  // Угол берём из ФАКТИЧЕСКОЙ угловой скорости: раскрутка маневровых не мгновенна.
  m.angle += Math.abs(ship.state.angVel.z) * dt

  const theta = m.angle * m.dir
  c.strafe = Math.cos(theta) * m.dir
  c.strafeUp = -Math.sin(theta) * m.dir

  if (m.angle >= MANOEUVRE.FULL_TURN) endManoeuvre(ship, m)
}

/**
 * Тяга, при которой петля выходит заданного радиуса.
 *
 * Корабль на петле идёт по кругу радиусом v/ω, значит нужная скорость — ω·R.
 * ω берётся ФАКТИЧЕСКАЯ: маневровые раскручиваются не мгновенно, и в начале
 * фигуры (ω→0) формула сама просит нулевую тягу — то есть тормозит. Лётный
 * компьютер (`flightAssist`) держит скорость по рукояти, поэтому достаточно
 * подвинуть рукоять, а гасить скорость ретродвигателями не нужно.
 */
function loopThrottle(ship: ShipEntity): number {
  const wanted = MANOEUVRE.LOOP_RADIUS * Math.abs(ship.state.angVel.x)
  return clamp(wanted / Math.max(ship.spec.tuning.MAX_SPEED, 1), 0, 1)
}

/**
 * Петля: полный оборот вокруг тангажа. Корабль уходит вверх (W) или вниз (S),
 * обходит круг и ложится на прежний курс.
 *
 * Смысл фигуры — пропустить вперёд того, кто сидит на хвосте: он либо
 * проскакивает, либо повторяет петлю и остаётся сзади, потеряв дистанцию.
 * Ракету петля не срывает — от неё уходят бочкой, — но круг уводит корабль
 * с её линии.
 */
function driveLoop(ship: ShipEntity, m: Manoeuvre, dt: number): void {
  ship.controls.pitch = m.dir
  ship.controls.throttle = loopThrottle(ship)
  m.angle += Math.abs(ship.state.angVel.x) * dt
  if (m.angle >= MANOEUVRE.FULL_TURN) endManoeuvre(ship, m)
}

/**
 * Разворот через петлю (иммельман): полупетля, затем полбочки.
 *
 * Полупетля разворачивает корабль на 180°, но вверх ногами — поэтому вторым
 * приёмом идёт докрутка крена. Разворот считается по РАЗНЫМ осям в разных
 * приёмах: тангаж в первом, крен во втором. Общий счётчик угла обнуляется на
 * переходе, иначе быстрый крен «дорисовал» бы недостающий тангаж.
 *
 * Фигура нужна для контратаки: тот, кто был на хвосте, оказывается в прицеле.
 */
function driveReversal(ship: ShipEntity, m: Manoeuvre, dt: number): void {
  const c = ship.controls

  if (m.phase === 0) {
    c.pitch = 1
    // Полупетля — та же петля: радиус у неё обязан быть тот же, иначе разворот
    // уносит корабль вперёд ровно туда, откуда он разворачивается уйти.
    c.throttle = loopThrottle(ship)
    m.angle += Math.abs(ship.state.angVel.x) * dt
    if (m.angle >= MANOEUVRE.HALF_TURN) {
      m.phase = 1
      m.angle = 0
      c.pitch = 0
    }
    return
  }

  c.roll = m.dir
  m.angle += Math.abs(ship.state.angVel.z) * dt
  if (m.angle >= MANOEUVRE.HALF_TURN) endManoeuvre(ship, m)
}

/** Ведёт начатую фигуру. Возвращает false, когда штурвал снова у пилота. */
function driveManoeuvre(ship: ShipEntity, m: Manoeuvre, dt: number): boolean {
  if (m.kind === null) return false

  m.elapsed += dt
  // Предохранитель: без маневровых фигура не должна длиться вечно.
  if (m.elapsed >= MANOEUVRE.MAX_DURATION) {
    endManoeuvre(ship, m)
    return false
  }

  if (m.kind === 'barrel') driveBarrel(ship, m, dt)
  else if (m.kind === 'loop') driveLoop(ship, m, dt)
  else driveReversal(ship, m, dt)

  return true
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

      const m = intent.manoeuvre
      const tap = pollTap(intent, dt)
      if (tap && m.kind === null && m.cooldown <= 0) {
        m.kind = tap.kind
        m.dir = tap.dir
        m.angle = 0
        m.phase = 0
        m.elapsed = 0
      }

      if (driveManoeuvre(ship, m, dt)) {
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
