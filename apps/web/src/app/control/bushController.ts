import { deadzoneScale, type Controller, type ShipEntity, type World } from '@elite/sim'
import { input, isHeld } from '../../platform/input/input'
import type { PlayerIntent } from './playerController'

/**
 * Штурвал на КУСТЕ галактик: перемещения по своей воле нет, есть газ и ВЗГЛЯД.
 *
 * Корабль едет по ребру, как вагонетка (`stepBushTravel`). Свободный полёт превратил бы
 * куст в обычное поле и убил бы его геометрию. Но голову вертеть можно: мышь задаёт
 * угловую скорость, борт разворачивается НА МЕСТЕ (позиция задаётся рельсом, её видно не
 * будет — слой якорится к кораблю). Так игрок осматривает крону и целится носом в ту
 * ветку, куда хочет поехать; сам выбор делает `stepBush` по направлению носа.
 *
 * Это ОБЫЧНЫЙ `Controller` — тот же шов, что у автостыковки; читать ввод ему можно, он
 * живёт в слое приложения. Газ (W) — сигнал «еду» для рельса и он же двигает борт вперёд
 * (скрыто задником), стоп по отпусканию гасит лётный компьютер.
 *
 * Крен/страйфы/форсаж молчат: на рельсе крутить бортом вокруг оси незачем, а разгонять
 * ход нечем — узел проскакивался бы, а он есть выбор.
 */

/** Та же мёртвая зона стика, что у пилота: меньше — нос ползёт от дрожи руки. */
const STICK_DEADZONE = 0.02

export function createBushController(_intent: PlayerIntent): Controller {
  return {
    update(ship: ShipEntity, _world: World, _dt: number): void {
      const c = ship.controls
      // Мышь вертит головой: отклонение стика = желаемая угловая скорость (как у пилота).
      const stick = Math.hypot(input.stickX, input.stickY)
      const scale = deadzoneScale(stick, STICK_DEADZONE)
      c.pitch = input.stickY * scale
      c.yaw = input.stickX * scale
      // Крен и снос на рельсе не нужны — вертим только носом.
      c.roll = 0
      c.rudder = 0
      c.strafe = 0
      c.strafeUp = 0
      c.retro = 0
      c.boost = 1
      c.cruise = 0
      c.grow = 0
      c.flightAssist = true
      // Газ — W. Он и сигнал рельсу «еду», и (скрытая) тяга борта.
      c.throttle = isHeld('KeyW') ? 1 : 0
    },

    wantsFire(): boolean {
      // Стрелять по галактикам не во что.
      return false
    },
  }
}
