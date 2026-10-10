import type { ConsoleTab } from '../ui/console/Console'

/**
 * Где игрок был до перезагрузки страницы — чтобы F5 возвращал к причалу на ту же вкладку,
 * а не на титул с взлётом.
 *
 * Только для ПРИСТЫКОВАННОГО: сейв пишется у станции, и мир после загрузки стоит там же.
 * В полёте вернуть «то же место» нечем (позиция в сейв не идёт), а без жеста браузер не
 * отдаст захват курсора — там честный титул.
 *
 * `sessionStorage`, а не `localStorage`: это память ВКЛАДКИ. Закрыл вкладку и открыл игру
 * заново — начинаешь с титула, как положено; перезагрузил — продолжаешь.
 */

const KEY = 'elite.resume'

export interface Resume {
  tab: ConsoleTab
}

export function readResume(): Resume | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'tab' in parsed && typeof parsed.tab === 'string') {
      return { tab: parsed.tab as ConsoleTab }
    }
  } catch {
    // Хранилище закрыто (приватный режим) или запись битая — просто стартуем с титула.
  }
  return null
}

export function writeResume(resume: Resume | null): void {
  try {
    if (resume) sessionStorage.setItem(KEY, JSON.stringify(resume))
    else sessionStorage.removeItem(KEY)
  } catch {
    // Не записали — следующая перезагрузка начнётся с титула. Не беда.
  }
}
