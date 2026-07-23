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
import { pushWarning } from '../../ui/hud/warnings'
import { undocking } from './undockFx'

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
/** Сброс наддува ПКМ быстрее набора: отпустил — прибавка стекает за ~0.25 с, не за секунду. */
const SURGE_RELEASE_RATE = 4

/**
 * Задний ход — доля от крейсерской, доступная за нулём рукояти газа.
 *
 * Главное сопло смотрит назад и толкает только вперёд; пятиться нечем, кроме
 * маневровых (снос вбок). Ctrl — ручник (гасит весь ход), не реверс. Поэтому назад
 * корабль ползёт медленно: 15% полного хода через S за нулём рукояти. Рукоять газа
 * общая: S сначала гасит ход до нуля, потом включает реверс.
 */
const REVERSE_FRAC = 0.15

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
 * Второе нажатие должно уложиться в это окно, с. Окно ЩЕДРОЕ: в 0.18 с палец
 * не всегда попадал. Ширину теперь можно позволить, потому что непрерывное
 * действие клавиши держит ОТДЕЛЬНЫЙ порог удержания (HOLD_CONFIRM), а не это окно:
 * широкое окно двойного тапа больше не растягивает задержку крена и газа.
 *
 * У крена оно всё же чуть короче: перехват крена (отпустил A, тут же нажал снова)
 * при слишком широком окне читался бы двойным тапом и слал в незаказанный оборот.
 * Газ дробью не двигают — ему можно шире.
 */
const TAP_WINDOW_ROLL = 0.3
const TAP_WINDOW_THRUST = 0.42

/**
 * Сколько клавишу надо ПРОДЕРЖАТЬ, прежде чем счесть её удержанием, а не первой
 * половиной двойного тапа, с. Двойной тап требует отпустить клавишу между
 * нажатиями — значит непрерывно зажатая дольше этого порога заведомо удержание.
 * Порог короткий: тап дробью — 50–80 мс, и 120 мс он не заденет, зато крен и газ
 * трогаются почти сразу, не дожидаясь всего широкого окна двойного тапа.
 */
const HOLD_CONFIRM = 0.12

/** Клавиша, её окно и что она заказывает вторым нажатием. Данные, а не `if` (OCP). */
interface TapKey {
  code: string
  window: number
  kind: ManoeuvreKind
  dir: -1 | 1
}

const TAPS: readonly TapKey[] = [
  // Направление бочки совпадает с ручным креном той же клавиши: удержание A кренит
  // в ту же сторону, что и двойное нажатие AA. Раньше они были встречными.
  { code: 'KeyA', window: TAP_WINDOW_ROLL, kind: 'barrel', dir: 1 },
  { code: 'KeyD', window: TAP_WINDOW_ROLL, kind: 'barrel', dir: -1 },
  { code: 'KeyW', window: TAP_WINDOW_THRUST, kind: 'loop', dir: 1 },
  { code: 'KeyS', window: TAP_WINDOW_THRUST, kind: 'reversal', dir: 1 },
]

export interface PlayerIntent {
  /** Держит ли клавишу крейсерского хода (Пробел) или защёлка Alt. */
  cruise: boolean
  /**
   * Защёлка форсажа (Alt): пробел можно отпустить — множитель ЗАМОРОЖЕН
   * на `cruiseLatchFactor` (не ползёт к MAX). Сброс — Ctrl.
   */
  cruiseLatch: boolean
  /** Множитель в миг Alt; 0 — нет защёлки. */
  cruiseLatchFactor: number
  /** Хочет выстрел с пилона (однократно): ракета или дрон-ракета — что экипировано. */
  missile: boolean
  /** Хочет пустить противоракетный импульс (однократно). */
  ecm: boolean
  /** Хочет подорвать энергетическую бомбу (однократно). */
  bomb: boolean
  /** Хочет переключить маскировочное поле (однократно). Тумблер, а не удержание. */
  cloak: boolean
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
  /**
   * Одно удержание S тормозит только ДО НУЛЯ, дальше в реверс не проваливается:
   * если газ был положительным в момент нажатия, эта клавиша уткнётся в ноль.
   * Хочешь назад — отпусти и нажми снова: новое нажатие уже стартует с нуля и
   * уводит в минус. Флаг ловит фронт нажатия, чтобы решить, упирать ли в ноль.
   */
  sFloorZero: boolean
  /** Было ли S подтверждённо зажато в прошлом кадре — для фронта нажатия. */
  sWasHeld: boolean
  /** Ctrl зажат в прошлом кадре — пуш «ручное торможение» только на фронте. */
  retroWasHeld: boolean
  flightAssist: boolean

  /**
   * Миелофон: направление роста, +1 (растём) или −1 (уменьшаемся). Клавиша модуля (E)
   * одна, поэтому направление ЧЕРЕДУЕТСЯ по отпусканию: подержал — вырос, отпустил-держишь —
   * уменьшаешься. «Маета как у Алисы»: перелетел размер и подгоняешь туда-сюда.
   */
  growDir: number
  /** Держалась ли клавиша модуля в прошлом кадре — чтобы поймать отпускание и сменить `growDir`. */
  growWasHeld: boolean

  /** Текущая фигура пилотажа. Пока она идёт, ручку держит контроллер. */
  manoeuvre: Manoeuvre
  /** Сколько осталось от окна второго нажатия, по клавише. */
  taps: Map<string, number>
}

/**
 * Лётный компьютер по умолчанию. Хранится в localStorage меню настроек: выбор
 * между аркадой и ньютоновским полётом — раз и надолго, а не каждую сессию заново.
 * Ключ тот же, что пишет экран настроек (`elite.assist`). Значения нет — включён.
 */
function assistDefault(): boolean {
  return localStorage.getItem('elite.assist') !== 'off'
}

export function createIntent(): PlayerIntent {
  return {
    cruise: false,
    cruiseLatch: false,
    cruiseLatchFactor: 0,
    missile: false,
    ecm: false,
    bomb: false,
    cloak: false,
    tractor: false,
    throttle: 0.45,
    surge: 0,
    sFloorZero: false,
    sWasHeld: false,
    retroWasHeld: false,
    flightAssist: assistDefault(),
    growDir: 1,
    growWasHeld: false,
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

/**
 * Коастинг под ОТКРЫТЫМ МЕНЮ (см. `session.menuFlying`): пилота нет за штурвалом, но мир
 * летит. Рулёжку и рост обнуляем — корабль идёт прежним курсом по инерции; газ и крейсер
 * НЕ трогаем, чтобы ход не сбрасывался при взгляде на карту. Оружие молчит (`wantsFire`
 * = false, прочие `wants*` не заданы — значит «нет»). Тот же `Controller`, что у пилота и
 * бота: физика не знает, что рулят не мышью, а «никем».
 */
export const coastController: Controller = {
  update(ship: ShipEntity): void {
    const c = ship.controls
    c.pitch = 0
    c.yaw = 0
    c.roll = 0
    c.rudder = 0
    c.strafe = 0
    c.strafeUp = 0
    c.boost = 1
    c.retro = 0
    c.grow = 0
    c.flightAssist = true
  },
  wantsFire(): boolean {
    return false
  },
}

export function createPlayerController(intent: PlayerIntent): Controller {
  /** Сколько каждая тап-клавиша зажата без отрыва, с. Обнуляется при отпускании. */
  const heldFor = new Map<string, number>()
  /** Нужен для однократного сброса рукояти в момент касания поверхности. */
  let landedBodyId: number | null = null

  return {
    update(ship: ShipEntity, world: World, dt: number): void {
      // Вылет со станции — кино: корабль рвёт строго вперёд по оси на полном газу
      // («вжууух»), ввод не читаем. Так он не уводит с оси, пока камера его обгоняет, и
      // на выходе из тоннеля уже разогнан. Крутить и рулить пилот начнёт, когда сцена
      // кончится (undocking() погаснет сам через ~3 с).
      if (undocking()) {
        const c = ship.controls
        c.throttle = 1
        c.pitch = 0
        c.yaw = 0
        c.roll = 0
        c.rudder = 0
        c.strafe = 0
        c.strafeUp = 0
        c.retro = 0
        c.flightAssist = true
        // Рукоять газа держим на полном ходе, иначе после кино сцены снова 0.45.
        intent.throttle = 1
        intent.surge = 0
        // Мышь на всё кино вылета ВЫКЛЮЧЕНА в самом источнике (setStickSuspended в
        // undockFx): движение не копится в стик вообще, дёргать корабль на выходе нечем.
        return
      }

      const currentLanding = ship.landedOn?.bodyId ?? null
      if (currentLanding !== null && currentLanding !== landedBodyId) {
        // Посадка принимает корабль при любой скорости. Старое положение рукояти
        // не должно тут же поднять его обратно: сначала ноль, следующая W — взлёт.
        intent.throttle = 0
        intent.surge = 0
      }
      landedBodyId = currentLanding

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

      // Опрос двойного тапа — ПЕРВЫМ делом: он взводит окно и, если тап сложился,
      // начинает фигуру, чтобы газ и крен ниже уже видели «идёт манёвр».
      const tap = pollTap(intent, dt)
      if (tap) beginManoeuvre(intent.manoeuvre, tap.kind, tap.dir)

      /**
       * Копим, сколько КАЖДАЯ тап-клавиша зажата без отрыва. Непрерывное действие
       * (газ у W/S, крен у A/D) включаем, лишь когда удержание подтвердилось: пока
       * не набралось HOLD_CONFIRM, это может быть первая половина двойного тапа —
       * трогать корабль рано. Так первый тап AA/DD не качнёт корабль, а первый тап
       * WW/SS не сдвинет рукоять, но зажал и держишь — крен с газом идут почти сразу,
       * не дожидаясь всего окна тапа. Отпустил — счётчик обнулился.
       */
      for (const t of TAPS) heldFor.set(t.code, isHeld(t.code) ? (heldFor.get(t.code) ?? 0) + dt : 0)
      const confirmedHold = (code: string): boolean => (heldFor.get(code) ?? 0) >= HOLD_CONFIRM

      /**
       * W/S двигают саму рукоять газа: выставленное ими держится, пока не сдвинешь.
       *
       * Во время фигуры — не двигают. Петля заказывается двойным нажатием W, и
       * второе нажатие остаётся ЗАЖАТЫМ на все четыре секунды оборота: рукоять
       * успевала уехать на полный ход, петля раздувалась вдвое, а по выходе
       * корабль уносился прочь на форсажном режиме, которого пилот не просил.
       */
      /**
       * НАД ПОВЕРХНОСТЬЮ Shift+W/S — это ВЫСОТА, а не газ. Полёт над телом полярный по
       * смыслу: мышь смотрит и рыскает, W/S ведут ход вдоль поверхности, а «вверх» —
       * отдельная координата, которую держит рельс сферы (`stepHoverAltitude` в домене).
       * Пилот выбирает эшелон, а не борется тягой с притяжением.
       */
      const hoverAltitudeKeys = ship.landedOn !== null && isHeld('ShiftLeft')

      if (!manoeuvring(intent) && !hoverAltitudeKeys) {
        // W гонит рукоять вверх СКВОЗЬ ноль и дальше — из реверса в полный ход одним
        // движением, без ступеньки на нуле.
        if (confirmedHold('KeyW')) intent.throttle += THROTTLE_RATE * dt

        // S тормозит, но одно удержание не проваливается сразу в реверс: если газ был
        // положительным в момент нажатия, клавиша упирается в ноль. Хочешь назад —
        // отпусти и нажми снова; новое нажатие стартует с нуля и уводит в минус.
        const sHeld = confirmedHold('KeyS')
        if (sHeld && !intent.sWasHeld) intent.sFloorZero = intent.throttle > 1e-4
        if (sHeld) {
          intent.throttle -= THROTTLE_RATE * dt
          if (intent.sFloorZero) intent.throttle = Math.max(intent.throttle, 0)
        }
        intent.sWasHeld = sHeld

        intent.throttle = clamp(intent.throttle, -REVERSE_FRAC, 1)
      }

      /**
       * ПКМ — НАДДУВ ТЯГИ, пока держишь: гонит газ до отказа поверх рукояти (surge) и
       * включает наддув двигателя (boost ниже). Резкий отрыв от объекта: даже из реверса
       * ПКМ считает наддув ОТ НУЛЯ — минусовую рукоять сбрасывает в ноль и гонит тягу
       * вверх от него. Отпустил — прибавка стекает в НОЛЬ, а не обратно в минус: корабль
       * остаётся стоять, а не возвращается к заднему ходу.
       *
       * Прибавка ограничена сверху свободным ходом до единицы: копить её впустую
       * незачем, иначе после отпускания она полсекунды стекала бы с невидимого
       * запаса, а тяга всё это время стояла бы на максимуме.
       */
      if (input.throttleUp && intent.throttle < 0) intent.throttle = 0
      const headroom = 1 - intent.throttle
      const surgeDelta = input.throttleUp ? THROTTLE_RATE * dt : -SURGE_RELEASE_RATE * dt
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

      if (stepManoeuvre(ship, intent.manoeuvre, dt)) {
        // Петлю фигура ведёт целиком: мышь не должна спорить с ней за тангаж
        // и уводить корабль с круга рысканием. В бочке ручка остаётся у пилота —
        // она и задумана как уклонение НА ходу, с сохранением прицела.
        if (manoeuvreHoldsCamera(intent)) c.yaw = 0
      } else {
        // A/D — единственный источник крена. Ни физика, ни ассист его не трогают.
        // Крен даём лишь по ПОДТВЕРЖДЁННОМУ удержанию: первый быстрый тап AA/DD не
        // должен кренить корабль, пока не решится — бочка это или просто крен.
        const bankLeft = confirmedHold('KeyA')
        const bankRight = confirmedHold('KeyD')
        c.roll = (bankLeft ? 1 : 0) - (bankRight ? 1 : 0)
        c.strafe = 0
        c.strafeUp = 0
      }

      /**
       * НАД ПОВЕРХНОСТЬЮ высоту ведёт Shift+W/S, а не нос: мышь там только смотрит и
       * рыскает. Полёт над телом — полярный по смыслу, и «вверх» у него не направление
       * тяги, а отдельная координата (домен ведёт её `strafeUp`, см. `stepHoverAltitude`).
       *
       * Тем же нажатием рукоять газа НЕ двигаем — иначе набор высоты разгонял бы борт.
       */
      if (hoverAltitudeKeys) {
        c.strafeUp = (isHeld('KeyW') ? 1 : 0) - (isHeld('KeyS') ? 1 : 0)
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

      // Наддув тяги на ПКМ, пока держишь: наддув двигателя вместе с газом до отказа
      // выше. Сила наддува — свойство установленного двигателя, а не константа
      // игры: поставил военный — наддув стал мощнее, и это посчитано, а не назначено.
      c.boost = input.throttleUp ? boostMult(ship.loadout) : 1
      c.retro = isHeld('ControlLeft') || isHeld('ControlRight') ? 1 : 0

      // Крейсерский ход («форсаж») — удержание Пробела (разгон к MAX).
      // Alt — защёлка: множитель встаёт; пробел можно отпустить.
      // Повторный Пробел (край нажатия) снимает защёлку и снова набирает к MAX.
      if (consumePress('AltLeft') || consumePress('AltRight')) {
        if (!intent.cruiseLatch && ship.cruise.factor > 1.02) {
          intent.cruiseLatch = true
          intent.cruiseLatchFactor = ship.cruise.factor
          pushWarning('cruiseLatch', world.time, { repeat: 0 })
        }
      }
      if (intent.cruiseLatch && consumePress('Space')) {
        intent.cruiseLatch = false
        intent.cruiseLatchFactor = 0
      }
      intent.cruise = isHeld('Space')
      // Ручник (Ctrl) гасит крейсер сразу (см. updateCruise), снимает защёлку и весь
      // вектор скорости. Побеждает пробел того же кадра — тормоз важнее.
      // Рукоять газа тоже в ноль: иначе после отпускания FA выстреливает к
      // оставшемуся throttle×scale («тормозил — отпустил — несусь»).
      if (c.retro) {
        if (!intent.retroWasHeld) pushWarning('cruiseUnlatch', world.time, { repeat: 0 })
        intent.retroWasHeld = true
        intent.cruiseLatch = false
        intent.cruiseLatchFactor = 0
        intent.cruise = false
        intent.throttle = 0
        intent.surge = 0
        c.throttle = 0
      } else {
        intent.retroWasHeld = false
      }
      // Луч — удержание, а не нажатие: пока держишь C, он тянет.
      intent.tractor = isHeld('KeyC')

      /**
       * Миелофон на клавише модуля (E) — но РАБОТАЕТ ПО-СВОЕМУ: не тап, как прочие
       * модули, а удержание с чередованием направления. Держишь — растёшь (мир на глаз
       * уменьшается, камера отъезжает ∝ масштабу); отпустил — стоп; держишь снова —
       * уменьшаешься. Отпускание меняет `growDir`. Пока дев-доступ, без гейта модулем.
       */
      const growHeld = isHeld('KeyE')
      if (intent.growWasHeld && !growHeld) intent.growDir = -intent.growDir // отпустил — сменить сторону
      intent.growWasHeld = growHeld
      c.grow = growHeld ? intent.growDir : 0
    },

    // Пока автобой ведёт корабль, гашетку жмёт он же. Спрашивать мышь тут было бы
    // странно: игрок отдал управление целиком, а не наполовину.
    wantsFire(ship: ShipEntity, world: World): boolean {
      // Во время вылета (кинематик отстыковки) гашетка молчит: корабль ещё влетает в кадр.
      // Разблокируется само, когда undocking() гаснет (~3 с) и борт уже целиком в кадре.
      if (undocking()) return false
      if (autofightActive(world)) return aiController.wantsFire(ship, world)
      // Огонь — ЛКМ. Пробел отдан форсажу, поэтому клавиатурного дубля гашетки больше нет.
      return input.firing
    },

    wantsMissile(ship: ShipEntity, world: World): boolean {
      // Пуск тоже заперт на время вылета — и нажатие не копим, чтобы ракета не ушла сразу
      // по завершении кинематика.
      if (undocking()) {
        intent.missile = false
        return false
      }
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

    wantsCruise(_ship: ShipEntity, world: World): boolean | number {
      if (autofightActive(world)) return false
      // Защёлка важнее пробела: иначе Space снова потащит к MAX.
      if (intent.cruiseLatch && intent.cruiseLatchFactor > 1) return intent.cruiseLatchFactor
      return intent.cruise
    },

    wantsTractor(_ship: ShipEntity, world: World): boolean {
      return autofightActive(world) ? false : intent.tractor
    },
  }
}
