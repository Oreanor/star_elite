import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { GALAXY_FLIGHT } from '../../config/galaxy'
import { MIELOPHONE } from '../../config/mielophone'
import { AUTOPILOT } from '../../config/station'
import { placeSystem } from '../galaxy/shape'
import { createWorld, STARTER_SYSTEM } from '../world'
import { canEngageFlyTo, flyToArrived, flyToController } from './flyto'

const _nose = new Vector3(0, 0, -1)
const _to = new Vector3()

/**
 * Автопилот-к-цели — ОБЫЧНЫЙ Controller: без рендера, без ввода. Проверяем СВОЙСТВА
 * (тянется к далёкой цели полным ходом, глохнет у близкой, доворачивает нос, отпускает
 * штурвал по прибытии), а не конкретные числа — они переживут перебалансировку AUTOPILOT.
 */
function withTarget(dist: number, side = 0) {
  // Патрулём спавним один борт-цель; координаты патруля мировые, поэтому цель ставим
  // относительно игрока (он в астроединице от начала координат).
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  world.docked = false
  const target = world.ships[0]
  if (!target) throw new Error('нужен борт-цель в мире')
  // Цель на известном удалении от игрока, с боковым сносом — чтобы был повод доворачивать.
  target.state.pos.copy(world.player.state.pos).add(new Vector3(side, 0, -dist))
  world.lockedTargetId = target.id
  world.lockedStationId = null
  world.targetFocus = 'contact'
  return { world, target }
}

/** Нос (−Z) точно на точку — иначе wantsCruise отказывает из‑за CRUISE_ALIGN. */
function faceToward(world: ReturnType<typeof createWorld>, target: Vector3): void {
  _to.copy(target).sub(world.player.state.pos).normalize()
  world.player.state.quat.setFromUnitVectors(_nose, _to)
}

describe('автопилот-к-цели', () => {
  it('дотянется только к захваченному живому борту и не в доке', () => {
    const { world, target } = withTarget(5000)
    expect(canEngageFlyTo(world)).toBe(true)

    world.lockedTargetId = null
    expect(canEngageFlyTo(world)).toBe(false) // нечего вести

    world.lockedTargetId = target.id
    world.docked = true
    expect(canEngageFlyTo(world)).toBe(false) // в доке не летают
  })

  it('фокус нав (Shift+Tab) — J ведёт к телу, а не к старому борту', () => {
    // Борт уже «у носа» — старый flyto считал бы прибытие по нему и глушил тягу.
    const { world, target } = withTarget(AUTOPILOT.ARRIVE_RANGE - 50)
    const planet = world.bodies.find((b) => b.kind === 'planet')
    if (!planet) throw new Error('нужна планета')
    // Центр далеко за парковочной сферой 2R: иначе новый безопасный stand-off уже достигнут.
    planet.pos.copy(world.player.state.pos).add(new Vector3(
      0,
      0,
      -(planet.radius * AUTOPILOT.BODY_STANDOFF_RADII + 5_000_000),
    ))
    world.navTargetId = planet.id
    world.targetFocus = 'nav'
    expect(world.lockedTargetId).toBe(target.id)
    expect(canEngageFlyTo(world)).toBe(true)
    expect(flyToArrived(world)).toBe(false) // ведём к планете, не к ближнему пирату

    flyToController.update(world.player, world, 0.016)
    expect(world.player.controls.throttle).toBeGreaterThan(0.5)

    world.targetFocus = 'contact'
    expect(flyToArrived(world)).toBe(true) // фокус снова на близком борте
  })

  it('к далёкой цели идёт полным ходом, у близкой глохнет', () => {
    const far = withTarget(20_000)
    flyToController.update(far.world.player, far.world, 0.016)
    expect(far.world.player.controls.throttle).toBeGreaterThan(0.5)

    const near = withTarget(AUTOPILOT.ARRIVE_RANGE - 100)
    flyToController.update(near.world.player, near.world, 0.016)
    expect(near.world.player.controls.throttle).toBe(0)
  })

  it('цель в стороне — автопилот доворачивает нос (тангаж или рыскание ненулевые)', () => {
    const { world } = withTarget(6000, 4000) // сильный боковой снос
    flyToController.update(world.player, world, 0.016)
    const c = world.player.controls
    expect(Math.abs(c.pitch) + Math.abs(c.yaw)).toBeGreaterThan(0)
  })

  it('прибытие: у цели — «долетел», вдали — нет, цель пропала — тоже «долетел»', () => {
    const { world, target } = withTarget(AUTOPILOT.ARRIVE_RANGE - 50)
    expect(flyToArrived(world)).toBe(true)

    target.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -10_000))
    expect(flyToArrived(world)).toBe(false)

    world.lockedTargetId = null // цель снята — вести некуда, штурвал возвращаем
    expect(flyToArrived(world)).toBe(true)
  })

  it('к телу паркуется у 2R и не отдаёт штурвал, пока не погасил ход', () => {
    const { world } = withTarget(50_000)
    const planet = world.bodies.find((b) => b.kind === 'planet')
    if (!planet) throw new Error('нужна планета')
    world.targetFocus = 'nav'
    world.navTargetId = planet.id

    const standOff = planet.radius * AUTOPILOT.BODY_STANDOFF_RADII
    world.player.state.pos.copy(planet.pos).add(new Vector3(0, 0, standOff + AUTOPILOT.ARRIVE_RANGE / 2))
    world.player.state.vel.set(0, 0, -world.player.spec.tuning.MAX_SPEED)

    flyToController.update(world.player, world, 0.016)
    expect(world.player.controls.retro).toBe(1)
    expect(flyToArrived(world)).toBe(false)

    world.player.state.vel.set(0, 0, 0)
    expect(flyToArrived(world)).toBe(true)
  })

  it('на ×scale начинает тормозить по фактическому тормозному пути, а не по фиксированной зоне', () => {
    const { world } = withTarget(50_000)
    const planet = world.bodies.find((b) => b.kind === 'planet')!
    const standOff = planet.radius * AUTOPILOT.BODY_STANDOFF_RADII
    const remaining = AUTOPILOT.BRAKE_RANGE * 4

    world.targetFocus = 'nav'
    world.navTargetId = planet.id
    world.player.state.scale = 1_000
    world.player.state.pos.copy(planet.pos).add(new Vector3(0, 0, standOff + remaining))
    // Выбег v/k заметно длиннее остатка: независимо от масштаба здесь уже нужен ручник.
    world.player.state.vel.set(0, 0, -remaining * 30)

    flyToController.update(world.player, world, 1 / 120)

    expect(world.player.controls.throttle).toBe(0)
    expect(world.player.controls.retro).toBe(1)
    expect(flyToArrived(world)).toBe(false)
  })

  it('на галактическом × J ведёт к jumpTarget мягким газом и с форсажем на дальнем плече', () => {
    // Tab на проявленном слое пишет jumpTarget — захвата системы нет, автопилот обязан сюда.
    const { world } = withTarget(5000)
    world.lockedTargetId = null
    world.targetFocus = 'nav'
    world.navTargetId = null
    world.player.state.scale = MIELOPHONE.GHOST_BODY_SCALE
    const jump = world.systemIndex === 0 ? 1 : 0
    world.jumpTargetIndex = jump
    world.galaxyAnchorTrue = world.player.state.pos.clone().add(world.originOffset)

    expect(canEngageFlyTo(world)).toBe(true)
    expect(flyToArrived(world)).toBe(false)

    flyToController.update(world.player, world, 0.016)
    // Аккуратный газ: не полный ход и не ноль на дальнем плече.
    expect(world.player.controls.throttle).toBeGreaterThan(0)
    expect(world.player.controls.throttle).toBeLessThanOrEqual(GALAXY_FLIGHT.THROTTLE_CRUISE)

    // Мировая точка звезды — как в flyto (якорь + Δly·м/св.г).
    const origin = placeSystem(world.systemIndex, world.galaxySeed)
    const star = placeSystem(jump, world.galaxySeed)
    const mPerLy =
      GALAXY_FLIGHT.LY_TO_M / Math.min(world.player.state.scale, MIELOPHONE.MAX_SCALE)
    const starPos = new Vector3(
      world.player.state.pos.x + (star.x - origin.x) * mPerLy,
      world.player.state.pos.y + (star.z - origin.z) * mPerLy,
      world.player.state.pos.z + (star.y - origin.y) * mPerLy,
    )
    faceToward(world, starPos)
    expect(flyToController.wantsCruise?.(world.player, world)).toBe(true)

    // Ниже порога галактики jumpTarget для J не считается — иначе метры св.года абсурдны.
    world.player.state.scale = 1
    expect(canEngageFlyTo(world)).toBe(false)
  })

  /**
   * РЕГРЕССИЯ: срыв в петлю. На большом ходу поперёк цели борт не сближался и не уходил
   * назад — он ходил ВОКРУГ, и ни один из двух прежних тормозов не срабатывал: первый судит
   * по скорости СБЛИЖЕНИЯ (в петле она мала), второй — только когда борт уже удаляется.
   *
   * Свойство, а не число: радиус разворота равен v²/a, и когда он больше дистанции, попасть
   * в цель нельзя НИКАКИМ рулением — автопилот обязан сбрасывать ход, а не рулить усерднее.
   */
  it('на большом ходу поперёк цели тормозит, а не наматывает круги', () => {
    const { world } = withTarget(3000)
    const player = world.player
    faceToward(world, world.ships[0]!.state.pos)

    // Ход ПОПЕРЁК направления на цель (цель по −Z, скорость по +X) и заведомо большой.
    player.state.vel.set(20_000, 0, 0)
    flyToController.update(player, world, 1 / 60)

    expect(player.controls.throttle).toBe(0)
    expect(player.controls.retro).toBe(1)
  })

  it('сойдясь ходом с курсом, снова даёт газ', () => {
    const { world } = withTarget(3000)
    const player = world.player
    faceToward(world, world.ships[0]!.state.pos)

    // Тот же борт, но ход уже НА цель: тормозить не с чего.
    player.state.vel.set(0, 0, -400)
    flyToController.update(player, world, 1 / 60)

    expect(player.controls.throttle).toBeGreaterThan(0)
  })
})
