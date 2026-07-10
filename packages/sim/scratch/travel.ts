/**
 * Сколько лететь до звезды и до планет крейсерским ходом.
 *
 * Считать в уме нельзя: скорость крейсера пропорциональна высоте над ближайшим
 * телом, поэтому подлёт — это экспоненциальное торможение, а не равномерный ход.
 * Ответ нужен и пилоту (сколько ждать), и точке выхода из прыжка (на каком удалении
 * ставить корабль, чтобы до причала была минута-две).
 */
import { Vector3 } from 'three'
import { CRUISE } from '../src/config/cruise'
import { steerToward } from '../src/domain/flight'
import { stepWorld, type Controller, type ControllerMap } from '../src/domain/sim'
import { createWorld, STARTER_SYSTEM, type ShipEntity, type World } from '../src/domain/world'

const _aim = new Vector3()

/** Летит к точке, заданной в ИСТИННЫХ координатах: плавающее начало сдвигает мир. */
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

const LIGHT_SECOND = 299_792_458

/**
 * Замер меряет ДОРОГУ, а не бой. Встречный трафик глушит крейсер массовой
 * блокировкой, и время в пути превращается во время до первого пирата.
 */
function hush(world: World): void {
  world.ships.length = 0
  world.trafficTimer = 1e9
}

/** Летит к телу, пока не окажется в `arriveAt` метрах от его ПОВЕРХНОСТИ. */
function travel(bodyName: string, arriveAt: number, maxSeconds = 600): void {
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  const body = world.bodies.find((b) => b.name === bodyName)
  if (!body) throw new Error(`нет тела «${bodyName}»`)

  const trueTarget = body.pos.clone().add(world.originOffset)
  const controllers: ControllerMap = new Map<number, Controller>([[world.player.id, pilotTo(trueTarget)]])

  const start = world.player.state.pos.distanceTo(body.pos) - body.radius
  let peak = 0
  let arrived: number | null = null

  const local = new Vector3()
  const DT = 1 / 120
  for (let i = 0; i < 120 * maxSeconds; i++) {
    hush(world)
    stepWorld(world, DT, controllers)
    peak = Math.max(peak, world.player.cruise.factor)
    local.copy(trueTarget).sub(world.originOffset)
    if (world.player.state.pos.distanceTo(local) - body.radius < arriveAt) {
      arrived = world.time
      break
    }
  }

  if (process.env.TRACE) {
    // Кино по секундам: где корабль, какой множитель, что его держит.
    const w2 = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const b2 = w2.bodies.find((b) => b.name === bodyName)!
    const t2 = b2.pos.clone().add(w2.originOffset)
    const c2: ControllerMap = new Map<number, Controller>([[w2.player.id, pilotTo(t2)]])
    const l2 = new Vector3()
    for (let s = 0; s <= 600; s++) {
      for (let i = 0; i < 120; i++) {
        hush(w2)
        stepWorld(w2, 1 / 120, c2)
      }
      if (s % 30) continue
      l2.copy(t2).sub(w2.originOffset)
      const alt = w2.player.state.pos.distanceTo(l2) - b2.radius
      console.log(
        `    t=${String(s).padStart(3)}с  до цели ${(alt / 1e6).toFixed(1).padStart(9)} тыс.км  ` +
          `v=${(w2.player.state.vel.length() / 1000).toFixed(0).padStart(7)} км/с  ×${w2.player.cruise.factor.toExponential(1)}`,
      )
    }
  }

  const ls = (start / LIGHT_SECOND).toFixed(0)
  const km = (m: number) => `${(m / 1000).toFixed(0)} км`
  console.log(
    `${bodyName.padEnd(16)} старт ${ls.padStart(4)} св.с, подойти на ${km(arriveAt).padStart(12)}: ` +
      (arrived === null
        ? `НЕ ДОЛЕТЕЛ за ${maxSeconds} с`
        : `${arrived.toFixed(0).padStart(3)} с (${(arrived / 60).toFixed(1)} мин)`) +
      `   пик ×${(peak / 1e6).toFixed(1)} млн`,
  )
}

console.log(`полный ход: ×${CRUISE.MAX_FACTOR.toExponential(0)}, зона торможения ${CRUISE.BRAKE_ZONE} м\n`)

// Звезда: 1 а.е. = 499 световых секунд. Подойти на разные дистанции от короны.
travel('Тиррион', 100_000_000)
travel('Тиррион', 10_000_000)
travel('Тиррион', 1_000_000)

// Планеты.
travel('Оссиания', 500_000)
travel('Тиррион IV', 1_000_000)

// Причал: сколько лететь с разных удалений — это и есть точка выхода из прыжка.
/**
 * То же, но С трафиком: сколько времени крейсер вообще разрешён.
 * Ровно на это жалуется пилот — «сколько ни держу, скорость не растёт».
 */
{
  console.log('\n--- дорога к звезде при живом трафике ---')
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  const star = world.bodies.find((b) => b.kind === 'star')!
  const trueTarget = star.pos.clone().add(world.originOffset)
  const controllers: ControllerMap = new Map<number, Controller>([[world.player.id, pilotTo(trueTarget)]])

  const blocked: Record<string, number> = {}
  let travelled = 0
  const before = new Vector3()
  for (let i = 0; i < 120 * 300; i++) {
    before.copy(world.player.state.pos)
    stepWorld(world, 1 / 120, controllers)
    travelled += before.distanceTo(world.player.state.pos) - world.originShift.length()
    const key = world.player.cruise.block ?? 'свободен'
    blocked[key] = (blocked[key] ?? 0) + 1 / 120
  }
  const local = new Vector3().copy(trueTarget).sub(world.originOffset)
  const left = world.player.state.pos.distanceTo(local) - star.radius
  console.log(`  за 300 с пройдено ${(travelled / 1e9).toFixed(2)} млн км, до звезды ещё ${(left / 1e9).toFixed(1)} млн км`)
  for (const [k, v] of Object.entries(blocked)) console.log(`  ${k.padEnd(10)} ${v.toFixed(0)} с`)
  console.log(`  кораблей вокруг: ${world.ships.filter((s) => s.alive).length}`)
}

console.log('\n--- до причала с разных удалений ---')
for (const away of [50_000, 150_000, 400_000, 1_000_000, 3_000_000]) {
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  const station = world.bodies.find((b) => b.kind === 'station')!
  const planet = world.bodies.find((b) => b.kind === 'planet')!

  // Ставим корабль «над» причалом по нормали от планеты: так и выйдет из прыжка.
  const out = station.pos.clone().sub(planet.pos).normalize()
  world.player.state.pos.copy(station.pos).addScaledVector(out, away)
  world.player.state.vel.set(0, 0, 0)

  const trueTarget = station.pos.clone().add(world.originOffset)
  const controllers: ControllerMap = new Map<number, Controller>([[world.player.id, pilotTo(trueTarget)]])

  const local = new Vector3()
  let arrived: number | null = null
  for (let i = 0; i < 120 * 600; i++) {
    hush(world)
    stepWorld(world, 1 / 120, controllers)
    local.copy(trueTarget).sub(world.originOffset)
    const range = world.player.state.pos.distanceTo(local) - station.radius
    if (range < 220) {
      arrived = world.time
      break
    }
  }
  console.log(
    `  ${(away / 1000).toFixed(0).padStart(4)} км → ` +
      (arrived === null ? 'не долетел за 600 с' : `${arrived.toFixed(0).padStart(3)} с (${(arrived / 60).toFixed(1)} мин)`),
  )
}
