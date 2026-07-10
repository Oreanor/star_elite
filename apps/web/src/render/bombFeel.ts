import { BOMB } from '@elite/sim'
import type { World } from '@elite/sim'
import { Vector3 } from 'three'

/**
 * Как ощущается подрыв бомбы: круг на экране, вспышка и тряска камеры.
 *
 * Все три величины ВЫВОДЯТСЯ из возраста вспышки и её мощности. Ни таймера, ни
 * состояния: вспышка одна, она уже лежит в мире, и всё, что видит и чувствует
 * пилот, — функция от неё. Заведи здесь свой счётчик, и однажды он разойдётся
 * со вспышкой на кадр.
 *
 * Тела в мире у неё нет. Ни сферы, ни пересечений: поражение мгновенно и уже
 * нанесено, а это — зрелище на пару секунд. Слабый импульс и светит слабее.
 */

/** Сколько длится засветка, с. Короче круга: свет гаснет раньше, чем расходится край. */
const FLASH_LIFE = 0.62
const SHAKE_LIFE = 0.75
/** Амплитуда тряски в метрах при полной мощности. */
const SHAKE_AMPLITUDE = 1.4

/** Возраст самой свежей вспышки в секундах и её мощность, либо null. */
function newest(world: World): { age: number; power: number } | null {
  const wave = world.shockwaves[0]
  if (!wave) return null
  return { age: world.time - wave.born, power: wave.power }
}

/**
 * Круг энергии: доля от максимального радиуса, 0..1, и яркость края.
 *
 * Растёт РЕЗКО и тормозит: `1 - exp(-t)` выбрасывает край почти мгновенно, как и
 * положено разряду. Линейный рост читался бы как надувание шарика.
 */
export function bombRing(world: World): { radius: number; edge: number; fill: number } | null {
  const wave = newest(world)
  if (!wave || wave.age > BOMB.WAVE_LIFE) return null

  const t = wave.age / BOMB.WAVE_LIFE
  const radius = 1 - Math.exp(-t * 5.5)
  // Край живёт дольше заливки: сначала слепящий диск, потом одно сияющее кольцо.
  return {
    radius,
    edge: wave.power * (1 - t) ** 1.4,
    fill: wave.power * (1 - t) ** 3.5 * 0.55,
  }
}

/**
 * Яркость засветки, 0..1.
 *
 * Два всплеска, а не один: импульс уходит из корабля рывком, и экран моргает
 * дважды — на разряде и на срыве. Косинус даёт ровно два максимума за время
 * вспышки, экспонента гасит второй слабее первого.
 */
export function bombFlash(world: World): number {
  const wave = newest(world)
  if (!wave || wave.age > FLASH_LIFE) return 0

  const t = wave.age / FLASH_LIFE
  const blink = Math.abs(Math.cos(t * Math.PI * 2))
  return wave.power * blink * Math.exp(-t * 3.2)
}

/**
 * Смещение камеры от тряски, м. Записывает в `out` и возвращает его.
 *
 * Псевдослучайность — от `world.time`, а не от `Math.random()`: тряска обязана
 * быть одинаковой у всех, кто смотрит на один и тот же кадр. Домену она не нужна,
 * но врать про детерминизм не станем и здесь.
 */
export function bombShake(world: World, out: Vector3): Vector3 {
  const wave = newest(world)
  out.set(0, 0, 0)
  if (!wave || wave.age > SHAKE_LIFE) return out

  const decay = (1 - wave.age / SHAKE_LIFE) ** 2
  const amplitude = SHAKE_AMPLITUDE * wave.power * decay
  const t = world.time

  // Три несоизмеримые частоты: рисунок не повторяется за время тряски.
  out.set(Math.sin(t * 47.3), Math.sin(t * 61.7), Math.sin(t * 39.1) * 0.4).multiplyScalar(amplitude)
  return out
}
