import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { distanceH } from '../../core/math/hyperbolic'
import {
  UNIVERSE,
  edgeLength,
  galaxySeedAt,
  generateUniverse,
  neighborsOf,
  universeSeedFromWord,
} from './universe'

/**
 * Вселенная выводится из СЛОВА. Проверяем инварианты, на которых стоит всё остальное:
 * детерминизм (иначе игроки окажутся в разных вселенных при одном слове), связность
 * (иначе до части галактик не доехать по рельсам) и то, что куст не слипается.
 */
describe('куст вселенной', () => {
  it('одно слово — одна вселенная', () => {
    expect(universeSeedFromWord('Начало')).toBe(universeSeedFromWord('начало'))
    // Регистр и пробелы по краям не считаются: иначе игрок с заглавной буквой попал бы
    // в другую вселенную, чем тот, кто набрал то же слово строчными.
    expect(universeSeedFromWord(' Слово ')).toBe(universeSeedFromWord('слово'))
    expect(universeSeedFromWord('слово')).not.toBe(universeSeedFromWord('дело'))
  })

  /**
   * Монумент назван В ДАННЫХ, а не там, где его рисуют. Показывают его трое — HUD комнаты,
   * карта мира и карта куста, — и пока имя подставлял каждый сам, корню доставалось обычное
   * имя галактики от его зерна: на карте монумент стоял под чужим именем и не находился
   * поиском, а подпись рядом гласила «Кресты». Одно имя в узле — одно имя всюду.
   */
  it('корень куста зовётся Крестами, а прочие узлы — своими именами', () => {
    const u = generateUniverse('Слово')
    expect(u.nodes[UNIVERSE.MONUMENT_NODE]?.name).toBe(UNIVERSE.MONUMENT_NAME)
    expect(u.nodes[1]?.name).not.toBe(UNIVERSE.MONUMENT_NAME)
  })

  /**
   * ЛОР, ставший инвариантом. В начале было Слово: вселенная выводится из него, а домашняя
   * галактика — нулевой узел её куста. `GALAXY.SEED` записан в конфигурации готовым числом
   * (слой конфигурации не имеет права звать домен), и стеречь их согласие может только тест.
   *
   * Разойдись они — домашняя галактика перестала бы быть частью вселенной: стояла бы рядом
   * сама по себе, и прилететь в неё по кусту было бы нельзя.
   */
  it('домашняя галактика — узел вселенной слова «Слово»', () => {
    expect(GALAXY.WORD).toBe('Слово')
    expect(galaxySeedAt(universeSeedFromWord(GALAXY.WORD), GALAXY.HOME_NODE)).toBe(GALAXY.SEED)
    expect(generateUniverse(GALAXY.WORD).nodes[GALAXY.HOME_NODE]!.seed).toBe(GALAXY.SEED)
  })

  it('то же слово даёт тот же куст', () => {
    const a = generateUniverse('свет')
    const b = generateUniverse('свет')
    expect(a.nodes.map((n) => n.name)).toEqual(b.nodes.map((n) => n.name))
    expect(a.nodes.map((n) => n.parent)).toEqual(b.nodes.map((n) => n.parent))
    expect(a.nodes.map((n) => n.seed)).toEqual(b.nodes.map((n) => n.seed))
  })

  it('разные слова дают разные вселенные', () => {
    const a = generateUniverse('свет')
    const b = generateUniverse('тьма')
    expect(a.nodes.map((n) => n.seed)).not.toEqual(b.nodes.map((n) => n.seed))
  })

  it('ровно COUNT галактик, у каждой своё зерно', () => {
    const u = generateUniverse('начало')
    expect(u.nodes).toHaveLength(UNIVERSE.COUNT)
    expect(new Set(u.nodes.map((n) => n.seed)).size).toBe(UNIVERSE.COUNT)
  })

  /**
   * СВЯЗНОСТЬ. Двигаться можно только по рёбрам, поэтому недостижимая галактика — это
   * не «редкий случай», а потерянный кусок вселенной: туда нельзя попасть никогда.
   */
  it('из корня достижима каждая галактика', () => {
    const u = generateUniverse('начало')
    const seen = new Set<number>([0])
    const queue = [0]
    while (queue.length > 0) {
      for (const next of neighborsOf(u, queue.shift()!)) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    expect(seen.size).toBe(UNIVERSE.COUNT)
  })

  it('это дерево: у всех один родитель, у корня — никого, циклов нет', () => {
    const u = generateUniverse('начало')
    expect(u.nodes[0]!.parent).toBe(-1)
    for (const node of u.nodes) {
      if (node.parent < 0) continue
      // Связь двусторонняя: ребёнок числится у родителя, иначе рельсы разойдутся.
      expect(u.nodes[node.parent]!.children).toContain(node.index)
      // Родитель ВСЕГДА ближе к корню: значит по родителям всегда придёшь в корень.
      expect(u.nodes[node.parent]!.depth).toBe(node.depth - 1)
    }
  })

  /**
   * Соседство симметрично: если из A виден B, то из B обязан быть виден A. Иначе рельс
   * оказался бы односторонним и корабль застрял бы в тупике, которого не видно.
   */
  it('соседство взаимно', () => {
    const u = generateUniverse('свет')
    for (const node of u.nodes) {
      for (const other of neighborsOf(u, node.index)) {
        expect(neighborsOf(u, other)).toContain(node.index)
      }
    }
  })

  it('длина ребра лежит в заданных пределах и меряется одинаково с обоих концов', () => {
    const u = generateUniverse('свет')
    for (const node of u.nodes) {
      if (node.parent < 0) continue
      const there = edgeLength(u, node.parent, node.index)
      expect(there).toBeGreaterThanOrEqual(UNIVERSE.EDGE_MIN - 1e-6)
      expect(there).toBeLessThanOrEqual(UNIVERSE.EDGE_MAX + 1e-6)
      expect(edgeLength(u, node.index, node.parent)).toBeCloseTo(there, 9)
    }
    // Не соседи — не ребро. Иначе рельсы можно было бы «срезать» напрямик.
    expect(Number.isNaN(edgeLength(u, 0, UNIVERSE.COUNT - 1))).toBe(true)
  })

  /**
   * Куст не слипается: ветка не ложится обратно на родителя. Проверяем ДЕДА — внук
   * обязан оказаться дальше от деда, чем длина одного ребра, иначе ветка сложилась вдвое.
   */
  it('ветки расходятся, а не складываются обратно к родителю', () => {
    const u = generateUniverse('начало')
    let checked = 0
    for (const node of u.nodes) {
      const parent = u.nodes[node.parent ?? -1]
      if (!parent || parent.parent < 0) continue
      const grand = u.nodes[parent.parent]!
      expect(distanceH(grand.pos, node.pos)).toBeGreaterThan(UNIVERSE.EDGE_MIN)
      checked++
    }
    expect(checked).toBeGreaterThan(100) // проверка не должна оказаться пустой
  })

  /** Экспоненциальное раскрытие: крона обязана уходить далеко от корня. */
  it('крона уходит от корня на много длин ребра', () => {
    const u = generateUniverse('начало')
    const far = Math.max(...u.nodes.map((n) => distanceH(u.nodes[0]!.pos, n.pos)))
    expect(far).toBeGreaterThan(UNIVERSE.EDGE_MAX * 3)
  })
})
