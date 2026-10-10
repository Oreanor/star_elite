/**
 * Каталог модулей таблицей по слотам: класс, цена, масса и главные числа.
 * Печатает markdown — для docs/PLAN_gear_tiers.md. Запуск: npx tsx scratch/catalogue.ts
 */
import { MODULE_CATALOGUE } from '../packages/sim/src/config/modules'
import type { ShipModule } from '../packages/sim/src/config/schema'

const KIND_RU: Record<string, string> = {
  engine: 'Двигатель', thrusters: 'Маневровые', shield: 'Щит', armour: 'Броня', laser: 'Лазер',
  missile: 'Ракеты', cargo: 'Грузовой отсек', hyperdrive: 'Гиперпривод', cloak: 'Маскировка',
  drone: 'Дроны', ecm: 'РЭБ', bomb: 'Бомба', scoop: 'Топливозаборник', mielophone: 'Миелофон',
}

/** Главные числа слота: то, по чему игрок сравнивает «слабее/сильнее». */
const KEY: Record<string, (m: any) => string> = {
  engine: (m) => `тяга ${m.thrust} кН · ${m.maxSpeed} м/с`,
  thrusters: (m) => `момент ${m.torque.join('/')} · бок ${m.lateralThrust}`,
  shield: (m) => `${m.capacity} ед. · реген ${m.regen}/с`,
  armour: (m) => `корпус +${m.hull}`,
  laser: (m) => `урон ${m.damage} · перезаряд ${m.cooldown} с`,
  missile: (m) => `${m.ammo} шт × ${m.damage} · ${m.speed} м/с`,
  cargo: (m) => `${m.capacity} т`,
  hyperdrive: (m) => `${m.jumpRange} св.г.`,
  cloak: (m) => `расход ${m.drain}/с`,
  drone: (m) => `${m.ammo} шт · до ${m.maxActive} разом`,
}

const byKind = new Map<string, ShipModule[]>()
for (const m of MODULE_CATALOGUE) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m])

for (const [kind, list] of byKind) {
  console.log(`\n### ${KIND_RU[kind] ?? kind}\n`)
  console.log('| Класс | Модуль | Цена, кр | Масса, т | Главное |')
  console.log('|---|---|---:|---:|---|')
  for (const m of [...list].sort((a, b) => a.class - b.class || a.cost - b.cost)) {
    const key = KEY[kind]?.(m) ?? '—'
    const price = m.cost === 0 ? 'старт' : m.cost.toLocaleString('ru-RU')
    console.log(`| ${m.class} | ${m.name} | ${price} | ${m.mass} | ${key} |`)
  }
}
