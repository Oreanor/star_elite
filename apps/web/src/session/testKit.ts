import { addItem, findModule, fitFromHold, refreshSpec, type ShipEntity, type ShipModule, type WeaponModule } from '@elite/sim'

/**
 * ТЕСТОВЫЙ НАБОР — пока идут тесты, у ВСЕХ (и в разработке, и в собранной игре). Одно место:
 * кончатся тесты — убрать вызов `grantTestKit`, и набор исчезнет, ничего не задев.
 *
 *  • миелофон — впаян в аукс-слот (маскировка вытесняется в трюм); купить и снять с обломков
 *    его нельзя (`notSold`), без набора он остаётся только даром Слова (`divineGift`);
 *  • лучи-переделки (уменьшающий, увеличивающий, удерживающий) — на оружейных точках,
 *    горный лазер — в трюме (прочие лазеры и так военные): менять на экране корабля, перебирать по X;
 *  • ракеты — на всех пустых пилонах, боезапас полон при каждом входе;
 *  • космические лазеры (засевающий луч, разбивающий импульс) — на первых двух оружейных
 *    точках, снятое — в трюм. Выдаются отдельно от лучей: у кого лучи уже есть, получит и их.
 *
 * Выдаётся ОДИН раз: что уже есть у игрока (в слотах или в трюме), не дублируется, и
 * поставленное им самим набор не переставляет обратно.
 */

const RAY_IDS = ['ray_shrink', 'ray_grow', 'ray_hold'] as const
const HOLD_LASER_IDS = ['mining_1'] as const
const KIT_LASER_IDS: readonly string[] = [...RAY_IDS, ...HOLD_LASER_IDS]
const PYLON_MISSILE_ID = 'missile_p'

const owns = (p: ShipEntity, id: string): boolean =>
  p.loadout.weapons.some((w) => w?.id === id) ||
  p.loadout.internals.some((m) => m.id === id) ||
  p.hold.items.some((it) => it.kind === 'module' && it.module.id === id)

function stash(p: ShipEntity, module: ShipModule): void {
  addItem(p.hold, { kind: 'module', module, costBasis: module.cost })
}

function grantMielophone(p: ShipEntity): void {
  if (p.loadout.internals.some((m) => m.kind === 'mielophone')) return
  let idx = p.hold.items.findIndex((it) => it.kind === 'module' && it.module.kind === 'mielophone')
  if (idx < 0) {
    const mielophone = findModule('mielophone_1')
    if (!mielophone) return
    stash(p, mielophone)
    idx = p.hold.items.length - 1
  }
  fitFromHold(p, idx)
}

/** Лучи — на оружейные точки по порядку (снятое — в трюм), горный — в трюм. */
function grantLasers(p: ShipEntity): void {
  // Хоть один лазер набора уже у игрока — набор выдан прежде; дальше он распоряжается сам.
  if (KIT_LASER_IDS.some((id) => owns(p, id))) return
  const guns = p.loadout.chassis.hardpoints.map((hp, i) => (hp.kind === 'gun' ? i : -1)).filter((i) => i >= 0)
  RAY_IDS.forEach((id, k) => {
    const ray = findModule(id) as WeaponModule | null
    const slot = guns[k]
    if (!ray) return
    if (slot === undefined) return stash(p, ray)
    const displaced = p.loadout.weapons[slot]
    if (displaced) stash(p, displaced)
    p.loadout.weapons[slot] = ray
  })
  for (const id of HOLD_LASER_IDS) {
    const laser = findModule(id)
    if (laser) stash(p, laser)
  }
}

const COSMIC_IDS = ['cosmic_seed', 'cosmic_shatter'] as const

/** Космические лазеры — на первые оружейные точки (снятое — в трюм). Один раз, как и лучи. */
function grantCosmic(p: ShipEntity): void {
  if (COSMIC_IDS.some((id) => owns(p, id))) return
  const guns = p.loadout.chassis.hardpoints.map((hp, i) => (hp.kind === 'gun' ? i : -1)).filter((i) => i >= 0)
  COSMIC_IDS.forEach((id, k) => {
    const laser = findModule(id) as WeaponModule | null
    const slot = guns[k]
    if (!laser) return
    if (slot === undefined) return stash(p, laser)
    const displaced = p.loadout.weapons[slot]
    if (displaced) stash(p, displaced)
    p.loadout.weapons[slot] = laser
  })
}

/** Ракеты на все пустые пилоны; боезапас пополняет `refreshSpec`/полный комплект ниже. */
function grantMissiles(p: ShipEntity): void {
  const missile = findModule(PYLON_MISSILE_ID) as WeaponModule | null
  if (!missile) return
  p.loadout.chassis.hardpoints.forEach((hp, i) => {
    if (hp.kind === 'pylon' && !p.loadout.weapons[i]) p.loadout.weapons[i] = missile
  })
}

export function grantTestKit(p: ShipEntity): void {
  grantMielophone(p)
  grantLasers(p)
  grantCosmic(p)
  grantMissiles(p)
  refreshSpec(p)
  // Боезапас — полный при каждом входе: тест, а не экономика ракет.
  p.spec.mounts.forEach((mount, i) => {
    const gun = p.guns[i]
    const ammo = (mount.weapon as { ammo?: number }).ammo
    if (gun && typeof ammo === 'number') gun.ammo = ammo
  })
}
