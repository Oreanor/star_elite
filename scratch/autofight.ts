/**
 * Прогон автобоя без рендера: враг на 3 км, автобой включён, печать посекундно —
 * дистанция, скорость игрока, газ, режим бота, жив ли враг, не снят ли автобой.
 * Запуск: npx tsx scratch/autofight.ts
 */
import { Vector3 } from 'three'
import { createWorld, STARTER_SYSTEM } from '../packages/sim/src/domain/world'
import { stepWorld } from '../packages/sim/src/domain/sim'
import { autofightActive, autofightSpent, disengageAutofight, engageAutofight } from '../packages/sim/src/domain/ai/autofight'
import { aiController } from '../packages/sim/src/domain/ai/pilot'
import { lockContact } from '../packages/sim/src/domain/world/queries'
const FIXED_DT = 1 / 60

const world = createWorld({
  ...STARTER_SYSTEM,
  belt: null,
  patrols: [{ count: 1, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' }],
})
const enemy = world.ships[0]!
// Вдали от станции: и игрока, и врага уводим на 30 км вбок, чтобы между ними ничего не стояло.
const AWAY = Number(process.env.AWAY ?? 30000)
world.player.state.pos.add(new Vector3(AWAY, 0, 0))
enemy.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -3000))
lockContact(world, 'ship', enemy.id)
world.targetFocus = 'contact'
console.log('engage', engageAutofight(world))

const controllers = new Map([[world.player.id, aiController]])
const p = world.player
for (let t = 0; t < 90; t += FIXED_DT) {
  if (autofightActive(world) && autofightSpent(world)) {
    console.log(`t=${t.toFixed(1)} SPENT -> disengage`)
    disengageAutofight(world)
  }
  stepWorld(world, FIXED_DT, controllers as any, { unassigned: aiController })
  if (Math.abs(t - Math.round(t)) < FIXED_DT / 2) {
    const d = enemy.state.pos.distanceTo(p.state.pos)
    console.log(
      `t=${Math.round(t)} d=${d.toFixed(0)} v=${p.state.vel.length().toFixed(0)} thr=${p.controls.throttle.toFixed(2)} ` +
        `mode=${p.ai?.mode ?? '-'} tgt=${p.ai?.targetId ?? '-'} fire=${p.ai ? aiController.wantsFire(p, world) : '-'} ` +
        `retro=${p.controls.retro} surge=${(p.controls as any).surge} fa=${p.controls.flightAssist} pitch=${p.controls.pitch?.toFixed?.(2)} yaw=${p.controls.yaw?.toFixed?.(2)} ev=${enemy.state.vel.length().toFixed(0)} emode=${enemy.ai?.mode}`,
    )
  }
  if (!enemy.alive) { console.log('enemy dead at', t.toFixed(1)); break }
}
const near = world.bodies
  .map((b) => ({ k: b.kind, n: b.name, d: b.pos.distanceTo(p.state.pos) - b.radius, de: b.pos.distanceTo(enemy.state.pos) - b.radius }))
  .sort((a, b) => a.d - b.d)
  .slice(0, 4)
console.log('nearest bodies (surface dist from player / enemy):', near)
console.log('player landedOn', p.landedOn, 'enemy landedOn', enemy.landedOn, 'enemy dock', enemy.ai?.dock)
