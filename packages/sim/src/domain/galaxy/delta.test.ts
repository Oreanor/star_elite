import { describe, expect, it } from 'vitest'
import { generateGalaxy } from './generate'
import { applyDelta, emptyDelta, popEdit, pushEdit, removedIndices } from './delta'

/**
 * Дельта галактики — правки бога поверх сида. Стережём то, ради чего она и заведена:
 * БАЗА НЕ МУТИРУЕТ (иначе рухнет детерминизм → сеть и сохранения), а правки ОТКАТЫВАЮТСЯ.
 * Индексы базы не едут: удаление держит слот, добавление идёт в хвост.
 */
describe('дельта галактики', () => {
  const base = generateGalaxy(1234)

  it('пустая дельта возвращает ту же галактику без копий', () => {
    expect(applyDelta(base, emptyDelta())).toBe(base)
  })

  it('move двигает звезду, а БАЗУ не трогает (детерминизм цел)', () => {
    const before = { x: base[5]!.x, y: base[5]!.y, z: base[5]!.z }
    const delta = emptyDelta()
    pushEdit(delta, { op: 'move', index: 5, x: 100, y: 200, z: 300 })

    const edited = applyDelta(base, delta)
    expect(edited[5]).toMatchObject({ x: 100, y: 200, z: 300 })
    // База неизменна — тот же объект и те же координаты.
    expect(base[5]!.x).toBe(before.x)
    expect(base[5]!.y).toBe(before.y)
    expect(base[5]!.z).toBe(before.z)
    // Нетронутые системы — те же объекты (не плодим копий на горячем пути карты).
    expect(edited[6]).toBe(base[6])
  })

  it('recolor красит светило, не мутируя исходную звезду', () => {
    const delta = emptyDelta()
    pushEdit(delta, { op: 'recolor', index: 3, color: 0xff00ff })
    const edited = applyDelta(base, delta)
    expect(edited[3]!.star.color).toBe(0xff00ff)
    expect(base[3]!.star.color).not.toBe(0xff00ff)
  })

  it('поздняя правка перекрывает раннюю (журнал редактора)', () => {
    const delta = emptyDelta()
    pushEdit(delta, { op: 'rename', index: 2, name: 'Первое' })
    pushEdit(delta, { op: 'rename', index: 2, name: 'Второе' })
    expect(applyDelta(base, delta)[2]!.name).toBe('Второе')
  })

  it('remove НЕ сдвигает массив — слот держится, факт удаления в предикате', () => {
    const delta = emptyDelta()
    pushEdit(delta, { op: 'remove', index: 4 })
    const edited = applyDelta(base, delta)
    expect(edited.length).toBe(base.length) // длина та же — индексы не поехали
    expect(edited[5]).toBe(base[5]) // сосед на своём месте
    expect(removedIndices(delta).has(4)).toBe(true)
  })

  it('add кладёт систему В ХВОСТ — индексы базы неизменны', () => {
    const delta = emptyDelta()
    const fresh = { ...base[0]!, name: 'Новая звезда бога' }
    pushEdit(delta, { op: 'add', system: fresh })
    const edited = applyDelta(base, delta)
    expect(edited.length).toBe(base.length + 1)
    expect(edited[base.length]!.name).toBe('Новая звезда бога')
    expect(edited[0]).toBe(base[0]) // существующие на местах
  })

  it('откат снятием правки возвращает базу как была', () => {
    const delta = emptyDelta()
    pushEdit(delta, { op: 'move', index: 1, x: 9, y: 9, z: 9 })
    expect(applyDelta(base, delta)[1]!.x).toBe(9)
    popEdit(delta)
    expect(applyDelta(base, delta)).toBe(base) // журнал пуст — галактика ровно из зерна
  })
})
