import { makeRng, type Rng } from '../../core/math'
import {
  ORIGIN,
  applyMat,
  boost,
  distanceH,
  identity,
  mulMat,
  vec4,
  type Mat4,
  type Vec4,
} from '../../core/math/hyperbolic'
import { galaxyName } from '../galaxy/names'

/**
 * ВСЕЛЕННАЯ: куст из тысячи галактик в H³.
 *
 * Зерно вселенной — СЛОВО. Бог произносит его, и из него выводится всё: сколько у какой
 * галактики ветвей, куда они смотрят, как их зовут и какое зерно у каждой галактики
 * внутри. Одно слово — одна вселенная, у всех игроков одинаковая.
 *
 * Куст, а не сфера и не решётка: в H³ объём растёт экспоненциально с радиусом, поэтому
 * дерево с ветвлением 2..4 расходится, не сминаясь и не пересекая само себя. Крону нельзя
 * окинуть взглядом — у каждой развилки свой горизонт.
 *
 * Слой ДОМЕННЫЙ: ни рендера, ни времени, ни `Math.random`. Рендер берёт готовые позиции
 * и проецирует их сам (см. `toBall`).
 */

export const UNIVERSE = {
  /** Сколько узлов в кусте. Корень — не галактика (см. `MONUMENT_NODE`), остальные — да. */
  COUNT: 1000,
  /**
   * КОРЕНЬ КУСТА — центр вселенной, и это НЕ галактика.
   *
   * Там нет ни звёзд, ни систем: особое пространство, в котором висит один монумент —
   * крест «Кресты». На графе узел рисуется крестом, а не шариком, и настоящей моделью.
   * Прилететь туда можно по тем же рельсам, что и во всякую галактику, но карту галактики
   * там открывать не над чем: показывать нечего, кроме самого монумента.
   *
   * Раньше крест стоял у общего старта — то есть у игрока во дворе. Монумент, до которого
   * лететь одну минуту, перестаёт быть монументом.
   */
  MONUMENT_NODE: 0,
  /** Имя монумента. Не выводится из зерна: он один на вселенную и зовётся всегда так. */
  MONUMENT_NAME: 'Кресты',
  /** Ветвление куста: сколько ДЕТЕЙ у узла. Корню достаётся на одного больше. */
  BRANCH_MIN: 2,
  BRANCH_MAX: 4,
  /** Длина ребра в гиперболических единицах. Больше — быстрее «раскрытие» кроны. */
  EDGE_MIN: 0.8,
  EDGE_MAX: 1.4,
  /**
   * Насколько ветка отталкивается от направления на родителя: косинус угла между ними
   * не должен превышать этого. Иначе ребёнок ложится поверх родителя и куст слипается.
   */
  PARENT_REPEL: -0.15,
} as const

/** Узел куста — одна галактика. */
export interface GalaxyNode {
  index: number
  name: string
  /** Зерно САМОЙ галактики: из него уже растут её звёзды (`generateGalaxy`). */
  seed: number
  /** −1 у корня. */
  parent: number
  children: number[]
  /** Положение в общем кадре H³ (корень — в начале координат). */
  pos: Vec4
  /** Изометрия «корень → этот узел». Ею рендер и движение переносят кадр. */
  transform: Mat4
  /** Шагов от корня. Нужен и для тумана, и для отладки. */
  depth: number
}

export interface Universe {
  /** Слово, из которого всё выведено. */
  word: string
  seed: number
  nodes: GalaxyNode[]
}

/**
 * Слово → число. Ровно тот же алгоритм обязан жить на сервере, поэтому он простой и
 * оговорённый: FNV-1a по кодовым точкам, приведённый к 31 биту.
 *
 * Регистр и края строки не значат ничего: «Начало», «начало » и «НАЧАЛО» — одно слово
 * и одна вселенная. Иначе игрок, набравший то же слово с заглавной, попал бы в другую.
 */
export function universeSeedFromWord(word: string): number {
  const norm = word.trim().toLowerCase()
  let h = 0x811c9dc5
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.codePointAt(i)!
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 0x7fffffff
}

/** Зерно отдельной галактики по её номеру. Своя соль, чтобы не совпасть с зерном куста. */
export function galaxySeedAt(universeSeed: number, index: number): number {
  return (Math.imul(universeSeed ^ 0x9e3779b1, index + 1) >>> 0) % 0x7fffffff
}

const _dir = { x: 0, y: 0, z: 0 }

/** Случайное единичное направление. Отбраковка по кубу — иначе углы куба перевешивают. */
function randomUnit(rng: Rng, out: { x: number; y: number; z: number }): void {
  for (let i = 0; i < 16; i++) {
    const x = rng() * 2 - 1
    const y = rng() * 2 - 1
    const z = rng() * 2 - 1
    const len = Math.hypot(x, y, z)
    if (len > 1e-6 && len <= 1) {
      out.x = x / len
      out.y = y / len
      out.z = z / len
      return
    }
  }
  out.x = 0
  out.y = 0
  out.z = 1
}

/**
 * Построить вселенную из слова.
 *
 * Узлы раздаются в ширину: корень, его дети, дети детей — пока не наберётся COUNT. Так
 * куст растёт равномерно во все стороны, а не вытягивается одной длинной плетью, как
 * вышло бы при обходе в глубину.
 */
export function generateUniverse(word: string): Universe {
  const seed = universeSeedFromWord(word)
  const nodes: GalaxyNode[] = []

  const makeNode = (index: number, parent: number, depth: number, transform: Mat4): GalaxyNode => ({
    index,
    // Корень — не галактика, а монумент, и зовут его КРЕСТАМИ. Имя записано в самом узле, а не
    // подставляется теми, кто его рисует: показывают монумент трое (HUD, карта мира, карта
    // куста), и каждый звал его по-своему — на карте он стоял под случайным именем галактики
    // и не находился поиском, а на HUD рядом подписывался «Кресты».
    name: isMonument(index) ? UNIVERSE.MONUMENT_NAME : galaxyName(galaxySeedAt(seed, index)),
    seed: galaxySeedAt(seed, index),
    parent,
    children: [],
    pos: applyMat(transform, ORIGIN, vec4()),
    transform,
    depth,
  })

  nodes.push(makeNode(0, -1, 0, identity()))

  // Направление НА РОДИТЕЛЯ в кадре ребёнка: ветки отталкиваются от него, иначе куст
  // складывается сам в себя. У корня родителя нет — там веер свободный.
  const parentDir = new Map<number, { x: number; y: number; z: number }>()

  for (let cursor = 0; cursor < nodes.length && nodes.length < UNIVERSE.COUNT; cursor++) {
    const node = nodes[cursor]!
    const rng = makeRng((seed ^ Math.imul(node.index + 1, 0x85ebca6b)) >>> 0)
    const span = UNIVERSE.BRANCH_MAX - UNIVERSE.BRANCH_MIN + 1
    // Корню даём на ветку больше: он ни от кого не отталкивается, и веер у него полный.
    const want = UNIVERSE.BRANCH_MIN + Math.floor(rng() * span) + (node.parent < 0 ? 1 : 0)
    const back = parentDir.get(node.index)

    for (let i = 0; i < want && nodes.length < UNIVERSE.COUNT; i++) {
      // Отталкивание от родителя: направление на него запретно, ищем в стороне.
      let tries = 0
      do {
        randomUnit(rng, _dir)
        tries++
      } while (
        back
        && tries < 24
        && _dir.x * back.x + _dir.y * back.y + _dir.z * back.z > UNIVERSE.PARENT_REPEL
      )

      const len = UNIVERSE.EDGE_MIN + rng() * (UNIVERSE.EDGE_MAX - UNIVERSE.EDGE_MIN)
      const step = boost(_dir.x, _dir.y, _dir.z, len)
      const childIndex = nodes.length
      // Кадр ребёнка = кадр родителя, сдвинутый бустом. Позиции всех узлов оказываются
      // в ОДНОЙ системе координат — той, где корень стоит в начале.
      const child = makeNode(childIndex, node.index, node.depth + 1, mulMat(node.transform, step))
      node.children.push(childIndex)
      // Обратное направление в кадре ребёнка — то же ребро, пройденное вспять.
      parentDir.set(childIndex, { x: -_dir.x, y: -_dir.y, z: -_dir.z })
      nodes.push(child)
    }
  }

  return { word, seed, nodes }
}

/**
 * Узел — центр вселенной (монумент в пустоте), а не галактика. Карту галактики над ним
 * открывать не над чем, и звёзд для гипера там не выбрать.
 */
export function isMonument(index: number): boolean {
  return index === UNIVERSE.MONUMENT_NODE
}

/** Соседи узла: родитель и дети одним списком — по ним и разрешён перелёт. */
export function neighborsOf(universe: Universe, index: number): number[] {
  const node = universe.nodes[index]
  if (!node) return []
  return node.parent < 0 ? [...node.children] : [node.parent, ...node.children]
}

/** Длина ребра между соседями (гиперболические единицы). NaN, если они не соседи. */
export function edgeLength(universe: Universe, a: number, b: number): number {
  const na = universe.nodes[a]
  const nb = universe.nodes[b]
  if (!na || !nb) return NaN
  if (na.parent !== b && nb.parent !== a) return NaN
  return distanceH(na.pos, nb.pos)
}
