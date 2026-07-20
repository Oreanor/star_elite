import {
  applyMat,
  boost,
  identity,
  invertLorentz,
  mulMat,
  toBall,
  vec4,
  type BushTravel,
  type Mat4,
  type Universe,
  type Vec4,
} from '@elite/sim'

/**
 * ВЗГЛЯД С КУСТА: где сидит игрок и как из этого спроецировать всю вселенную.
 *
 * Домен держит узлы в ОДНОМ кадре (корень в начале координат). Чтобы вывернуть куст
 * вокруг игрока — «он стоит, вселенная движется», — берём изометрию его текущего места
 * и применяем ОБРАТНУЮ ко всем узлам: тогда игрок садится в начало координат, а соседи
 * расходятся веером. Это и есть вся «гиперболика», без единого частного случая.
 *
 * Дальше H³ → шар Пуанкаре (`toBall`): экспоненциальная геометрия проявляется сама —
 * дальние галактики скучиваются к границе шара. Слой рендера умножает шар на свой радиус
 * в метрах и ставит пузыри.
 *
 * Чистая проекция: ни three, ни времени. Буферы переиспользуются — ни одной аллокации
 * в кадре (проекция зовётся каждый кадр по тысяче узлов).
 */

// Скретч уровня модуля: изометрия места игрока и обратная к ней. Наружу не отдаются.
const _fromInv: Mat4 = new Float64Array(16)
const _rel: Mat4 = new Float64Array(16)
const _step: Mat4 = new Float64Array(16)
const _frame: Mat4 = new Float64Array(16)

/**
 * Изометрия МЕСТА ИГРОКА в общем кадре куста: узел, если стоим, либо точка на ребре при
 * ходе. Ребро между двумя узлами — чистый буст (кривизна прячется в самих `transform`ах),
 * поэтому доля пути `t` — это тот же буст, взятый на долю расстояния.
 */
function playerFrame(universe: Universe, bush: BushTravel, out: Mat4): Mat4 {
  const from = universe.nodes[bush.node]
  if (!from) return identity(out)
  if (bush.edgeTo < 0) {
    out.set(from.transform)
    return out
  }
  const to = universe.nodes[bush.edgeTo]
  if (!to) {
    out.set(from.transform)
    return out
  }
  // relative = from⁻¹ · to — чистый буст «из узла в соседа» в кадре узла.
  invertLorentz(from.transform, _fromInv)
  mulMat(_fromInv, to.transform, _rel)
  // Полное расстояние ребра: у буста временна́я компонента = cosh(d).
  const d = Math.acosh(Math.max(1, _rel[0]!))
  if (d < 1e-9) {
    out.set(from.transform)
    return out
  }
  // Направление — первая строка буста (sh·n); `boost` нормирует его сам. Доля пути `t`
  // масштабирует РАССТОЯНИЕ, а не матрицу: на полпути буст ровно на d/2.
  const t = bush.t < 0 ? 0 : bush.t > 1 ? 1 : bush.t
  boost(_rel[1]!, _rel[2]!, _rel[3]!, d * t, _step)
  return mulMat(from.transform, _step, out)
}

export interface BushProjection {
  /** Координаты узлов в шаре Пуанкаре (радиус 1), кадр игрока. Умножается на радиус слоя. */
  ball: Float32Array
  /** Туман/LOD: 1/cosh(dist) = 1/w. Близкие → 1, дальние → 0. */
  fog: Float32Array
  /** Точки узлов в H³ кадра игрока — из них строятся середины геодезических (рёбра). */
  hPoints: Vec4[]
  count: number
}

export function makeBushProjection(count: number): BushProjection {
  return {
    ball: new Float32Array(count * 3),
    fog: new Float32Array(count),
    hPoints: Array.from({ length: count }, () => vec4()),
    count,
  }
}

const _ball = { x: 0, y: 0, z: 0 }

/**
 * Спроецировать всю вселенную в кадр игрока. Заполняет буферы `proj` на месте.
 *
 * `g = playerFrame⁻¹` — та самая инверсия, что сажает игрока в начало координат и
 * выворачивает куст вокруг него.
 */
export function projectBush(universe: Universe, bush: BushTravel, proj: BushProjection): void {
  playerFrame(universe, bush, _frame)
  const g = invertLorentz(_frame, _fromInv)
  const n = Math.min(proj.count, universe.nodes.length)
  for (let i = 0; i < n; i++) {
    const node = universe.nodes[i]!
    const p = proj.hPoints[i]!
    applyMat(g, node.pos, p)
    // dist = acosh(-mdot(O,p)) = acosh(p.w); значит 1/cosh(dist) = 1/p.w. Даром из w.
    proj.fog[i] = 1 / Math.max(1, p.w)
    toBall(p, _ball)
    proj.ball[i * 3] = _ball.x
    proj.ball[i * 3 + 1] = _ball.y
    proj.ball[i * 3 + 2] = _ball.z
  }
}
