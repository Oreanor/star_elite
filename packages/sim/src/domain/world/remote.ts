import { Quaternion, type Vector3 } from 'three'
import { playerStartLoadout } from '../../config/loadouts'
import { createAIState } from '../ai/types'
import { declareFoe } from '../ai/targeting'
import { applyDamage } from '../combat/damage'
import { rehydrateLoadout, type SavedLoadout } from '../save/player'
import { makeShip } from './factory'
import type { Faction, MissileEntity, PlatformEntity, ShipEntity, StructHit, World } from './entities'
import { PLATFORM } from '../../config/platform'
import { damageWarBaseFixture } from '../combat/warBase'
import type { MissileModule } from '../loadout'
import type { Persona } from './persona'

/**
 * Удалённый игрок в мире. Это ОБЫЧНЫЙ `ShipEntity` в `world.ships` — чтобы бой,
 * наведение и рендер работали по нему без ветки «а это сетевой». Отличие одно: он
 * `kinematic` (см. `entities.ts`), поэтому шаг мира его не рулит и не двигает — позу
 * ставит интерполятор снапшотов в слое app.
 *
 * Домен НЕ знает про сеть: откуда взялись имя, вид и поза — не его забота. Он лишь
 * даёт собрать и убрать такой борт, переиспользуя ту же фабрику, что и для ботов.
 */

export interface RemotePlayerInit {
  /** Отображаемое имя (у живого игрока открыто сразу — это не незнакомец с радара). */
  name: string
  /** Вид пилота — для портрета (тот же лист, что у ботов у причала). */
  species: string
  /** Индекс лица в листе портретов (выбран игроком при создании персонажа). */
  portrait: number
  /** Стартовая поза; дальше её ведёт интерполятор. */
  pos: Vector3
  quat: Quaternion
}

/**
 * Материализовать чужого игрока кинематическим бортом. Корабль — дефолтный
 * (`playerStartLoadout`): у всех игроков он одинаков на старте; настоящее шасси
 * синхронизируем позже. Фракция `neutral`: чужой человек — не враг и не полиция, а
 * `player` зарезервирована за ЛОКАЛЬНЫМ игроком (по ней считаются очки, бомба, обиды).
 */
export function spawnRemotePlayer(world: World, init: RemotePlayerInit): ShipEntity {
  const ship = makeShip(world.ids, 'neutral', init.name, playerStartLoadout(), init.pos, init.quat)
  ship.persona = { ...ship.persona, species: init.species, portrait: init.portrait }
  ship.kinematic = true
  ship.peer = true
  world.ships.push(ship)
  return ship
}

/** Убрать чужого игрока (вышел из системы или из игры). Тихо: ни взрыва, ни трофеев. */
export function despawnRemotePlayer(world: World, id: number): void {
  world.ships = world.ships.filter((s) => s.id !== id)
}

/**
 * ОБЩИЙ ТРАФИК. В системе с несколькими игроками трафик и ИИ гоняет один — хозяин системы;
 * у остальных его борта — ЗЕРКАЛА: обычные `ShipEntity`, но кинематические (позу ставит сеть),
 * поэтому бой, захват, радар и рендер работают по ним без ветки «а это сетевой». Урон по
 * зеркалу уходит хозяину (`remoteHits`), залп зеркала — косметический (`mirrorFiring`).
 *
 * Домен про сеть не знает: что пришло и откуда — забота слоя app; здесь только собрать,
 * повысить и разобрать борта.
 */
export interface MirrorInit {
  name: string
  pilotName: string
  faction: Faction
  originKind: string | null
  loadout: SavedLoadout
  persona: Persona
  divine: boolean
  pos: Vector3
  quat: Quaternion
}

/** Материализовать зеркало бота хозяина. */
export function spawnMirrorShip(world: World, init: MirrorInit): ShipEntity {
  let loadout = playerStartLoadout()
  try {
    loadout = rehydrateLoadout(init.loadout)
  } catch {
    // Чужая сборка не читается (другая версия каталога) — рисуем стартовым корпусом.
  }
  const ship = makeShip(world.ids, init.faction, init.name, loadout, init.pos, init.quat)
  ship.pilotName = init.pilotName
  ship.persona = init.persona
  ship.originKind = init.originKind
  ship.divine = init.divine || undefined
  ship.kinematic = true
  ship.mirror = true
  world.ships.push(ship)
  return ship
}

/**
 * Стал хозяином: зеркала оживают — получают своего пилота и летят дальше сами, с того места
 * и той скоростью, что пришли последними. Бой не обрывается на смене хозяина.
 */
export function promoteMirror(world: World, ship: ShipEntity, origin?: string): void {
  ship.kinematic = false
  ship.mirror = false
  ship.mirrorFiring = false
  ship.ai ??= createAIState(ship.state.pos, world.rng)
  if (origin) ship.netOrigin = origin
}

/**
 * Ракета прежнего хозяина долетает: зеркало становится настоящей ракетой с тем же курсом и
 * целью. Взведена сразу — она уже в полёте; срок жизни отсчитывается заново, но не полный.
 */
export function promoteMirrorMissile(world: World, m: MissileEntity): void {
  m.kinematic = false
  m.speed = Math.max(m.speed, m.vel.length())
  m.born = world.time - Math.max(m.module.armTime, m.module.lifetime * 0.5)
}

/**
 * Стал зеркалом: СВОЙ трафик уходит — его теперь ведёт хозяин, и двойников быть не должно.
 * Остаётся своё: наёмники и попутчики, знакомые, цели твоих дел, гнёзда под твоим заказом.
 * Возвращает id убранных бортов.
 */
/**
 * ЛИЧНЫЙ борт игрока — его, а не трафика системы: наёмник и попутчик, знакомый, цель его дела,
 * его дрон. Им владеет этот клиент при любой роли; трафиком — хозяин системы.
 */
export function isPersonalShip(world: World, s: ShipEntity): boolean {
  const playerId = world.player.id
  // Бог — часть мира, а не чей-то знакомый: им владеет хозяин системы, иначе у знакомого с
  // ним гостя по небу ходили бы два Слова.
  if (s.divine) return false
  return s.ai?.escortOf === playerId || s.acquaintanceId != null || s.bountyOf != null || s.droneOf === playerId
}

export function yieldLocalTraffic(world: World): number[] {
  const removed: number[] = []
  world.ships = world.ships.filter((s) => {
    if (s.kinematic === true || isPersonalShip(world, s)) return true
    removed.push(s.id)
    return false
  })
  world.platforms = world.platforms.filter((p) => p.contractId != null)
  // Камни: общие (объявленные) остаются — они у всех одни; свои необъявленные уходят, их
  // заменит пояс хозяина.
  world.asteroids = world.asteroids.filter((a) => a.netId != null)
  world.titans = world.titans.filter((t) => t.netId != null)
  if (world.dockOccupantId != null && removed.includes(world.dockOccupantId)) world.dockOccupantId = null
  return removed
}

/**
 * У ХОЗЯИНА: чужой игрок попал по его боту (урон прислал клиент стрелка). Урон ложится с
 * подписью стрелка — бот знает, откуда стреляли, и отвечает ему. Мирный, по которому стрелял
 * живой игрок, берёт его в личные враги сразу: претензию-по-связи ведёт только свой игрок.
 */
export function applyPeerHit(world: World, ship: ShipEntity, damage: number, attacker: ShipEntity | null): void {
  if (!ship.alive || ship.kinematic) return
  applyDamage(ship, damage, world.time, { kind: 'laser', name: attacker?.name ?? '' }, attacker?.id ?? null)
  if (attacker && ship.faction === 'neutral') declareFoe(ship, attacker)
}

/**
 * Зеркало ракеты хозяина: летит, где сказал хозяин (`kinematic` — домен её не ведёт и не
 * взрывает), но видна, наводится на своих и включает тревогу «ракета на хвосте».
 */
export function spawnMirrorMissile(
  world: World,
  module: MissileModule,
  ownerId: number,
  targetId: number | null,
  pos: Vector3,
  vel: Vector3,
): MissileEntity {
  const m: MissileEntity = {
    id: world.ids.next(),
    kind: 'missile',
    pos: pos.clone(),
    vel: vel.clone(),
    quat: new Quaternion(),
    module,
    ownerId,
    targetId,
    kinematic: true,
    speed: vel.length(),
    born: world.time,
    alive: true,
  }
  world.missiles.push(m)
  return m
}

/** Копия гнезда хозяина: стоит, где он сказал; прочность и гибель приходят от него. */
export function spawnMirrorPlatform(
  world: World,
  init: { netId: string; variant: number; pos: Vector3; quat: Quaternion; hull: number; maxHull: number },
): PlatformEntity {
  const p: PlatformEntity = {
    id: world.ids.next(),
    kind: 'platform',
    variant: init.variant,
    name: 'Пиратская платформа',
    pos: init.pos.clone(),
    quat: init.quat.clone(),
    radius: PLATFORM.RADIUS,
    extent: PLATFORM.EXTENT,
    spin: 0.02,
    hull: init.hull,
    maxHull: init.maxHull,
    alive: true,
    wreckAt: null,
    triggered: true,
    crew: [],
    kinematic: true,
    netId: init.netId,
  }
  world.platforms.push(p)
  return p
}

/** Стал хозяином: копия гнезда становится настоящим (его экипаж уже ожил вместе с трафиком). */
export function promoteMirrorPlatform(p: PlatformEntity): void {
  p.kinematic = false
}

/**
 * У ХОЗЯИНА: удар по сооружению, присланный другим игроком. Деталь базы — тем же счётом
 * попаданий, что свой выстрел; ядро гнезда — прочностью.
 */
export function applyStructHitAtHost(world: World, hit: StructHit): void {
  if (hit.kind === 'fixture') {
    const base = world.warBases[hit.base]
    const fix = base?.fixtures[hit.fixture]
    if (base && fix) damageWarBaseFixture(world, base, fix, 1)
    return
  }
  const p = world.platforms.find((x) => x.netId === hit.netId && x.alive && !x.kinematic)
  if (p) p.hull = Math.max(0, p.hull - hit.damage)
}
