import type { ContractOffer, Persona, SavedLoadout, ShipEntity, World } from '@elite/sim'
import { serializeLoadout } from '@elite/sim'

/**
 * ФОРМАТ ОБЩЕГО ТРАФИКА — что хозяин системы шлёт остальным. Два канала с разной частотой:
 *
 *   • РЕЕСТР (`roster/{id}`) — кто это: имя, фракция, сборка, характер. Пишется раз при
 *     появлении борта и раз при гибели: сборка весит сотни байт, гнать её 10 раз в секунду
 *     незачем;
 *   • КАДР (`frame`) — где все сейчас: поза, скорость, щит/корпус, жмёт ли гашетку. Один узел
 *     на систему, ~10 раз в секунду, массивы чисел вместо объектов — короче пакет.
 *
 * Поза АБСОЛЮТНАЯ (`state.pos + originOffset`): плавающее начало у каждого своё, сумма — общая.
 * Модуль чистый: ни Firebase, ни мира-синглтона — только перевод туда и обратно.
 */

/** Кто такой борт хозяина. Ключи коротки: реестр читают все в системе. */
export interface RosterEntry {
  /** Отображаемое имя и истинное имя пилота. */
  n: string
  pn: string
  /** Фракция. */
  f: ShipEntity['faction']
  /** Тип встречи (`originKind`) — им красится роль в разговоре. */
  o: string | null
  /** Сборка: по ней зеркало рисуется тем же корпусом и вешает те же стволы. */
  l: SavedLoadout
  /** Характер — для портрета и разговора. */
  p: Persona
  /** Бог (Слово): неуязвимый борт особого облика. */
  dv?: 1
  /** Погиб: зеркало взрывается у всех. */
  d?: 1
  /**
   * Борт ТРАФИКА системы (а не личный наёмник владельца): при смене хозяина его подхватывает
   * новый хозяин, а не убирает.
   */
  tr?: 1
  /** Был зеркалом `владелец:id` у прежнего хозяина: у остальных копия лишь меняет ключ. */
  w?: string
  /** Дело, которое бот предлагает (у спасения — id нападающих у ВЛАДЕЛЬЦА). */
  of?: ContractOffer
}

/**
 * Поза борта в кадре: [x, y, z, qx, qy, qz, qw, vx, vy, vz, корпус 0..1, щит 0..1, огонь 0|1, масштаб].
 * Позиция округлена до 10 см, остальное до тысячных — хватит глазу, а пакет вдвое короче.
 */
export type ShipPose = number[]

/** Ракета в кадре: [x, y, z, vx, vy, vz], модуль и цель. */
export interface MissilePose {
  p: number[]
  /** id модуля ракеты из каталога. */
  mod: string
  /**
   * Цель: `u:<uid>` — живой игрок (у каждого клиента это свой борт), `h:<id>` — борт хозяина,
   * null — головка слепа.
   */
  to: string | null
}

export interface TrafficFrame {
  /** Отметка сервера, мс: по ней интерполятор отличает новый кадр от повтора. */
  t: number
  s: Record<string, ShipPose>
  m?: Record<string, MissilePose>
}

const r1 = (v: number): number => Math.round(v * 10) / 10
const r3 = (v: number): number => Math.round(v * 1000) / 1000

export function rosterOf(ship: ShipEntity, traffic: boolean): RosterEntry {
  const entry: RosterEntry = {
    n: ship.name,
    pn: ship.pilotName,
    f: ship.faction,
    o: ship.originKind,
    l: serializeLoadout(ship.loadout),
    p: ship.persona,
  }
  if (ship.divine) entry.dv = 1
  if (!ship.alive) entry.d = 1
  if (traffic) entry.tr = 1
  if (ship.netOrigin) entry.w = ship.netOrigin
  if (ship.offer) entry.of = { ...ship.offer, revealed: false }
  return entry
}

export function encodeShip(ship: ShipEntity, world: World): ShipPose {
  const { pos, quat, vel, scale } = ship.state
  const o = world.originOffset
  const hull = ship.spec.hull.hull > 0 ? ship.hull / ship.spec.hull.hull : 0
  const shield = ship.spec.hull.shield > 0 ? ship.shield / ship.spec.hull.shield : 0
  return [
    r1(pos.x + o.x), r1(pos.y + o.y), r1(pos.z + o.z),
    r3(quat.x), r3(quat.y), r3(quat.z), r3(quat.w),
    r1(vel.x), r1(vel.y), r1(vel.z),
    r3(hull), r3(shield),
    ship.ai?.wantsFire ? 1 : 0,
    r3(scale),
  ]
}

/** Разобранная поза борта (абсолютные координаты). */
export interface DecodedShip {
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
  vx: number
  vy: number
  vz: number
  hull: number
  shield: number
  firing: boolean
  scale: number
}

export function decodeShip(p: ShipPose): DecodedShip | null {
  if (!Array.isArray(p) || p.length < 14 || p.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null
  return {
    x: p[0]!, y: p[1]!, z: p[2]!,
    qx: p[3]!, qy: p[4]!, qz: p[5]!, qw: p[6]!,
    vx: p[7]!, vy: p[8]!, vz: p[9]!,
    hull: p[10]!, shield: p[11]!,
    firing: p[12] === 1,
    scale: p[13]!,
  }
}

/**
 * Цель ракеты словом провода: `u:<uid>` — живой игрок (свой или чужой), `h:<владелец>:<id>` —
 * борт владельца, null — головка слепа. Как назвать чужой борт, знает вызывающий (`refOf`).
 */
export function missileTargetRef(
  targetId: number | null,
  world: World,
  myUid: string,
  refOf: (shipId: number) => string | null,
): string | null {
  if (targetId == null) return null
  if (targetId === world.player.id) return `u:${myUid}`
  return refOf(targetId)
}
