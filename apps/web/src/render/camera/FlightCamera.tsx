import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { CRUISE, clamp } from '@elite/sim'
import { manoeuvreHoldsCamera } from '../../app/control/playerController'
import { useSession } from '../../app/GameContext'
import { bombShake } from '../bombFeel'
import { CAMERA, RENDER } from '../config'

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
const _swing = new Quaternion()
const _twist = new Quaternion()
const _desiredQuat = new Quaternion()
const _shake = new Vector3()
const _bombShake = new Vector3()
const _axis = new Vector3()
const _camRot = new Quaternion()

const _identity = /* @__PURE__ */ new Quaternion()
/** Ось крена в связанных осях. Нос смотрит в −Z, значит крутимся вокруг Z. */
const _rollAxis = /* @__PURE__ */ new Vector3(0, 0, 1)

/**
 * Постоянный наклон камеры вниз. Поворот вокруг локальной X на отрицательный угол
 * уводит взгляд (−Z) вниз — так корабль оказывается в центре кадра, а не под ним.
 */
const _pitchDown = /* @__PURE__ */ new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -CAMERA.CHASE_PITCH)

/**
 * Разложение поворота на крен вокруг оси и всё остальное (курс с тангажом).
 *
 * Нужно, чтобы камера следовала за НАПРАВЛЕНИЕМ носа, но не крутилась вместе
 * с кораблём. В бочке корабль проворачивается на полный оборот; камера, которая
 * повторяет его кватернион целиком, переворачивает кадр и вызывает тошноту.
 * Здесь крен отделяется и берётся долей — или не берётся вовсе.
 */
function swingTwist(q: Quaternion, axis: Vector3, outSwing: Quaternion, outTwist: Quaternion): void {
  // Проекция векторной части кватерниона на ось и есть его «закрученная» часть.
  _axis.set(q.x, q.y, q.z)
  const projection = _axis.dot(axis)
  outTwist.set(axis.x * projection, axis.y * projection, axis.z * projection, q.w).normalize()
  // swing = q · twist⁻¹
  outSwing.copy(outTwist).invert().premultiply(q)
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
    const cockpit = session.view === 'cockpit'

    /**
     * В петле камера НЕ едет за носом: она держит свою ориентацию и просто
     * сопровождает корабль, пока тот обходит круг. Поэтому и смещение считается
     * от ориентации КАМЕРЫ, а не корабля — иначе точка съёмки уходила бы вместе
     * с носом, и петли не было бы видно вовсе.
     *
     * Когда фигура кончится, пружина сама перенесёт камеру в хвост. После
     * разворота хвост оказывается с другой стороны — это и есть «перебежать».
     */
    const held = !cockpit && manoeuvreHoldsCamera(session.intent)
    // Бочка — крен без смены курса. Камера в ней не гонится ни за креном, ни за
    // положением: она замирает за хвостом, а корабль крутится в центре кадра.
    const barrel = !cockpit && session.intent.manoeuvre.kind === 'barrel'

    const offset = cockpit ? CAMERA.COCKPIT_OFFSET : CAMERA.CHASE_OFFSET
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
    } else if (barrel) {
      // Смещение считаем от ЗАСТЫВШЕГО курса камеры, а не от кватерниона корабля:
      // иначе точка съёмки проворачивается вокруг оси крена и орбитой обходит
      // корабль — та самая «камера сходит с ума» посреди бочки.
      _offset.applyQuaternion(camSwing)
    } else {
      _offset.applyQuaternion(state.quat)
    }
    _target.copy(state.pos).add(_offset)

    if (cockpit) {
      // Кабина жёстко привязана к кораблю: никакой пружины. Здесь крен настоящий —
      // пилот сидит внутри и крутится вместе с кораблём.
      camera.position.copy(_target)
      camera.quaternion.copy(state.quat)
    } else {
      /**
       * Ориентация корабля разбирается на КУРС С ТАНГАЖОМ (swing) и КРЕН (twist),
       * и каждая часть догоняется своей пружиной. Никакого lookAt: он строит базис
       * через мировой «верх», и на перевёрнутом корабле вырождается — камера
       * скачком переворачивается ровно на середине бочки.
       *
       * Две пружины нужны потому, что физика больше не выравнивает корабль сама.
       * Курс камера подхватывает мягко — отсюда ощущение массы в вираже. Крен
       * подхватывает жёстко, иначе закрученный кадр таким и останется навсегда.
       */
      swingTwist(state.quat, _rollAxis, _swing, _twist)

      // В бочке крен не передаём вовсе: это фигура пилотажа, а не вираж.
      const wantTwist = barrel ? _identity : _twist

      if (held) {
        // Камера стоит и ждёт. Ориентацию не трогаем совсем — только позицию,
        // которая уже посчитана от этой самой ориентации.
        camera.position.lerp(_target, 1 - Math.exp(-CAMERA.CHASE_STIFFNESS * dt))
      } else if (running) {
        // В бочке курс камеры ЗАМИРАЕТ: он и так не меняется (бочка не поворачивает),
        // а разложение крена у 180° вырождается и швыряет swing — отсюда рывок кадра.
        if (!barrel) camSwing.slerp(_swing, 1 - Math.exp(-CAMERA.CHASE_ROT_STIFFNESS * dt))
        camTwist.slerp(wantTwist, 1 - Math.exp(-CAMERA.ROLL_STIFFNESS * dt))
        camera.position.lerp(_target, 1 - Math.exp(-CAMERA.CHASE_STIFFNESS * dt))
      } else {
        camSwing.copy(_swing)
        camTwist.copy(wantTwist)
        camera.position.copy(_target)
      }

      _desiredQuat.copy(camSwing).multiply(camTwist).multiply(_pitchDown)
      camera.quaternion.copy(_desiredQuat)
    }

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

    const baseFov = cockpit ? RENDER.FOV_COCKPIT : RENDER.FOV_CHASE
    const wantFov = baseFov + RENDER.FOV_CRUISE_BOOST * cruiseFraction
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov = running ? camera.fov + (wantFov - camera.fov) * (1 - Math.exp(-6 * dt)) : wantFov
      camera.updateProjectionMatrix()
    }
  })

  return null
}
