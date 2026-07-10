import { Vector3 } from 'three'
import { PHYSICS } from '../../config/physics'
import type { World } from './entities'

/**
 * Плавающее начало координат.
 *
 * float32 у GPU теряет точность уже за парой тысяч единиц: геометрия начинает
 * дрожать, и это не тот джиттер, который нам нужен. Раз в несколько километров
 * сдвигаем ВЕСЬ мир так, чтобы игрок снова оказался около нуля.
 *
 * Истинная позиция игрока = state.pos + originOffset.
 */

const _shift = new Vector3()

/**
 * Сдвигает мир, если игрок ушёл далеко от нуля, и записывает сдвиг в
 * `world.originShift` — ноль, если не двигали.
 *
 * Записываем, а не возвращаем: `_shift` переиспользуется, и отдавать его наружу
 * нельзя. А знать о сдвиге обязана камера — она живёт в мировых координатах и
 * без поправки «отстаёт» на четыре километра: пружина преследования тащит её
 * обратно к кораблю через полсекунды, и это выглядит как рывок кадра назад.
 */
export function maybeShiftOrigin(world: World): void {
  const pos = world.player.state.pos
  world.originShift.set(0, 0, 0)
  if (pos.lengthSq() < PHYSICS.FLOATING_ORIGIN_RADIUS ** 2) return

  _shift.copy(pos).negate()
  world.originOffset.sub(_shift)
  world.originShift.copy(_shift)

  pos.set(0, 0, 0)

  for (const s of world.ships) s.state.pos.add(_shift)
  for (const a of world.asteroids) a.pos.add(_shift)
  for (const p of world.pods) p.pos.add(_shift)
  for (const m of world.missiles) m.pos.add(_shift)
  for (const b of world.bodies) b.pos.add(_shift)
  for (const t of world.tracers) {
    t.from.add(_shift)
    t.to.add(_shift)
  }
  for (const e of world.explosions) e.pos.add(_shift)
}
