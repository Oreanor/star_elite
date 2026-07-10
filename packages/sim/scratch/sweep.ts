/**
 * Бот против бота. Меряем, разрешается ли бой вообще, и подбираем
 * скорость разворота и боевую скорость так, чтобы попадать было возможно,
 * но не тривиально.
 *
 * Ключевая величина — угловая скорость линии визирования ω = v⊥ / d.
 * Если ω больше скорости разворота корабля, цель в прицеле не удержать никогда.
 */
import { Vector3 } from 'three'
import { aiController, createAIState } from '../src/domain/ai'
import { AI } from '../src/config/ai'
import { createWorld, STARTER_SYSTEM, type ShipEntity } from '../src/domain/world'
import { stepWorld, type Controller, type ControllerMap } from '../src/domain/sim'

interface Result {
  turnScale: number
  nearThrottle: number
  killTime: number | null
  fireFrames: number
  medianDist: number
  medianLosRate: number
}

function scaleTurn(e: ShipEntity, k: number) {
  const t = e.spec.tuning
  t.PITCH_RATE *= k
  t.YAW_RATE *= k
  t.ROLL_RATE *= k
  t.PITCH_ACCEL *= k
  t.YAW_ACCEL *= k
  t.ROLL_ACCEL *= k
}

const _prevDir = new Vector3()
const _dir = new Vector3()

function run(turnScale: number, nearThrottle: number): Result {
  // Один противник; игрок тоже управляется ботом — так меряется чистая геометрия боя.
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null, // астероиды тут только мешают измерению
    patrols: [{ ...STARTER_SYSTEM.patrols[0]!, count: 1 }],
  })

  const mutableAI = AI as unknown as { ATTACK_THROTTLE_NEAR: number }
  const savedThrottle = mutableAI.ATTACK_THROTTLE_NEAR
  mutableAI.ATTACK_THROTTLE_NEAR = nearThrottle

  const enemy = world.ships[0]!
  world.player.ai = createAIState(world.player.state.pos, world.rng)
  scaleTurn(world.player, turnScale)
  scaleTurn(enemy, turnScale)

  const controllers: ControllerMap = new Map<number, Controller>([
    [world.player.id, aiController],
    [enemy.id, aiController],
  ])

  let fireFrames = 0
  let killTime: number | null = null
  const dists: number[] = []
  const losRates: number[] = []
  let havePrev = false

  const DT = 1 / 120
  for (let i = 0; i < 120 * 90; i++) {
    stepWorld(world, DT, controllers)

    if (!world.player.alive || !enemy.alive) {
      killTime = world.time
      break
    }
    if (world.player.ai?.wantsFire || enemy.ai?.wantsFire) fireFrames++

    if (i % 12 === 0) {
      _dir.copy(enemy.state.pos).sub(world.player.state.pos)
      const d = _dir.length()
      _dir.divideScalar(Math.max(d, 1e-6))
      dists.push(d)
      if (havePrev) {
        // ω ≈ угол между направлениями на цель за прошедшее время.
        const cos = Math.max(-1, Math.min(1, _prevDir.dot(_dir)))
        losRates.push(Math.acos(cos) / (12 * DT))
      }
      _prevDir.copy(_dir)
      havePrev = true
    }
  }

  mutableAI.ATTACK_THROTTLE_NEAR = savedThrottle

  const median = (a: number[]) => {
    if (!a.length) return 0
    const s = [...a].sort((x, y) => x - y)
    return s[Math.floor(s.length / 2)]!
  }
  return {
    turnScale,
    nearThrottle,
    killTime,
    fireFrames,
    medianDist: median(dists),
    medianLosRate: median(losRates),
  }
}

console.log('скорость разворота базовая: тангаж 0.95 рад/с (54°/с), рыскание 0.55 (31°/с)\n')
console.log('×разв  тяга  время боя   кадров с огнём   медиана дист   медиана ω(лин.виз.)')
console.log('─'.repeat(78))

for (const turnScale of [1.0, 1.4, 1.8, 2.2]) {
  for (const nearThrottle of [0.25, 0.4, 0.55]) {
    const r = run(turnScale, nearThrottle)
    const kill = r.killTime === null ? '  ничья ' : `${r.killTime.toFixed(1).padStart(6)}с`
    const maxTurn = 0.95 * turnScale
    const trackable = r.medianLosRate < maxTurn ? '✓' : '✗'
    console.log(
      `${turnScale.toFixed(1).padStart(4)}  ${nearThrottle.toFixed(2)}  ${kill}   ` +
        `${String(r.fireFrames).padStart(8)}        ` +
        `${r.medianDist.toFixed(0).padStart(5)} м        ` +
        `${r.medianLosRate.toFixed(2)} рад/с ${trackable} (макс ${maxTurn.toFixed(2)})`,
    )
  }
}
console.log('\n✓ — линию визирования можно отследить носом; ✗ — цель физически не удержать.')
