/**
 * Дуэль один на один с приборами. Ищем, почему игрок не попадает.
 */
import { Vector3 } from 'three'
import { aiController, leadPoint } from '../src/domain/ai'
import { createWorld, type ShipEntity, type World } from '../src/domain/world'
import { stepWorld, type Controller, type ControllerMap } from '../src/domain/sim'
import { steerToward } from '../src/domain/flight'
import { STARTER_SYSTEM } from '../src/domain/world'

const _aim = new Vector3()
const _fwd = new Vector3()
const _to = new Vector3()

let shots = 0
let framesOnTarget = 0
let frames = 0
const coneSamples: number[] = []
const distSamples: number[] = []

const player: Controller = {
  update(ship: ShipEntity, world: World) {
    const c = ship.controls
    c.autoBank = true
    c.flightAssist = true
    const enemy = world.ships.find((s) => s.alive)
    if (!enemy) return

    const d = enemy.state.pos.distanceTo(ship.state.pos)
    // Далеко — режем угол упреждением, близко — ведём нос прямо в цель.
    if (d > 600) leadPoint(ship, enemy, 900, _aim)
    else _aim.copy(enemy.state.pos)

    const st = steerToward(ship.state, _aim, 2.2)
    c.pitch = st.pitch
    c.yaw = st.yaw
    c.throttle = d < 300 ? 0.3 : 0.85
  },
  wantsFire(ship: ShipEntity, world: World) {
    const enemy = world.ships.find((s) => s.alive)
    if (!enemy) return false
    frames++

    const d = enemy.state.pos.distanceTo(ship.state.pos)
    _fwd.set(0, 0, -1).applyQuaternion(ship.state.quat)
    _to.copy(enemy.state.pos).sub(ship.state.pos).normalize()
    const dot = _fwd.dot(_to)
    const cone = Math.acos(Math.max(-1, Math.min(1, dot)))

    if (frames % 30 === 0) {
      coneSamples.push((cone * 180) / Math.PI)
      distSamples.push(d)
    }

    // Стреляем, только когда цель реально закрыта прицелом: её угловой размер.
    const angularSize = Math.atan2(enemy.spec.hull.radius, Math.max(d, 1))
    const fire = d < 1400 && cone < angularSize * 1.6
    if (fire) {
      framesOnTarget++
      shots++
    }
    return fire
  },
}

// Один противник, чтобы измерять чистый поединок.
const world = createWorld({ ...STARTER_SYSTEM, patrols: [{ ...STARTER_SYSTEM.patrols[0]!, count: 1 }] })
const controllers: ControllerMap = new Map<number, Controller>([
  [world.player.id, player],
  ...world.ships.map((s) => [s.id, aiController] as [number, Controller]),
])

const enemy = world.ships[0]!
console.log(`враг: корпус ${enemy.spec.hull.hull} щит ${enemy.spec.hull.shield}, ` +
  `рыскание ${enemy.spec.tuning.YAW_RATE} рад/с, тангаж ${enemy.spec.tuning.PITCH_RATE}`)
console.log(`игрок: рыскание ${world.player.spec.tuning.YAW_RATE} рад/с, тангаж ${world.player.spec.tuning.PITCH_RATE}`)
console.log(`старт: дистанция ${enemy.state.pos.distanceTo(world.player.state.pos).toFixed(0)} м\n`)

console.log('  t    игрок(корп/щит)   враг(корп/щит)   дист   трасс')
let tracersSeen = 0
const aiModes = new Map<string, number>()
let aiWantedFire = 0

for (let i = 0; i < 120 * 60 && world.player.alive && world.ships.some((s) => s.alive); i++) {
  stepWorld(world, 1 / 120, controllers)
  tracersSeen += world.tracers.length

  const bot = world.ships[0]
  if (bot?.ai) {
    aiModes.set(bot.ai.mode, (aiModes.get(bot.ai.mode) ?? 0) + 1)
    if (bot.ai.wantsFire) aiWantedFire++
  }

  if (i % (120 * 5) === 0) {
    const p = world.player
    const e = world.ships[0]
    const d = e ? e.state.pos.distanceTo(p.state.pos) : 0
    console.log(
      `${world.time.toFixed(0).padStart(3)}с   ` +
        `${p.hull.toFixed(0).padStart(3)}/${p.shield.toFixed(0).padStart(3)}          ` +
        `${(e?.hull ?? 0).toFixed(0).padStart(3)}/${(e?.shield ?? 0).toFixed(0).padStart(3)}         ` +
        `${d.toFixed(0).padStart(4)}м  ${world.tracers.length}`,
    )
  }
}
console.log(`\nсуммарно кадро-трасс: ${tracersSeen}`)
console.log(`\nрежимы ИИ: ${[...aiModes].map(([m, n]) => `${m}:${((n / 7200) * 100).toFixed(0)}%`).join(' ')}`)
console.log(`ИИ хотел стрелять: ${aiWantedFire} кадров (${((aiWantedFire / 7200) * 100).toFixed(1)}%)`)

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)] ?? 0
}

console.log(`длительность: ${world.time.toFixed(1)} с`)
console.log(`игрок ${world.player.alive ? 'жив' : 'ПОГИБ'} (корпус ${world.player.hull.toFixed(0)})`)
console.log(`враг ${world.ships.some((s) => s.alive) ? 'жив' : 'СБИТ'}`)
console.log(`\nвыстрелов: ${shots}, кадров в конусе: ${framesOnTarget}/${frames} (${((framesOnTarget / frames) * 100).toFixed(1)}%)`)
console.log(`угол до цели: средний ${avg(coneSamples).toFixed(0)}°, медиана ${median(coneSamples).toFixed(0)}°`)
console.log(`дистанция: средняя ${avg(distSamples).toFixed(0)} м, медиана ${median(distSamples).toFixed(0)} м`)
