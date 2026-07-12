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
 */

interface Sample {
  /** Время прихода, мс (performance.now у вызывающего). */
  t: number
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

/** Насколько показываем в прошлом, мс. ~1.5 пакета при 12 Гц — почти всегда есть пара. */
const INTERP_DELAY = 120
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

  /** Принять батч поз (`subscribePoses` отдаёт всех разом). `now` — performance.now(), мс. */
  ingest(snaps: PoseSnapshot[], now: number): void {
    for (const s of snaps) {
      let buf = this.buffers.get(s.uid)
      if (!buf) {
        buf = []
        this.buffers.set(s.uid, buf)
      }
      // onValue повторяет неизменные узлы: дубликат не копим, только освежаем время.
      // Масштаб в сверку ВХОДИТ: растущий на месте гигант не двигает pos/quat, и без
      // этого его рост не долетал бы до чужого экрана (пакет отбраковывался как дубль).
      const last = buf[buf.length - 1]
      if (last && last.x === s.x && last.y === s.y && last.z === s.z && last.qw === s.qw && last.s === s.s) {
        last.t = now
        continue
      }
      buf.push({ t: now, x: s.x, y: s.y, z: s.z, qx: s.qx, qy: s.qy, qz: s.qz, qw: s.qw, vx: s.vx, vy: s.vy, vz: s.vz, s: s.s })
      if (buf.length > BUFFER) buf.shift()
    }
  }

  /** uid, о ком есть свежие (моложе `MAX_AGE`) данные. Протухшие чистит попутно. */
  freshUids(now: number): Set<string> {
    const out = new Set<string>()
    for (const [uid, buf] of this.buffers) {
      const last = buf[buf.length - 1]
      if (last && now - last.t < MAX_AGE) out.add(uid)
      else this.buffers.delete(uid)
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

    const target = now - INTERP_DELAY

    // Пара, окружающая target: интерполируем между ними.
    for (let i = buf.length - 1; i > 0; i--) {
      const b = buf[i]!
      const a = buf[i - 1]!
      if (a.t <= target && target <= b.t) {
        const span = b.t - a.t
        const f = span > 1e-3 ? (target - a.t) / span : 1
        outPos.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f)
        _qa.set(a.qx, a.qy, a.qz, a.qw)
        _qb.set(b.qx, b.qy, b.qz, b.qw)
        outQuat.copy(_qa).slerp(_qb, f)
        return true
      }
    }

    const first = buf[0]!
    // target раньше всех пакетов (только подписались) — держим старейший.
    if (target < first.t) {
      outPos.set(first.x, first.y, first.z)
      outQuat.set(first.qx, first.qy, first.qz, first.qw)
      return true
    }

    // target позже всех — экстраполируем последний скоростью, ограниченно по времени.
    const s = buf[buf.length - 1]!
    const dt = Math.min((target - s.t) / 1000, MAX_EXTRAP)
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
  }
}
