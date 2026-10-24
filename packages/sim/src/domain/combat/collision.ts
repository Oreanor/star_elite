import { Vector3 } from 'three'
import { LANDING } from '../../config/landing'
import { IMPACT } from '../../config/weapons'
import { SHIELD } from '../../config/station'
import type { ShipEntity } from '../world/entities'
import { effectiveMass, effectiveRadius } from '../scale/scale'
import { applyDamage } from './damage'

const _delta = new Vector3()
const _normal = new Vector3()
const _relVel = new Vector3()

/**
 * Расталкивание корабля и сферического препятствия.
 *
 * Это не полноценная физика удара — тензора инерции здесь нет, вращение от
 * касательного удара не возникает. Но импульс по нормали честный, и урон
 * пропорционален скорости сближения: влететь в астероид на форсаже смертельно.
 *
 * @returns нанесённый кораблю урон.
 */
export function resolveShipVsSphere(
  ship: ShipEntity,
  otherPos: Vector3,
  otherVel: Vector3,
  otherRadius: number,
  otherMass: number,
  time: number,
): number {
  _delta.copy(ship.state.pos).sub(otherPos)
  const distance = _delta.length()
  const minDistance = effectiveRadius(ship) + otherRadius

  if (distance >= minDistance || distance < 1e-6) return 0

  _normal.copy(_delta).divideScalar(distance)

  // Сначала разводим по позиции, иначе тела залипнут и будут дрожать.
  ship.state.pos.addScaledVector(_normal, minDistance - distance)

  const closingSpeed = _relVel.copy(ship.state.vel).sub(otherVel).dot(_normal)
  if (closingSpeed >= 0) return 0 // уже расходятся

  // Доля импульса, достающаяся кораблю: лёгкий отлетает от тяжёлого. У гиганта масса
  // растёт кубом масштаба — от камня он не дрогнет.
  const massRatio = otherMass / (effectiveMass(ship) + otherMass)
  ship.state.vel.addScaledVector(_normal, -closingSpeed * (1 + IMPACT.RESTITUTION) * massRatio)

  // «Сырая» сила удара — по ней вызывающий решает, колоть ли камень; она от масштаба
  // не зависит (гигант всё так же дробит астероид, что задел).
  const rawImpact = Math.min(
    IMPACT.RAM_DAMAGE_MAX,
    Math.abs(closingSpeed) * IMPACT.RAM_DAMAGE_PER_SPEED,
  )
  // Вырос (миелофон) — НЕУЯЗВИМ к столкновениям, но ОСТАЁТСЯ ТВЁРДЫМ: раздвижка и импульс
  // выше уже применены (не проваливается), а урон гиганту не наносим. За каждой мошкой,
  // что в тебя тычется, гиганту не уследить — глупо за это гибнуть.
  if (ship.state.scale <= 1 && rawImpact > 1) {
    applyDamage(ship, rawImpact, time, { kind: 'impact', name: '' })
  }
  return rawImpact
}

const _sdelta = new Vector3()
const _snormal = new Vector3()
const _solidPrev = new Vector3()

/**
 * Отскок от твёрдой сферы (планета, статуя, глыба) — БЕЗ урона.
 *
 * Неуправляемый контакт: отбрасывает назад (жёлтый «КРУШЕНИЕ» у HUD), сесть можно
 * только по L. После крейсерского туннеля корабль оказывается на ДАЛЬНЕЙ стороне;
 * ставим его на сторону подхода и гасим сверхсвет — иначе отражение унесло бы на 29c.
 *
 * @returns скорость налёта до отскока, м/с.
 */
export function bounceOffSolid(
  ship: ShipEntity,
  center: Vector3,
  radius: number,
  dt: number,
): number {
  ship.cruise.factor = 1
  const reach = radius + effectiveRadius(ship)

  // Сторона подхода — откуда пришли за шаг (интегратор уже сдвинул pos).
  _solidPrev.copy(ship.state.pos).addScaledVector(ship.state.vel, -dt)
  _snormal.copy(_solidPrev).sub(center)
  if (_snormal.lengthSq() < 1e-12) {
    _snormal.copy(ship.state.vel).negate()
    if (_snormal.lengthSq() < 1e-12) _snormal.set(1, 0, 0)
  }
  _snormal.normalize()

  const impactSpeed = Math.max(0, -ship.state.vel.dot(_snormal))
  ship.state.pos.copy(center).addScaledVector(_snormal, reach)

  const closing = ship.state.vel.dot(_snormal)
  if (closing < 0) {
    ship.state.vel.addScaledVector(_snormal, -closing * (1 + LANDING.CRASH_BOUNCE))
  }
  const speed = ship.state.vel.length()
  if (speed > LANDING.CRASH_BOUNCE_MAX) {
    ship.state.vel.multiplyScalar(LANDING.CRASH_BOUNCE_MAX / speed)
  }
  return impactSpeed
}

/**
 * Отскок корабля от защитного поля станции. В отличие от удара о твердь — БЕЗ урона:
 * поле упруго отталкивает и ГАСИТ скорость (пружина, не таран). Врезаться в станцию
 * больше нельзя: разогнавшийся отпружинивает назад, теряя ход. Пропуск через поле —
 * забота вызывающего (идущему на стыковку с допуском поле не мешает).
 *
 * Кладёт точку контакта на сфере поля в `outContact` и ВОЗВРАЩАЕТ скорость сближения
 * в момент удара, м/с: `-1` — контакта не было; `0` — корабль касается, но лишь упирается/
 * скользит вдоль поля без налёта; `>0` — налетел с этой скоростью. Вызывающий по этому
 * числу задаёт ЯРКОСТЬ вспышки (упор — еле видно, таран — ярко), а не «есть/нет».
 */
export function bounceOffShield(
  ship: ShipEntity,
  center: Vector3,
  shieldRadius: number,
  outContact: Vector3,
): number {
  _sdelta.copy(ship.state.pos).sub(center)
  const distance = _sdelta.length()
  const minDistance = effectiveRadius(ship) + shieldRadius
  if (distance >= minDistance || distance < 1e-6) return -1

  _snormal.copy(_sdelta).divideScalar(distance)
  // Выталкиваем на поверхность поля: иначе корабль вязнет и дрожит в нём.
  ship.state.pos.addScaledVector(_snormal, minDistance - distance)

  // Точка контакта — на сфере поля, туда рендер положит голубой кружок.
  outContact.copy(center).addScaledVector(_snormal, shieldRadius)

  const closing = ship.state.vel.dot(_snormal)
  if (closing >= 0) return 0 // касается, но отходит/скользит — не удар, поле лишь мерцает

  // Отражаем нормальную составляющую с восстановлением < 1: корабль отпружинивает
  // назад, но медленнее, чем влетел. Касательную не трогаем — он скользит вдоль поля.
  ship.state.vel.addScaledVector(_snormal, -closing * (1 + SHIELD.BOUNCE))
  return -closing // скорость налёта на поле, м/с
}
