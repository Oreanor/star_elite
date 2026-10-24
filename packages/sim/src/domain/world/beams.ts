import { Quaternion, Vector3 } from 'three'
import { bodyZoom } from '../scale/scale'
import { BEAM_HEAT } from '../../config/beams'
import { clamp } from '../../core/math'
import type { BodyEntity, ShipEntity, World } from './entities'

/**
 * Лучи светил — джеты квазара и маяк пульсара (`BodyEntity.beams`). Одна формула и для
 * опасности, и для отрисовки: направление луча в момент `time` — ось `beams.axis`,
 * повёрнутая вокруг `spinAxis` на угол `spin · time` (модель маяка). У джетов spin = 0,
 * и они стоят на месте. Рендер зовёт то же самое с показанным временем — и видимый луч
 * всегда там, где жжёт.
 */

const _q = new Quaternion()
const _r = new Vector3()
const _dir = new Vector3()

/** Направление луча (единичное) в момент `time`. Второй луч — противоположный. */
export function beamDirection(body: BodyEntity, time: number, out: Vector3): Vector3 {
  out.copy(body.beams!.axis)
  if (body.spin !== 0) out.applyQuaternion(_q.setFromAxisAngle(body.spinAxis, body.spin * time))
  return out
}

/**
 * Облучённость корабля лучами, 0..1 — шкала та же, что у короны (`starExposure`): на оси
 * луча `BEAM_HEAT.CORE`, к стенке конуса спадает до нуля. Конус идёт от поверхности тела
 * до `beams.length`, в обе стороны; радиус растёт с удалением: `R + s·tg(полураствор)`.
 */
export function beamExposure(ship: ShipEntity, world: World): number {
  return hottestBeam(ship, world).exposure
}

/** Тело, чей луч жжёт сильнее всех, — для сообщения о гибели. Зовётся редко (при смерти). */
export function beamSourceName(ship: ShipEntity, world: World): string {
  return hottestBeam(ship, world).body?.name ?? ''
}

/** Результат поиска переиспользуется: облучённость считается каждый такт для каждого борта. */
const _hot: { exposure: number; body: BodyEntity | null } = { exposure: 0, body: null }

function hottestBeam(ship: ShipEntity, world: World): typeof _hot {
  let hottest = 0
  let source: BodyEntity | null = null
  for (const body of world.bodies) {
    const beams = body.beams
    if (!beams) continue
    _r.copy(ship.state.pos).sub(body.pos)
    beamDirection(body, world.time, _dir)
    // Луч того размера, что виден борту (закон зума тела): выросшему он короче — не жжёт там,
    // где на экране его давно нет.
    const zoom = bodyZoom(body, ship.state.scale)
    const radius = body.radius * zoom
    const along = _r.dot(_dir)
    const s = Math.abs(along) // оба луча: вдоль оси и против
    if (s < radius || s > beams.length * zoom) continue
    const perp = Math.sqrt(Math.max(0, _r.lengthSq() - along * along))
    const width = radius + s * Math.tan(beams.halfAngle)
    const e = clamp(1 - perp / width, 0, 1) * BEAM_HEAT.CORE
    if (e > hottest) {
      hottest = e
      source = body
    }
  }
  _hot.exposure = hottest
  _hot.body = source
  return _hot
}
