import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM } from '../world'
import { cycleCelestial } from '../world/queries'
import { dispatcherBriefing, dispatcherPersona, dispatcherTraffic, stationInterlocutor } from './dispatcher'
import { localSettlement } from './trade'
import { lockContact, lockedShipId, lockedStationId } from '../world/queries'

function world() {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

describe('диспетчер станции', () => {
  it('персона детерминирована от станции и говорит расой округа', () => {
    const w = world()
    const station = w.bodies.find((b) => b.kind === 'station')
    if (!station) throw new Error('в стартовой системе нет станции')

    const a = dispatcherPersona(w, station)
    const b = dispatcherPersona(w, station)
    expect(a).toEqual(b) // тот же сид — тот же диспетчер
    expect(a.species).toBe(localSettlement(w).species) // на связи раса столицы, не случайная
  })

  it('сводка: тела по близости, без звезды, ближайший обитаемый — обитаем', () => {
    const w = world()
    const brief = dispatcherBriefing(w)

    expect(brief.bodies.every((b) => b.kind !== 'star')).toBe(true)
    for (let i = 1; i < brief.bodies.length; i++) {
      expect(brief.bodies[i]!.distanceKm).toBeGreaterThanOrEqual(brief.bodies[i - 1]!.distanceKm)
    }
    if (brief.nearestPopulated) expect(brief.nearestPopulated.populated).toBe(true)
  })

  it('небесный круг берёт станцию на связь и гасит старый контакт', () => {
    const w = world()
    const station = w.bodies.find((b) => b.kind === 'station')!

    // Был захват борта — Shift+Tab на станцию обязан его сбросить (один фокус).
    lockContact(w, 'ship', 42)
    w.targetFocus = 'contact'

    // Листаем небесные тела по удалению, пока круг не встанет на станцию.
    let guard = 0
    do {
      cycleCelestial(w)
      guard += 1
    } while (w.navTargetId !== station.id && guard < 50)

    expect(w.navTargetId).toBe(station.id) // станция — точка навигации
    expect(lockedStationId(w)).toBe(station.id) // и взята на связь (T → диспетчер)
    expect(lockedShipId(w)).toBeNull() // старый контакт сброшен
    expect(w.targetFocus).toBe('nav')
    expect(stationInterlocutor(w)?.id).toBe(station.id)
  })
})

describe('трафик диспетчера', () => {
  /** Пойманное: диспетчер видел лишь занявшего причал, а на «кто тут летает?» отвечал «никого». */
  it('видит все живые незамаскированные борта системы, ближние первыми', () => {
    const w = world()
    const traffic = dispatcherTraffic(w, 1000)
    const expected = w.ships.filter((s) => s.alive && !s.cloaked).length
    expect(traffic.length).toBe(expected)
    for (let i = 1; i < traffic.length; i++) {
      expect(traffic[i]!.distanceKm).toBeGreaterThanOrEqual(traffic[i - 1]!.distanceKm)
    }
  })

  it('замаскированного не видит и диспетчер', () => {
    const w = world()
    const ship = w.ships[0]
    if (!ship) return
    ship.cloaked = true
    expect(dispatcherTraffic(w, 1000).some((t) => t.pilot === ship.pilotName && t.distanceKm === Math.round(ship.state.pos.distanceTo(w.player.state.pos) / 1000))).toBe(false)
  })
})
