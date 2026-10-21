import { Quaternion, Vector3 } from 'three'
import type { PoseSnapshot } from './pose'

/**
 * Интерполятор чужих поз. Пакеты приходят ~12–15 Гц (`subscribePoses`), а рисуем 60 —
 * без сглаживания борт дёргался бы. Держим короткий буфер снапшотов на игрока и
 * показываем позу в НЕДАВНЕМ ПРОШЛОМ (`INTERP_DELAY`), чтобы почти всегда было два
 * пакета для интерполяции между ними. Ушли за последний пакет — короткая экстраполяция
 * скоростью, не дольше `MAX_EXTRAP`.
 *
 * Позы АБСОЛЮТНЫЕ (кадр общий: pos+originOffset у отправителя). В локальный кадр их
 * переводит вызывающий, вычитая свой `originOffset`. Часы (`performance.now()`) — снаружи:
 * так класс остаётся чистым и проверяемым, без обращения к времени.
 *
 * ВРЕМЁН ЗДЕСЬ ТРИ, и путать их нельзя. Часы ОТПРАВИТЕЛЯ (`Sample.k` — его монотонные мс в миг
 * сборки пакета; у прежних сборок — серверная отметка) — ось СГЛАЖИВАНИЯ: пакеты собираются
 * ровно, раз в ~66 мс. Серверная отметка (`Sample.stamp`) — доказательство жизни и порядок:
 * новый ли пакет. Время ПРИХОДА (`Sample.t`, наши мс) — для свежести и оценки сдвига часов.
 *
 * Прежде сглаживали по приходу — и борт мотало «туда-сюда на десятки метров». `onValue` слушает
 * систему целиком и отдаёт пакеты ПАЧКАМИ (будит нас и наша собственная поза, 15 раз в секунду):
 * ровно отправленные пакеты ложатся на ось прихода неровно, бывает по два в одно мгновение.
 * Интерполяция по такой оси то стоит, то прыгает, экстраполяция перелетает и откатывается.
 *
 * Сдвиг часов отправителя к нашим (`offset`) — МИНИМУМ «приход − k» по пакетам: самый быстрый
 * пакет ближе всех к истинному сдвигу. Обе стороны — ПЛАВНО: скачок оценки — это скачок момента
 * показа, а он рывок борта на v·Δ. Вниз (нашёлся пакет быстрее) — не больше OFFSET_FALL мс за
 * пакет, вверх (дрейф часов) — долей OFFSET_RISE. Первый пакет ставит оценку сразу.
 */

interface Sample {
  /** Время прихода, мс (performance.now у вызывающего). */
  t: number
  /** Отметка ОТПРАВИТЕЛЯ (серверные мс). Ею отличаем новый пакет от повтора того же узла. */
  stamp: number
  /** Ось сглаживания: часы отправителя (`c`), а у прежних сборок — серверная отметка. */
  k: number
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
  vx: number
  vy: number
  vz: number
  /** Масштаб борта (миелофон). */
  s: number
}

/**
 * Насколько показываем в прошлом, мс, от оценки «самого быстрого» пакета: ~2 пакета при 15 Гц
 * плюс запас на разброс задержки — почти всегда есть пара по обе стороны.
 */
const INTERP_DELAY = 150
/** Доля, на которую оценка сдвига часов ползёт вверх за пакет (дрейф часов, смена маршрута). */
const OFFSET_RISE = 0.01
/**
 * Предел, на который оценка опускается за пакет, мс: при 15 Гц это 3% скорости воспроизведения —
 * глазу незаметно, а сдвиг в десятки мс выбирается за секунду-две без рывка.
 */
const OFFSET_FALL = 2
/** Дольше без пакетов — игрок «пропал»: буфер чистится, спавн решает выше по грейсу. */
const MAX_AGE = 2500
/** Экстраполяция скоростью не дольше этого, с: дальше поза «уезжает» в никуда. */
const MAX_EXTRAP = 0.25
/** Сколько снапшотов держим на игрока: хватает на интерполяцию, не растёт вечно. */
const BUFFER = 16

const _qa = new Quaternion()
const _qb = new Quaternion()

export class PoseInterp {
  private readonly buffers = new Map<string, Sample[]>()
  /** uid → сдвиг «наши мс − серверные мс» (оценка по быстрейшим пакетам). */
  private readonly offsets = new Map<string, number>()

  /** Принять батч поз (`subscribePoses` отдаёт всех разом). `now` — performance.now(), мс. */
  ingest(snaps: PoseSnapshot[], now: number): void {
    for (const s of snaps) {
      let buf = this.buffers.get(s.uid)
      if (!buf) {
        buf = []
        this.buffers.set(s.uid, buf)
      }
      /**
       * ПОВТОР ТОГО ЖЕ УЗЛА — не новость. `onValue` слушает систему целиком и будит нас на
       * чужое шевеление, отдавая заодно всех; собственная поза уходит 15 раз в секунду, и
       * каждая приводит с собой чужие узлы неизменными.
       *
       * Отличаем повтор по отметке ОТПРАВИТЕЛЯ, а не по содержимому. Раньше сверяли позу со
       * скоростью и масштабом — и, признав дубликат, освежали ему время прихода. Выходило
       * ровно наоборот задуманному: мертвец, чей узел неизменен по определению, освежался
       * при каждом СВОЁМ пакете и не протухал никогда, покуда ты сам летаешь в этой системе.
       * Отметку же за него не перепишет никто — вот она и разделяет живых и мёртвых. А стоящий
       * на месте живой шлёт пакеты с новой отметкой и остаётся свежим, хоть и не двигается.
       */
      const last = buf[buf.length - 1]
      if (last && last.stamp === s.t) continue
      // Порядок — по часам отправителя: пачка могла привезти пакеты не по порядку, а серверная
      // отметка пляшет вместе с задержкой отправки и отбросила бы пакет зря.
      const k = s.c ?? s.t
      if (last && k <= last.k) continue
      const lag = now - k
      const was = this.offsets.get(s.uid)
      this.offsets.set(
        s.uid,
        was === undefined ? lag : lag < was ? Math.max(lag, was - OFFSET_FALL) : was + (lag - was) * OFFSET_RISE,
      )
      buf.push({ t: now, stamp: s.t, k, x: s.x, y: s.y, z: s.z, qx: s.qx, qy: s.qy, qz: s.qz, qw: s.qw, vx: s.vx, vy: s.vy, vz: s.vz, s: s.s })
      if (buf.length > BUFFER) buf.shift()
    }
  }

  /** uid, о ком есть свежие (моложе `MAX_AGE`) данные. Протухшие чистит попутно. */
  freshUids(now: number): Set<string> {
    const out = new Set<string>()
    for (const [uid, buf] of this.buffers) {
      const last = buf[buf.length - 1]
      if (last && now - last.t < MAX_AGE) out.add(uid)
      else {
        this.buffers.delete(uid)
        this.offsets.delete(uid)
      }
    }
    return out
  }

  /**
   * Интерполированная АБСОЛЮТНАЯ поза `uid` в момент `now - INTERP_DELAY` в `outPos`/`outQuat`.
   * false — данных нет. Вызывающий переводит позу в локальный кадр, вычтя свой originOffset.
   */
  sample(uid: string, now: number, outPos: Vector3, outQuat: Quaternion): boolean {
    const buf = this.buffers.get(uid)
    if (!buf || buf.length === 0) return false

    if (buf.length === 1) {
      const s = buf[0]!
      outPos.set(s.x, s.y, s.z)
      outQuat.set(s.qx, s.qy, s.qz, s.qw)
      return true
    }

    // Момент показа — на оси ОТПРАВИТЕЛЯ: наше «сейчас» в его часах, минус задержка.
    const target = now - (this.offsets.get(uid) ?? 0) - INTERP_DELAY

    // Пара, окружающая target: интерполируем между ними.
    for (let i = buf.length - 1; i > 0; i--) {
      const b = buf[i]!
      const a = buf[i - 1]!
      if (a.k <= target && target <= b.k) {
        const span = b.k - a.k
        const f = span > 1e-3 ? (target - a.k) / span : 1
        outPos.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f)
        _qa.set(a.qx, a.qy, a.qz, a.qw)
        _qb.set(b.qx, b.qy, b.qz, b.qw)
        outQuat.copy(_qa).slerp(_qb, f)
        return true
      }
    }

    const first = buf[0]!
    // target раньше всех пакетов (только подписались) — держим старейший.
    if (target < first.k) {
      outPos.set(first.x, first.y, first.z)
      outQuat.set(first.qx, first.qy, first.qz, first.qw)
      return true
    }

    // target позже всех — экстраполируем последний скоростью, ограниченно по времени.
    const s = buf[buf.length - 1]!
    const dt = Math.min((target - s.k) / 1000, MAX_EXTRAP)
    outPos.set(s.x + s.vx * dt, s.y + s.vy * dt, s.z + s.vz * dt)
    outQuat.set(s.qx, s.qy, s.qz, s.qw)
    return true
  }

  /**
   * Последний известный масштаб борта `uid` (миелофон). 1, если данных нет. Масштаб
   * меняется плавно, поэтому берём свежайший пакет без интерполяции — задержки не видно.
   */
  scaleOf(uid: string): number {
    const buf = this.buffers.get(uid)
    const last = buf?.[buf.length - 1]
    return last?.s ?? 1
  }

  /** Забыть игрока (вышел из системы/из игры). */
  drop(uid: string): void {
    this.buffers.delete(uid)
    this.offsets.delete(uid)
  }
}
