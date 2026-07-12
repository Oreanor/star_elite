import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SPAWN } from '../../config/world'
import { makeRng } from '../../core/math'
import { createWorld, STARTER_SYSTEM } from '.'
import { isFreeSpawn, pickFreeSpawn } from './spawn'

/**
 * Инвариант: новичок никогда не рождается в чём-то твёрдом. Опору берём у САМОЙ
 * станции — плотнейшее место системы: если и там точка выходит свободной, то в
 * пустоте тем более.
 */
describe('спавн новичка в свободной точке', () => {
  it('не рождает внутри тела, астероида или борта — на сотне разных сидов', () => {
    const w = createWorld(STARTER_SYSTEM)
    const station = w.bodies.find((b) => b.kind === 'station')
    expect(station).toBeTruthy()
    const out = new Vector3()
    for (let seed = 1; seed <= 200; seed++) {
      pickFreeSpawn(w, station!.pos, makeRng(seed), out)
      // Именно та проверка, которую использует сам спавн: место обязано быть чистым.
      expect(isFreeSpawn(w, out)).toBe(true)
    }
  })

  // Детерминизм — фундамент сети и сейвов: тот же сид обязан дать ту же точку,
  // иначе двое клиентов посадят новичка в разные места одной системы.
  it('детерминирован: тот же сид — та же точка', () => {
    const w = createWorld(STARTER_SYSTEM)
    const origin = w.player.state.pos
    const a = pickFreeSpawn(w, origin, makeRng(777), new Vector3())
    const b = pickFreeSpawn(w, origin, makeRng(777), new Vector3())
    expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z])
  })

  it('держится в окрестности опоры, а не улетает через всю систему', () => {
    const w = createWorld(STARTER_SYSTEM)
    const origin = w.player.state.pos
    const out = pickFreeSpawn(w, origin, makeRng(3), new Vector3())
    // Потолок: даже если пришлось расширять кольца до предела.
    const maxReach = SPAWN.RADIUS * SPAWN.GROWTH ** SPAWN.RINGS
    expect(out.distanceTo(origin)).toBeLessThanOrEqual(maxReach)
  })
})
