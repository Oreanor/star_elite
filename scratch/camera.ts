/**
 * Исследование «кульбитов» камеры преследования на развороте.
 *
 * Не тест — прогон для глаз. Воспроизводит РОВНО логику FlightCamera (swingTwist +
 * две пружины) без three-сцены и печатает крен камеры относительно мирового «верха»
 * по ходу манёвра. Кульбит = крен, уезжающий к ±180° там, где корабль не кренился.
 *
 * Запуск: npx tsx scratch/camera.ts
 */
import { Quaternion, Vector3 } from 'three'

// ── Константы камеры (зеркалят apps/web/src/render/config.ts) ─────────────────
const CHASE_PITCH = 0.065
const CHASE_ROT_STIFFNESS = 4.5
const ROLL_STIFFNESS = 12
const FIXED_DT = 1 / 60

const _rollAxis = new Vector3(0, 0, 1)
const _pitchDown = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -CHASE_PITCH)

const _axis = new Vector3()

// swingTwist — копия из FlightCamera.tsx
function swingTwist(q: Quaternion, axis: Vector3, outSwing: Quaternion, outTwist: Quaternion): void {
  _axis.set(q.x, q.y, q.z)
  const projection = _axis.dot(axis)
  outTwist.set(axis.x * projection, axis.y * projection, axis.z * projection, q.w)
  if (outTwist.lengthSq() < 1e-8) {
    outTwist.identity()
  } else {
    outTwist.normalize()
    if (outTwist.w < 0) outTwist.set(-outTwist.x, -outTwist.y, -outTwist.z, -outTwist.w)
  }
  outSwing.copy(outTwist).invert().premultiply(q)
}

/** Крен камеры: угол наклона её «верха» от мирового верха вокруг оси взгляда, градусы. */
function cameraRoll(camQuat: Quaternion): number {
  const up = new Vector3(0, 1, 0).applyQuaternion(camQuat)
  const fwd = new Vector3(0, 0, -1).applyQuaternion(camQuat)
  const worldUp = new Vector3(0, 1, 0)
  // Мировой верх, спроецированный в плоскость кадра (перпендикулярно взгляду).
  const ref = worldUp.clone().addScaledVector(fwd, -worldUp.dot(fwd))
  if (ref.lengthSq() < 1e-9) return 0 // смотрим прямо вверх/вниз — крен не определён
  ref.normalize()
  const camUp = up.clone().addScaledVector(fwd, -up.dot(fwd)).normalize()
  const cos = Math.max(-1, Math.min(1, camUp.dot(ref)))
  const sign = Math.sign(camUp.clone().cross(ref).dot(fwd))
  return (Math.acos(cos) * 180) / Math.PI * (sign || 1)
}

function run(label: string, shipQuatAt: (t: number) => Quaternion, seconds: number): void {
  const camSwing = new Quaternion()
  const camTwist = new Quaternion()
  const swing = new Quaternion()
  const twist = new Quaternion()
  const desired = new Quaternion()

  // Инициализация как на стоящем мире: жёстко ставим по первой позе.
  swingTwist(shipQuatAt(0), _rollAxis, swing, twist)
  camSwing.copy(swing)
  camTwist.copy(twist)

  let prevRoll = 0
  let maxRoll = 0
  let maxJump = 0
  const steps = Math.round(seconds / FIXED_DT)
  console.log(`\n=== ${label} ===`)
  for (let i = 1; i <= steps; i++) {
    const t = i * FIXED_DT
    const shipQ = shipQuatAt(t)
    swingTwist(shipQ, _rollAxis, swing, twist)
    camSwing.slerp(swing, 1 - Math.exp(-CHASE_ROT_STIFFNESS * FIXED_DT))
    camTwist.slerp(twist, 1 - Math.exp(-ROLL_STIFFNESS * FIXED_DT))
    desired.copy(camSwing).multiply(camTwist).multiply(_pitchDown)

    const roll = cameraRoll(desired)
    const jump = Math.abs(roll - prevRoll)
    maxRoll = Math.max(maxRoll, Math.abs(roll))
    maxJump = Math.max(maxJump, jump)
    // Печатаем каждые ~0.1с и подсвечиваем скачки.
    if (i % 6 === 0 || jump > 20) {
      console.log(
        `t=${t.toFixed(2)}  крен камеры=${roll.toFixed(1)}°` + (jump > 20 ? `   <== СКАЧОК +${jump.toFixed(0)}°` : ''),
      )
    }
    prevRoll = roll
  }
  console.log(`ИТОГ ${label}: макс |крен|=${maxRoll.toFixed(1)}°, макс скачок за кадр=${maxJump.toFixed(1)}°`)
}

// АЛЬТЕРНАТИВА: swing строится как минимальный (без крена) поворот от опорного «вперёд»
// к текущему носу. Крен по построению НУЛЕВОЙ, а остаток — настоящий крен корабля.
const _fwd = new Vector3()
const _refFwd = new Vector3(0, 0, -1)
function swingTwistAlt(q: Quaternion, outSwing: Quaternion, outTwist: Quaternion): void {
  _fwd.set(0, 0, -1).applyQuaternion(q)
  outSwing.setFromUnitVectors(_refFwd, _fwd) // heading+pitch без крена
  outTwist.copy(outSwing).invert().multiply(q) // остаток = крен вокруг продольной оси
  if (outTwist.w < 0) outTwist.set(-outTwist.x, -outTwist.y, -outTwist.z, -outTwist.w)
}

function runAlt(label: string, shipQuatAt: (t: number) => Quaternion, seconds: number): void {
  const camSwing = new Quaternion()
  const camTwist = new Quaternion()
  const swing = new Quaternion()
  const twist = new Quaternion()
  const desired = new Quaternion()
  swingTwistAlt(shipQuatAt(0), swing, twist)
  camSwing.copy(swing)
  camTwist.copy(twist)
  let prevRoll = 0
  let maxRoll = 0
  let maxJump = 0
  const steps = Math.round(seconds / FIXED_DT)
  for (let i = 1; i <= steps; i++) {
    const t = i * FIXED_DT
    swingTwistAlt(shipQuatAt(t), swing, twist)
    camSwing.slerp(swing, 1 - Math.exp(-CHASE_ROT_STIFFNESS * FIXED_DT))
    camTwist.slerp(twist, 1 - Math.exp(-ROLL_STIFFNESS * FIXED_DT))
    desired.copy(camSwing).multiply(camTwist).multiply(_pitchDown)
    const roll = cameraRoll(desired)
    maxRoll = Math.max(maxRoll, Math.abs(roll))
    maxJump = Math.max(maxJump, Math.abs(roll - prevRoll))
    prevRoll = roll
  }
  console.log(`АЛЬТ ${label}: макс |крен|=${maxRoll.toFixed(1)}°, макс скачок=${maxJump.toFixed(1)}°`)
}

// МЕТОД C: курс и тангаж — раздельные УГЛЫ, сглаживаются каждый своей пружиной по
// кратчайшей дуге. Кватернион курса+тангажа пересобирается каждый кадр как yaw·pitch,
// поэтому крен камеры НУЛЕВОЙ по построению — конинг не проникает, кульбита нет.
const _cfwd = new Vector3()
const _qYaw = new Quaternion()
const _qPitch = new Quaternion()
function shortestDelta(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}
function runAngles(label: string, shipQuatAt: (t: number) => Quaternion, seconds: number): void {
  _cfwd.set(0, 0, -1).applyQuaternion(shipQuatAt(0))
  let camYaw = Math.atan2(-_cfwd.x, -_cfwd.z)
  let camPitch = Math.asin(Math.max(-1, Math.min(1, _cfwd.y)))
  const twist = new Quaternion()
  const camTwist = new Quaternion()
  const swing = new Quaternion()
  const desired = new Quaternion()
  let prevRoll = 0
  let maxRoll = 0
  let maxJump = 0
  const steps = Math.round(seconds / FIXED_DT)
  for (let i = 1; i <= steps; i++) {
    const q = shipQuatAt(i * FIXED_DT)
    _cfwd.set(0, 0, -1).applyQuaternion(q)
    const tgtYaw = Math.atan2(-_cfwd.x, -_cfwd.z)
    const tgtPitch = Math.asin(Math.max(-1, Math.min(1, _cfwd.y)))
    const aRot = 1 - Math.exp(-CHASE_ROT_STIFFNESS * FIXED_DT)
    camYaw += shortestDelta(camYaw, tgtYaw) * aRot
    camPitch += shortestDelta(camPitch, tgtPitch) * aRot
    // Настоящий крен корабля — остаток после снятия курса+тангажа, сглаживаем жёстко.
    _qYaw.setFromAxisAngle(Y, camYaw)
    _qPitch.setFromAxisAngle(X, camPitch)
    swing.copy(_qYaw).multiply(_qPitch)
    twist.copy(swing).invert().multiply(q) // остаточный крен относительно сглаженного курса
    if (twist.w < 0) twist.set(-twist.x, -twist.y, -twist.z, -twist.w)
    camTwist.slerp(twist, 1 - Math.exp(-ROLL_STIFFNESS * FIXED_DT))
    desired.copy(swing).multiply(camTwist).multiply(_pitchDown)
    const roll = cameraRoll(desired)
    maxRoll = Math.max(maxRoll, Math.abs(roll))
    maxJump = Math.max(maxJump, Math.abs(roll - prevRoll))
    prevRoll = roll
  }
  console.log(`УГЛЫ ${label}: макс |крен|=${maxRoll.toFixed(1)}°, макс скачок=${maxJump.toFixed(1)}°`)
}

const Y = new Vector3(0, 1, 0)
const X = new Vector3(1, 0, 0)

// 1. Чистый разворот на 180° вокруг МИРОВОГО верха (нос уходит назад), корабль не кренится.
run('разворот 180° (yaw вокруг мирового верха)', (t) => {
  const yaw = Math.min(t / 2, 1) * Math.PI // за 2с довернуть на 180°
  return new Quaternion().setFromAxisAngle(Y, yaw)
}, 3)

// 2. Разворот на 180° с набором высоты: yaw + постоянный тангаж (как реальный вираж).
run('вираж 180° с тангажом 30°', (t) => {
  const yaw = Math.min(t / 2, 1) * Math.PI
  const q = new Quaternion().setFromAxisAngle(Y, yaw)
  q.multiply(new Quaternion().setFromAxisAngle(X, -0.52)) // ~30° нос вверх в связанных осях
  return q
}, 3)

// 3. «Пролетел в сторону» — рыскание почти на 180° через бок (yaw до 179°, чуть не доходя).
run('yaw до 179° и обратно', (t) => {
  const yaw = (179 * Math.PI / 180) * Math.sin(Math.min(t / 1.5, 1) * Math.PI / 2)
  return new Quaternion().setFromAxisAngle(Y, yaw)
}, 3)

// 4. Крутой вираж: yaw ПРОХОДИТ за 180° (до 210°) при тангаже 60° — здесь кульбит сильнее.
const steep = (t: number) => {
  const yaw = Math.min(t / 2, 1) * (210 * Math.PI / 180)
  const q = new Quaternion().setFromAxisAngle(Y, yaw)
  q.multiply(new Quaternion().setFromAxisAngle(X, -1.05)) // ~60° нос вверх
  return q
}
run('крутой вираж: yaw до 210°, тангаж 60°', steep, 3)

// 5. БЫСТРЫЙ разворот на 180° за 0.25с: камера отстаёт почти на 180°, и slerp курса
//    идёт неоднозначным путём — вот где ждём настоящий кульбит.
run('быстрый разворот 180° за 0.25с (камера догоняет)', (t) => {
  const yaw = Math.min(t / 0.25, 1) * Math.PI
  return new Quaternion().setFromAxisAngle(Y, yaw)
}, 2)

// 6. Быстрый разворот 180° с тангажом 20° — отставание почти на 180° при коническом крене.
run('быстрый разворот 180° за 0.25с + тангаж 20°', (t) => {
  const yaw = Math.min(t / 0.25, 1) * Math.PI
  const q = new Quaternion().setFromAxisAngle(Y, yaw)
  q.multiply(new Quaternion().setFromAxisAngle(X, -0.35))
  return q
}, 2)

// ── Сравнение методов на тех же манёврах ─────────────────────────────────────
console.log('\n----- АЛЬТЕРНАТИВНЫЙ swing (setFromUnitVectors, крен нулевой по построению) -----')
runAlt('вираж 180° с тангажом 30°', (t) => {
  const yaw = Math.min(t / 2, 1) * Math.PI
  const q = new Quaternion().setFromAxisAngle(Y, yaw)
  q.multiply(new Quaternion().setFromAxisAngle(X, -0.52))
  return q
}, 3)
runAlt('крутой вираж: yaw до 210°, тангаж 60°', steep, 3)

console.log('\n----- МЕТОД C: раздельные углы курса/тангажа -----')
const fast20 = (t: number) => {
  const yaw = Math.min(t / 0.25, 1) * Math.PI
  const q = new Quaternion().setFromAxisAngle(Y, yaw)
  q.multiply(new Quaternion().setFromAxisAngle(X, -0.35))
  return q
}
runAngles('вираж 180° с тангажом 30°', (t) => {
  const yaw = Math.min(t / 2, 1) * Math.PI
  const q = new Quaternion().setFromAxisAngle(Y, yaw)
  q.multiply(new Quaternion().setFromAxisAngle(X, -0.52))
  return q
}, 3)
runAngles('быстрый разворот 180° за 0.25с + тангаж 20°', fast20, 2)
runAngles('крутой вираж: yaw до 210°, тангаж 60°', steep, 3)
// Контроль: настоящая бочка (крен корабля) — крен камеры ДОЛЖЕН следовать (это не кульбит).
runAngles('честная бочка 360° (крен должен идти)', (t) => {
  const roll = Math.min(t / 1, 1) * 2 * Math.PI
  return new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll)
}, 2)
// Проблемный для углов случай: нос уходит через ВЕРТИКАЛЬ (петля через верх), тангаж 0→170°.
runAngles('петля через верх (тангаж до 170°) — вырождение углов', (t) => {
  const pitch = Math.min(t / 1.5, 1) * (170 * Math.PI / 180)
  return new Quaternion().setFromAxisAngle(X, -pitch)
}, 2.5)

// МЕТОД D: инкрементальный доворот камеры к носу минимальным поворотом (parallel transport).
// Ни абсолютного курса (нет вырождения на вертикали), ни slerp через полюс (нет кульбита):
// каждый кадр камера доворачивается на кратчайший поворот от своего «вперёд» к носу.
console.log('\n----- МЕТОД D: инкрементальный доворот к носу -----')
const _dcf = new Vector3()
const _dnf = new Vector3()
const _dq = new Quaternion()
const _ident = new Quaternion()
function runIncr(label: string, shipQuatAt: (t: number) => Quaternion, seconds: number): void {
  const camSwing = new Quaternion().copy(swingFwd(shipQuatAt(0)))
  const camTwist = new Quaternion()
  const twist = new Quaternion()
  const desired = new Quaternion()
  let prevRoll = 0, maxRoll = 0, maxJump = 0
  const steps = Math.round(seconds / FIXED_DT)
  for (let i = 1; i <= steps; i++) {
    const q = shipQuatAt(i * FIXED_DT)
    _dnf.set(0, 0, -1).applyQuaternion(q) // нос корабля
    _dcf.set(0, 0, -1).applyQuaternion(camSwing) // куда смотрит камера
    _dq.setFromUnitVectors(_dcf, _dnf) // минимальный доворот
    const aRot = 1 - Math.exp(-CHASE_ROT_STIFFNESS * FIXED_DT)
    camSwing.premultiply(_ident.identity().slerp(_dq, aRot)).normalize()
    twist.copy(camSwing).invert().multiply(q)
    if (twist.w < 0) twist.set(-twist.x, -twist.y, -twist.z, -twist.w)
    camTwist.slerp(twist, 1 - Math.exp(-ROLL_STIFFNESS * FIXED_DT))
    desired.copy(camSwing).multiply(camTwist).multiply(_pitchDown)
    const roll = cameraRoll(desired)
    maxRoll = Math.max(maxRoll, Math.abs(roll))
    maxJump = Math.max(maxJump, Math.abs(roll - prevRoll))
    prevRoll = roll
  }
  console.log(`ИНКР ${label}: макс |крен|=${maxRoll.toFixed(1)}°, макс скачок=${maxJump.toFixed(1)}°`)
}
function swingFwd(q: Quaternion): Quaternion {
  return new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), _dnf.set(0, 0, -1).applyQuaternion(q))
}
runIncr('вираж 180° с тангажом 30°', (t) => {
  const yaw = Math.min(t / 2, 1) * Math.PI
  return new Quaternion().setFromAxisAngle(Y, yaw).multiply(new Quaternion().setFromAxisAngle(X, -0.52))
}, 3)
runIncr('быстрый разворот 180° за 0.25с + тангаж 20°', fast20, 2)
runIncr('крутой вираж: yaw до 210°, тангаж 60°', steep, 3)
runIncr('петля через верх (тангаж до 170°)', (t) => {
  const pitch = Math.min(t / 1.5, 1) * (170 * Math.PI / 180)
  return new Quaternion().setFromAxisAngle(X, -pitch)
}, 2.5)
runIncr('честная бочка 360° (крен должен идти)', (t) => {
  const roll = Math.min(t / 1, 1) * 2 * Math.PI
  return new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll)
}, 2)
