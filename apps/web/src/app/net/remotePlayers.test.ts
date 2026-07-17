import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { PoseInterp } from './remotePlayers'
import type { PoseSnapshot } from './pose'

/**
 * ПРИЗРАК В СТАРТОВОЙ СИСТЕМЕ. Вышедший из игры висел в ней вечно, и вот почему.
 *
 * `onValue` слушает узел СИСТЕМЫ целиком: он будит нас, когда шевельнётся кто угодно, и отдаёт
 * заодно ВСЕХ, включая неизменные чужие узлы. Своя поза уходит 15 раз в секунду — значит чужой
 * узел приезжает к нам 15 раз в секунду, шевелится его хозяин или умер год назад.
 *
 * Свежесть же мерили временем ПРИХОДА пакета, и повтору узла это время освежали. Выходило
 * наоборот задуманному: мертвец, чей узел неизменен по определению, освежался ровно потому, что
 * жив ТЫ, — и не протухал никогда, пока ты сам летаешь в этой системе.
 *
 * Различает их отметка ОТПРАВИТЕЛЯ: живой переписывает её каждым пакетом, за мертвеца её не
 * перепишет никто. Оба теста ниже — половины одного инварианта, и порознь они бессмысленны:
 * первый одному «протухай», второй другому «не смей», а разделить их может только отметка.
 */

const POSE: Omit<PoseSnapshot, 'uid' | 't'> = {
  x: 100,
  y: 0,
  z: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  vx: 0,
  vy: 0,
  vz: 0,
  s: 1,
}

const snap = (uid: string, t: number, over: Partial<PoseSnapshot> = {}): PoseSnapshot => ({ uid, t, ...POSE, ...over })

/** Дольше этого без НОВЫХ пакетов — игрок считается пропавшим (MAX_AGE в модуле). */
const MAX_AGE = 2500

describe('свежесть чужой позы', () => {
  it('мертвец протухает, сколько бы раз его узел ни приехал снова', () => {
    const interp = new PoseInterp()
    // Последний вздох: отметка замерла на 5000 и больше не сменится никогда.
    interp.ingest([snap('ghost', 5000)], 0)
    expect(interp.freshUids(0).has('ghost')).toBe(true)

    // Наши собственные пакеты будят слушателя и тащат мертвеца с собой — но отметка та же.
    for (let now = 100; now <= 10_000; now += 100) interp.ingest([snap('ghost', 5000)], now)

    expect(interp.freshUids(10_000).has('ghost')).toBe(false)
  })

  it('живой, стоящий на месте, остаётся свежим — поза та же, отметка новая', () => {
    const interp = new PoseInterp()
    // Висит у причала неподвижно: поза байт в байт та же, но пакеты идут.
    for (let now = 0; now <= 10_000; now += 100) interp.ingest([snap('parked', 5000 + now)], now)

    // Именно этот случай и защищала прежняя правка, освежая время прихода дубликату:
    // без отметки «стоит на месте» и «умер» неотличимы, и одного из двух теряешь всегда.
    expect(interp.freshUids(10_000).has('parked')).toBe(true)
  })

  it('пропавший исчезает не мгновенно, а по сроку: сеть бывает и рваной', () => {
    const interp = new PoseInterp()
    interp.ingest([snap('laggy', 1000)], 0)
    // Пакет задержался, но срок ещё не вышел — борт не должен мигать на чужом экране.
    expect(interp.freshUids(MAX_AGE - 500).has('laggy')).toBe(true)
    expect(interp.freshUids(MAX_AGE + 500).has('laggy')).toBe(false)
  })
})

describe('поза между пакетами', () => {
  it('повтор узла не плодит образцов: между «двумя» одинаковыми нечего интерполировать', () => {
    const interp = new PoseInterp()
    const pos = new Vector3()
    const quat = new Quaternion()

    interp.ingest([snap('a', 5000, { x: 100 })], 0)
    // Тот же узел приехал десять раз — буфер обязан остаться при одном образце, иначе
    // интерполятор поедет между копиями одной и той же позы по выдуманному времени.
    for (let i = 1; i <= 10; i++) interp.ingest([snap('a', 5000, { x: 100 })], i * 100)

    expect(interp.sample('a', 1000, pos, quat)).toBe(true)
    expect(pos.x).toBe(100)
  })

  it('движение между двумя пакетами сглаживается, а не рвётся', () => {
    const interp = new PoseInterp()
    const pos = new Vector3()
    const quat = new Quaternion()

    interp.ingest([snap('a', 1000, { x: 0 })], 0)
    interp.ingest([snap('a', 2000, { x: 200 })], 200)

    // Показываем в прошлом на INTERP_DELAY=120 мс: при now=320 цель = 200 мс, ровно второй пакет.
    expect(interp.sample('a', 320, pos, quat)).toBe(true)
    expect(pos.x).toBeCloseTo(200, 3)

    // Ровно посередине между пакетами — половина пути. Проверяем свойство, не число.
    expect(interp.sample('a', 220, pos, quat)).toBe(true)
    expect(pos.x).toBeGreaterThan(0)
    expect(pos.x).toBeLessThan(200)
  })
})
