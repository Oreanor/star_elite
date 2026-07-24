import { Quaternion, Vector3 } from 'three'
import { GUNNERY } from '../../config/weapons'
import { WARBASE } from '../../config/warbase'
import { signed } from '../../core/math'
import type { BoltEntity, WarBaseEntity, WarBaseFixture, World } from '../world/entities'
import { warBaseFixtureWorldPos } from '../world/warBase'
import { isVisible } from './cloak'

/**
 * ТУРЕЛИ ВОЕННОЙ БАЗЫ: подошёл близко — по тебе открывают огонь.
 *
 * База перестаёт быть мишенью для стрельбы в тире: её орудия бьют сами, а значит снос
 * стоит риска. Дальность короткая (`TURRET.RANGE`) — база не достаёт через полсистемы,
 * подходить или держаться поодаль решает пилот.
 *
 * Темп задан ПЕРЕЗАРЯДОМ В СЕКУНДАХ, а не броском кости за шаг: `rng() < p` внутри шага
 * физики стреляет вдвое чаще на 120 Гц, чем на 60, и бой менялся бы вместе с герцовкой.
 *
 * Залп — КОРОТКАЯ ОЧЕРЕДЬ: сколько импульсов, задаёт облик орудия (`TURRET_BURST` —
 * данные, не ветка: новая модель пушки — новая строка). Импульсы идут с малым зазором,
 * поэтому очередь читается как «та-та», а не как один болт.
 *
 * Целится турель ДОВОРОТОМ: крутится вся деталь вокруг своей радиали (`roll`) с ограниченной
 * скоростью, и болт уходит вдоль ствола, а не «в игрока». Поэтому пока она ведёт цель, очередь
 * ложится мимо — из-под огня можно выскочить, обойдя турель быстрее, чем она поворачивается.
 */

const _muzzle = /* @__PURE__ */ new Vector3()
const _dir = /* @__PURE__ */ new Vector3()
const _radial = /* @__PURE__ */ new Vector3()
const _ref = /* @__PURE__ */ new Vector3()
const _toTarget = /* @__PURE__ */ new Vector3()
const _cross = /* @__PURE__ */ new Vector3()
const _aim = /* @__PURE__ */ new Vector3()
const _align = /* @__PURE__ */ new Quaternion()
const _spinQ = /* @__PURE__ */ new Quaternion()
const _UP = /* @__PURE__ */ new Vector3(0, 1, 0)
const _FWD = /* @__PURE__ */ new Vector3(0, 0, -1)

/** Кратчайший путь до угла: −π…π. Иначе турель поедет «длинной дорогой» через спину. */
function shortestAngle(delta: number): number {
  let a = delta
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

/**
 * ДОВОРОТ ТУРЕЛИ к игроку. Крутится ВСЯ деталь вокруг своей радиали — то самое `roll`,
 * которым её и так разворачивает рендер: отдельной подвижной башни в модели нет, а тумба
 * у пушек круглая, и разница на глаз не читается.
 *
 * Возвращает мировое направление ствола ПОСЛЕ доворота. Скорость ограничена
 * (`TURRET_TURN_RATE`): турель ВЕДЁТ цель, а не прилипает к ней намертво — пролетая
 * вплотную, из-под ствола можно выскочить.
 */
function aimTurret(world: World, base: WarBaseEntity, fix: WarBaseFixture, dt: number, out: Vector3): void {
  warBaseFixtureWorldPos(base, fix, world.time, _muzzle)

  // Радиаль детали в мировых осях — с учётом спина базы: она крутится вместе с корпусом.
  _spinQ.setFromAxisAngle(base.spinAxis, base.spin * world.time)
  _radial.copy(fix.dir).applyQuaternion(_spinQ).normalize()

  // Опорное направление ствола при `roll = 0`: то же построение, что у рендера («вверх»
  // детали кладётся на радиаль). Иначе домен целился бы не туда, куда нарисовано.
  _align.setFromUnitVectors(_UP, _radial)
  _ref.copy(_FWD).applyQuaternion(_align)

  // Куда хотим смотреть: на игрока, спроецировав в касательную плоскость — вертеть турель
  // можно только вокруг радиали, вверх-вниз она не ходит.
  _toTarget.copy(world.player.state.pos).sub(_muzzle)
  _toTarget.addScaledVector(_radial, -_toTarget.dot(_radial))
  if (_toTarget.lengthSq() > 1e-6) {
    _toTarget.normalize()
    _cross.crossVectors(_ref, _toTarget)
    const wanted = Math.atan2(_cross.dot(_radial), _ref.dot(_toTarget))
    const delta = shortestAngle(wanted - fix.roll)
    const step = WARBASE.TURRET_TURN_RATE * dt
    fix.roll += Math.abs(delta) <= step ? delta : Math.sign(delta) * step
  }

  out.copy(_ref).applyQuaternion(_spinQ.setFromAxisAngle(_radial, fix.roll))
}

/** Стреляет ли деталь этого облика и сколькими импульсами. Нет в таблице — не орудие. */
function burstOf(model: number): number {
  return WARBASE.TURRET_BURST[model as keyof typeof WARBASE.TURRET_BURST] ?? 0
}

/**
 * Один импульс турели: болт уходит ВДОЛЬ СТВОЛА (`aim`), а не «в игрока».
 *
 * Разница видна глазами: пока турель доворачивает, очередь ложится мимо, и уйти из-под
 * огня можно, обходя её быстрее, чем она ведёт. Плюс разброс — попадание на подходе это
 * плата за близость, а не приговор.
 */
function fireOne(world: World, base: WarBaseEntity, fix: WarBaseFixture, aim: Vector3): void {
  warBaseFixtureWorldPos(base, fix, world.time, _muzzle)
  _dir.copy(aim)
  _dir.x += signed(world.rng) * WARBASE.TURRET_SPREAD
  _dir.y += signed(world.rng) * WARBASE.TURRET_SPREAD
  _dir.z += signed(world.rng) * WARBASE.TURRET_SPREAD
  _dir.normalize()

  const bolt: BoltEntity = {
    id: world.ids.next(),
    kind: 'bolt',
    pos: _muzzle.clone(),
    vel: _dir.clone().multiplyScalar(GUNNERY.BOLT_SPEED),
    // Стрелок — сама база: по её id болт не попадёт в неё же, а обиды базы не копят.
    ownerId: base.id,
    hostile: true,
    cloaked: false,
    damage: WARBASE.TURRET_DAMAGE,
    weapon: WARBASE.TURRET_WEAPON,
    distanceLeft: WARBASE.TURRET_RANGE * 1.5,
    born: world.time,
    alive: true,
    bore: 1,
  }
  world.bolts.push(bolt)
}

/**
 * Шаг турелей. Раз в кадр по СЕКУНДАМ (как трафик и киты), а не в такте физики: перезаряд
 * и зазор очереди заданы в секундах, и от герцовки бой зависеть не должен.
 */
export function stepWarBaseTurrets(world: World, dt: number): void {
  const player = world.player
  const open = player.alive && isVisible(player)

  for (const base of world.warBases) {
    if (!base.alive) continue
    for (const fix of base.fixtures) {
      const burst = burstOf(fix.model)
      if (!fix.alive || burst === 0) continue

      warBaseFixtureWorldPos(base, fix, world.time, _muzzle)
      const near = _muzzle.distanceTo(player.state.pos) <= WARBASE.TURRET_RANGE

      // Ствол ведёт цель, пока она в зоне, — и в перезаряде тоже: к следующей очереди
      // турель уже смотрит куда надо, а не начинает доворачиваться с нуля.
      if (near && open) aimTurret(world, base, fix, dt, _aim)

      // Очередь доигрывается всегда: начатый залп не обрывается тем, что цель ушла.
      if (fix.burstLeft > 0) {
        fix.shotIn -= dt
        if (fix.shotIn <= 0) {
          fireOne(world, base, fix, _aim)
          fix.burstLeft--
          fix.shotIn = WARBASE.TURRET_BURST_GAP
        }
        continue
      }

      fix.cooldown -= dt
      if (fix.cooldown > 0 || !near || !open) continue

      fix.cooldown = WARBASE.TURRET_COOLDOWN
      fix.burstLeft = burst
      fix.shotIn = 0
    }
  }
}
