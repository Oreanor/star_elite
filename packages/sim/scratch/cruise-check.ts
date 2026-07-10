/**
 * Крейсерский ход: время в пути, массовая блокировка, торможение у планет.
 */
import { Vector3 } from 'three'
import { aiController } from '../src/domain/ai'
import { createWorld, STARTER_SYSTEM } from '../src/domain/world'
import { stepWorld, type Controller, type ControllerMap } from '../src/domain/sim'
import { steerToward } from '../src/domain/flight'
import { isPhased } from '../src/domain/cruise'
import { CRUISE } from '../src/config/cruise'
import type { ShipEntity, World } from '../src/domain/world'

const _aim = new Vector3()

/**
 * Летит к точке, заданной в ИСТИННЫХ координатах.
 * Плавающее начало сдвигает мир, поэтому локальная цель = истинная − originOffset.
 * Забыть про это — значит гнаться за уезжающей точкой.
 */
function pilotTo(trueTarget: Vector3): Controller {
  return {
    update(ship: ShipEntity, world: World) {
      const c = ship.controls
      c.autoBank = true
      c.flightAssist = true
      c.throttle = 1
      _aim.copy(trueTarget).sub(world.originOffset)
      const st = steerToward(ship.state, _aim, 2.2)
      c.pitch = st.pitch
      c.yaw = st.yaw
    },
    wantsFire: () => false,
    wantsCruise: () => true,
  }
}

function travel(label: string, trueTarget: Vector3, arriveAt: number, maxSeconds: number) {
  const world: World = createWorld({ ...STARTER_SYSTEM, patrols: [] })
  const controllers: ControllerMap = new Map<number, Controller>([
    [world.player.id, pilotTo(trueTarget)],
  ])

  const start = world.player.state.pos.distanceTo(trueTarget)
  let peakSpeed = 0
  let peakFactor = 0
  let arrived: number | null = null

  const local = new Vector3()
  const DT = 1 / 120
  for (let i = 0; i < 120 * maxSeconds; i++) {
    stepWorld(world, DT, controllers)
    peakSpeed = Math.max(peakSpeed, world.player.state.vel.length())
    peakFactor = Math.max(peakFactor, world.player.cruise.factor)

    local.copy(trueTarget).sub(world.originOffset)
    if (world.player.state.pos.distanceTo(local) < arriveAt) {
      arrived = world.time
      break
    }
  }

  const km = (m: number) => (m / 1000).toFixed(0)
  console.log(
    `${label.padEnd(18)} ${km(start).padStart(5)} км  ` +
      (arrived ? `долетел за ${arrived.toFixed(0).padStart(3)} с` : `НЕ ДОЛЕТЕЛ за ${maxSeconds} с`) +
      `   пик ${(peakSpeed / 1000).toFixed(1)} км/с (×${peakFactor.toFixed(0)})`,
  )
}

console.log('--- время в пути ---')
travel('до звезды', new Vector3(0, 0, -1_200_000), 70_000, 300)
travel('до Миратии', new Vector3(180_000, -20_000, -420_000), 20_000, 300)
travel('до Наронии IV', new Vector3(-600_000, 40_000, 300_000), 30_000, 300)

console.log('\n--- массовая блокировка: пираты рядом ---')
{
  const world = createWorld()
  const controllers: ControllerMap = new Map<number, Controller>([
    [world.player.id, pilotTo(new Vector3(0, 0, -1_200_000))],
    ...world.ships.map((s) => [s.id, aiController] as [number, Controller]),
  ])
  for (let i = 0; i < 120 * 3; i++) stepWorld(world, 1 / 120, controllers)
  const p = world.player
  const nearest = Math.min(...world.ships.map((s) => s.state.pos.distanceTo(p.state.pos)))
  console.log(
    `  ближайший пират ${nearest.toFixed(0)} м → множитель ${p.cruise.factor.toFixed(2)}, ` +
      `причина: ${p.cruise.block ?? '—'}, вне фазы: ${isPhased(p) ? 'да' : 'нет'}`,
  )
}

console.log('\n--- торможение у планеты ---')
{
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [] })
  const planet = world.bodies.find((b) => b.name === 'Миратия')!
  // Ставим игрока в 30 км над поверхностью планеты радиусом 6 км.
  world.player.state.pos.copy(planet.pos).add(new Vector3(0, 0, planet.radius + 30_000))
  const controllers: ControllerMap = new Map<number, Controller>([
    [world.player.id, pilotTo(new Vector3(0, 0, -1_200_000))],
  ])
  for (let i = 0; i < 120 * 20; i++) stepWorld(world, 1 / 120, controllers)
  const p = world.player
  const altitude = p.state.pos.distanceTo(planet.pos) - planet.radius
  const brakeZone = Math.min(Math.max(planet.radius * CRUISE.PROXIMITY_K, CRUISE.MIN_BRAKE_ZONE), CRUISE.MAX_BRAKE_ZONE)
  console.log(
    `  высота ${(altitude / 1000).toFixed(0)} км над планетой R=${planet.radius / 1000} км → ` +
      `множитель ${p.cruise.factor.toFixed(1)} (потолок ${(altitude / brakeZone).toFixed(1)}), ` +
      `причина: ${p.cruise.block ?? '—'}`,
  )
}
