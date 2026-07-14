/**
 * Скорости vs гравитация: где тянет, чем можно вырваться, где пренебречь.
 */
import { GRAVITY } from '../src/config/bodies'
import { CRUISE } from '../src/config/cruise'
import { SCALE, STAR_CLASSES } from '../src/config/galaxy'
import { playerStartLoadout } from '../src/config/loadouts'
import { ENGINE_CIVILIAN, ENGINE_MILITARY, ENGINE_STANDARD } from '../src/config/modules'
import { bodyMass, gravityReach } from '../src/domain/flight/gravity'
import { deriveShipSpec } from '../src/domain/loadout'
import { createWorld, STARTER_SYSTEM } from '../src/domain/world'

const G = GRAVITY.G
const SHIP_R = 12

function massFromRadius(radius: number, density: number): number {
  return density * ((4 / 3) * Math.PI * radius ** 3)
}

function surfaceG(mass: number, radius: number): number {
  return (G * mass) / radius ** 2
}

function gAtAltitude(mass: number, bodyR: number, altitude: number): number {
  const r = bodyR + altitude
  return (G * mass) / (r * r)
}

function escapeSpeed(mass: number, radius: number): number {
  return Math.sqrt((2 * G * mass) / radius)
}

function thrustAccel(thrustKn: number, massT: number): number {
  return (thrustKn * 1000) / (massT * 1000)
}

const spec = deriveShipSpec(playerStartLoadout())
const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })

const planet = world.bodies.find((b) => b.kind === 'planet')!
const star = world.bodies.find((b) => b.kind === 'star')!
const moon = world.bodies.find((b) => b.kind === 'moon')

console.log('=== Корабль игрока (Аврора, стартовая сборка) ===')
console.log(`  масса ${spec.tuning.MASS.toFixed(1)} т`)
console.log(`  тяга ${spec.tuning.THRUST} кН → ускорение ${thrustAccel(spec.tuning.THRUST, spec.tuning.MASS).toFixed(1)} м/с²`)
console.log(`  ретро ~45% → ${(thrustAccel(spec.tuning.THRUST, spec.tuning.MASS) * 0.45).toFixed(1)} м/с²`)
console.log(`  MAX_SPEED ${spec.tuning.MAX_SPEED.toFixed(0)} м/с, крейсер ×${CRUISE.MAX_FACTOR.toExponential(1)}`)

console.log('\n=== Двигатели (та же масса) ===')
for (const e of [ENGINE_CIVILIAN, ENGINE_STANDARD, ENGINE_MILITARY]) {
  const a = thrustAccel(e.thrust, spec.tuning.MASS)
  console.log(`  ${e.name}: ${e.thrust} кН → ${a.toFixed(1)} м/с², v_max ${e.maxSpeed} м/с`)
}

function reportBody(label: string, kind: 'planet' | 'star' | 'moon', bodyR: number, mass: number, brakeZone: number) {
  const gSurf = surfaceG(mass, bodyR)
  const vEsc = escapeSpeed(mass, bodyR)
  console.log(`\n=== ${label} ===`)
  console.log(`  R=${(bodyR / 1000).toFixed(0)} км, M=${(mass / 1e24).toFixed(3)}×10²⁴ кг`)
  console.log(`  g у поверхности: ${gSurf.toFixed(1)} м/с²`)
  console.log(`  v_эск (${bodyR / 1000 | 0} км): ${(vEsc / 1000).toFixed(1)} км/с (${vEsc.toFixed(0)} м/с)`)
  console.log(`  зона g (BRAKE_ZONE): 0…${brakeZone} м над поверхностью`)

  const thrustA = thrustAccel(spec.tuning.THRUST, spec.tuning.MASS)
  console.log(`  тяга vs g: ${thrustA >= gSurf ? 'ВЫРВАТЬСЯ можно (тяга ≥ g)' : `НЕ хватает (${(gSurf / thrustA).toFixed(1)}× g)`}`)

  console.log('  g по высоте (только внутри зоны):')
  for (const h of [0, 100, 300, 600, 1200, brakeZone]) {
    if (h > brakeZone) continue
    const g = gAtAltitude(mass, bodyR, h + SHIP_R)
    const cruiseCap = Math.max(1, h / brakeZone)
    const vCruise = spec.tuning.MAX_SPEED * cruiseCap
    const canHover = thrustA >= g
    const canOutrunFall = vCruise > Math.sqrt(2 * g * Math.max(h, 1))
    console.log(
      `    h=${String(h).padStart(4)} м: g=${g.toFixed(2)} м/с², v_крейс≤${vCruise.toFixed(0)} м/с` +
        (h === 0 ? '' : `, v_падения за 1с≈${Math.sqrt(2 * g).toFixed(1)} м/с`) +
        (h > 0 && h <= brakeZone ? `, вырваться по скорости: ${canOutrunFall ? 'да' : 'нет'}` : ''),
    )
  }

  // За пределами зоны — g не считается в симе, но «если бы была полная g»:
  for (const h of [2000, 10_000, 100_000, 500_000]) {
    const g = gAtAltitude(mass, bodyR, h)
    console.log(`    h=${(h / 1000).toFixed(0).padStart(6)} км (ВНЕ зоны, g=0 в игре; физическая g=${g.toFixed(3)} м/с²)`)
  }
}

reportBody(`Планета «${planet.name}»`, 'planet', planet.radius, bodyMass(planet), CRUISE.BRAKE_ZONE.planet)
reportBody(`Звезда «${star.name}»`, 'star', star.radius, bodyMass(star), CRUISE.BRAKE_ZONE.star)
if (moon) reportBody(`Луна «${moon.name}»`, 'moon', moon.radius, bodyMass(moon), CRUISE.BRAKE_ZONE.moon)

console.log('\n=== Классы звёзд (g у «поверхности» диска) ===')
for (const c of STAR_CLASSES) {
  const r = c.radius * SCALE.STAR_RADIUS
  const m = massFromRadius(r, GRAVITY.STAR_DENSITY)
  const g = surfaceG(m, r)
  console.log(`  ${c.id} ${c.name.padEnd(16)} R=${(r / 1e6).toFixed(0).padStart(4)} Мм  g=${g.toFixed(1).padStart(6)} м/с²  v_esc=${(escapeSpeed(m, r) / 1000).toFixed(0).padStart(4)} км/с`)
}

console.log('\n=== Зона притяжения (g = 1% от поверхностной на границе) ===')
const f = GRAVITY.EDGE_FRACTION
for (const b of w.bodies.filter((x) => x.kind !== 'station')) {
  const reach = gravityReach(b)
  console.log(
    `  ${b.kind.padEnd(7)} ${b.name.padEnd(16)} R=${(b.radius / 1000).toFixed(0).padStart(8)} км  зона=${(reach / 1000).toFixed(0).padStart(8)} км (${(reach / b.radius).toFixed(1)} R)`,
  )
}

console.log('\n=== Где пренебречь ===')
console.log(`  • За границей зоны (≈${(1 / Math.sqrt(f) - 1).toFixed(1)} R, g < ${f * 100}% от коры) — в симе ноль`)
console.log(`  • Крейсер factor > ${CRUISE.PHASE_THRESHOLD} — g отключена`)
console.log('  • Между планетами (≫ зоны) — невесомость')
console.log('  • На 1 а.е. от звезды — g ≈ 0.006 м/с², зона звезды ≈ 0.04 а.е.')
