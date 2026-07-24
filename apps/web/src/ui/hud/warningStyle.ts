import { UI } from '../theme'
import { t } from '../i18n'
import type { Warning, WarnCode } from '../../session/warnings'

/**
 * КАК ВЫГЛЯДИТ предупреждение: цвет, мигание, подпись на языке игрока.
 *
 * Отделено от очереди (`session/warnings`) не ради красоты: сигналы толкают контроллер,
 * сцена и приложение, и им незачем знать про палитру HUD и словарь. Здесь — чистое
 * оформление, и добавить новый сигнал по-прежнему значит дописать строку в таблицу.
 *
 * Красный — угроза жизни, жёлтый — осторожность и «нельзя», голубой — сообщение/состояние.
 */

interface Style {
  /** Цвет рамки, текста и полупрозрачного фона. */
  color: string
  /** Частота мигания текста, Гц. 0 — не мигает (текст горит ровно). */
  hz: number
  /** Ключ i18n подписи по умолчанию (переопределяется `label` у параметрических). */
  key: Parameters<typeof t>[0]
}

const STYLE: Record<WarnCode, Style> = {
  missileIn: { color: UI.DANGER, hz: 5, key: 'hud.missileWarn' },
  overheat: { color: UI.DANGER, hz: 3, key: 'hud.overheat' },
  hullCritical: { color: UI.DANGER, hz: 3, key: 'hud.hullCritical' },
  // Перегрев ЛАЗЕРА — жёлтый (осторожность/«нельзя стрелять»), а не угроза жизни: ствол
  // всего лишь глохнет на охлаждение. Мигает все 5 секунд отключки.
  laserHot: { color: UI.WARN, hz: 3, key: 'hud.laserHot' },
  noRockets: { color: UI.WARN, hz: 0, key: 'hud.noRockets' },
  noLaser: { color: UI.WARN, hz: 0, key: 'hud.noLaser' },
  noJump: { color: UI.WARN, hz: 0, key: 'hud.noJump' },
  portalClosed: { color: UI.PRIMARY, hz: 0, key: 'hud.portalClosed' },
  // Пока держат H — состояние, а не отказ: голубая, ровная, без мигания. Рангом выше
  // закрытия: раскрытие идёт прямо сейчас и перебивает сообщение о прошлом кольце.
  portalOpening: { color: UI.PRIMARY, hz: 0, key: 'hud.portalOpening' },
  noAux: { color: UI.WARN, hz: 0, key: 'hud.noAux' },
  noTarget: { color: UI.WARN, hz: 0, key: 'hud.noTarget' },
  // Окно стоянки: голубое — «нажмите L». Выше стыковки.
  landPrompt: { color: UI.PRIMARY, hz: 2, key: 'hud.landPrompt' },
  // За 1000 м: жёлтая «подготовка к ховер-режиму», L ещё рано.
  landApproach: { color: UI.WARN, hz: 0, key: 'hud.landApproach' },
  // Сидим на поверхности: не мигает — состояние, а не дедлайн. L отпускает.
  landDetach: { color: UI.PRIMARY, hz: 0, key: 'hud.landDetach' },
  // Неуправляемый удар о твердь: отскок без урона. Жёлтое — «осторожно», не гибель.
  crash: { color: UI.WARN, hz: 3, key: 'hud.crash' },
  // Игрок «погиб» и воскрес: красное, выше ракеты — причина должна быть видна сразу.
  shipLost: { color: UI.DANGER, hz: 3, key: 'hud.shipLost' },
  dockHint: { color: UI.PRIMARY, hz: 0, key: 'hud.dockHint' },
  contactLost: { color: UI.DANGER, hz: 0, key: 'hud.contactLost' },
  hullHot: { color: UI.WARN, hz: 2, key: 'hud.hullHot' },
  lowEnergy: { color: UI.WARN, hz: 2, key: 'hud.lowEnergy' },
  massLock: { color: UI.WARN, hz: 2, key: 'hud.massLock' },
  gravityBrake: { color: UI.WARN, hz: 2, key: 'hud.gravityBrake' },
  playerLeft: { color: UI.WARN, hz: 0, key: 'hud.playerLeft' },
  hail: { color: UI.PRIMARY, hz: 1.5, key: 'hud.hail' },
  dockReady: { color: UI.PRIMARY, hz: 2, key: 'hud.dockReady' },
  dockCorridor: { color: UI.PRIMARY, hz: 0, key: 'hud.dockCorridor' },
  orbitExit: { color: UI.PRIMARY, hz: 0, key: 'hud.orbitExit' },
  refuel: { color: UI.PRIMARY, hz: 1.5, key: 'hud.refuel' },
  // Напутствие при вылете: голубое, ровно горит (не мигает). Приоритет невысок — реальная
  // угроза на отходе (если вдруг) должна перебить добрые пожелания.
  bonVoyage: { color: UI.PRIMARY, hz: 0, key: 'hud.bonVoyage' },
  // Трюм не вмещает ближайший контейнер: жёлтое «нельзя», не угроза жизни.
  holdFull: { color: UI.WARN, hz: 0, key: 'hud.holdFull' },
  // Выкладка статуэтки: орбита низкая или тела слишком близко.
  noRoom: { color: UI.WARN, hz: 0, key: 'hud.noRoom' },
  // Защёлка форсажа (Alt) / сброс Ctrl — голубые, разовые, не угроза.
  cruiseLatch: { color: UI.PRIMARY, hz: 0, key: 'hud.cruiseLatch' },
  cruiseUnlatch: { color: UI.PRIMARY, hz: 0, key: 'hud.cruiseUnlatch' },
  // Вселенная: вход на куст и прибытие в узел. Голубые, высокий ранг — это событие
  // масштаба «сменилась галактика», его нельзя перебить бытовой подсказкой.
  bushEnter: { color: UI.PRIMARY, hz: 2, key: 'hud.bushEnter' },
  bushArrive: { color: UI.PRIMARY, hz: 0, key: 'hud.bushArrive' },
}

/** Плашка на экране: сигнал, одетый в цвет и слова. */
export interface Plate {
  color: string
  hz: number
  rank: number
  label: string
  born: number
}

export function plateOf(warning: Warning): Plate {
  const style = STYLE[warning.code]
  return {
    color: style.color,
    hz: warning.hz ?? style.hz,
    rank: warning.rank,
    label: warning.label ?? t(style.key),
    born: warning.born,
  }
}
