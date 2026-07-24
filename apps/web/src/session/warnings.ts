/**
 * ОЧЕРЕДЬ ПРЕДУПРЕЖДЕНИЙ — единый канал ситуативных сообщений: любое место кода зовёт
 * `pushWarning(code, now)`, а HUD показывает ОДНУ самую важную живую плашку.
 *
 * Живёт в состоянии сеанса, а не в HUD, потому что толкают её отовсюду: контроллер
 * игрока, шаг сцены, слой приложения. Пока очередь лежала в `ui/hud`, каждый из них
 * тянул импорт ВВЕРХ по слоям — HUD оказывался зависимостью управления, хотя всё, что
 * ему нужно знать, это «покажи вот этот код».
 *
 * Здесь только СИГНАЛ: код, важность и время. Как он выглядит — цвет, мигание, подпись
 * на языке игрока — знает `ui/hud/warningStyle`: это оформление, и ему место в UI.
 *
 * Плашки ТРАНЗИЕНТНЫ: живут пару секунд и гаснут (`WARN_LIFE`). Пока условие держится,
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
  | 'gravityBrake'
  | 'dockHint'
  | 'playerLeft'
  | 'noRockets'
  | 'noLaser'
  | 'noJump'
  | 'portalClosed'
  | 'portalOpening'
  | 'noAux'
  | 'noTarget'
  | 'landPrompt'
  | 'landApproach'
  | 'landDetach'
  | 'crash'
  | 'shipLost'
  | 'dockReady'
  | 'dockCorridor'
  | 'orbitExit'
  | 'hail'
  | 'refuel'
  | 'bonVoyage'
  | 'noRoom'
  | 'holdFull'
  | 'cruiseLatch'
  | 'cruiseUnlatch'
  | 'bushEnter'
  | 'bushArrive'

/**
 * Важность сигнала: при нескольких живых показывается плашка с бо́льшим числом.
 *
 * Это свойство СОБЫТИЯ, а не картинки: ракета на хвосте важнее подсказки о стыковке
 * при любом оформлении. Потому ранг и остался здесь, а цвет с миганием уехали в UI.
 */
const RANK: Record<WarnCode, number> = {
  missileIn: 110,
  overheat: 100,
  hullCritical: 95,
  laserHot: 90,
  noRockets: 84,
  noLaser: 84,
  noJump: 84,
  portalClosed: 43,
  portalOpening: 44,
  noAux: 84,
  noTarget: 84,
  landPrompt: 86,
  landApproach: 85,
  landDetach: 42,
  crash: 70,
  shipLost: 120,
  dockHint: 38,
  contactLost: 68,
  hullHot: 60,
  lowEnergy: 55,
  massLock: 50,
  gravityBrake: 49,
  playerLeft: 45,
  hail: 44,
  dockReady: 40,
  dockCorridor: 35,
  orbitExit: 43,
  refuel: 20,
  bonVoyage: 42,
  holdFull: 48,
  noRoom: 72,
  cruiseLatch: 41,
  cruiseUnlatch: 41,
  bushEnter: 92,
  bushArrive: 91,
}

/** Пара секунд на экране. */
export const WARN_LIFE = 2.2
/** Кулдаун переблика, пока условие держится: пауза между появлениями. */
const REPEAT = 4.5

/** Живой сигнал: что случилось, когда и с какими поправками от толкающего. */
export interface Warning {
  code: WarnCode
  rank: number
  born: number
  /** Готовая подпись (для параметрических: дистанция коридора, секунды до ракеты). */
  label?: string
  /** Переопределение частоты мигания (ракета мигает чаще по мере приближения). */
  hz?: number
}

const active = new Map<WarnCode, Warning>()
const lastFired = new Map<WarnCode, number>()

interface PushOpts {
  label?: string
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
  active.set(code, { code, rank: RANK[code], born: now, label: opts.label, hz: opts.hz })
}

/** Самый важный ЖИВОЙ сигнал (просроченные попутно выметаются). null — тихо. */
export function activeWarning(now: number): Warning | null {
  let best: Warning | null = null
  for (const [code, warning] of active) {
    // Просрочено ИЛИ время ушло НАЗАД (перезапуск мира после гибели): сигнал из прошлой
    // жизни родился в будущем относительно нового времени — выметаем, иначе висит вечно.
    if (now - warning.born > WARN_LIFE || now < warning.born) {
      active.delete(code)
      continue
    }
    if (!best || warning.rank > best.rank) best = warning
  }
  return best
}
