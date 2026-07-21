/**
 * ГИПЕРТОР: замкнутая вселенная как сетка на 3-СФЕРЕ S³, снесённая в наш R³
 * СТЕРЕОГРАФИЧЕСКОЙ проекцией.
 *
 * Зачем именно так. Плоский тор заворачивается, но летит на тебя мёртвой прямой перспективой —
 * не «выворачивается». Гиперболика выворачивается, но тащит повторяющиеся копии. S³ снимает
 * оба минуса: она ЗАМКНУТА (конечна, заворачивается сама на себя), а стереографическая проекция
 * превращает её большие круги в дуги — и когда S³ ВРАЩАЕТСЯ (игрок стоит, вселенная едет),
 * картинка выворачивается наизнанку через полюс проекции. Это и есть классический «гипертор».
 *
 * Точка S³ — единичный 4-вектор (x,y,z,w). Сетка задана торическими координатами:
 *   x = cosξ·cosθ,  y = cosξ·sinθ,  z = sinξ·cosφ,  w = sinξ·sinφ
 * θ и φ — два независимых круга (два «тора»), ξ — вложенность одного в другой. Линии по θ и φ
 * замкнуты в кольца — отсюда тор. Движение = вращение S³ в плоскости (z,w): точки проходят
 * через полюс w=1, улетают на бесконечность и возвращаются — поток с выворотом.
 *
 * Чистая геометрия: ни three, ни времени внутри (углы приходят параметром). Буферы наружу
 * выделяются один раз в слое; здесь только генерация сетки и преобразования на месте.
 */

export interface HypertorusGrid {
  /** Вершины S³ подряд по 4 числа (x,y,z,w), единичные. */
  verts: Float64Array
  /** Рёбра как пары индексов вершин (i,j) подряд. Дуга между ними — большой круг S³. */
  edges: Int32Array
  vertCount: number
  edgeCount: number
  /** Сетка генерации — для отладки/тюнинга. */
  nxi: number
  ntheta: number
  nphi: number
}

/**
 * Построить сетку гипертора: `nxi` вложенных торов, на каждом сетка `ntheta`×`nphi`.
 *
 * ξ берём строго ВНУТРИ (0, π/2), минуя полюса: там тор вырождается в окружность, а деления
 * по φ (при ξ→0) или θ (при ξ→π/2) схлопнулись бы в одну точку. Кольца по θ и φ замыкаются
 * (обход по модулю) — вселенная заворачивается.
 */
export function buildHypertorusGrid(nxi: number, ntheta: number, nphi: number): HypertorusGrid {
  const vertCount = nxi * ntheta * nphi
  const verts = new Float64Array(vertCount * 4)
  const idx = (a: number, t: number, p: number): number => (a * ntheta + t) * nphi + p

  for (let a = 0; a < nxi; a++) {
    // ξ ∈ (0, π/2), равномерно, без самих полюсов.
    const xi = ((a + 1) / (nxi + 1)) * (Math.PI / 2)
    const cx = Math.cos(xi)
    const sx = Math.sin(xi)
    for (let t = 0; t < ntheta; t++) {
      const theta = (t / ntheta) * Math.PI * 2
      const ct = Math.cos(theta)
      const st = Math.sin(theta)
      for (let p = 0; p < nphi; p++) {
        const phi = (p / nphi) * Math.PI * 2
        const o = idx(a, t, p) * 4
        verts[o] = cx * ct
        verts[o + 1] = cx * st
        verts[o + 2] = sx * Math.cos(phi)
        verts[o + 3] = sx * Math.sin(phi)
      }
    }
  }

  // Рёбра: кольца по θ и по φ (замкнуты), плюс перемычки по ξ между вложенными торами.
  const edgeList: number[] = []
  for (let a = 0; a < nxi; a++) {
    for (let t = 0; t < ntheta; t++) {
      for (let p = 0; p < nphi; p++) {
        const here = idx(a, t, p)
        edgeList.push(here, idx(a, (t + 1) % ntheta, p)) // кольцо θ
        edgeList.push(here, idx(a, t, (p + 1) % nphi)) // кольцо φ
        if (a + 1 < nxi) edgeList.push(here, idx(a + 1, t, p)) // перемычка ξ
      }
    }
  }

  return {
    verts,
    edges: Int32Array.from(edgeList),
    vertCount,
    edgeCount: edgeList.length / 2,
    nxi,
    ntheta,
    nphi,
  }
}

/**
 * ПОЗА пилота в S³ — элемент SO(4), матрица 4×4 (строки подряд). Полёт сквозь тор = накопление
 * этой матрицы малыми вращениями от ввода: движение вперёд — поворот в плоскости (оси, w), взгляд
 * — поворот в пространственной плоскости. Стоя на месте, поза = единица (узел под тобой).
 */
export type Pose4 = Float64Array

export function identity4(out: Pose4 = new Float64Array(16)): Pose4 {
  out.fill(0)
  out[0] = 1
  out[5] = 1
  out[10] = 1
  out[15] = 1
  return out
}

/**
 * Вращение S³ в плоскости, натянутой на пространственное направление n=(nx,ny,nz) и ось w,
 * на угол `angle`. Это «полёт вперёд» по направлению n: точки уходят к оси w (в бесконечность
 * стереопроекции) и обратно — вселенная течёт сквозь игрока. n нормируется сам.
 *
 *   M = I + (c−1)(n nᵀ + ew ewᵀ) + s(n ewᵀ − ew nᵀ),  ось w = индекс 3.
 */
export function rotPlaneW(
  nx: number,
  ny: number,
  nz: number,
  angle: number,
  out: Pose4 = new Float64Array(16),
): Pose4 {
  const len = Math.hypot(nx, ny, nz)
  if (len < 1e-9) return identity4(out)
  const ux = nx / len
  const uy = ny / len
  const uz = nz / len
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const k = c - 1
  out[0] = 1 + k * ux * ux
  out[1] = k * ux * uy
  out[2] = k * ux * uz
  out[3] = s * ux
  out[4] = k * uy * ux
  out[5] = 1 + k * uy * uy
  out[6] = k * uy * uz
  out[7] = s * uy
  out[8] = k * uz * ux
  out[9] = k * uz * uy
  out[10] = 1 + k * uz * uz
  out[11] = s * uz
  out[12] = -s * ux
  out[13] = -s * uy
  out[14] = -s * uz
  out[15] = c
  return out
}

const _mul4Tmp = new Float64Array(16)

/** Произведение 4×4: out = A·B. Допускает совпадение out с любым входом. */
export function mul4(A: Pose4, B: Pose4, out: Pose4 = new Float64Array(16)): Pose4 {
  const r = _mul4Tmp
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += A[i * 4 + k]! * B[k * 4 + j]!
      r[i * 4 + j] = sum
    }
  }
  out.set(r)
  return out
}

/**
 * Грам-Шмидт по строкам: держит позу в SO(4). Малые повороты копят float-ошибку, матрица
 * «плывёт», сетка едет наискось. Дёшево ортонормируем раз в кадр — узлы остаются на S³.
 */
export function orthonormalize4(m: Pose4): void {
  for (let i = 0; i < 4; i++) {
    const ri = i * 4
    let a = m[ri]!
    let b = m[ri + 1]!
    let c = m[ri + 2]!
    let d = m[ri + 3]!
    for (let j = 0; j < i; j++) {
      const rj = j * 4
      const pa = m[rj]!
      const pb = m[rj + 1]!
      const pc = m[rj + 2]!
      const pd = m[rj + 3]!
      const dot = a * pa + b * pb + c * pc + d * pd
      a -= dot * pa
      b -= dot * pb
      c -= dot * pc
      d -= dot * pd
    }
    const len = Math.hypot(a, b, c, d) || 1
    m[ri] = a / len
    m[ri + 1] = b / len
    m[ri + 2] = c / len
    m[ri + 3] = d / len
  }
}

/**
 * Применить позу ко всем вершинам сетки: out[i] = pose · verts[i]. Двигает всю решётку под
 * накопленным полётом игрока. Пишет в `out` (раскладка по 4), аллокаций нет.
 */
export function applyPose(grid: HypertorusGrid, pose: Pose4, out: Float64Array): void {
  const v = grid.verts
  const n = grid.vertCount
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const x = v[o]!
    const y = v[o + 1]!
    const z = v[o + 2]!
    const w = v[o + 3]!
    out[o] = pose[0]! * x + pose[1]! * y + pose[2]! * z + pose[3]! * w
    out[o + 1] = pose[4]! * x + pose[5]! * y + pose[6]! * z + pose[7]! * w
    out[o + 2] = pose[8]! * x + pose[9]! * y + pose[10]! * z + pose[11]! * w
    out[o + 3] = pose[12]! * x + pose[13]! * y + pose[14]! * z + pose[15]! * w
  }
}

/**
 * Стереографическая проекция точки S³ из полюса w=+1 в R³, домноженная на масштаб сцены.
 * `w→1` (у полюса) уходит в бесконечность; `w→−1` жмётся к центру. Возвращает и «глубину»
 * `depth = (1−w)/2 ∈ [0,1]` — по ней слой гасит дальние (у полюса) в туман.
 */
export function stereoProject(
  rx: number,
  ry: number,
  rz: number,
  rw: number,
  scale: number,
  out: { x: number; y: number; z: number; depth: number },
): void {
  const k = scale / Math.max(1e-4, 1 - rw)
  out.x = rx * k
  out.y = ry * k
  out.z = rz * k
  out.depth = (1 - rw) * 0.5
}

/**
 * Точка на большом круге S³ между вершинами i и j (в повёрнутом буфере) на доле t — сферическая
 * интерполяция (slerp). Стереографический образ большого круга — дуга окружности, поэтому ребро
 * рисуется изогнутой трубкой, а не хордой. Пишет 4-вектор в `out`.
 */
export function slerpS3(
  rot: Float64Array,
  i: number,
  j: number,
  t: number,
  out: Float64Array,
): void {
  const oi = i * 4
  const oj = j * 4
  const ax = rot[oi]!
  const ay = rot[oi + 1]!
  const az = rot[oi + 2]!
  const aw = rot[oi + 3]!
  const bx = rot[oj]!
  const by = rot[oj + 1]!
  const bz = rot[oj + 2]!
  const bw = rot[oj + 3]!
  let dot = ax * bx + ay * by + az * bz + aw * bw
  dot = dot < -1 ? -1 : dot > 1 ? 1 : dot
  const om = Math.acos(dot)
  const so = Math.sin(om)
  if (so < 1e-6) {
    // Почти совпали — линейно, потом нормируем.
    out[0] = ax + (bx - ax) * t
    out[1] = ay + (by - ay) * t
    out[2] = az + (bz - az) * t
    out[3] = aw + (bw - aw) * t
    return
  }
  const wa = Math.sin((1 - t) * om) / so
  const wb = Math.sin(t * om) / so
  out[0] = wa * ax + wb * bx
  out[1] = wa * ay + wb * by
  out[2] = wa * az + wb * bz
  out[3] = wa * aw + wb * bw
}
