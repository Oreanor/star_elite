import { Euler, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { AURORA_ONE } from '../../config/chassis'
import { ENGINE_STANDARD, PULSE_LASER, RCS_STANDARD, SHIELD_HEAVY, SHIELD_STANDARD } from '../../config/modules'
import { playerStartLoadout } from '../../config/loadouts'
import { createLoadout, deriveShipSpec } from '../loadout'
import { shipAxes } from './axes'
import { stepShip } from './model'
import { bankToward, interceptPoint, steerToward } from './steering'
import { createControls, createShipState } from './types'

const spec = () => deriveShipSpec(playerStartLoadout())

function run(seconds: number, mutate: (c: ReturnType<typeof createControls>) => void) {
  const s = createShipState()
  const c = createControls()
  const t = spec().tuning
  mutate(c)
  const dt = 1 / 120
  for (let i = 0; i < seconds * 120; i++) stepShip(s, c, t, dt)
  return s
}

describe('линейная динамика', () => {
  it('корабль разгоняется вперёд, то есть в −Z', () => {
    const s = run(3, (c) => {
      c.throttle = 1
    })
    expect(s.pos.z).toBeLessThan(0)
    expect(s.vel.length()).toBeGreaterThan(50)
  })

  it('не превышает потолок скорости', () => {
    const s = run(30, (c) => {
      c.throttle = 1
    })
    expect(s.vel.length()).toBeLessThanOrEqual(spec().tuning.MAX_SPEED + 1e-6)
  })

  it('крейсерский множитель поднимает потолок пропорционально', () => {
    const s = run(30, (c) => {
      c.throttle = 1
      c.cruise = 10
    })
    // Крейсер входит в физику как обычный множитель — никаких особых режимов.
    expect(s.vel.length()).toBeGreaterThan(spec().tuning.MAX_SPEED * 5)
  })

  it('миелофон поднимает потолок скорости пропорционально масштабу', () => {
    // Иначе гигант ползёт паспортными 220 м/с и «на газу до звезды» невозможно.
    const s = createShipState()
    s.scale = 100
    const c = createControls()
    c.throttle = 1
    const t = spec().tuning
    const dt = 1 / 120
    for (let i = 0; i < 30 * 120; i++) stepShip(s, c, t, dt)
    expect(s.vel.length()).toBeGreaterThan(t.MAX_SPEED * 50)
    expect(s.vel.length()).toBeLessThanOrEqual(t.MAX_SPEED * 100 + 1e-6)
  })

  it('ручник гасит любой ход в ноль за долю секунды', () => {
    // На ×scale ретро вдоль носа не справлялось — борт «куда-то летел» на нулевом газе.
    const s = createShipState()
    s.scale = 1e6
    s.vel.set(0, 0, -1e9)
    const c = createControls()
    c.throttle = 0
    c.retro = 1
    const t = spec().tuning
    const dt = 1 / 120
    for (let i = 0; i < 0.5 * 120; i++) stepShip(s, c, t, dt)
    expect(s.vel.length()).toBe(0)
  })

  it('на ×scale выбег с нулевым газом гасит ход за пару секунд', () => {
    // ASSIST_SPEED_DAMP ~0.35 оставлял гиганта «плыть» минуту — отпустил ПКМ, а спидометр стоит.
    const s = createShipState()
    s.scale = 1e6
    s.vel.set(0, 0, -spec().tuning.MAX_SPEED * 1e6)
    const c = createControls()
    c.throttle = 0
    c.flightAssist = true
    const t = spec().tuning
    const dt = 1 / 120
    for (let i = 0; i < 2.5 * 120; i++) stepShip(s, c, t, dt)
    expect(s.vel.length()).toBe(0)
  })

  it('ручник сбрасывает газ — после отпускания FA не выстреливает к старому throttle×scale', () => {
    // Держал газ на гиганте, затормозил Ctrl, отпустил — раньше FA сразу тянул к commanded.
    const s = createShipState()
    s.scale = 1e5
    s.vel.set(0, 0, -1e8)
    const c = createControls()
    c.throttle = 1
    c.flightAssist = true
    c.retro = 1
    const t = spec().tuning
    const dt = 1 / 120
    for (let i = 0; i < 0.5 * 120; i++) stepShip(s, c, t, dt)
    expect(s.vel.length()).toBe(0)
    expect(c.throttle).toBe(0) // рукоять снята ручником

    c.retro = 0
    for (let i = 0; i < 0.25 * 120; i++) stepShip(s, c, t, dt)
    expect(s.vel.length()).toBeLessThan(1)
  })
})

describe('инерция и снос', () => {
  /**
   * Вектор скорости живёт отдельно от направления носа. Это то, ради чего
   * вообще писалась честная физика: при выключенном ассисте корабль
   * продолжает лететь туда, куда летел.
   */
  it('без ассиста корабль сохраняет снос после разворота', () => {
    const s = createShipState()
    const c = createControls()
    const t = spec().tuning
    c.flightAssist = false
    c.throttle = 1

    const dt = 1 / 120
    for (let i = 0; i < 480; i++) stepShip(s, c, t, dt) // разгон

    const velBefore = s.vel.clone()
    c.throttle = 0
    c.yaw = 1
    for (let i = 0; i < 240; i++) stepShip(s, c, t, dt) // разворот без тяги

    // Скорость не изменилась: в вакууме поворот носа её не трогает.
    expect(s.vel.distanceTo(velBefore)).toBeLessThan(1e-6)

    const fwd = new Vector3()
    shipAxes(s.quat, fwd, new Vector3(), new Vector3())
    const drift = fwd.angleTo(s.vel)
    expect(drift).toBeGreaterThan(0.3) // нос смотрит вбок от вектора скорости
  })

  /**
   * Ассист меряется СРАВНЕНИЕМ с его отсутствием, а не порогом в радианах.
   *
   * Абсолютный порог здесь был магической константой: установившийся снос равен
   * atan(ω/k) — при YAW_RATE 0.77 и ASSIST_LATERAL_DAMP 1.25 это 31.6°, то есть
   * 0.55 рад. Старый порог 0.5 держался впритык и падал от любой правки конфига.
   * Свойство «с ассистом сноса меньше» переживёт перебалансировку, число — нет.
   */
  it('ассист гасит снос сильнее, чем его отсутствие', () => {
    const drift = (flightAssist: boolean) => {
      const s = createShipState()
      const c = createControls()
      const t = spec().tuning
      const dt = 1 / 120

      c.flightAssist = flightAssist
      c.throttle = 1
      for (let i = 0; i < 480; i++) stepShip(s, c, t, dt)

      c.yaw = 1
      for (let i = 0; i < 600; i++) stepShip(s, c, t, dt)

      const fwd = new Vector3()
      shipAxes(s.quat, fwd, new Vector3(), new Vector3())
      return fwd.angleTo(s.vel)
    }

    expect(drift(true)).toBeLessThan(drift(false) * 0.5)
  })

  it('нос набирает угловую скорость не мгновенно', () => {
    const s = createShipState()
    const c = createControls()
    const t = spec().tuning
    c.yaw = 1
    stepShip(s, c, t, 1 / 120)
    // За один шаг угловая скорость ограничена угловым ускорением.
    expect(Math.abs(s.angVel.y)).toBeLessThan(t.YAW_RATE * 0.2)
  })
})

/**
 * Крен относительно мировой оси Y. МЕРА ДЛЯ ТЕСТА, и только: сама физика этой
 * оси не знает и знать не должна. Раньше такая функция жила в домене под именем
 * `bankAngle` и питала автокоординацию — из-за неё корабль выравнивался сам.
 */
function bankTo(q: Quaternion): number {
  const right = new Vector3(1, 0, 0).applyQuaternion(q)
  const up = new Vector3(0, 1, 0).applyQuaternion(q)
  return Math.atan2(right.dot(new Vector3(0, 1, 0)), up.dot(new Vector3(0, 1, 0)))
}

describe('крен без горизонта', () => {
  /** Рыскание — это рыскание. Никакой «координации» с креном больше нет. */
  it('поворот носа вбок сам по себе не кренит корабль', () => {
    const s = run(2, (c) => {
      c.throttle = 0.5
      c.yaw = 1
    })
    expect(Math.abs(bankTo(s.quat))).toBeLessThan(1e-6)
  })

  it('руль направления даёт плоский разворот без крена', () => {
    const s = run(2, (c) => {
      c.throttle = 0.5
      c.rudder = 1
    })
    expect(Math.abs(bankTo(s.quat))).toBeLessThan(1e-6)
  })

  /**
   * Регрессия. Автокоординация тянула крен к нулю ОТНОСИТЕЛЬНО МИРОВОЙ оси Y,
   * даже когда ручка по центру: накренённый корабль сам раскручивался обратно
   * за пару секунд, хотя пилот ничего не жал. В вакууме «горизонта» нет.
   *
   * Проверяем СВОЙСТВО: отпущенная ручка сохраняет крен, а не число градусов.
   */
  it('отпущенная ручка не выравнивает корабль', () => {
    const s = createShipState()
    const c = createControls()
    const t = spec().tuning
    const dt = 1 / 120

    c.throttle = 0.5
    c.roll = 1
    while (Math.abs(bankTo(s.quat)) < 0.6) stepShip(s, c, t, dt)

    c.roll = 0
    c.yaw = 0

    // Секунда на выбег: маневровые гасят угловую скорость не мгновенно,
    // и крен успевает доехать по инерции. Это физика, а не выравнивание.
    for (let i = 0; i < 120; i++) stepShip(s, c, t, dt)
    const settled = bankTo(s.quat)

    for (let i = 0; i < 4 * 120; i++) stepShip(s, c, t, dt)

    expect(Math.abs(s.angVel.z)).toBeLessThan(0.01)
    expect(bankTo(s.quat)).toBeCloseTo(settled, 3)
    expect(Math.abs(bankTo(s.quat))).toBeGreaterThan(0.5)
  })

  /**
   * Главный инвариант вакуума и единственная защита от возвращения «верха»:
   * при одних и тех же органах управления корабль вращается одинаково, куда бы
   * ни смотрел нос. Любая мировая ось, просочившаяся в физику вращения, ломает
   * ровно этот тест — и ломает сеть, где клиенты стартуют в разных ориентациях.
   */
  it('вращение не зависит от ориентации корабля в мире', () => {
    const t = spec().tuning
    const dt = 1 / 120

    const fly = (start: Quaternion) => {
      const s = createShipState(new Vector3(), start)
      const c = createControls()
      c.throttle = 0.7
      c.yaw = 0.6
      c.pitch = -0.35
      c.roll = 0.2
      for (let i = 0; i < 3 * 120; i++) stepShip(s, c, t, dt)
      return s
    }

    const level = fly(new Quaternion())
    // Вверх ногами и носом в произвольную сторону — то же самое для физики.
    const tilted = fly(new Quaternion().setFromEuler(new Euler(2.1, -0.7, 3.0)))

    expect(tilted.angVel.x).toBeCloseTo(level.angVel.x, 9)
    expect(tilted.angVel.y).toBeCloseTo(level.angVel.y, 9)
    expect(tilted.angVel.z).toBeCloseTo(level.angVel.z, 9)

    // И скорость вдоль собственного носа тоже совпадает.
    const noseSpeed = (s: typeof level) => s.vel.dot(new Vector3(0, 0, -1).applyQuaternion(s.quat))
    expect(noseSpeed(tilted)).toBeCloseTo(noseSpeed(level), 6)
  })
})

describe('наведение', () => {
  it('steerToward велит поднять нос к цели сверху', () => {
    const s = createShipState(new Vector3(), new Quaternion())
    const out = steerToward(s, new Vector3(0, 100, -100))
    expect(out.pitch).toBeGreaterThan(0)
    expect(Math.abs(out.yaw)).toBeLessThan(0.05)
  })

  it('steerToward велит повернуть нос вправо к цели справа', () => {
    const s = createShipState(new Vector3(), new Quaternion())
    const out = steerToward(s, new Vector3(100, 0, -100))
    expect(out.yaw).toBeGreaterThan(0)
  })

  it('точка упреждения лежит впереди движущейся цели', () => {
    const out = new Vector3()
    interceptPoint(
      new Vector3(0, 0, 0),
      new Vector3(),
      new Vector3(0, 0, -100), // цель в 100 м впереди
      new Vector3(50, 0, 0), // уходит вправо
      500, // снаряд летит 500 м/с
      out,
    )
    expect(out.x).toBeGreaterThan(0) // упреждение вправо
  })

  it('на бесконечной скорости снаряда упреждение вырождается в саму цель', () => {
    // Именно поэтому лазер (мгновенный) должен целиться ПРЯМО, без упреждения.
    const out = new Vector3()
    const target = new Vector3(0, 0, -100)
    interceptPoint(new Vector3(), new Vector3(), target, new Vector3(50, 0, 0), 1e9, out)
    expect(out.distanceTo(target)).toBeLessThan(0.01)
  })
})

describe('снаряжение определяет характеристики', () => {
  it('тяжёлый щит уменьшает угловое ускорение', () => {
    // Компромисс прокачки должен СЧИТАТЬСЯ из массы, а не назначаться.
    const light = deriveShipSpec(
      createLoadout(AURORA_ONE, [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD], [PULSE_LASER, PULSE_LASER]),
    )
    const heavy = deriveShipSpec(
      createLoadout(AURORA_ONE, [ENGINE_STANDARD, RCS_STANDARD, SHIELD_HEAVY], [PULSE_LASER, PULSE_LASER]),
    )
    expect(heavy.mass).toBeGreaterThan(light.mass)
    expect(heavy.tuning.PITCH_ACCEL).toBeLessThan(light.tuning.PITCH_ACCEL)
    expect(heavy.hull.shield).toBeGreaterThan(light.hull.shield)
  })

  it('груз утяжеляет корабль и снижает манёвренность', () => {
    const empty = deriveShipSpec(playerStartLoadout(), 0)
    const loaded = deriveShipSpec(playerStartLoadout(), 4)
    expect(loaded.tuning.PITCH_ACCEL).toBeLessThan(empty.tuning.PITCH_ACCEL)
  })

  it('корабль без двигателя не летит', () => {
    const dead = deriveShipSpec(createLoadout(AURORA_ONE, [RCS_STANDARD], []))
    expect(dead.tuning.THRUST).toBe(0)
    expect(dead.tuning.MAX_SPEED).toBe(0)
  })
})

/**
 * Крен «в цель» — замена автокоординации, не знающая мирового «верха».
 * Тангаж быстрее рыскания (1.33 против 0.77 рад/с), поэтому разворачиваться
 * выгодно креном: подкатил цель «наверх» и потянул носом.
 */
describe('bankToward', () => {
  const at = (x: number, y: number, z = -100) => new Vector3(x, y, z)

  it('цель прямо по курсу крена не требует', () => {
    const s = createShipState()
    expect(bankToward(s, at(0, 0))).toBe(0)
  })

  /**
   * Знак вывести на глаз нельзя: крен идёт вокруг связанной Z, а она смотрит
   * НАЗАД. Цель справа обязана уехать наверх, значит корабль катится влево.
   */
  it('цель справа катит корабль так, чтобы она ушла наверх', () => {
    const s = createShipState()
    const roll = bankToward(s, at(100, 0))
    expect(roll).toBeLessThan(0)

    // Подтверждаем делом: прокрутив корабль этой командой, цель уходит вверх.
    const c = createControls()
    const t = spec().tuning
    c.roll = roll
    for (let i = 0; i < 60; i++) stepShip(s, c, t, 1 / 120)

    const local = at(100, 0).applyQuaternion(s.quat.clone().invert())
    expect(local.y).toBeGreaterThan(0)
    expect(Math.abs(local.x)).toBeLessThan(100)
  })

  it('цель уже наверху крена не требует', () => {
    const s = createShipState()
    expect(Math.abs(bankToward(s, at(0, 100)))).toBeLessThan(1e-9)
  })

  /** Крен не зависит от того, куда смотрит нос: мировой оси в нём нет. */
  it('команда крена не зависит от ориентации в мире', () => {
    const level = createShipState()
    const tilted = createShipState(new Vector3(), new Quaternion().setFromEuler(new Euler(1.2, -2.4, 0.8)))

    // Одна и та же цель в СВЯЗАННЫХ осях: переносим её вместе с кораблём.
    const aimLocal = at(70, -30)
    const aimWorld = aimLocal.clone().applyQuaternion(tilted.quat)

    expect(bankToward(tilted, aimWorld)).toBeCloseTo(bankToward(level, aimLocal), 9)
  })
})
