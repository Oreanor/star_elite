/**
 * Гиперболическое пространство H³ на гиперболоиде Минковского.
 *
 * Зачем оно вообще: куст из тысячи галактик в евклидовом пространстве либо сминается
 * в ком, либо расползается так, что ветки не видно. В H³ объём растёт экспоненциально
 * с радиусом, поэтому у каждой развилки свой горизонт — крону нельзя окинуть взглядом,
 * и при движении узор перестраивается по строгому, но неочевидному закону.
 *
 * Точки — 4-векторы с сигнатурой (−,+,+,+) на верхней поле `mdot(p,p) = −1`, `w > 0`.
 * Начало координат — `ORIGIN = [1,0,0,0]`.
 *
 * Почему именно гиперболоид, а не сразу шар Пуанкаре: изометрии H³ здесь — в точности
 * матрицы Лоренца 4×4. Перелёт, поворот камеры и «выворачивание» мира оказываются одной
 * и той же алгеброй, без единого частного случая на краю. Шар Пуанкаре нужен только для
 * ПРОЕКЦИИ на экран, и в него переводят в самом конце (`toBall`).
 *
 * Всё чистое: ни игры, ни времени, ни ГПСЧ. Матрицы — `Float64Array(16)`, строки подряд.
 */

export interface Vec4 {
  w: number
  x: number
  y: number
  z: number
}

export type Mat4 = Float64Array

export const ORIGIN: Readonly<Vec4> = { w: 1, x: 0, y: 0, z: 0 }

export function vec4(w = 1, x = 0, y = 0, z = 0): Vec4 {
  return { w, x, y, z }
}

/** Скалярное произведение Минковского. Знак у временной компоненты — минус. */
export function mdot(a: Vec4, b: Vec4): number {
  return -a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * Вернуть точку на гиперболоид. Обязательна после цепочки бустов: float копит ошибку,
 * и точка сползает с поверхности, а `acosh` от такой даёт NaN.
 */
export function normalizeH(v: Vec4): Vec4 {
  v.w = Math.sqrt(1 + v.x * v.x + v.y * v.y + v.z * v.z)
  return v
}

/** Гиперболическое расстояние. `acosh` не терпит аргумента меньше единицы — зажимаем. */
export function distanceH(a: Vec4, b: Vec4): number {
  return Math.acosh(Math.max(1, -mdot(a, b)))
}

export function identity(out: Mat4 = new Float64Array(16)): Mat4 {
  out.fill(0)
  out[0] = 1
  out[5] = 1
  out[10] = 1
  out[15] = 1
  return out
}

/**
 * Буст (перелёт) на расстояние `d` вдоль единичного направления (dx,dy,dz).
 *
 * Это гиперболический поворот: там, где у обычного стоят cos/sin, здесь cosh/sinh.
 * Матрица собирается сразу в произвольном направлении, без «повернуть-забустить-вернуть»:
 * пространственный блок — единица плюс (cosh−1)·nnᵀ, временная строка и столбец — sinh·n.
 */
export function boost(dx: number, dy: number, dz: number, d: number, out: Mat4 = new Float64Array(16)): Mat4 {
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-12) return identity(out)
  const nx = dx / len
  const ny = dy / len
  const nz = dz / len
  const ch = Math.cosh(d)
  const sh = Math.sinh(d)
  const k = ch - 1

  out[0] = ch
  out[1] = sh * nx
  out[2] = sh * ny
  out[3] = sh * nz

  out[4] = sh * nx
  out[5] = 1 + k * nx * nx
  out[6] = k * nx * ny
  out[7] = k * nx * nz

  out[8] = sh * ny
  out[9] = k * ny * nx
  out[10] = 1 + k * ny * ny
  out[11] = k * ny * nz

  out[12] = sh * nz
  out[13] = k * nz * nx
  out[14] = k * nz * ny
  out[15] = 1 + k * nz * nz
  return out
}

/**
 * Обратное лоренцево преобразование: L⁻¹ = G·Lᵀ·G, где G = diag(−1,1,1,1).
 *
 * Формула, а не общий обратный: все наши матрицы — изометрии H³ (бусты и повороты), а у
 * них обратное считается транспонированием со сменой знака у временны́х компонент. Нужно,
 * чтобы смотреть НА КУСТ ИЗ СВОЕГО УЗЛА: применяем инверсию его кадра ко всем позициям, и
 * текущий узел садится в начало координат, а вселенная выворачивается вокруг игрока.
 */
export function invertLorentz(m: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  // (G·Mᵀ·G)[i][j] = s(i)·s(j)·M[j][i], где s(0)=−1, s(1..3)=+1.
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const sign = (i === 0 ? -1 : 1) * (j === 0 ? -1 : 1)
      out[i * 4 + j] = sign * m[j * 4 + i]!
    }
  }
  return out
}

/** Поворот в пространственной плоскости (осей 1..3): обычный евклидов, время не трогает. */
export function rotate(axisA: 1 | 2 | 3, axisB: 1 | 2 | 3, angle: number, out: Mat4 = new Float64Array(16)): Mat4 {
  identity(out)
  if (axisA === axisB) return out
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  out[axisA * 4 + axisA] = c
  out[axisB * 4 + axisB] = c
  out[axisA * 4 + axisB] = -s
  out[axisB * 4 + axisA] = s
  return out
}

/** Произведение матриц: out = a·b. Допускает совпадение out с любым из входов. */
export function mulMat(a: Mat4, b: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  const r = _mulTmp
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[i * 4 + k]! * b[k * 4 + j]!
      r[i * 4 + j] = s
    }
  }
  out.set(r)
  return out
}
const _mulTmp = new Float64Array(16)

/** Применить изометрию к точке. Допускает совпадение out и v. */
export function applyMat(m: Mat4, v: Vec4, out: Vec4 = vec4()): Vec4 {
  const { w, x, y, z } = v
  out.w = m[0]! * w + m[1]! * x + m[2]! * y + m[3]! * z
  out.x = m[4]! * w + m[5]! * x + m[6]! * y + m[7]! * z
  out.y = m[8]! * w + m[9]! * x + m[10]! * y + m[11]! * z
  out.z = m[12]! * w + m[13]! * x + m[14]! * y + m[15]! * z
  return out
}

/**
 * Точка на расстоянии `t` от НАЧАЛА КООРДИНАТ вдоль единичного направления.
 * Геодезическая из `ORIGIN` — это и есть «прямолинейный полёт» в H³.
 */
export function expMapOrigin(dx: number, dy: number, dz: number, t: number, out: Vec4 = vec4()): Vec4 {
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-12) {
    out.w = 1
    out.x = 0
    out.y = 0
    out.z = 0
    return out
  }
  const ch = Math.cosh(t)
  const sh = Math.sinh(t)
  out.w = ch
  out.x = (sh * dx) / len
  out.y = (sh * dy) / len
  out.z = (sh * dz) / len
  return out
}

/**
 * Середина геодезической: полусумма, поделённая на СВОЮ ЖЕ норму Минковского.
 *
 * Именно на минковскую, а не через `normalizeH`: та чинит сползание, пересчитывая `w`
 * из пространственных частей, и годится лишь когда точка УЖЕ почти на поверхности.
 * Сумма двух далёких точек лежит глубоко внутри, и такая «починка» сдвинула бы её
 * вдоль оси времени — середина уехала бы к более близкому концу.
 */
export function geodesicMidpoint(a: Vec4, b: Vec4, out: Vec4 = vec4()): Vec4 {
  out.w = a.w + b.w
  out.x = a.x + b.x
  out.y = a.y + b.y
  out.z = a.z + b.z
  const n = Math.sqrt(Math.max(1e-12, -mdot(out, out)))
  out.w /= n
  out.x /= n
  out.y /= n
  out.z /= n
  return out
}

/**
 * Гиперболоид → шар Пуанкаре (радиус 1), стереографически. Только для ОТРИСОВКИ:
 * экспоненциальная геометрия проявляется сама — дальние точки скучиваются к границе
 * шара, и неевклидовость читается глазом без единого трюка.
 *
 * Пишет в три числа: у шара временной компоненты нет.
 */
export function toBall(v: Vec4, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const k = 1 / (v.w + 1)
  out.x = v.x * k
  out.y = v.y * k
  out.z = v.z * k
  return out
}
