import { CanvasTexture, EquirectangularReflectionMapping, SRGBColorSpace, type Texture } from 'three'
import { makeRng } from '@elite/sim'

/**
 * Фон — полоса Млечного Пути. Не геометрия: three рисует `scene.background`
 * одним полноэкранным проходом за всей сценой, без вершин и без глубины.
 *
 * Текстура генерируется процедурно, а не берётся из фотографии, по двум причинам:
 *
 *  1. Сфере нужна РАВНОПРОМЕЖУТОЧНАЯ развёртка: горизонталь — полный оборот 360°,
 *     вертикаль — от полюса до полюса. Обычный снимок 3:2 даёт видимый шов за спиной
 *     и защемление на полюсах, где верхний ряд пикселей стягивается в точку.
 *  2. Здесь она замыкается по горизонтали по построению: шва нет вообще.
 *
 * Чтобы подставить свою картинку: положи файл в `public/` и замени тело на
 * `new TextureLoader().load('/sky.jpg')` с той же настройкой mapping и colorSpace.
 */

const WIDTH = 1024
const HEIGHT = 512

/** Наклон галактической плоскости к «экватору» сцены, радианы. */
const BAND_TILT = 0.62
/** Ширина полосы в долях полусферы. */
const BAND_WIDTH = 0.28

/**
 * Значение шума, замкнутое по долготе. Периодичность обязательна:
 * иначе на стыке u=0 и u=1 появится вертикальный шрам.
 */
function seamlessNoise(u: number, v: number, octaves: number, rng: () => number): number {
  // Раскладываем долготу на окружность — тогда шум непрерывен через шов.
  const table = Array.from({ length: 64 }, () => rng())
  let value = 0
  let amplitude = 0.5
  let frequency = 1

  for (let o = 0; o < octaves; o++) {
    const angle = u * Math.PI * 2 * frequency
    const x = Math.cos(angle)
    const y = Math.sin(angle)
    const z = v * frequency * 3

    // Дешёвая тригонометрическая «складка» вместо решётчатого шума:
    // фон размыт, разницы не видно, а кода втрое меньше.
    const a = table[(o * 7) % 64]! * 6.283
    const b = table[(o * 13 + 3) % 64]! * 6.283
    value += amplitude * Math.sin(x * 3.1 + a) * Math.sin(y * 2.7 + b) * Math.cos(z * 1.9 + a * 0.5)

    amplitude *= 0.55
    frequency *= 2.1
  }
  return value
}

function generate(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const image = ctx.createImageData(WIDTH, HEIGHT)
  const data = image.data
  const rng = makeRng(0x51deb0a7)

  for (let y = 0; y < HEIGHT; y++) {
    // v: −1 (южный полюс) … +1 (северный).
    const v = (y / (HEIGHT - 1)) * 2 - 1

    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH

      // Большой круг, наклонённый к экватору: широта полосы зависит от долготы.
      const bandLat = Math.atan(Math.tan(BAND_TILT) * Math.sin(u * Math.PI * 2)) / (Math.PI / 2)
      const distance = Math.abs(v - bandLat) / BAND_WIDTH

      // Сгущение к оси полосы, гладко спадающее к краям.
      let density = Math.exp(-distance * distance * 1.6)

      // Пылевые прожилки: тёмные разрывы поперёк полосы. Без них она — просто мазок.
      const dust = seamlessNoise(u, v, 4, makeRng(0xbeef))
      density *= 0.55 + 0.45 * (1 - Math.abs(dust))
      density *= 0.7 + 0.3 * seamlessNoise(u * 1.7, v * 2.3, 3, makeRng(0xf00d))

      density = Math.max(0, Math.min(1, density))

      // Палитра: холодная синева в тенях, лиловое сгущение в ядре.
      const base = 6 + 10 * (1 - Math.abs(v)) // лёгкий градиент к экватору
      const r = base + density * 92
      const g = base + 2 + density * 88
      const b = base + 12 + density * 120

      const i = (y * WIDTH + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)

  // Мелкие звёзды прямо в текстуре: дают глубину за крупными точками Starfield.
  // Больше там, где гуще полоса, — как в настоящем небе.
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 5200; i++) {
    const u = rng()
    const v = rng() * 2 - 1

    const bandLat = Math.atan(Math.tan(BAND_TILT) * Math.sin(u * Math.PI * 2)) / (Math.PI / 2)
    const offset = (v - bandLat) / BAND_WIDTH
    const density = Math.exp(-(offset ** 2) * 1.6)
    if (rng() > 0.18 + density * 0.82) continue

    // Ближе к полюсам развёртка растягивает пиксели: компенсируем размер.
    const stretch = 1 / Math.max(0.25, Math.cos((v * Math.PI) / 2))
    const brightness = 60 + rng() * 150
    const size = rng() < 0.9 ? 1 : 1.6

    ctx.fillStyle = `rgba(${brightness + 40}, ${brightness + 30}, ${brightness + 60}, 0.9)`
    ctx.fillRect(u * WIDTH, ((v + 1) / 2) * HEIGHT, size * stretch, size)
  }

  return canvas
}

let cached: Texture | null = null

export function nebulaTexture(): Texture {
  if (cached) return cached

  const texture = new CanvasTexture(generate())
  // Равнопромежуточная развёртка: three сам натянет её на «бесконечную» сферу.
  texture.mapping = EquirectangularReflectionMapping
  texture.colorSpace = SRGBColorSpace

  cached = texture
  return cached
}
