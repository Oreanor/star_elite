import {
  deadzoneScale,
  steerToward,
  type Controller,
  type ShipEntity,
  type World,
} from '@elite/sim'
import { Vector3 } from 'three'
import { input } from '../../platform/input/input'
import { torusAutopilotActive, torusNav } from './torusAutopilot'
import type { PlayerIntent } from './playerController'

/**
 * Штурвал в КОМНАТЕ ТОРА: корабль стоит в центре проекции и только ВЕРТИТСЯ. Мышь задаёт угловую
 * скорость (как у пилота), борт разворачивается на месте; полёт — поток S³ сквозь него (`torusFlight`).
 *
 * АВТОПИЛОТ (`torusAutopilot`): если ведём к дому/кресту — нос доворачивается на цель (`steerToward`
 * по направлению, что посчитал слой), мышь на это время молчит. Прибыл — автопилот снимется в
 * `torusFlight`, и мышь снова у руля.
 *
 * Это ОБЫЧНЫЙ `Controller` — тот же шов, что у автостыковки; читать ввод ему можно, он живёт в
 * слое приложения.
 */

/** Та же мёртвая зона стика, что у пилота: меньше — нос ползёт от дрожи руки. */
const STICK_DEADZONE = 0.02

const _aim = new Vector3()
const _navDir = new Vector3()
const _steer = { pitch: 0, yaw: 0 }

export function createBushController(_intent: PlayerIntent): Controller {
  return {
    update(ship: ShipEntity, _world: World, _dt: number): void {
      const c = ship.controls

      if (torusAutopilotActive()) {
        // Нос — на активную цель: точка вдалеке по направлению, что посчитал слой.
        const nav = torusNav()
        if (nav.valid && !nav.arrived) {
          _navDir.set(nav.dx, nav.dy, nav.dz)
          _aim.copy(ship.state.pos).addScaledVector(_navDir, 1000)
          steerToward(ship.state, _aim, 2.4, _steer)
          c.pitch = _steer.pitch
          c.yaw = _steer.yaw
        } else {
          c.pitch = 0
          c.yaw = 0
        }
      } else {
        // Мышь вертит головой: отклонение стика = желаемая угловая скорость (как у пилота).
        const stick = Math.hypot(input.stickX, input.stickY)
        const scale = deadzoneScale(stick, STICK_DEADZONE)
        c.pitch = input.stickY * scale
        c.yaw = input.stickX * scale
      }

      c.roll = 0
      c.rudder = 0
      c.strafe = 0
      c.strafeUp = 0
      c.retro = 0
      c.boost = 1
      c.cruise = 0
      c.grow = 0
      c.flightAssist = true
      // ТЯГА В ФИЗИКУ — НОЛЬ: в комнате тора корабль СТОИТ в центре проекции, а «едет» вселенная
      // (её поток по S³ копит `torusFlight`). Дай борту реальную тягу — он улетит из центра, выворот
      // проекции «упадёт», а осмотр мышью потонет в переносе.
      c.throttle = 0
    },

    wantsFire(): boolean {
      // Стрелять по галактикам не во что.
      return false
    },
  }
}
