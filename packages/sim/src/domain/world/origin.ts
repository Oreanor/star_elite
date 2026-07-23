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

  pos.set(0, 0, 0)

  /**
   * Сдвинуть обязано ВСЁ, у чего есть место в мире. Список тут — ручной, и это его слабость:
   * заведёшь новый список в `World` и забудешь строку здесь — объекты молча останутся в старых
   * координатах, то есть окажутся за километры от того места, где им положено быть. Так и
   * случилось со статуями: их поставили у причала, а после первого же сдвига они уехали за
   * пол-а.е. Аудит по этому следу вскрыл, что так же забыты были болты, платформы, варп-вспышки,
   * порталы и вспышки поля. НОВЫЙ СПИСОК С `pos` — НОВАЯ СТРОКА ЗДЕСЬ.
   */
  for (const s of world.ships) s.state.pos.add(_shift)
  for (const a of world.asteroids) a.pos.add(_shift)
  for (const p of world.pods) p.pos.add(_shift)
  for (const m of world.missiles) m.pos.add(_shift)
  // Болты — снаряды в полёте. Сдвиг случается и посреди боя: без него очередь teleportируется.
  for (const b of world.bolts) b.pos.add(_shift)
  for (const b of world.bodies) b.pos.add(_shift)
  for (const t of world.titans) t.pos.add(_shift)
  for (const m of world.monoliths) m.pos.add(_shift)
  for (const f of world.figurines) f.pos.add(_shift)
  for (const r of world.warBases) r.pos.add(_shift)
  // Платформы-гнёзда стоят на месте — тем заметнее был бы их прыжок.
  for (const p of world.platforms) p.pos.add(_shift)
  for (const t of world.tracers) {
    t.from.add(_shift)
    t.to.add(_shift)
  }
  for (const e of world.explosions) e.pos.add(_shift)
  // Живут доли секунды, но сдвиг может прийтись ровно на них — и вспышка мигнёт не там.
  for (const w of world.warps) w.pos.add(_shift)
  for (const p of world.warpPortals) p.pos.add(_shift)
  for (const gate of world.jumpGates) gate.pos.add(_shift)
  for (const f of world.shieldFlashes) {
    f.pos.add(_shift)
    f.center.add(_shift)
  }
  // `shockwaves` здесь нет намеренно: у вспышки бомбы нет места в мире — это экранный эффект,
  // а не тело. `muzzleFlashes` тоже: они держатся за id стрелка и едут вместе с ним сами.
}
