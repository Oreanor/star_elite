/**
 * Сколько стоит такт симуляции и где уходит время. Не тест — прогон для глаз.
 *
 * Мир стартовой системы с трафиком, у каждого борта ИИ-пилот. Сперва прогрев (трафик
 * успевает заселить систему), затем замер: среднее время такта и доли по фазам —
 * фазы меряются обёрткой экспортов step-модулей через «перехват» `performance.now`.
 *
 * Запуск: npx tsx scratch/simperf.ts
 */
import { PHYSICS } from '../packages/sim/src/config/physics'
import { aiController } from '../packages/sim/src/domain/ai/pilot'
import { stepWorld } from '../packages/sim/src/domain/sim/step'
import type { ControllerMap } from '../packages/sim/src/domain/sim/controller'
import { createWorld, type World } from '../packages/sim/src/domain/world'
import { STARTER_SYSTEM } from '../packages/sim/src/domain/world/system'
import { applySharedStartWorld } from '../packages/sim/src/domain/galaxy/sharedStart'

function bind(world: World, map: ControllerMap): void {
  if (map.size === world.ships.length && world.ships.every((s) => map.has(s.id))) return
  map.clear()
  for (const s of world.ships) map.set(s.id, aiController)
}

function run(label: string, world: World, seconds: number): void {
  const map: ControllerMap = new Map()
  const frame = 1 / 60
  // Прогрев: трафик заселяет систему, JIT прогревается.
  for (let t = 0; t < 30; t += frame) {
    bind(world, map)
    stepWorld(world, frame, map)
  }
  const frames = Math.round(seconds / frame)
  const t0 = performance.now()
  let ships = 0
  let bolts = 0
  for (let i = 0; i < frames; i++) {
    bind(world, map)
    stepWorld(world, frame, map)
    ships += world.ships.length
    bolts += world.bolts.length
  }
  const ms = performance.now() - t0
  const ticks = seconds / PHYSICS.FIXED_DT
  console.log(
    `${label}: ${(ms / ticks * 1000).toFixed(1)} мкс/такт, ${(ms / frames).toFixed(3)} мс/кадр 60 Гц, ` +
      `бортов в среднем ${(ships / frames).toFixed(1)}, камней ${world.asteroids.length}, болтов в полёте ${(bolts / frames).toFixed(0)}, живых ${world.ships.filter((x) => x.alive).length}`,
  )
}

const def = applySharedStartWorld(STARTER_SYSTEM, 1, 0)
run('стартовая система (базы, трафик)', createWorld(def), 60)
run('стартовая система, без баз', createWorld(STARTER_SYSTEM), 60)

// ── СВАЛКА: 20 пиратов против 20 полицейских вокруг игрока, все стреляют ───────────────
import { Quaternion, Vector3 } from 'three'
import { pirateLoadout } from '../packages/sim/src/config/loadouts'
import { makeShip } from '../packages/sim/src/domain/world'
import { createAIState } from '../packages/sim/src/domain/ai'

function brawl(n: number): World {
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [] })
  const at = world.player.state.pos
  for (let i = 0; i < n; i++) {
    const faction = i % 2 === 0 ? 'hostile' : 'police'
    const a = (i / n) * Math.PI * 2
    const pos = new Vector3(Math.cos(a) * 1500, (i % 5) * 80 - 160, Math.sin(a) * 1500).add(at)
    const ship = makeShip(world.ids, faction, `Бот ${i}`, pirateLoadout(), pos, new Quaternion(), world.rng)
    ship.ai = createAIState(at.clone(), world.rng)
    world.ships.push(ship)
  }
  return world
}
run('свалка 40 бортов', brawl(40), 30)
run('свалка 80 бортов', brawl(80), 30)
