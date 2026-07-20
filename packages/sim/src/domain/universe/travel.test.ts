import { describe, expect, it } from 'vitest'
import {
  BUSH_SPEED,
  MONUMENT_ROOM_EXIT_M,
  atNode,
  createBushTravel,
  departTo,
  enterBush,
  leaveBush,
  monumentRoomEntered,
  monumentRoomExited,
  stepBushTravel,
} from './travel'
import { generateUniverse, neighborsOf } from './universe'

/**
 * Рельсы куста. Главное требование пилота — «ехать гладко, не застревая», поэтому
 * проверяем именно это: ход всегда двигается вперёд, узел всегда достижим, а сойти
 * с рельсов нельзя.
 */
describe('движение по кусту', () => {
  const universe = generateUniverse('Слово')

  it('вне куста шаг ничего не делает', () => {
    const t = createBushTravel()
    expect(stepBushTravel(t, universe, 1, 1)).toBe(-1)
    expect(atNode(t)).toBe(false)
  })

  it('войдя, стоим в узле и можем выбирать ветку', () => {
    const t = createBushTravel()
    enterBush(t, 5)
    expect(atNode(t)).toBe(true)
    expect(t.node).toBe(5)
  })

  /** Рельсы обязаны быть рельсами: срезать к дальнему узлу нельзя. */
  it('тронуться можно ТОЛЬКО к соседу', () => {
    const t = createBushTravel()
    enterBush(t, 5)
    const [first] = neighborsOf(universe, 5)
    expect(departTo(t, universe, first!)).toBe(true)

    const t2 = createBushTravel()
    enterBush(t2, 5)
    const stranger = universe.nodes.findIndex((n) => n.index !== 5 && !neighborsOf(universe, 5).includes(n.index))
    expect(departTo(t2, universe, stranger)).toBe(false)
    expect(atNode(t2)).toBe(true) // остались стоять
  })

  it('на ходу новую ветку не выбрать', () => {
    const t = createBushTravel()
    enterBush(t, 5)
    const ns = neighborsOf(universe, 5)
    departTo(t, universe, ns[0]!)
    expect(departTo(t, universe, ns[1] ?? ns[0]!)).toBe(false)
  })

  /**
   * НЕ ЗАСТРЕВАЕТ. Ход монотонно растёт при любом положительном газе, и узел достигается
   * за конечное время. Это то самое требование «ехать гладко», и оно проверяется числом
   * шагов, а не ощущением.
   */
  it('при полном газе доезжает до узла и встаёт в нём', () => {
    const t = createBushTravel()
    enterBush(t, 5)
    const to = neighborsOf(universe, 5)[0]!
    departTo(t, universe, to)

    const dt = 1 / 60
    let arrived = -1
    let last = -1
    for (let i = 0; i < 60 * 30 && arrived < 0; i++) {
      const before = t.t
      arrived = stepBushTravel(t, universe, 1, dt)
      if (arrived < 0) expect(t.t).toBeGreaterThan(before) // ход только вперёд
      last = i
    }
    expect(arrived).toBe(to)
    expect(t.node).toBe(to)
    expect(atNode(t)).toBe(true) // приехали — СТОИМ, а не проскочили дальше
    // Время проезда задано долей ребра в секунду, значит оно предсказуемо.
    expect(last / 60).toBeCloseTo(1 / BUSH_SPEED, 0)
  })

  it('без газа стоит на месте и никуда не приезжает', () => {
    const t = createBushTravel()
    enterBush(t, 5)
    departTo(t, universe, neighborsOf(universe, 5)[0]!)
    for (let i = 0; i < 600; i++) expect(stepBushTravel(t, universe, 0, 1 / 60)).toBe(-1)
    expect(t.t).toBe(0)
  })

  /**
   * Узел — это ВЫБОР, и проскочить его нельзя. Иначе на просадке кадра корабль улетал бы
   * через несколько развилок в случайную сторону, а игрок терял бы управление маршрутом.
   */
  it('огромный шаг не проносит сквозь узел', () => {
    const t = createBushTravel()
    enterBush(t, 5)
    const to = neighborsOf(universe, 5)[0]!
    departTo(t, universe, to)
    expect(stepBushTravel(t, universe, 1, 1000)).toBe(to)
    expect(t.node).toBe(to)
    expect(atNode(t)).toBe(true)
  })

  it('доехав, можно ехать дальше — в том числе назад к родителю', () => {
    const t = createBushTravel()
    enterBush(t, 5)
    const to = neighborsOf(universe, 5)[0]!
    departTo(t, universe, to)
    stepBushTravel(t, universe, 1, 1000)
    // Обратно — законный ход: соседство взаимно, тупиков быть не должно.
    expect(departTo(t, universe, 5)).toBe(true)
    expect(stepBushTravel(t, universe, 1, 1000)).toBe(5)
  })

  /**
   * Комната монумента: вход по касанию креста, выход по отдалению. Между порогами —
   * ЗАЗОР, иначе на самой границе комната мигала бы вход-выход в каждом кадре.
   */
  it('крест: близко — вход в комнату, далеко — выход, с гистерезисом', () => {
    const crossRadius = 500
    // Коснулся креста (внутри радиуса) — вошёл.
    expect(monumentRoomEntered(crossRadius - 1, crossRadius)).toBe(true)
    expect(monumentRoomEntered(crossRadius + 1, crossRadius)).toBe(false)
    // Отдалился за порог выхода — вышел.
    expect(monumentRoomExited(MONUMENT_ROOM_EXIT_M + 1)).toBe(true)
    expect(monumentRoomExited(MONUMENT_ROOM_EXIT_M - 1)).toBe(false)
    // Зазор реален: сразу за крестом ты ещё НЕ выходишь — иначе вход и выход
    // срабатывали бы почти в одной точке и комната дрожала бы.
    expect(monumentRoomExited(crossRadius + 100)).toBe(false)
  })

  it('свежий ход не в комнате монумента', () => {
    const t = createBushTravel()
    expect(t.inMonument).toBe(false)
    enterBush(t, 3)
    expect(t.inMonument).toBe(false)
  })

  it('выход с куста сбрасывает ход', () => {
    const t = createBushTravel()
    enterBush(t, 5)
    departTo(t, universe, neighborsOf(universe, 5)[0]!)
    leaveBush(t)
    expect(t.active).toBe(false)
    expect(stepBushTravel(t, universe, 1, 1)).toBe(-1)
  })
})
