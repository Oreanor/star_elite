import { DefaultLoadingManager } from 'three'

/**
 * ГОТОВА ЛИ СЦЕНА — для экрана загрузки после обновления вкладки у причала.
 *
 * Перезагрузка у причала сразу показывает станцию, но канва ещё пуста: модели и текстуры в
 * пути, кликать бесполезно — ничего не происходит. Пока сцена не готова, интерфейс закрыт
 * экраном загрузки.
 *
 * «Готова» — сцена нарисовала первый кадр И очередь загрузок three.js опустела: все
 * загрузчики (GLTF, текстуры) по умолчанию идут через `DefaultLoadingManager`, и он знает,
 * сколько заказано и сколько доехало. Портреты (обычные <img>) сюда не входят и не держат.
 * Предохранитель — `MAX_WAIT_MS`: сеть упала или файл висит, экран не должен застрять навсегда.
 *
 * Флаг защёлкивается: раз сцена показалась, дальнейшие подгрузки (трафик, верфь) экран не
 * возвращают.
 */

const MAX_WAIT_MS = 25_000

let firstFrame = false
let ready = false
let loaded = 0
let total = 0
const listeners = new Set<() => void>()
const startedAt = typeof performance !== 'undefined' ? performance.now() : 0

function emit(): void {
  for (const fn of listeners) fn()
}

function check(): void {
  if (ready) return
  const idle = loaded >= total
  const timedOut = performance.now() - startedAt > MAX_WAIT_MS
  if ((firstFrame && idle) || timedOut) {
    ready = true
    emit()
  }
}

DefaultLoadingManager.onStart = (_url, itemsLoaded, itemsTotal) => {
  loaded = itemsLoaded
  total = itemsTotal
  emit()
}
DefaultLoadingManager.onProgress = (_url, itemsLoaded, itemsTotal) => {
  loaded = itemsLoaded
  total = itemsTotal
  emit()
  check()
}
DefaultLoadingManager.onLoad = () => {
  loaded = total
  check()
}

/** Сцена нарисовала первый кадр — зовёт компонент внутри Canvas. */
export function markFirstFrame(): void {
  if (firstFrame) return
  firstFrame = true
  check()
  // Предохранитель: если загрузок так и не было, `onLoad` не придёт — проверим и позже.
  setTimeout(check, 300)
  setTimeout(check, MAX_WAIT_MS + 50)
}

export function sceneReady(): boolean {
  return ready
}

/** Доля загруженного, 0..1 — для полосы. */
export function sceneProgress(): number {
  return total > 0 ? Math.min(1, loaded / total) : firstFrame ? 1 : 0
}

export function subscribeSceneReady(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
