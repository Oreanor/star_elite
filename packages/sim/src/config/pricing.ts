import type { ShipModule } from './schema'

/**
 * Цена каталога — не запись в карточке, а формула.
 *
 * Платят за характеристику и за то, сколько её приходится на тонну:
 *   цена = ставка × характеристика × (характеристика / масса)
 *         = ставка × характеристика² / масса.
 *
 * Лёгкая деталь с тем же статом дороже тяжёлой: тонна, которой нет, и есть товар.
 * Тяжёлая с большим статом может выйти дешевле лёгкой, если на тонну стата меньше.
 * Ставка своя у вида, потому что у тяги, щита и светового года разные единицы.
 *
 * Маскировка перевёрнута: её характеристика — расход, и меньше значит лучше,
 * поэтому в формулу входит 1/расход. Аукс без шкалы (РЭБ, бомба, скуп) — ставка
 * вида, делённая на массу: то же устройство тяжелее стоит меньше.
 */
export const LIST_PRICE = {
  engine: 1,
  thrusters: 15,
  shield: 0.4,
  armour: 1,
  /** Урон в секунду, не «за выстрел»: у луча и у импульсного поле `damage` — разные единицы. */
  laser: 4,
  /** Суммарный урон подвески (урон × боезапас), не число ракет в ячейке. */
  missile: 0.02,
  cargo: 20,
  hyperdrive: 200,
  drone: 2000,
  /** Множитель при 1/расход²/масса. */
  cloak: 400_000_000,
  ecm: 84_000,
  bomb: 640_000,
  scoop: 36_000,
} as const

/** Число, которое формула считает характеристикой модуля. */
function pricedSpec(m: ShipModule): number {
  switch (m.kind) {
    case 'engine':
      return m.thrust
    case 'thrusters':
      return m.torque[0]
    case 'shield':
      return m.capacity
    case 'armour':
      return m.hull
    case 'laser':
      // «Столб» бьёт не своим уроном, а калибром носовой точки. В цене этого нет —
      // иначе слабый паспортный луч стал бы товаром и сломал сравнение семейств.
      if (m.id === 'pulse_1c') return 0
      // Диковинки не жгут: их характеристика — темп эффекта, не нулевой урон.
      if (m.damage <= 0) return m.effectRate ?? 0
      return m.beam || m.cooldown <= 0 ? m.damage : m.damage / m.cooldown
    case 'missile':
      return m.damage * m.ammo
    case 'cargo':
      return m.capacity
    case 'hyperdrive':
      return m.jumpRange
    case 'drone':
      return m.ammo
    case 'cloak':
      return 1 / m.drain
    case 'ecm':
    case 'bomb':
    case 'scoop':
    case 'mielophone':
      return 0
  }
}

/** Каталожная цена, кредиты. Миелофон сюда не входит: он дар, не строка формулы. */
export function listPrice(m: ShipModule): number {
  if (m.kind === 'ecm' || m.kind === 'bomb' || m.kind === 'scoop') {
    return Math.max(1, Math.round(LIST_PRICE[m.kind] / m.mass))
  }
  const spec = pricedSpec(m)
  if (spec <= 0 || m.mass <= 0 || m.kind === 'mielophone') return 0
  return Math.max(1, Math.round(LIST_PRICE[m.kind] * spec * spec / m.mass))
}
