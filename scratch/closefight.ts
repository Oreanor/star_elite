/**
 * Ближний бой автобоя: N пиратов в D метрах, автобой берёт следующего после убийства.
 * Печатает долю времени с носом на цели, ошибку носа, угловую скорость, режимы.
 * Запуск: N=3 D=300 [SHIP=hermes] [UP=1] npx tsx scratch/closefight.ts
 */
import { Vector3 } from 'three'
import { createWorld, STARTER_SYSTEM } from '../packages/sim/src/domain/world'
import { auroraVeteranLoadout } from '../packages/sim/src/config/loadouts'
import { stepWorld } from '../packages/sim/src/domain/sim'
import { engageAutofight } from '../packages/sim/src/domain/ai/autofight'
import { aiController } from '../packages/sim/src/domain/ai/pilot'
import { lockContact } from '../packages/sim/src/domain/world/queries'
import { forward } from '../packages/sim/src/domain/flight/axes'
const DT = 1 / 60
const N = Number(process.env.N ?? 2)
const D = Number(process.env.D ?? 300)
const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [{ count: N, at: [0, 0, 0], spread: 150, faction: 'hostile', name: 'Пират' }] }, undefined, process.env.SHIP === 'hermes' ? auroraVeteranLoadout() : undefined)
const p = world.player
if (process.env.UP) { const { upgradeModule } = await import('../packages/sim/src/domain/station/upgrade'); world.credits = 1e9; for (let i = 0; i < 3; i++) { const r = p.loadout.internals.find((m) => m.kind === 'thrusters')!; (globalThis as any).x = upgradeModule(world, p, r, false) } }
p.state.pos.set(30000, 0, 0)
world.ships.forEach((e, i) => e.state.pos.copy(p.state.pos).add(new Vector3((i - (N - 1) / 2) * 150, 0, -D)))
lockContact(world, 'ship', world.ships[0]!.id)
world.targetFocus = 'contact'
engageAutofight(world)
console.log('ships', world.ships.map((s) => s.faction + ':' + s.alive + ':' + s.state.pos.distanceTo(p.state.pos).toFixed(0) + ':' + s.landedOn).join(' '))
const controllers = new Map([[p.id, aiController]])
const modes = new Map<string, number>()
let frames = 0, onTarget = 0, angSum = 0, errSum = 0, fire = 0
const fwd = new Vector3(), to = new Vector3()
for (let t = 0; t < 120; t += DT) {
  stepWorld(world, DT, controllers as any, { unassigned: aiController })
  // Игрок жмёт P на следующего, как только прежний убит.
  if (!world.ships.some((x) => x.id === p.ai?.orderedTargetId && x.alive)) { const next = world.ships.find((x) => x.alive && x.faction === 'hostile'); if (next) { lockContact(world, 'ship', next.id); engageAutofight(world) } }
  modes.set(p.ai?.mode ?? '-', (modes.get(p.ai?.mode ?? '-') ?? 0) + 1)
  const tgt = world.ships.find((s) => s.id === p.ai?.targetId && s.alive)
  if (tgt && p.ai?.mode === 'attack') {
    frames++
    forward(p.state.quat, fwd)
    to.copy(tgt.state.pos).sub(p.state.pos).normalize()
    const err = Math.acos(Math.min(1, fwd.dot(to)))
    errSum += err
    if (err < 0.05) onTarget++
    if (p.ai.wantsFire) fire++
    angSum += p.state.angVel.length()
  }
  if (t < DT * 2) console.log('p', p.state.pos.toArray().map(Math.round), p.alive, 'after step', world.ships.map((s) => s.faction + ':' + s.alive + ':' + s.state.pos.distanceTo(p.state.pos).toFixed(0)).join(' '))
  if (world.ships.every((s) => !s.alive || s.faction !== 'hostile')) { console.log('all dead at', t.toFixed(1)); break }
}
console.log(`attack frames ${frames} onTarget ${(100 * onTarget / Math.max(frames, 1)).toFixed(1)}% fire ${(100 * fire / Math.max(frames, 1)).toFixed(1)}% avgErr ${(errSum / Math.max(frames, 1) * 57.3).toFixed(1)}° avgAngVel ${(angSum / Math.max(frames, 1)).toFixed(2)} rad/s alive ${world.ships.filter((s) => s.alive && s.faction === 'hostile').length}`)
console.log('modes', [...modes].map(([k, v]) => `${k}:${(v / 60).toFixed(1)}s`).join(' '))
