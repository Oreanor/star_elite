import { smoothstep } from '@elite/sim'

/**
 * ВЫХОД ИЗ КОМНАТЫ — переход, а не щелчок.
 *
 * Раньше прибытие подменяло мир в одном кадре: только что вокруг была решётка — и сразу
 * галактика. Теперь это две фазы, склеенные подменой ровно посередине, когда экран чёрный
 * и шва не видно:
 *
 *  1. РАЗЛЁТ (`GROW`). Тор раздувается ОТНОСИТЕЛЬНО ТОЧКИ ВЫХОДА: масштаб проекции растёт,
 *     узлы уносит мимо камеры, дальний туман их доедает. Экран гаснет к чёрному.
 *  2. ПРОЯВЛЕНИЕ (`REVEAL`). Мир уже подменён и нарисован, но закрыт чёрным; из центра
 *     растёт круглая прорезь с мягким краем — сначала совсем размытым, к концу резким.
 *
 * Обе фазы идут с разгоном и торможением (`smoothstep`): линейный ход читается как рывок.
 * Живёт в app/control рядом с полётом — это состояние перехода, а не сцены; слой рендера
 * и пелена только читают его.
 */

/** Секунды. Полторы-две на всё: дольше — это уже не переход, а ожидание. */
const GROW = 0.75
const REVEAL = 1.05
const TOTAL = GROW + REVEAL

/** Во сколько раз раздувается проекция тора к концу разлёта. */
const GROW_SCALE = 15

/** Отрицательное время — перехода нет. */
let t = -1
let vertex = -1
let swapped = false

export function beginBushExit(v: number): void {
  t = 0
  vertex = v
  swapped = false
}

export function bushExitActive(): boolean {
  return t >= 0
}

/** Вершина, в которую летим. −1, если перехода нет. */
export function bushExitVertex(): number {
  return vertex
}

export function resetBushExit(): void {
  t = -1
  vertex = -1
  swapped = false
}

/**
 * Шаг перехода. Возвращает true РОВНО ОДИН РАЗ — в кадре, когда пора подменить мир
 * (конец разлёта, экран чёрный). Дальше переход досматривает проявление и гаснет сам.
 */
export function stepBushExit(dt: number): boolean {
  if (t < 0) return false
  t += dt
  if (t >= TOTAL) {
    const owed = !swapped
    resetBushExit()
    // Кадр мог быть длинным и перескочить всю фазу разлёта — подмену тогда всё равно должны.
    return owed
  }
  if (!swapped && t >= GROW) {
    swapped = true
    return true
  }
  return false
}

/** Множитель масштаба стереопроекции: 1 в начале, `GROW_SCALE` к концу разлёта. */
export function bushExitScale(): number {
  if (t < 0) return 1
  const p = smoothstep(0, GROW, t)
  return 1 + (GROW_SCALE - 1) * p
}

/**
 * Состояние ПЕЛЕНЫ для оверлея:
 *  `dark` 0..1 — насколько экран залит чёрным (фаза разлёта);
 *  `hole` 0..1.4 — радиус прорези в долях полуэкрана (фаза проявления);
 *  `soft` — ширина размытого края прорези в тех же долях: широкий вначале, узкий к концу.
 */
export function bushExitVeil(): { dark: number; hole: number; soft: number } {
  if (t < 0) return { dark: 0, hole: 0, soft: 0 }
  if (t < GROW) return { dark: smoothstep(0, GROW, t), hole: 0, soft: 0.5 }
  const p = smoothstep(0, REVEAL, t - GROW)
  return { dark: 1, hole: p * 1.45, soft: 0.5 - 0.45 * p }
}
