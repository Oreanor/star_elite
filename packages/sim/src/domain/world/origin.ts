import { Vector3 } from 'three'
import { PHYSICS } from '../../config/physics'
import type { World } from './entities'
import { shiftTrail } from './poseTrail'
import { translateNeighborhood, translatePlayer } from './frame'

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
 * Сдвигает мир, если игрок ушёл далеко от нуля, и ПРИБАВЛЯЕТ свой сдвиг к
 * `world.originShift` (общий канал поправки камеры за кадр; см. `stepWorld`).
 *
 * Прибавляем, а не возвращаем: `_shift` переиспользуется, и отдавать его наружу
 * нельзя. А знать о сдвиге обязана камера — она живёт в мировых координатах и
 * без поправки «отстаёт» на четыре километра: пружина преследования тащит её
 * обратно к кораблю через полсекунды, и это выглядит как рывок кадра назад.
 */
export function maybeShiftOrigin(world: World): void {
  const pos = world.player.state.pos
  // Не обнуляем `originShift` здесь: его сбрасывает `stepWorld` в начале кадра, а до нас
  // в него уже мог накопиться орбитальный сдвиг из `stepOrbits`. Мы лишь ПРИБАВЛЯЕМ свой.
  if (pos.lengthSq() < PHYSICS.FLOATING_ORIGIN_RADIUS ** 2) return

  _shift.copy(pos).negate()
  world.originOffset.sub(_shift)
  world.originShift.add(_shift)

  translatePlayer(world, _shift)
  translateNeighborhood(world, _shift)
  // Перецентровка двигает ВСЁ: кроме окрестности — тела, статуи двора, базы и статуэтки.
  for (const b of world.bodies) {
    b.pos.add(_shift)
    shiftTrail(b, _shift)
  }
  for (const m of world.monoliths) m.pos.add(_shift)
  for (const r of world.warBases) r.pos.add(_shift)
  for (const f of world.figurines) {
    f.pos.add(_shift)
    shiftTrail(f, _shift)
  }
}
