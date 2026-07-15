import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { CRUISE, clamp } from '@elite/sim'
import { manoeuvreHoldsCamera } from '../../app/control/playerController'
import { useSession } from '../../app/GameContext'
import { jumpFx, jumpShake } from '../../app/control/jumpFx'
import { undocking, undockProgress } from '../../app/control/undockFx'
import { cameraView } from '../../app/control/cameraView'
import { bombShake } from '../bombFeel'
import { CAMERA, GIANT_RENDER_CAP, RENDER } from '../config'

/**
 * Камера преследования и вид из кабины.
 *
 * ТРЯСКА ЖИВЁТ ТОЛЬКО ЗДЕСЬ. Ни один её пиксель не попадает в физику: иначе
 * симуляция перестанет быть детерминированной и разъедется с сервером.
 * Трясёт от перегрузки, а не от скорости, — поэтому амплитуда падает,
 * когда крейсер выходит на установившийся ход.
 */

const _target = new Vector3()
const _offset = new Vector3()
/** Скорость для упреждения, обрезанная базовым MAX_SPEED: см. врезку у addScaledVector. */
const _lead = new Vector3()
const _rel = new Vector3()
const _twist = new Quaternion()
const _desiredQuat = new Quaternion()
const _shake = new Vector3()
const _bombShake = new Vector3()
const _jumpShake = new Vector3()
const _camRot = new Quaternion()
/** Пользовательский облёт: поворот всей связки камеры вокруг вертикали корабля. */
const _orbit = new Quaternion()
const _up = new Vector3()

/** Направление носа и взгляда камеры — для инкрементального доворота курса. */
const _noseFwd = new Vector3()
const _camFwd = new Vector3()
const _deltaRot = new Quaternion()
const _identity = new Quaternion()
/** Опорное «вперёд»: нос смотрит в −Z. */
const _refFwd = /* @__PURE__ */ new Vector3(0, 0, -1)

/**
 * Постоянный наклон камеры вниз. Поворот вокруг локальной X на отрицательный угол
 * уводит взгляд (−Z) вниз — так корабль оказывается в центре кадра, а не под ним.
 */
const _pitchDown = /* @__PURE__ */ new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -CAMERA.CHASE_PITCH)

/**
 * Крен корабля относительно текущего курса камеры: остаток ориентации после снятия
 * `camSwing`. Канонизируем полушарие (`w ≥ 0`) — иначе цель крена перепрыгивает на
 * «перевёрнутую» версию себя, и пружина идёт длинным путём.
 */
function residualTwist(shipQuat: Quaternion, camSwing: Quaternion, out: Quaternion): void {
  out.copy(camSwing).invert().multiply(shipQuat)
  if (out.w < 0) out.set(-out.x, -out.y, -out.z, -out.w)
}

/** Псевдослучайная тряска: две несоизмеримые синусоиды не дают заметного периода. */
function shakeAt(time: number, seed: number): number {
  return Math.sin(time * CAMERA.SHAKE_FREQ + seed) * Math.sin(time * (CAMERA.SHAKE_FREQ * 0.37) + seed * 2)
}

export function FlightCamera() {
  const session = useSession()
  const camera = useThree((state) => state.camera) as PerspectiveCamera

  /** Множитель крейсера в прошлом кадре: по его росту и виден разгон. */
  const previousFactor = useRef(1)

  /**
   * Ориентация камеры хранится РАЗОБРАННОЙ — курс с тангажом отдельно, крен
   * отдельно. Иначе постоянный доворот `_pitchDown` попадал бы в разложение
   * следующего кадра и накапливался, уводя взгляд всё ниже.
   */
  const camSwing = useRef(new Quaternion()).current
  const camTwist = useRef(new Quaternion()).current

  /**
   * Поза камеры, застывшая на входе в бочку: смещение от корабля и ориентация.
   * Пока фигура идёт, камеру не трогаем вовсе — только возим за кораблём от этой
   * замороженной точки. `null` — бочки нет.
   */
  const frozen = useRef<{ offset: Vector3; quat: Quaternion } | null>(null)

  useFrame((_, dt) => {
    /**
     * Мир стоит — камера не ДОГОНЯЕТ, но встать на место обязана.
     *
     * Пружина идёт от реального `dt`, поэтому под открытым меню она продолжала бы
     * подтягиваться к кораблю, и пауза выглядела бы как медленный наезд. Но просто
     * выйти отсюда нельзя: до первого шага мира (а игра начинается на паузе, с
     * отпущенным курсором) камера так и осталась бы в начале координат — то есть
     * внутри звезды, за сто пятьдесят миллионов километров от корабля.
     *
     * Поэтому на стоящем мире камера ставится жёстко, без пружины. Цель при этом
     * неподвижна, значит и камера неподвижна: ничто не шевелится.
     */
    const running = session.running

    const player = session.world.player
    const state = player.state

    /**
     * ВЫЛЕТ СО СТАНЦИИ: камера ведёт кино. Стартует ВПЕРЕДИ носа и смотрит наружу —
     * корабль позади неё, вне кадра. За ~3 с смещение по скрипту едет от `UNDOCK_AHEAD`
     * к обычному `CHASE_OFFSET`, ускоряясь к финалу: камера откатывается за корму, а
     * корабль на «вжууух» обгоняет её и влетает в полный кадр ровно по оси. Позу
     * ставим жёстко (без пружины): после стыковки прежняя поза случайна, а обгон обязан
     * идти ровно по оси. На выходе (k→1) поза равна погонной — обычная пружина
     * подхватывает без рывка, а `camSwing`/`camTwist` уже выставлены по носу.
     */
    if (undocking()) {
      const k = undockProgress() ** 3 // медленно → быстро: обгон случается к финалу
      _noseFwd.copy(_refFwd).applyQuaternion(state.quat)
      camSwing.setFromUnitVectors(_refFwd, _noseFwd)
      camTwist.identity()

      const off = CAMERA.CHASE_OFFSET
      const ah = CAMERA.UNDOCK_AHEAD
      _offset
        .set(ah[0] + (off[0] - ah[0]) * k, ah[1] + (off[1] - ah[1]) * k, ah[2] + (off[2] - ah[2]) * k)
        .applyQuaternion(state.quat)
      _target.copy(state.pos).add(_offset)

      _desiredQuat.copy(camSwing).multiply(camTwist).multiply(_pitchDown)
      camera.position.copy(_target)
      camera.quaternion.copy(_desiredQuat)
      // HUD проецирует маркеры в этом же useFrame-цикле, до WebGL-рендера.
      // Без свежей матрицы он видел позу камеры прошлого кадра и все метки мерцали.
      camera.updateMatrixWorld(true)
      previousFactor.current = player.cruise.factor
      return
    }

    /**
     * ОТПРАВЛЕНИЕ В ПРЫЖОК: камера НАБЛЮДАЕТ, а не преследует. Она встаёт за точкой
     * старта и оттуда смотрит, как корабль срывается, уходит к далёкому кольцу и тает
     * в нём, — поэтому поза считается от ЗАМОРОЖЕННОЙ позы старта (`shipStart`/`ringQuat`),
     * а не от живого корабля, и не едет за носом. На зарядке добавляется дрожь.
     */
    if (jumpFx().phase === 'depart') {
      const fx = jumpFx()
      const off = CAMERA.CHASE_OFFSET
      _offset.set(off[0], off[1], off[2]).applyQuaternion(fx.ringQuat)
      _target.copy(fx.shipStart).add(_offset)
      _desiredQuat.copy(fx.ringQuat).multiply(_pitchDown)

      const a = running ? 1 - Math.exp(-CAMERA.CHASE_STIFFNESS * dt) : 1
      camera.position.lerp(_target, a)
      camera.quaternion.slerp(_desiredQuat, a)

      const js = jumpShake()
      if (js > 1e-4) {
        const time = session.world.time
        _jumpShake
          .set(shakeAt(time, 2.3), shakeAt(time, 5.1), shakeAt(time, 9.7))
          .multiplyScalar(js * CAMERA.JUMP_SHAKE_MAX)
        camera.position.add(_jumpShake.applyQuaternion(camera.quaternion))
      }

      camera.updateMatrixWorld(true)
      previousFactor.current = player.cruise.factor
      return
    }

    /**
     * В петле камера НЕ едет за носом: она держит свою ориентацию и просто
     * сопровождает корабль, пока тот обходит круг. Поэтому и смещение считается
     * от ориентации КАМЕРЫ, а не корабля — иначе точка съёмки уходила бы вместе
     * с носом, и петли не было бы видно вовсе.
     *
     * Когда фигура кончится, пружина сама перенесёт камеру в хвост. После
     * разворота хвост оказывается с другой стороны — это и есть «перебежать».
     */
    const held = manoeuvreHoldsCamera(session.intent)
    // Бочка — крен без смены курса. Обрабатывается особо, сразу ниже.
    const barrel = session.intent.manoeuvre.kind === 'barrel'

    /**
     * БОЧКА: камеру не трогаем СОВСЕМ. Раньше она разбирала кватернион корабля на
     * крен и курс — но у полного оборота разложение вырождается (у 180° крен
     * меняет знак), и камера ныряла за носом на пол-оборота, а потом на пол-оборота
     * обратно. Никакой пружиной это не лечится: вырождается сам источник.
     *
     * Поэтому в бочке разложения нет вовсе. На первом кадре фигуры запоминаем позу
     * камеры относительно корабля и дальше лишь возим её за кораблём: ориентация
     * стоит намертво, корабль крутится в центре кадра. Кончилась бочка — обычное
     * слежение подхватывает с той же позы (курс не менялся), без рывка.
     */
    if (barrel) {
      const f =
        frozen.current ??
        (frozen.current = {
          offset: _rel.copy(camera.position).sub(state.pos).clone(),
          quat: camera.quaternion.clone(),
        })
      camera.position.copy(state.pos).add(f.offset)
      camera.quaternion.copy(f.quat)
      camera.updateMatrixWorld(true)
      // Множитель крейсера в бочке не читаем — чтобы на выходе тряска не дёрнулась
      // от накопившейся «скорости роста», которой на деле не было.
      previousFactor.current = player.cruise.factor
      return
    }
    frozen.current = null

    const offset = CAMERA.CHASE_OFFSET
    _offset.set(offset[0], offset[1], offset[2])
    if (held) {
      /**
       * И отодвигается — ровно на петлю. Радиус петли есть v/ω, и с обычных
       * двадцати четырёх метров камера оказывается ВНУТРИ круга: корабль
       * пролетает сквозь неё и заслоняет кадр собственным брюхом.
       *
       * Отъезд считается из радиуса, а не подбирается: на 60 м/с петля выходит
       * сорокапятиметровой, на боевых двухстах — полуторастаметровой, и никакая
       * одна константа не годится сразу для обеих. Но сверху он ограничен, иначе
       * на быстрой фигуре корабль улетает в точку и не видно, что он делает.
       */
      const rate = Math.max(0.4, Math.abs(state.angVel.x))
      const loopRadius = state.vel.length() / rate
      const pullback = clamp(
        1 + (CAMERA.LOOP_PULLBACK_GAIN * loopRadius) / _offset.length(),
        1,
        CAMERA.LOOP_PULLBACK_MAX,
      )
      _offset.multiplyScalar(pullback)

      _camRot.copy(camSwing).multiply(camTwist)
      _offset.applyQuaternion(_camRot)
    } else {
      _offset.applyQuaternion(state.quat)
    }
    // Миелофон: камера отъезжает НА ТОТ ЖЕ множитель, что и размер борта. Оттого свой
    // корабль на экране всегда одного размера, а мир вокруг «уменьшается» — не «я расту».
    // Множитель зажат потолком РЕНДЕРА (см. GIANT_RENDER_CAP): выше него километровый
    // корпус мерцает в лог-буфере, а на экране он и так во весь кадр. Тот же зажим у меша
    // корабля — тогда он остаётся постоянного размера, просто мир перестаёт уменьшаться.
    _offset.multiplyScalar(Math.min(state.scale, GIANT_RENDER_CAP))

    // Пользовательский ракурс (стрелки): наезд множителем дистанции и облёт вокруг ЦЕНТРА
    // корабля. Облёт — жёсткий поворот всей связки камеры (и смещения, и взгляда ниже)
    // вокруг вертикали корабля через его центр: корабль остаётся в центре кадра, меняется
    // только угол обзора. `_orbit` переиспользуется ниже для доворота ориентации.
    const view = cameraView()
    _offset.multiplyScalar(view.distance)
    _up.set(0, 1, 0).applyQuaternion(state.quat)
    _orbit.setFromAxisAngle(_up, view.azimuth)
    _offset.applyQuaternion(_orbit)

    // Цель слежения — точка за кормой. Упреждение и пружину добавим НИЖЕ, после обновления
    // ориентации: камера «плавает» за кораблём, как шарик на нитке, а не приколочена к нему.
    const chaseAlpha = 1 - Math.exp(-CAMERA.CHASE_STIFFNESS * dt)
    _target.copy(state.pos).add(_offset)

    /**
     * КУРС С ТАНГАЖОМ (swing) камера доворачивает к носу МИНИМАЛЬНЫМ поворотом
     * (parallel transport), а не slerp'ом целевого кватерниона. Разница видна на
     * быстром развороте: когда камера отстаёт почти на 180°, slerp композитного
     * «курс+тангаж» режет угол через НАКРЕНЁННЫЕ ориентации — и камера делает кульбит
     * (замер `scratch/camera.ts`: до 73° крена, скачок 18° за кадр). Доворот идёт вдоль
     * ПУТИ носа и крен не выдумывает: тот же манёвр даёт 13° плавно, без скачка.
     *
     * КРЕН (twist) — настоящий крен корабля относительно курса камеры, отдельной
     * жёсткой пружиной: бочку и вираж с креном камера отыгрывает, а конический крен
     * от разворота — нет. Никакого lookAt: он строит базис через мировой «верх» и на
     * перевёрнутом корабле вырождается скачком.
     */
    _noseFwd.set(0, 0, -1).applyQuaternion(state.quat)

    if (held) {
      // В фигуре ориентацию не трогаем — камера смотрит замороженным курсом, корабль
      // крутится в центре кадра.
    } else if (running) {
      // Доворот курса на кратчайший поворот от «куда смотрит камера» к носу, долей dt.
      _camFwd.set(0, 0, -1).applyQuaternion(camSwing)
      _deltaRot.setFromUnitVectors(_camFwd, _noseFwd)
      camSwing
        .premultiply(_identity.identity().slerp(_deltaRot, 1 - Math.exp(-CAMERA.CHASE_ROT_STIFFNESS * dt)))
        .normalize()
      residualTwist(state.quat, camSwing, _twist)
      camTwist.slerp(_twist, 1 - Math.exp(-CAMERA.ROLL_STIFFNESS * dt))
    } else {
      // Стоящий мир: камера строго за носом, крен — по кораблю.
      camSwing.setFromUnitVectors(_refFwd, _noseFwd)
      residualTwist(state.quat, camSwing, _twist)
      camTwist.copy(_twist)
    }

    // Позиция: на ЖИВОМ мире — упреждение по скорости + мягкая ПРУЖИНА к цели. Оттого
    // камера плавает за кораблём и заметно отстаёт в манёврах — это желаемое ощущение.
    //
    // Упреждение — КОНСТАНТА (`VELOCITY_LEAD`), намеренно ЧУТЬ МЕНЬШЕ точного v·dt/a: оно
    // гасит транспортное запаздывание пружины не до нуля, а с запасом, поэтому камера всегда
    // держится СЛЕГКА позади — корабль ни в разгоне, ни на крейсере не выскакивает ВПЕРЁД
    // из кадра. Точное dt/a садилось ровно на корму и на первом же скачке скорости
    // (включении крейсера) перелетало вперёд — корабль пропадал.
    // На СТОЯЩЕМ мире — жёстко и без упреждения: иначе оно сместило бы неподвижную камеру.
    if (running) {
      // Упреждение считаем по скорости, ОБРЕЗАННОЙ базовым MAX_SPEED. Иначе на крейсере
      // (vel = MAX_SPEED × factor, до ×90) член vel·LEAD выносит цель на километры ВПЕРЁД
      // корабля — камера обгоняет, а корабль отстаёт назад. Раньше упреждения не было вовсе
      // и на сильном разгоне корабль уходил ВПЕРЁД из кадра — так и надо. Обрезка оставляет
      // упреждение для обычного манёвра, но на крейсере оно исчезающе мало против пройденного
      // пути, и корабль снова убегает вперёд, как прежде.
      const cap = player.spec.tuning.MAX_SPEED
      _lead.copy(state.vel)
      if (_lead.lengthSq() > cap * cap) _lead.setLength(cap)
      _target.addScaledVector(_lead, CAMERA.VELOCITY_LEAD)
      camera.position.lerp(_target, chaseAlpha)
    } else {
      camera.position.copy(_target)
    }

    // Тот же облёт — на взгляд: связка (позиция + ориентация) поворачивается вокруг
    // корабля как жёсткое тело, поэтому корабль не уплывает из центра при облёте.
    _desiredQuat.copy(camSwing).multiply(camTwist).multiply(_pitchDown).premultiply(_orbit)
    camera.quaternion.copy(_desiredQuat)

    // ── Крейсер: поле зрения и тряска ────────────────────────────────────────
    const factor = player.cruise.factor
    const cruiseFraction = clamp((factor - 1) / (CRUISE.MAX_FACTOR - 1), 0, 1)

    // Разгон = рост множителя. На установившемся ходу он нулевой, и тряска стихает.
    const growth = dt > 1e-6 ? (factor - previousFactor.current) / dt : 0
    previousFactor.current = factor

    // Нормируем на скорость экспоненциального роста: при полном разгоне ≈ 1.
    const accelerating = clamp(growth / (factor * CRUISE.CHARGE_RATE), 0, 1)

    const amplitude =
      CAMERA.SHAKE_MAX * cruiseFraction * (CAMERA.SHAKE_STEADY_FALLOFF + (1 - CAMERA.SHAKE_STEADY_FALLOFF) * accelerating)

    if (amplitude > 1e-4) {
      const time = session.world.time
      _shake.set(shakeAt(time, 1.7), shakeAt(time, 4.2), shakeAt(time, 8.9)).multiplyScalar(amplitude)
      // Смещение в связанных осях: трясёт кабину, а не мир.
      _shake.applyQuaternion(camera.quaternion)
      camera.position.add(_shake)
    }

    // Удар энергетической бомбы. Тоже в связанных осях и тоже мимо физики:
    // амплитуда выведена из возраста волны, своего таймера у неё нет.
    if (bombShake(session.world, _bombShake).lengthSq() > 1e-8) {
      camera.position.add(_bombShake.applyQuaternion(camera.quaternion))
    }

    // Толчок кабины на попадании по КОРПУСУ (щит пробит). Короткий вздрог + лёгкий увод
    // кадра — «как будто на миг тряхнуло управление». Мимо физики: домен лишь метит момент.
    const hullAge = (session.world.time - player.lastHullHitAt) / CAMERA.HULL_HIT_SHAKE_LIFE
    if (hullAge >= 0 && hullAge < 1) {
      const time = session.world.time
      const amp = CAMERA.HULL_HIT_SHAKE_MAX * (1 - hullAge)
      _shake.set(shakeAt(time, 3.1), shakeAt(time, 6.7), shakeAt(time, 0.9)).multiplyScalar(amp)
      camera.position.add(_shake.applyQuaternion(camera.quaternion))
    }

    const baseFov = RENDER.FOV_CHASE
    const wantFov = baseFov + RENDER.FOV_CRUISE_BOOST * cruiseFraction
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov = running ? camera.fov + (wantFov - camera.fov) * (1 - Math.exp(-6 * dt)) : wantFov
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld(true)
  })

  return null
}
