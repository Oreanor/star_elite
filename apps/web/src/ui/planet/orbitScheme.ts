import type { BodyEntity } from '@elite/sim'

/**
 * СХЕМА спутников вокруг шара на вкладке планеты. Не масштабная модель — у Луны орбита в 60
 * радиусов, и в кадре от планеты остался бы пиксель, — но и не произвол:
 *
 *   • кольца идут в НАСТОЯЩЕМ порядке высот: причал на низкой орбите — внутри лун, а не
 *     последним кольцом (прежде кольцо давалось по номеру, и станция всегда висела снаружи);
 *   • шаг между кольцами РОВНЫЙ и заметный. Шаг от логарифма орбит пробовали — скачок
 *     «причал на высоте 500 км → луна на 30 000 км» съедал весь бюджет кадра, и две луны,
 *     между которыми на деле сорок их радиусов, рисовались впритирку. Генератор держит
 *     соседние орбиты в 1.45–2 раза (`makeMoons`), так что ровная лестница честна по смыслу;
 *   • соседние шары НЕ касаются: шаг не меньше суммы их нарисованных радиусов с зазором;
 *   • скорость — по Кеплеру (ω ∝ a^−3/2) от радиуса КОЛЬЦА: внутренний обгоняет внешнего, как
 *     в небе. От настоящих орбит нельзя: после низкого причала луны ползли бы почти стоя.
 *
 * Единица — радиус планеты на сцене.
 */
export interface SchemeSlot {
  body: BodyEntity
  /** Радиус кольца в радиусах планеты. */
  ring: number
  /** Радиус нарисованного шара в радиусах планеты. */
  size: number
  /** Угловая скорость на схеме, рад/с. */
  rate: number
}

/** Первое кольцо — не ближе этого к центру (поверх своего шара), R. */
const FIRST_RING = 1.45
/** Шаг между кольцами, R: полный — пока спутников мало. */
const STEP = 0.6
/**
 * Весь размах колец сверх первого, R. Камера вкладки видит примерно ±2.8 R; при свите в
 * шесть лун шаг ужимается, чтобы она влезла, но не ниже `MIN_STEP`.
 */
const SPREAD = 1.6
const MIN_STEP = 0.3
/** Зазор между соседними шарами сверх суммы их радиусов, R. */
const GAP = 0.15
/** Скорость самого внутреннего спутника на схеме, рад/с. */
const INNER_RATE = 0.45
/** Самая медленная — чтобы дальняя луна всё же шевелилась. */
const MIN_RATE = 0.03
/** Потолок нарисованного шара: крупная луна не перекрывает полпланеты. */
const MAX_SIZE = 0.3

/** Нарисованный размер: отношение радиусов сжато корнем — мелкая не пылинка, крупная не шар-близнец. */
export function drawnSize(body: BodyEntity, planet: BodyEntity): number {
  if (body.kind === 'station') return 0.05
  return Math.min(MAX_SIZE, Math.max(0.06, Math.sqrt(body.radius / planet.radius) * 0.4))
}

export function orbitScheme(planet: BodyEntity, satellites: readonly BodyEntity[]): SchemeSlot[] {
  const sorted = satellites
    .map((body) => ({ body, a: Math.max(body.pos.distanceTo(planet.pos), planet.radius * 1.01) }))
    .sort((x, y) => x.a - y.a)
  if (sorted.length === 0) return []

  const step = sorted.length > 1 ? Math.max(MIN_STEP, Math.min(STEP, SPREAD / (sorted.length - 1))) : STEP

  const slots: SchemeSlot[] = []
  for (let i = 0; i < sorted.length; i++) {
    const { body } = sorted[i]!
    const size = drawnSize(body, planet)
    const prev = slots[i - 1]
    const ring = prev
      ? prev.ring + Math.max(step, prev.size + size + GAP)
      : Math.max(FIRST_RING, 1 + size + GAP)
    const rate = Math.max(MIN_RATE, INNER_RATE * (FIRST_RING / ring) ** 1.5)
    slots.push({ body, ring, size, rate })
  }
  return slots
}
