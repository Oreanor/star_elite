import { makeRng } from '../../core/math'
import type { Settlement } from '../galaxy/types'
import type { BodyEntity, World } from '../world/entities'
import { makePersona, type Persona } from '../world/persona'
import { findShip } from '../world/queries'
import { localSettlement } from './shop'

/**
 * Диспетчер станции — всезнающий по своей округе собеседник со своей персоной.
 *
 * В отличие от пилота-бота, что знает лишь ВИДИМОЕ, диспетчер держит ПОЛНУЮ правду о системе:
 * какие тела где, как далеко, что за мир вокруг, кто занял причал. Границей его знания служит
 * система (как «камень» у бортового компьютера): факты берём из домена (`world.bodies`,
 * дистанции, `localSettlement`), а не из того, что «видно». ЗНАНИЕ полное у всех диспетчеров —
 * разнится лишь ТОН: персона детерминирована от станции, вид — расы той планеты, что держит причал.
 *
 * Атаковать станцию нельзя (см. `lockedStationId`): её только берут в захват, чтобы связаться.
 */

/** Захваченная станция-собеседник, или null. Отдельно от `interlocutor` (это про борта). */
export function stationInterlocutor(world: World): BodyEntity | null {
  const id = world.lockedStationId
  if (id === null) return null
  return world.bodies.find((b) => b.id === id && b.kind === 'station') ?? null
}

/**
 * Персона диспетчера. Детерминирована от станции (сид системы + id узла): у одной станции
 * диспетчер ПОСТОЯННЫЙ, как имена и лица ботов от зерна. Вид — расы столицы округа (кто держит
 * причал, тот и на связи), а не случайный: знание всезнающее, но говорит конкретный народ.
 */
export function dispatcherPersona(world: World, station: BodyEntity): Persona {
  const seed = (Math.imul(world.galaxySeed | 0, 2654435761) ^ Math.imul(world.systemIndex + 1, 40503) ^ station.id) >>> 0
  return { ...makePersona(makeRng(seed)), species: localSettlement(world).species }
}

/** Одно тело в сводке: где оно и обитаемо ли. Дистанция — от игрока, км. */
export interface BriefingBody {
  id: number
  name: string
  kind: BodyEntity['kind']
  distanceKm: number
  populated: boolean
  hasStation: boolean
}

/** Всё, что диспетчер знает и может рассказать про округу. Голые ФАКТЫ — тон накладывает UI/LLM. */
export interface DispatcherBriefing {
  /** Столица округа: строй/экономика/тех/вид/население — «что мы за мир и чем живём». */
  settlement: Settlement
  /** Тела системы (планеты/луны/станции, без звезды) по близости к игроку. */
  bodies: BriefingBody[]
  /** Ближайшее ОБИТАЕМОЕ тело — рекомендация «куда лететь». null — обитаемых нет. */
  nearestPopulated: BriefingBody | null
  /** Имя пилота, занявшего причал сейчас, если есть. */
  dockOccupant: string | null
}

/** Собрать сводку диспетчера. Чистое чтение мира: ничего не меняет. */
export function dispatcherBriefing(world: World): DispatcherBriefing {
  const player = world.player
  const bodies: BriefingBody[] = world.bodies
    .filter((b) => b.kind !== 'star')
    .map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      distanceKm: Math.round(b.pos.distanceTo(player.state.pos) / 1000),
      populated: b.population > 0,
      hasStation: b.kind === 'station',
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)

  const occupant = findShip(world, world.dockOccupantId)
  return {
    settlement: localSettlement(world),
    bodies,
    nearestPopulated: bodies.find((b) => b.populated) ?? null,
    dockOccupant: occupant?.pilotName ?? null,
  }
}
