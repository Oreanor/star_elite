/**
 * ВРЕМЕННАЯ диагностика гиперперехода. Снять, как только поймаем причину.
 *
 * Портал проходит через четыре слоя (клавиша → состояние портала → сборка мира →
 * stencil-проход → пересечение), и каждый умеет молча ничего не сделать. Поэтому лог
 * ставится в КАЖДУЮ ветку: важно не то, что случилось, а на каком шаге оборвалось.
 *
 * `hstate` пишет только СМЕНУ значения: покадровое состояние иначе заливает консоль
 * и прячет в себе то единственное событие, ради которого лог и включён.
 */

const ON = true

export function hlog(event: string, data?: Record<string, unknown>): void {
  if (!ON) return
  if (data) console.log(`[HYPER] ${event}`, data)
  else console.log(`[HYPER] ${event}`)
}

const last = new Map<string, string>()

export function hstate(key: string, value: string, data?: Record<string, unknown>): void {
  if (!ON) return
  if (last.get(key) === value) return
  last.set(key, value)
  hlog(`${key}: ${value}`, data)
}

/** Новое нажатие H начинает новую историю — старые «последние значения» не мешают. */
export function hreset(): void {
  last.clear()
}
