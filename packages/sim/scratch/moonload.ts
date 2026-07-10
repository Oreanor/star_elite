/**
 * Чего стоят луны.
 *
 * Утверждение «каждая луна — своя зона торможения, полсотни лун — патока» было
 * догадкой, а не замером. Проверяем: потолок крейсера берётся у БЛИЖАЙШЕГО тела,
 * значит луна режет скорость только там, где она ближе своей планеты, — а это
 * пузырь вокруг неё, целиком лежащий внутри пузыря планеты.
 *
 * Меряем три вещи: время в пути с лунами и без, ширину пузыря луны и сколько
 * тел добавляется в систему.
 */
import { Vector3 } from 'three'
import { CRUISE } from '../src/config/cruise'
import { GALAXY } from '../src/config/galaxy'
import { steerToward } from '../src/domain/flight'
import { systemDefFor } from '../src/domain/galaxy/jump'
import { stepWorld, type Controller, type ControllerMap } from '../src/domain/sim'
import { createWorld, STARTER_SYSTEM, type ShipEntity, type World } from '../src/domain/world'

const _aim = new Vector3()

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

function hush(world: World): void {
  world.ships.length = 0
  world.trafficTimer = 1e9
}

/**
 * Замер к «Тиррион IV» честно печатает «НЕ ДОЛЕТЕЛ», и это не поломка крейсера:
 * гигант стоит по другую сторону Оссиании, а этот пилот не умеет облетать миры —
 * он таранит планету и остаётся лежать на ней. Обход препятствий тут не проверяется.
 */

/** Время в пути до тела, с лунами или без них. */
function travel(bodyName: string, arriveAt: number, keepMoons: boolean): { seconds: number | null; worst: number } {
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  if (!keepMoons) world.bodies = world.bodies.filter((b) => b.kind !== 'moon')

  const body = world.bodies.find((b) => b.name === bodyName)!
  const trueTarget = body.pos.clone().add(world.originOffset)
  const controllers: ControllerMap = new Map<number, Controller>([[world.player.id, pilotTo(trueTarget)]])

  const local = new Vector3()
  let worst = CRUISE.MAX_FACTOR
  for (let i = 0; i < 120 * 600; i++) {
    hush(world)
    stepWorld(world, 1 / 120, controllers)
    local.copy(trueTarget).sub(world.originOffset)
    const range = local.distanceTo(world.player.state.pos) - body.radius
    // Потолок интересен только на разгоне: у самой цели он и обязан падать.
    if (range > arriveAt * 4) worst = Math.min(worst, world.player.cruise.factor)
    if (range < arriveAt) return { seconds: world.time, worst }
  }
  return { seconds: null, worst }
}

const show = (r: { seconds: number | null; worst: number }) =>
  (r.seconds === null ? 'НЕ ДОЛЕТЕЛ' : `${r.seconds.toFixed(1)} с`).padStart(12)

console.log('--- время в пути: с лунами и без ---')
for (const [name, at] of [['Тиррион', 1_000_000], ['Оссиания', 500_000], ['Тиррион IV', 1_000_000]] as const) {
  const with_ = travel(name, at, true)
  const without = travel(name, at, false)
  console.log(`${name.padEnd(12)} с лунами ${show(with_)}   без лун ${show(without)}`)
}

console.log('\n--- пузырь луны: где она ближе своей планеты ---')
{
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  for (const moon of world.bodies.filter((b) => b.kind === 'moon')) {
    const planet = world.bodies.find((b) => b.id === moon.orbit!.parentId)!
    const d = moon.pos.distanceTo(planet.pos)
    // Граница: alt_moon = alt_planet ⇒ (b − Rm) = (d − b − Rp)
    const bubble = (d - planet.radius + moon.radius) / 2
    const byMoon = (bubble - moon.radius) / CRUISE.BRAKE_ZONE.moon
    const byPlanet = (d - bubble - planet.radius) / CRUISE.BRAKE_ZONE.planet
    console.log(
      `${moon.name.padEnd(14)} R=${(moon.radius / 1000).toFixed(0).padStart(5)} км  ` +
        `орбита ${(d / 1e6).toFixed(0).padStart(4)} тыс.км  пузырь ${(bubble / 1e6).toFixed(0).padStart(4)} тыс.км  ` +
        `на его краю: луна ×${byMoon.toExponential(1)}, планета ×${byPlanet.toExponential(1)} ` +
        `(решает меньший; полный ×${CRUISE.MAX_FACTOR.toExponential(1)})`,
    )
  }
}

console.log('\n--- сколько тел добавится ---')
{
  let planets = 0
  let moons = 0
  let worstSystem = 0
  for (let i = 0; i < 400; i++) {
    const def = systemDefFor(i, GALAXY.SEED)
    let here = 0
    for (const p of def.planets) {
      planets++
      moons += p.moons.length
      here += p.moons.length
    }
    worstSystem = Math.max(worstSystem, here + def.planets.length)
  }
  console.log(`планет ${planets}, лун ${moons}, в среднем ${(moons / planets).toFixed(2)} на планету`)
  console.log(`худшая система: ${worstSystem} крупных тел`)
}

console.log('\n--- крупные луны: кому положена текстура ---')
{
  // Порог рендера — 2400 км: столько у Титана и Ганимеда, а это уже миры.
  const BIG = 2_100_000
  let decor = 0
  let big = 0
  let biggest = 0
  for (let i = 0; i < 400; i++) {
    for (const p of systemDefFor(i, GALAXY.SEED).planets) {
      for (const m of p.moons) {
        if (m.radius >= BIG) big++
        else decor++
        biggest = Math.max(biggest, m.radius)
      }
    }
  }
  console.log(`декоративных ${decor}, крупных ${big} (${((100 * big) / (big + decor)).toFixed(0)}%)`)
  console.log(`самая крупная: ${(biggest / 1000).toFixed(0)} км`)
  console.log(`треугольников на луну: было ${160 * 105 * 2}, стало ${32 * 21 * 2}`)
}
