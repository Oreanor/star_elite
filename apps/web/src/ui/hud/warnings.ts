import { UI } from '../theme'
import { t } from '../i18n'

/**
 * Плашки-предупреждения — единый канал ситуативных сообщений HUD.
 *
 * Раньше каждое предупреждение рисовалось своей строчкой в своём углу. Теперь это
 * одна очередь: любое место кода зовёт `pushWarning(code, now)`, а HUD показывает
 * ОДНУ самую важную живую плашку по центру. Так добавить новый сигнал — строка в
 * `DEFS`, а не ещё один `text()` посреди `drawHud`.
 *
 * Плашки ТРАНЗИЕНТНЫ: живут пару секунд и гаснут (`LIFE`). Пока условие держится,
 * толкающий зовёт push каждый кадр — переблик сдерживает кулдаун (`REPEAT`), чтобы
 * плашка не висела намертво, а мигала «пару секунд — пауза — пару секунд».
 *
 * Время — `world.time` (домен): на паузе плашки замирают вместе с миром, а не тают.
 */

export type WarnCode =
  | 'overheat'
  | 'hullCritical'
  | 'laserHot'
  | 'missileIn'
  | 'contactLost'
  | 'hullHot'
  | 'lowEnergy'
  | 'massLock'
  | 'dockFast'
  | 'playerLeft'
  | 'noRockets'
  | 'noLaser'
  | 'noJump'
  | 'noAux'
  | 'dockReady'
  | 'dockCorridor'
  | 'hail'
  | 'refuel'

interface Def {
  /** Цвет рамки, текста и полупрозрачного фона. */
  color: string
  /** Частота мигания текста, Гц. 0 — не мигает (текст горит ровно). */
  hz: number
  /** Приоритет: при нескольких живых показывается плашка с большим числом. */
  rank: number
  /** Ключ i18n подписи по умолчанию (переопределяется `opts.label` для параметрических). */
  key: Parameters<typeof t>[0]
}

// Красный — угроза жизни, жёлтый — осторожность и «нельзя», голубой — сообщение/состояние.
const DEFS: Record<WarnCode, Def> = {
  missileIn: { color: UI.DANGER, hz: 5, rank: 110, key: 'hud.missileWarn' },
  overheat: { color: UI.DANGER, hz: 3, rank: 100, key: 'hud.overheat' },
  hullCritical: { color: UI.DANGER, hz: 3, rank: 95, key: 'hud.hullCritical' },
  laserHot: { color: UI.DANGER, hz: 3, rank: 90, key: 'hud.laserHot' },
  noRockets: { color: UI.WARN, hz: 0, rank: 84, key: 'hud.noRockets' },
  noLaser: { color: UI.WARN, hz: 0, rank: 84, key: 'hud.noLaser' },
  noJump: { color: UI.WARN, hz: 0, rank: 84, key: 'hud.noJump' },
  noAux: { color: UI.WARN, hz: 0, rank: 84, key: 'hud.noAux' },
  dockFast: { color: UI.WARN, hz: 2.5, rank: 70, key: 'hud.dockTooFast' },
  contactLost: { color: UI.DANGER, hz: 0, rank: 68, key: 'hud.contactLost' },
  hullHot: { color: UI.WARN, hz: 2, rank: 60, key: 'hud.hullHot' },
  lowEnergy: { color: UI.WARN, hz: 2, rank: 55, key: 'hud.lowEnergy' },
  massLock: { color: UI.WARN, hz: 2, rank: 50, key: 'hud.massLock' },
  playerLeft: { color: UI.WARN, hz: 0, rank: 45, key: 'hud.playerLeft' },
  hail: { color: UI.PRIMARY, hz: 1.5, rank: 44, key: 'hud.hail' },
  dockReady: { color: UI.PRIMARY, hz: 2, rank: 40, key: 'hud.dockReady' },
  dockCorridor: { color: UI.PRIMARY, hz: 0, rank: 35, key: 'hud.dockCorridor' },
  refuel: { color: UI.PRIMARY, hz: 1.5, rank: 20, key: 'hud.refuel' },
}

export interface Plate {
  color: string
  hz: number
  rank: number
  label: string
  born: number
}

/** Пара секунд на экране. */
export const WARN_LIFE = 2.2
/** Кулдаун переблика, пока условие держится: пауза между появлениями. */
const REPEAT = 4.5

const active = new Map<WarnCode, Plate>()
const lastFired = new Map<WarnCode, number>()

interface PushOpts {
  /** Готовая подпись (для параметрических: дистанция коридора, секунды до ракеты). */
  label?: string
  /** Переопределить частоту мигания (ракета мигает чаще по мере приближения). */
  hz?: number
  /** Переопределить кулдаун. 0 — обновлять каждый кадр (держать, пока толкают). */
  repeat?: number
}

/**
 * Заявить предупреждение. Зовётся каждый кадр, пока условие истинно; кулдаун сам
 * решает, показать сейчас или подождать. Разные коды не мешают друг другу.
 */
export function pushWarning(code: WarnCode, now: number, opts: PushOpts = {}): void {
  const repeat = opts.repeat ?? REPEAT
  const last = lastFired.get(code) ?? -Infinity
  // Кулдаун применяем ТОЛЬКО при ходе времени вперёд. Если время скакнуло назад
  // (гибель → «начать заново»: `world.time` сброшен), старый штамп не должен глушить
  // новые вести — иначе после перезапуска предупреждения молчали бы, пока время нагонит.
  if (now >= last && now - last < repeat) return
  lastFired.set(code, now)
  const def = DEFS[code]
  active.set(code, {
    color: def.color,
    hz: opts.hz ?? def.hz,
    rank: def.rank,
    label: opts.label ?? t(def.key),
    born: now,
  })
}

/** Самая важная ЖИВАЯ плашка (просроченные попутно выметаются). null — тихо. */
export function activeWarning(now: number): Plate | null {
  let best: Plate | null = null
  for (const [code, plate] of active) {
    // Просрочено ИЛИ время ушло НАЗАД (перезапуск мира после гибели): плашка из прошлой
    // жизни родилась в будущем относительно нового времени — выметаем, иначе висит вечно.
    if (now - plate.born > WARN_LIFE || now < plate.born) {
      active.delete(code)
      continue
    }
    if (!best || plate.rank > best.rank) best = plate
  }
  return best
}
