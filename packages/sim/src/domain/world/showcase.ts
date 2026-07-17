import { Quaternion, Vector3 } from 'three'
import {
  auroraOneLoadout,
  hermesLoadout,
  orionLoadout,
  pegasusLoadout,
  perseusLoadout,
  theseusLoadout,
  atlasLoadout,
} from '../../config/loadouts'
import type { Loadout } from '../loadout'
import { makeShip } from './factory'
import type { World } from './entities'

/**
 * DEV-парад у станции: пара десятков мелких бортов строем + несколько «Атласов»
 * (кораблей поколений), чтобы облететь и рассмотреть модели со стороны.
 *
 * Борты СТОЯТ: `ai = null` (makeShip так и отдаёт) + нулевой газ, а `aiController`
 * при пустом `ai` не трогает управление — значит строй не разлетается. Фракция
 * `neutral`: не нападают и не притягивают полицию. Не трафик и не баланс — витрина,
 * потому кладём мимо `ENCOUNTERS`, прямо в `world.ships` (контроллер им раздаст
 * приложение при следующей пересборке — общий безсостоятельный `aiController`).
 *
 * Расклад ДЕТЕРМИНИРОВАННЫЙ и без `world.rng`: тип борта берём по индексу (ассорти),
 * чтобы не сдвигать поток случайности трафика. Все носом в ОДНУ сторону — на станцию.
 */

/** Мелкие корпуса для ассорти строя. Индекс перебирает их по кругу — «рандомная» смесь. */
const SMALL_FLEET: readonly (() => Loadout)[] = [
  auroraOneLoadout,
  hermesLoadout,
  perseusLoadout,
  pegasusLoadout,
  orionLoadout,
  theseusLoadout,
]

const SMALL_COUNT = 20
const SMALL_COLS = 5 // разнос по ширине
const SMALL_LAYERS = 2 // ярусы по высоте
const SMALL_GAP_X = 55 // м между бортами вбок
const SMALL_GAP_Y = 46 // м между ярусами
const SMALL_GAP_Z = 62 // м между рядами в глубину

const ATLAS_COUNT = 4
const ATLAS_GAP = 150 // м: киты крупнее, разнос шире
const ATLAS_BACK = 320 // м: стоят позади мелкого строя (дальше от станции)
const ATLAS_UP = 90 // м: приподняты, чтобы не слиться с мелочью

const _nose = /* @__PURE__ */ new Vector3(0, 0, -1)

/** Ортонормальный базис из направления взгляда: правое и верхнее, перпендикулярные `fwd`. */
function frame(fwd: Vector3): { right: Vector3; up: Vector3 } {
  const ref = Math.abs(fwd.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
  const right = ref.clone().cross(fwd).normalize()
  const up = fwd.clone().cross(right).normalize()
  return { right, up }
}

export function placeShowcaseFleet(world: World): void {
  const station = world.bodies.find((b) => b.kind === 'station')
  if (!station) return
  const star = world.bodies.find((b) => b.kind === 'star')

  // Строй — на дальней от звезды стороне причала (там же выходит игрок) и сбоку, чтобы
  // не загораживать станцию. Всё считаем от станции: где бы она ни стояла, парад рядом.
  const outward = star ? station.pos.clone().sub(star.pos).normalize() : new Vector3(0, 0, 1)
  const worldUp = new Vector3(0, 1, 0)
  const side = worldUp.clone().cross(outward).normalize()
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0)

  const anchor = station.pos
    .clone()
    .addScaledVector(outward, 2000)
    .addScaledVector(side, 1200)
    .addScaledVector(worldUp, 200)

  // Носом на станцию: одна сторона на всех.
  const fwd = station.pos.clone().sub(anchor).normalize()
  const { right, up } = frame(fwd)
  const quat = new Quaternion().setFromUnitVectors(_nose, fwd)

  const rows = Math.ceil(SMALL_COUNT / (SMALL_COLS * SMALL_LAYERS))
  for (let i = 0; i < SMALL_COUNT; i++) {
    const c = i % SMALL_COLS
    const l = Math.floor(i / SMALL_COLS) % SMALL_LAYERS
    const r = Math.floor(i / (SMALL_COLS * SMALL_LAYERS))
    const pos = anchor
      .clone()
      .addScaledVector(right, (c - (SMALL_COLS - 1) / 2) * SMALL_GAP_X)
      .addScaledVector(up, (l - (SMALL_LAYERS - 1) / 2) * SMALL_GAP_Y)
      .addScaledVector(fwd, -(r - (rows - 1) / 2) * SMALL_GAP_Z)
    const loadout = SMALL_FLEET[i % SMALL_FLEET.length]!()
    const ship = makeShip(world.ids, 'neutral', loadout.chassis.name, loadout, pos, quat.clone())
    ship.controls.throttle = 0
    world.ships.push(ship)
  }

  // «Атласы» позади строя, приподняты и разнесены шире — их и так видно издалека.
  const atlasAnchor = anchor.clone().addScaledVector(fwd, -ATLAS_BACK).addScaledVector(up, ATLAS_UP)
  for (let j = 0; j < ATLAS_COUNT; j++) {
    const pos = atlasAnchor.clone().addScaledVector(right, (j - (ATLAS_COUNT - 1) / 2) * ATLAS_GAP)
    const loadout = atlasLoadout()
    const ship = makeShip(world.ids, 'neutral', loadout.chassis.name, loadout, pos, quat.clone())
    ship.controls.throttle = 0
    world.ships.push(ship)
  }
}
