import { MORALE } from '../../config/ai'
import { clamp } from '../../core/math'
import { healthFraction, shieldFraction } from '../combat/damage'
import { energyFraction } from '../combat/ecm'
import type { Persona } from '../world/persona'
import type { ShipEntity } from '../world/entities'

/**
 * Боевой дух: решает, пора ли боту бросить бой.
 *
 * Не один порог здоровья, а СУММА трёх факторов, которые складываются по мере
 * ослабления: своя слабость (мало корпуса, щита, энергии), сила противника и
 * робость характера — трус со слабой волей пугается раньше храбреца. Пока бот
 * свеж, сумма мала; получая урон, он копит страх, и однажды тот переваливает порог.
 *
 * Слабость ВРАГА входит со знаком минус: если противник сам почти добит, добить
 * его выгоднее, чем бежать, и храбрость возвращается. Так «почти на нуле у обоих»
 * склоняет не к бегству, а к последнему размену.
 *
 * Всё детерминировано: то же состояние и та же персона — то же решение. Числа —
 * в конфиге (`MORALE`), тут только их сборка.
 */

/** Робость характера, −0.5..1. Трус боязлив, храбрец наоборот; слабая воля добавляет страх. */
export function cowardice(p: Persona): number {
  const base =
    p.disposition === 'cowardly' ? MORALE.COWARD_BASE : p.disposition === 'brave' ? MORALE.BRAVE_BASE : 0
  // Воля 1..5 (середина 3): ниже средней прибавляет страх, выше — гасит.
  const will = (3 - p.willpower) / 2 // −1..+1
  return clamp(base + will * MORALE.WILL_WEIGHT, -0.5, 1)
}

/**
 * Боевая сила — КЛАСС корабля (корпус+щит по паспорту), без текущего здоровья.
 * Здоровье врага уже учтено отдельным слагаемым `enemyWeak`: считать его и здесь
 * значило бы наказать подбитого дважды — он и так слаб, да ещё и «враг сильнее».
 */
function strength(s: ShipEntity): number {
  return s.spec.hull.hull + s.spec.hull.shield
}

/**
 * Уровень страха. Растёт с ослаблением, падает, когда враг сам при смерти. Порог
 * бегства — `MORALE.FLEE`; между ним и `FLEE − HYSTERESIS` бот, уже бегущий, бежит
 * дальше, а свежий ещё держится — так у порога нет дрожи «бегу-дерусь-бегу».
 */
export function fearLevel(e: ShipEntity, target: ShipEntity): number {
  const ownWeak =
    1 - MORALE.HULL_W * healthFraction(e) - MORALE.SHIELD_W * shieldFraction(e) - MORALE.ENERGY_W * energyFraction(e)
  const enemyStr = clamp(strength(target) / Math.max(1, strength(e)) - 1, -0.5, MORALE.ENEMY_STR_CAP)
  const coward = cowardice(e.persona)
  const enemyWeak = 1 - healthFraction(target)

  // Сила врага и робость нрава важны лишь ПО МЕРЕ ОСЛАБЛЕНИЯ, а не на старте боя:
  // свежий борт не бежит от одного вида сильного противника, а трус — не с полными
  // щитами. Их вклад умножается на собственную слабость (0 при полном здоровье),
  // поэтому страх КОПИТСЯ с уроном — «не сразу, а по мере ослабевания», как и задумано.
  // Слабость врага вычитается всегда: почти добитого добивают в любом состоянии.
  const pressure = (enemyStr * MORALE.ENEMY_W + coward * MORALE.COWARD_W) * ownWeak
  return ownWeak * MORALE.OWN_W + pressure - enemyWeak * MORALE.ENEMY_WEAK_W
}

/** Пора ли рвать из боя. Свежий бот — по порогу; уже бегущий держит бегство по гистерезису. */
export function wantsToFlee(e: ShipEntity, target: ShipEntity, alreadyFleeing: boolean): boolean {
  const threshold = alreadyFleeing ? MORALE.FLEE - MORALE.HYSTERESIS : MORALE.FLEE
  return fearLevel(e, target) >= threshold
}
