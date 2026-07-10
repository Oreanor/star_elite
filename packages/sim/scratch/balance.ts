/**
 * Сколько урона реально доходит до цели. Игрок здесь — бот с игроцким железом:
 * так меряется оружие и геометрия боя, а не рука человека.
 *
 * Урон считаем по ПАДЕНИЮ живучести живых кораблей за шаг. Разность
 * «было всего / стало у живых» врёт: убитый мгновенно теряет всю живучесть,
 * и любой бой выглядит как ровно `ehp` нанесённого урона.
 */
import { Vector3 } from 'three'
import { aiController } from '../src/domain/ai'
import { steerToward } from '../src/domain/flight'
import { createWorld, STARTER_SYSTEM, type ShipEntity, type World } from '../src/domain/world'
import { stepWorld, type Controller, type ControllerMap } from '../src/domain/sim'

const _aim = new Vector3()
const _fwd = new Vector3()
const _to = new Vector3()

let framesFiring = 0
let shotsFired = 0

/**
 * `coneMult` — насколько щедро игрок жмёт гашетку, в долях углового размера цели.
 * 1.6 — снайпер, стреляет только наверняка. 6 — человек: увидел в прицеле, залил.
 */
function makePlayer(coneMult: number): Controller {
  return {
    update(ship: ShipEntity, world: World) {
      const c = ship.controls
      c.autoBank = true
      c.flightAssist = true
      const enemy = nearest(ship, world)
      if (!enemy) return
      _aim.copy(enemy.state.pos)
      const st = steerToward(ship.state, _aim, 2.2)
      c.pitch = st.pitch
      c.yaw = st.yaw
      const d = enemy.state.pos.distanceTo(ship.state.pos)
      c.throttle = d < 300 ? 0.3 : 0.85
    },
    wantsFire(ship: ShipEntity, world: World) {
      const enemy = nearest(ship, world)
      if (!enemy) return false
      const d = enemy.state.pos.distanceTo(ship.state.pos)
      _fwd.set(0, 0, -1).applyQuaternion(ship.state.quat)
      _to.copy(enemy.state.pos).sub(ship.state.pos).normalize()
      const cone = Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_to))))
      const fire = d < 1400 && cone < Math.atan2(enemy.spec.hull.radius, Math.max(d, 1)) * coneMult
      if (fire) framesFiring++
      return fire
    },
  }
}

/**
 * Прицел приклеен к цели: нос доворачивается мгновенно, вне физики.
 * Это НЕ игрок — это верхняя граница. Показывает чистое время убийства
 * оружием, без вклада рулёжки. Если и здесь долго — виновато оружие.
 */
const turretPlayer: Controller = {
  update(ship: ShipEntity, world: World) {
    const c = ship.controls
    c.flightAssist = true
    c.throttle = 0.3
    const enemy = nearest(ship, world)
    if (!enemy) return
    _aim.copy(enemy.state.pos).sub(ship.state.pos).normalize()
    ship.state.quat.setFromUnitVectors(new Vector3(0, 0, -1), _aim)
  },
  wantsFire(ship: ShipEntity, world: World) {
    framesFiring++
    const enemy = nearest(ship, world)
    return !!enemy && enemy.state.pos.distanceTo(ship.state.pos) < 1400
  },
}

/** Новичок: прёт на врага по прямой и льёт очередями. Так и умирают. */
const rookiePlayer: Controller = {
  update(ship: ShipEntity, world: World) {
    const c = ship.controls
    c.autoBank = true
    c.flightAssist = true
    const enemy = nearest(ship, world)
    if (!enemy) return
    const st = steerToward(ship.state, _aim.copy(enemy.state.pos), 1.4)
    c.pitch = st.pitch
    c.yaw = st.yaw
    c.throttle = 0.7
  },
  wantsFire() {
    framesFiring++
    return true
  },
}

function nearest(ship: ShipEntity, world: World): ShipEntity | null {
  let best: ShipEntity | null = null
  let bestD = Infinity
  for (const s of world.ships) {
    if (!s.alive) continue
    const d = s.state.pos.distanceTo(ship.state.pos)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

const ehp = (e: ShipEntity): number => e.hull + e.shield

function run(pirates: number, label: string, player: Controller): void {
  framesFiring = 0
  shotsFired = 0

  // Разносим пиратов: на тесном спавне они таранят друг друга, и замер врёт.
  const patrol = { ...STARTER_SYSTEM.patrols[0]!, count: pirates, spread: 300 }
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [patrol] })
  const controllers: ControllerMap = new Map<number, Controller>([
    [world.player.id, player],
    ...world.ships.map((s) => [s.id, aiController] as [number, Controller]),
  ])

  const playerMax = ehp(world.player)
  const dt = 1 / 120

  let dealt = 0
  let taken = 0
  let firstKillAt = 0
  let botFireFrames = 0
  let tracersOwn = 0
  let tracersHostile = 0

  const before = new Map<number, number>()

  for (let i = 0; i < 120 * 120; i++) {
    if (!world.player.alive || !world.ships.some((s) => s.alive)) break

    before.clear()
    for (const s of world.ships) if (s.alive) before.set(s.id, ehp(s))
    const playerBefore = ehp(world.player)

    stepWorld(world, dt, controllers)

    for (const s of world.ships) {
      const was = before.get(s.id)
      if (was === undefined) continue
      // Убитому засчитываем ровно ту живучесть, что у него оставалась.
      dealt += was - (s.alive ? ehp(s) : 0)
    }
    taken += Math.max(0, playerBefore - ehp(world.player))

    for (const t of world.tracers) (t.hostile ? (tracersHostile += 1) : (tracersOwn += 1))
    for (const s of world.ships) if (s.alive && s.ai?.wantsFire) botFireFrames++
    if (!firstKillAt && world.ships.some((s) => !s.alive)) firstKillAt = world.time
  }

  const frames = world.time * 120
  // Трасса живёт 0.055 с ≈ 6.6 кадров — делим, чтобы получить выстрелы.
  shotsFired = Math.round(tracersOwn / 6.6)
  const hostileShots = Math.round(tracersHostile / 6.6)

  console.log(
    `${pirates} пират(ов), ${label}: ` +
      `${world.player.alive ? `игрок жив ${ehp(world.player).toFixed(0)}/${playerMax}` : `ИГРОК ПОГИБ на ${world.time.toFixed(1)} с`}, ` +
      `первый сбит ${firstKillAt ? `${firstKillAt.toFixed(1)} с` : '—'}, бой ${world.time.toFixed(1)} с`,
  )
  console.log(
    `   игрок: гашетка ${((framesFiring / frames) * 100).toFixed(0)}%, ` +
      `выстрелов ~${shotsFired}, нанёс ${dealt.toFixed(0)} ` +
      `(${(dealt / world.time).toFixed(1)} ед/с, попаданий ~${((dealt / Math.max(shotsFired * 14, 1)) * 100).toFixed(0)}%)`,
  )
  console.log(
    `   боты: гашетка ${((botFireFrames / frames / pirates) * 100).toFixed(0)}%, ` +
      `выстрелов ~${hostileShots}, нанесли ${taken.toFixed(0)} ` +
      `(${(taken / world.time).toFixed(1)} ед/с) → игрок живёт ${taken > 0 ? (playerMax / (taken / world.time)).toFixed(0) : '∞'} с\n`,
  )
}

const VARIANTS: [string, Controller][] = [
  ['прицел приклеен', turretPlayer],
  ['снайпер', makePlayer(1.6)],
  ['человек', makePlayer(6)],
  ['новичок по прямой', rookiePlayer],
]

for (const [label, controller] of VARIANTS) {
  console.log(`── ${label} ──`)
  for (const n of [1, 3]) run(n, label, controller)
}
