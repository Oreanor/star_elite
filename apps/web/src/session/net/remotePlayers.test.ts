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

    // Отметки отправителя 1000 и 1200, пришли с задержкой в 1000 мс наших часов.
    interp.ingest([snap('a', 1000, { x: 0 })], 2000)
    interp.ingest([snap('a', 1200, { x: 200 })], 2200)

    // Показ — в прошлом на задержку интерполяции (150 мс) по оси отправителя: при now=2350
    // цель — отметка 1200, ровно второй пакет.
    expect(interp.sample('a', 2350, pos, quat)).toBe(true)
    expect(pos.x).toBeCloseTo(200, 3)

    // Между пакетами — между позициями. Проверяем свойство, не число.
    expect(interp.sample('a', 2250, pos, quat)).toBe(true)
    expect(pos.x).toBeGreaterThan(0)
    expect(pos.x).toBeLessThan(200)
  })

  it('пакеты, пришедшие пачками, всё равно дают ровный ход — без «туда-сюда»', () => {
    // Пойманное: «лагает туда-сюда на несколько десятков метров». Сглаживали по времени
    // ПРИХОДА, а Firebase отдаёт систему пачками: ровно отправленные пакеты ложатся неровно,
    // по два разом, — интерполяция стояла и прыгала, экстраполяция перелетала и откатывалась.
    const interp = new PoseInterp()
    const pos = new Vector3()
    const quat = new Quaternion()
    const speed = 300 // м/с, обычный ход
    const send = 66 // мс между пакетами отправителя
    // Пачки: пакеты копятся и приходят по два-три разом, задержка 80…260 мс.
    const arrivals: { at: number; stamp: number }[] = []
    let jitter = 0
    for (let k = 0; k < 120; k++) {
      const stamp = 10_000 + k * send
      jitter = (jitter * 7 + 13) % 180
      arrivals.push({ at: stamp + 80 + jitter - (stamp % 200 < 66 ? 0 : (stamp % 200)), stamp })
    }
    arrivals.sort((a, b) => a.at - b.at)
    let next = 0
    let prev = -Infinity
    let maxBack = 0
    for (let now = 10_300; now < 10_000 + 110 * send; now += 16) {
      while (next < arrivals.length && arrivals[next]!.at <= now) {
        const a = arrivals[next++]!
        interp.ingest([snap('a', a.stamp, { x: ((a.stamp - 10_000) / 1000) * speed, vx: speed })], a.at)
      }
      interp.sample('a', now, pos, quat)
      if (prev !== -Infinity) maxBack = Math.max(maxBack, prev - pos.x)
      prev = pos.x
    }
    // Летит вперёд ровно: ни одного шага назад.
    expect(maxBack).toBeLessThan(1e-6)
  })

  it('по часам отправителя ход ровный, даже когда серверные отметки пляшут', () => {
    // Серверная отметка ставится, когда пакет ДОШЁЛ, — с разбросом задержки отправки. Часы
    // отправителя (`c`) ровные: по ним скорость на экране постоянна.
    const interp = new PoseInterp()
    const pos = new Vector3()
    const quat = new Quaternion()
    const speed = 300
    let jitter = 0
    const arrivals: { at: number; stamp: number; c: number }[] = []
    for (let k = 0; k < 120; k++) {
      const c = 500 + k * 66
      jitter = (jitter * 11 + 17) % 60
      const stamp = 9_000 + c + jitter // доехал до сервера с разбросом 0…60 мс
      arrivals.push({ at: stamp + 40 + ((k * 37) % 90), stamp, c })
    }
    arrivals.sort((a, b) => a.at - b.at)
    let next = 0
    const xs: number[] = []
    for (let now = 9_900; now < 9_000 + 500 + 110 * 66; now += 16) {
      while (next < arrivals.length && arrivals[next]!.at <= now) {
        const a = arrivals[next++]!
        interp.ingest([snap('a', a.stamp, { x: (a.c / 1000) * speed, vx: speed, c: a.c })], a.at)
      }
      interp.sample('a', now, pos, quat)
      xs.push(pos.x)
    }
    // Шаг кадра почти постоянен: 300 м/с · 16 мс = 4.8 м, без рывков вдвое и откатов.
    const steps = xs.slice(40).map((x, i, a) => (i === 0 ? null : x - a[i - 1]!)).filter((d): d is number => d !== null)
    for (const d of steps) {
      expect(d).toBeGreaterThan(speed * 0.016 * 0.5)
      expect(d).toBeLessThan(speed * 0.016 * 1.5)
    }
  })
})

