import { UNIVERSE, type Universe } from '@elite/sim'
import { TORUS } from '../config'

/**
 * ВЕРШИНА РЕШЁТКИ ↔ УЗЕЛ ВСЕЛЕННОЙ.
 *
 * Это два разных пространства: вершины — геометрия S³ (их `NXI·NTHETA·NPHI`), узлы — куст
 * галактик из домена (их `UNIVERSE.COUNT`). Раньше индексы просто отождествлялись, и вершина
 * «дом» (0) попадала на узел 0 — а он НЕ галактика, а корень-монумент «Кресты». Оттого дом на
 * HUD подписывался «Кресты», как и сам крест: две одинаковые метки, между которыми Tab и
 * «глючил».
 *
 * Чиним перестановкой: крестовая вершина решётки — это и есть монумент (узел 0), а вершина
 * дома забирает освободившийся номер. Перестановка биективна, поэтому каждая вершина
 * по-прежнему ровно одна галактика, и ни одна не пропадает.
 */
export function nodeOfVertex(vertex: number): number {
  if (vertex === TORUS.MONUMENT_NODE) return UNIVERSE.MONUMENT_NODE
  if (vertex === UNIVERSE.MONUMENT_NODE) return TORUS.MONUMENT_NODE
  return vertex
}

/**
 * Обратное отображение. Перестановка меняет местами ровно два номера, поэтому она сама себе
 * обратна — отдельной таблицы не нужно, но имя нужно: на месте вызова видно, что во что.
 */
export const vertexOfNode = nodeOfVertex

/** Монумент — не галактика: влететь в него как в звёздную систему нельзя. */
export function isMonumentVertex(vertex: number): boolean {
  return vertex === TORUS.MONUMENT_NODE
}

/**
 * Имя того, что стоит в вершине. Монумент назван в самих данных (`UNIVERSE.MONUMENT_NAME`),
 * поэтому здесь ни одной оговорки: и HUD, и карта берут имя из узла и не могут разойтись.
 */
export function nameOfVertex(universe: Universe, vertex: number): string {
  return universe.nodes[nodeOfVertex(vertex)]?.name ?? ''
}
