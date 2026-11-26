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
 * `new TextureLoader().load('/sky.webp')` с той же настройкой mapping и colorSpace.
 */

const WIDTH = 1024
const HEIGHT = 512

/** Наклон галактической плоскости к «экватору» сцены, радианы. */
const BAND_TILT = 0.62
/** Ширина полосы в долях полусферы. */
const BAND_WIDTH = 0.28

/** Фазы шума: 64 числа из своего зерна. */
function noiseTable(seed: number): Float64Array {
  const rng = makeRng(seed)
  const table = new Float64Array(64)
  for (let i = 0; i < table.length; i++) table[i] = rng()
  return table
}

/**
 * Шум, замкнутый по долготе (периодичность обязательна: иначе на стыке u=0 и u=1 появится
 * вертикальный шрам), РАЗЛОЖЕННЫЙ на множители. Октава — это amp·S1(u)·S2(u)·C(v): синусы
 * зависят только от долготы, косинус — только от широты. Поэтому они считаются раз на столбец
 * и раз на строку, а пиксель лишь перемножает — в ТОМ ЖЕ порядке, что прежняя формула
 * `amplitude * sin * sin * cos`, так что картинка совпадает с ней до бита.
 *
 * История: раньше каждый вызов шума ещё и заводил генератор с тем же зерном и набивал таблицу
 * фаз заново — 2 вызова × 524 288 пикселей = 67 млн бросков `rng` ради одних и тех же 64 чисел.
 * Замер: 5.5 с главного потока на старте игры — заставка стояла колом ради заглушки, которую
 * через миг сменит `sky/N.webp`.
 */
type Noise = { octaves: number; amp: Float64Array; s1: Float64Array; s2: Float64Array; c: Float64Array }

function separableNoise(seed: number, octaves: number, uScale: number, vScale: number): Noise {
  const table = noiseTable(seed)
  const amp = new Float64Array(octaves)
  const s1 = new Float64Array(octaves * WIDTH)
  const s2 = new Float64Array(octaves * WIDTH)
  const c = new Float64Array(octaves * HEIGHT)
  let amplitude = 0.5
  let frequency = 1
  for (let o = 0; o < octaves; o++) {
    // Дешёвая тригонометрическая «складка» вместо решётчатого шума:
    // фон размыт, разницы не видно, а кода втрое меньше.
    const a = table[(o * 7) % 64]! * 6.283
    const b = table[(o * 13 + 3) % 64]! * 6.283
    amp[o] = amplitude
    for (let x = 0; x < WIDTH; x++) {
      // Раскладываем долготу на окружность — тогда шум непрерывен через шов.
      const angle = (x / WIDTH) * uScale * Math.PI * 2 * frequency
      s1[o * WIDTH + x] = Math.sin(Math.cos(angle) * 3.1 + a)
      s2[o * WIDTH + x] = Math.sin(Math.sin(angle) * 2.7 + b)
    }
    for (let y = 0; y < HEIGHT; y++) {
      const z = ((y / (HEIGHT - 1)) * 2 - 1) * vScale * frequency * 3
      c[o * HEIGHT + y] = Math.cos(z * 1.9 + a * 0.5)
    }
    amplitude *= 0.55
    frequency *= 2.1
  }
  return { octaves, amp, s1, s2, c }
}

function sample(n: Noise, x: number, y: number): number {
  let value = 0
  for (let o = 0; o < n.octaves; o++) {
    value += n.amp[o]! * n.s1[o * WIDTH + x]! * n.s2[o * WIDTH + x]! * n.c[o * HEIGHT + y]!
  }
  return value
}

/**
 * Полоса Млечного Пути в RGBA-буфер `WIDTH × HEIGHT`. Чистая функция без canvas — её
 * цену меряет тест, браузер для этого не нужен.
 */
export function paintBand(data: Uint8ClampedArray): void {
  // Пылевые прожилки и складка яркости — у каждой своё зерно и свой масштаб.
  const dustNoise = separableNoise(0xbeef, 4, 1, 1)
  const foldNoise = separableNoise(0xf00d, 3, 1.7, 2.3)
  // Большой круг, наклонённый к экватору: широта полосы зависит от долготы.
  const bandLat = new Float64Array(WIDTH)
  for (let x = 0; x < WIDTH; x++) {
    bandLat[x] = Math.atan(Math.tan(BAND_TILT) * Math.sin((x / WIDTH) * Math.PI * 2)) / (Math.PI / 2)
  }

  for (let y = 0; y < HEIGHT; y++) {
    // v: −1 (южный полюс) … +1 (северный).
    const v = (y / (HEIGHT - 1)) * 2 - 1
    // Палитра: холодная синева в тенях, лиловое сгущение в ядре.
    const base = 6 + 10 * (1 - Math.abs(v)) // лёгкий градиент к экватору

    for (let x = 0; x < WIDTH; x++) {
      const distance = Math.abs(v - bandLat[x]!) / BAND_WIDTH

      // Сгущение к оси полосы, гладко спадающее к краям.
      let density = Math.exp(-distance * distance * 1.6)

      // Пылевые прожилки: тёмные разрывы поперёк полосы. Без них она — просто мазок.
      const dust = sample(dustNoise, x, y)
      density *= 0.55 + 0.45 * (1 - Math.abs(dust))
      density *= 0.7 + 0.3 * sample(foldNoise, x, y)

      density = Math.max(0, Math.min(1, density))

      const i = (y * WIDTH + x) * 4
      data[i] = base + density * 92
      data[i + 1] = base + 2 + density * 88
      data[i + 2] = base + 12 + density * 120
      data[i + 3] = 255
    }
  }
}

function generate(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const image = ctx.createImageData(WIDTH, HEIGHT)
  paintBand(image.data)
  ctx.putImageData(image, 0, 0)

  // Генератор звёзд — свой, отдельный от шума полосы: та же последовательность, что и раньше.
  const rng = makeRng(0x51deb0a7)

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
