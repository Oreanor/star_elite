import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { BELT } from '../../config/belt'
import { PHYSICS } from '../../config/physics'
import { createWorld } from './factory'
import { STARTER_SYSTEM } from './system'
import { BELT_NAV_ID, configureAsteroidBelt, nearestBeltPoint, stepAsteroidBelt } from './asteroidBelt'
import { stepWorld } from '../sim/step'
import { cycleCelestial, navTarget } from './queries'
import type { World } from './entities'

function fixture() {
  const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
  nearestBeltPoint(world, world.player.state.pos)
  stepAsteroidBelt(world)
  return world
}

/** Точки дальней дуги в координатах мира (истинные минус плавающее начало). */
function dotPositions(w: World): Vector3[] {
  const dots = w.asteroidBelt!.dots
  const out: Vector3[] = []
  for (let i = 0; i < dots.count; i++) {
    out.push(new Vector3(dots.pos[i * 3]!, dots.pos[i * 3 + 1]!, dots.pos[i * 3 + 2]!).sub(w.originOffset))
  }
  return out
}

describe('постоянный астероидный пояс', () => {
  it('даёт заданную плотность в дуге локатора, а не во всём кольце', () => {
    const w = fixture()
    const nearby = w.asteroids.filter(a => a.pos.distanceTo(w.player.state.pos) < BELT.LOCAL_RANGE)
    expect(nearby.length).toBeGreaterThan(BELT.LOCAL_COUNT * 0.8)
    expect(nearby.length).toBeLessThan(BELT.LOCAL_COUNT * 1.2)
    expect(w.asteroids.length).toBeGreaterThan(nearby.length)
    expect(w.asteroids.length).toBeLessThan(20_000)
  })

  it('редеет с дистанцией и остаётся виден за десять тысяч км', () => {
    const w = fixture()
    const player = w.player.state.pos
    const belt = w.asteroidBelt!
    // Дальняя дуга — точки (`belt.dots`, истинные координаты), не тела мира.
    const dots = dotPositions(w)
    const band = (min: number, max: number) =>
      dots.filter(p => {
        const d = p.distanceTo(player)
        return d >= min && d < max
      }).length
    // Два шага по 100 км — дальняя сотня должна быть заметно реже ближней.
    expect(band(300_000, 400_000)).toBeLessThan(band(100_000, 200_000) / 2)
    // Пол — угол, не 50 км. На 800 км фиксированный шаг был три градуса пустоты.
    // Полоса 600 км с двух сторон кольца; сплошная черта сюда тоже не проходит.
    const arc = 2 * 600_000
    const spacing = arc / band(600_000, 1_200_000)
    const angle = spacing / 900_000
    expect(angle).toBeGreaterThan(0.002)
    expect(angle).toBeLessThan(0.02)
    expect(band(10_000_000, BELT.VISIBLE_RANGE)).toBeGreaterThan(0)
    // Камни в координатах мира, ось пояса — абсолютная, со сдвигом начала.
    const axisX = belt.center.x - w.originOffset.x
    const axisY = belt.center.y - w.originOffset.y
    const axisZ = belt.center.z - w.originOffset.z
    let widest = 0
    for (const p of dots) {
      const d = p.distanceTo(player)
      if (d < 200_000 || d > 350_000) continue
      const radial = Math.hypot(p.x - axisX, p.z - axisZ)
      const cross = Math.hypot(radial - belt.radius, p.y - axisY)
      if (cross > widest) widest = cross
    }
    // На паре сотен километров сечение уже не во всю трубу — иначе дуга снова в палец.
    expect(widest).toBeGreaterThan(0)
    expect(widest).toBeLessThan(belt.diameter / 2 * 0.45)
  })

  it('телами живут только камни окна мешей, дальше — точки дуги до самого края', () => {
    // Дальняя дуга была тысячами тел: их каждый такт гнала физика, вёл след позы и
    // перебирал рендер (6690 тел ради 600 ближних) — пояс едва тянул 60 кадров.
    const w = fixture()
    const player = w.player.state.pos
    for (const a of w.asteroids) {
      if (!a.beltKey) continue
      expect(a.pos.distanceTo(player)).toBeLessThanOrEqual(BELT.ENTITY_RANGE)
    }
    const dots = dotPositions(w)
    expect(dots.length).toBeGreaterThan(0)
    for (const p of dots) expect(p.distanceTo(player)).toBeGreaterThan(BELT.ENTITY_RANGE)
    // Черта на небе тянется дальше прежних 50 000 км.
    expect(dots.some(p => p.distanceTo(player) > 50_000_000)).toBe(true)
  })

  it('из одного зерна получает те же камни и не дублирует их при обновлении', () => {
    const a = fixture()
    const b = fixture()
    expect(a.asteroids.map(r => [r.beltKey, r.pos.toArray(), r.radius])).toEqual(
      b.asteroids.map(r => [r.beltKey, r.pos.toArray(), r.radius]),
    )
    const count = a.asteroids.length
    a.time += BELT.STREAM_INTERVAL
    stepAsteroidBelt(a)
    expect(new Set(a.asteroids.map(r => r.beltKey)).size).toBe(a.asteroids.length)
    expect(Math.abs(a.asteroids.length - count)).toBeLessThan(5)
  })

  it('возвращает повреждённый камень после выгрузки и не воскрешает добытый', () => {
    const w = fixture()
    const rock = w.asteroids[0]!
    const killed = w.asteroids[1]!
    rock.hull *= 0.5
    const hull = rock.hull
    killed.alive = false
    const start = w.player.state.pos.clone()
    w.player.state.pos.add(new Vector3(0, BELT.VISIBLE_RANGE + BELT.SECTOR_LENGTH * 2, 0))
    w.time += 1
    stepAsteroidBelt(w)
    expect(w.asteroids).not.toContain(rock)
    w.player.state.pos.copy(start)
    w.time += 1
    stepAsteroidBelt(w)
    expect(w.asteroids).toContain(rock)
    expect(rock.hull).toBe(hull)
    expect(w.asteroids.some(a => a.beltKey === killed.beltKey)).toBe(false)
  })

  it('учитывает плавающее начало координат при загрузке участка', () => {
    const a = fixture()
    const b = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    b.originOffset.set(1e6, -500, 2e6)
    b.player.state.pos.copy(a.player.state.pos).add(a.originOffset).sub(b.originOffset)
    stepAsteroidBelt(b)
    expect(b.asteroids.length).toBe(a.asteroids.length)
    for (let i = 0; i < a.asteroids.length; i++) {
      expect(b.asteroids[i]!.pos.clone().add(b.originOffset).sub(a.originOffset).distanceTo(a.asteroids[i]!.pos)).toBeLessThan(1e-3)
    }
  })

  it('ползунки меняют толщину и плотность, не удаляя посторонние астероиды', () => {
    const w = fixture()
    const other = { ...w.asteroids[0]!, id: w.ids.next(), beltKey: undefined }
    w.asteroids.push(other)
    configureAsteroidBelt(w, BELT.DIAMETER_MAX, BELT.COUNT_MAX)
    expect(w.asteroids).toContain(other)
    expect(w.asteroidBelt!.diameter).toBe(BELT.DIAMETER_MAX)
    const nearby = w.asteroids.filter(a => a.beltKey && a.pos.distanceTo(w.player.state.pos) < BELT.LOCAL_RANGE)
    expect(nearby.length).toBeGreaterThan(BELT.COUNT_MAX * 0.8)
    expect(nearby.length).toBeLessThan(BELT.COUNT_MAX * 1.2)
  })

  it('пояс выбирается целью, и дистанция считается до края потока', () => {
    const w = fixture()
    // Игрок стоит на оси: пояс — ближайшее перед носом, свежий перебор берёт его первым.
    w.navTargetId = null
    cycleCelestial(w)
    expect(w.navTargetId).toBe(BELT_NAV_ID)
    // Такт не должен сбрасывать пояс: уборка нав-цели знает только тела и камни.
    stepWorld(w, PHYSICS.FIXED_DT, new Map())
    expect(w.navTargetId).toBe(BELT_NAV_ID)
    const nav = navTarget(w)
    expect(nav?.kind).toBe('belt')
    expect(nav?.radius).toBe(w.asteroidBelt!.diameter / 2)

    w.player.state.pos.y += 200_000
    const again = navTarget(w)!
    const axis = new Vector3()
    nearestBeltPoint(w, axis)
    expect(again.pos.distanceTo(axis)).toBeLessThan(1)
    const surface = Math.max(0, axis.distanceTo(w.player.state.pos) - again.radius)
    expect(surface).toBeGreaterThan(190_000)
    expect(surface).toBeLessThan(210_000)

    w.asteroidBelt = undefined
    expect(navTarget(w)).toBeNull()
  })
})
