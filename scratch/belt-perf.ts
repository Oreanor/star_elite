/**
 * Сколько стоит пояс астероидов в такте симуляции. Не тест — прогон для глаз.
 * Игрок у пояса стартовой системы (1.4 а.е.): число камней в мире, средний такт,
 * стоимость пересборки пояса (раз в STREAM_INTERVAL) и худший такт.
 *
 * Запуск: npx tsx scratch/belt-perf.ts
 */
import { PHYSICS } from '../packages/sim/src/config/physics'
import { stepWorld } from '../packages/sim/src/domain/sim/step'
import { stepAsteroidBelt, nearestBeltPoint } from '../packages/sim/src/domain/world/asteroidBelt'
import { createWorld } from '../packages/sim/src/domain/world'
import { STARTER_SYSTEM } from '../packages/sim/src/domain/world/system'
import type { ControllerMap } from '../packages/sim/src/domain/sim/controller'

const world = createWorld({ ...STARTER_SYSTEM, patrols: [] })
world.docked = false
nearestBeltPoint(world, world.player.state.pos)
world.player.state.vel.set(0, 0, 0)
const map: ControllerMap = new Map()

// Прогрев: пояс заселяется, JIT греется.
for (let i = 0; i < 600; i++) stepWorld(world, 1 / 60, map)

const belt = world.asteroids.filter((a) => a.beltKey)
const near = belt.filter((a) => a.pos.distanceTo(world.player.state.pos) < 30_000)
console.log(`камней в мире: ${world.asteroids.length}, из них пояса: ${belt.length}, ближе 30 км: ${near.length}`)

// Средний такт и худший кадр.
const frames = 600
let worst = 0
const t0 = performance.now()
for (let i = 0; i < frames; i++) {
  const a = performance.now()
  stepWorld(world, 1 / 60, map)
  worst = Math.max(worst, performance.now() - a)
}
const ms = performance.now() - t0
const ticks = (frames / 60) / PHYSICS.FIXED_DT
console.log(`такт: ${(ms / ticks * 1000).toFixed(1)} мкс, кадр 60 Гц: ${(ms / frames).toFixed(3)} мс, худший кадр: ${worst.toFixed(2)} мс`)

// Одна пересборка пояса.
let rebuild = 0
const N = 20
for (let i = 0; i < N; i++) {
  world.asteroidBelt!.nextUpdate = -1
  const a = performance.now()
  stepAsteroidBelt(world)
  rebuild += performance.now() - a
}
console.log(`пересборка пояса: ${(rebuild / N).toFixed(2)} мс (раз в 0.5 с), точек дуги: ${world.asteroidBelt!.dots.count}`)
