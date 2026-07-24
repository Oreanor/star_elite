/**
 * Куда смотрят стволы В ХОВЕРЕ над поверхностью. Жалоба: «два лазера бьют нормально,
 * один куда-то назад», причём только в режиме посадки — в космосе всё цело.
 *
 * Печатаем для каждого дула косинус между направлением болта и носом корабля.
 * Больше нуля — вперёд, меньше — назад. Заодно позицию дула относительно носа:
 * если дуло оказалось ДАЛЬШЕ точки сведения, вектор «на сведение» развернётся назад.
 */
import { Vector3 } from 'three'
import { playerStartLoadout } from '../src/config/loadouts'
import { GUNNERY } from '../src/config/weapons'
import { fireLasers } from '../src/domain/combat'
import { shipAxes } from '../src/domain/flight/axes'
import { enterSurfaceFlight, type LandableSurface } from '../src/domain/flight/landing'
import { refreshSpec } from '../src/domain/world/factory'
import { createWorld, STARTER_SYSTEM, type World } from '../src/domain/world'

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()

function report(world: World, label: string): void {
  world.bolts.length = 0
  // Перезаряд не должен глушить замер: стволы к каждому замеру считаем готовыми.
  for (const gun of world.player.guns) { gun.cooldown = 0; gun.heat = 0; gun.overheatUntil = 0 }
  fireLasers(world, world.player, false, 1 / 120)
  const ship = world.player
  shipAxes(ship.state.quat, _fwd, _right, _up)
  console.log(`\n=== ${label} — болтов ${world.bolts.length}`)
  for (const beam of world.beams) {
    const alongB = beam.dir.clone().dot(_fwd)
    console.log(`  ЛУЧ    ${beam.weapon.padEnd(22)} вдоль носа ${alongB.toFixed(3)}   длина ${beam.length.toFixed(0)}` + (alongB < 0 ? '   <-- НАЗАД' : ''))
  }
  for (const bolt of world.bolts) {
    const along = bolt.vel.clone().normalize().dot(_fwd)
    const muzzleAhead = bolt.pos.clone().sub(ship.state.pos).dot(_fwd)
    console.log(
      `  оружие ${bolt.weapon.padEnd(22)} вдоль носа ${along.toFixed(3)}` +
        `   дуло впереди на ${muzzleAhead.toFixed(2)} м` +
        (along < 0 ? '   <-- НАЗАД' : ''),
    )
  }
}

const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
world.player.loadout = playerStartLoadout()
refreshSpec(world.player)

console.log('сведение стволов, м:', GUNNERY.CONVERGENCE)
console.log('дула установок:')
world.player.spec.mounts.forEach((m, i) => {
  console.log(' ', i, m.weapon?.id ?? '—', 'offset', m.hardpoint.offset, 'nozzles', m.hardpoint.nozzles ?? '(одно, в offset)')
})

report(world, 'КОСМОС')

// Ховер над первой пригодной планетой: ставим борт на высоту стоянки и входим в режим.
const body = world.bodies.find((b) => b.kind === 'planet' && b.radius > 100)
if (!body) throw new Error('в стартовой системе нет планеты')
const surface: LandableSurface = {
  id: body.id,
  pos: body.pos,
  radius: body.radius,
  spinRate: 0,
  spinAxis: new Vector3(0, 1, 0),
}
world.player.state.pos.copy(body.pos).add(new Vector3(0, body.radius + 500, 0))
if (!enterSurfaceFlight(world.player, surface)) throw new Error('в ховер не пустило')
console.log('\nв ховере, высота стоянки:', world.player.landedOn?.altitude)

report(world, 'ХОВЕР')
