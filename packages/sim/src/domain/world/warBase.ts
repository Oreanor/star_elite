import { Quaternion, Vector3 } from 'three'
import { WARBASE } from '../../config/warbase'
import type { WarBaseEntity, WarBaseFixture } from './entities'

/**
 * ГДЕ ЧТО СТОИТ на военной базе. Только геометрия: ни урона, ни обломков — те в `combat`.
 *
 * Живёт в `world`, а не в `combat`, потому что место детали спрашивают все: луч (попадание),
 * рендер (куда рисовать) и захват цели (`queries`). Оставь функцию в бою — и запросы мира
 * начнут импортировать бой, чтобы узнать координату; направление зависимостей развернётся,
 * и «куда нарисовано — туда и попадает» разъедется по копиям формулы.
 */

const _spin = /* @__PURE__ */ new Quaternion()

/**
 * Мировая точка навесной детали в момент `time`: локальная радиаль, повёрнутая спином базы,
 * отложенная на поверхность + выступ. ОДИН источник для луча, рендера и захвата — куда
 * нарисовано, туда и попадает. Пишет в `out`, наружу scratch не отдаёт.
 */
export function warBaseFixtureWorldPos(
  base: WarBaseEntity,
  fix: WarBaseFixture,
  time: number,
  out: Vector3,
): Vector3 {
  _spin.setFromAxisAngle(base.spinAxis, base.spin * time)
  out.copy(fix.dir).applyQuaternion(_spin)
  const reach = base.radius + fix.size * WARBASE.FIXTURE_SIT_OUT
  return out.multiplyScalar(reach).add(base.pos)
}

/** Сколько деталей ещё стоит. Ноль — базе держаться не на чем. */
export function livingFixtures(base: WarBaseEntity): number {
  let n = 0
  for (const f of base.fixtures) if (f.alive) n++
  return n
}

/**
 * ЖИВУЧЕСТЬ базы, 0..1 — доля уцелевших деталей.
 *
 * Своей копилки прочности у корпуса нет: база и есть её турели. Это же число рисует
 * полоска цели, поэтому «сколько осталось» видно глазами, а не выводится из скрытого
 * запаса: сбил турель — полоска шагнула на понятную величину.
 */
export function warBaseIntegrity(base: WarBaseEntity): number {
  const total = base.fixtures.length
  return total > 0 ? livingFixtures(base) / total : 0
}

/** Найти деталь по id среди живых баз — вместе с её базой: место считается от базы. */
export function findWarBaseFixture(
  bases: readonly WarBaseEntity[],
  id: number | null,
): { base: WarBaseEntity; fixture: WarBaseFixture } | null {
  if (id === null) return null
  for (const base of bases) {
    if (!base.alive) continue
    const fixture = base.fixtures.find((f) => f.id === id && f.alive)
    if (fixture) return { base, fixture }
  }
  return null
}
