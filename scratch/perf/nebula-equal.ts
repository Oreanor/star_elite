// Вынос таблиц шума не меняет картинку: старый алгоритм против нового, пиксель в пиксель.
import { makeRng } from '../../packages/sim/src/core/math/random'
import { paintBand } from '../../apps/web/src/render/sky/nebula'

const W = 1024, H = 512, BAND_TILT = 0.62, BAND_WIDTH = 0.28
function oldNoise(u: number, v: number, octaves: number, rng: () => number): number {
  const table = Array.from({ length: 64 }, () => rng())
  let value = 0, amplitude = 0.5, frequency = 1
  for (let o = 0; o < octaves; o++) {
    const angle = u * Math.PI * 2 * frequency
    const x = Math.cos(angle), y = Math.sin(angle), z = v * frequency * 3
    const a = table[(o * 7) % 64]! * 6.283, b = table[(o * 13 + 3) % 64]! * 6.283
    value += amplitude * Math.sin(x * 3.1 + a) * Math.sin(y * 2.7 + b) * Math.cos(z * 1.9 + a * 0.5)
    amplitude *= 0.55; frequency *= 2.1
  }
  return value
}
function oldBand(data: Uint8ClampedArray) {
  for (let y = 0; y < H; y++) {
    const v = (y / (H - 1)) * 2 - 1
    for (let x = 0; x < W; x++) {
      const u = x / W
      const bandLat = Math.atan(Math.tan(BAND_TILT) * Math.sin(u * Math.PI * 2)) / (Math.PI / 2)
      const distance = Math.abs(v - bandLat) / BAND_WIDTH
      let density = Math.exp(-distance * distance * 1.6)
      const dust = oldNoise(u, v, 4, makeRng(0xbeef))
      density *= 0.55 + 0.45 * (1 - Math.abs(dust))
      density *= 0.7 + 0.3 * oldNoise(u * 1.7, v * 2.3, 3, makeRng(0xf00d))
      density = Math.max(0, Math.min(1, density))
      const base = 6 + 10 * (1 - Math.abs(v))
      const i = (y * W + x) * 4
      data[i] = base + density * 92; data[i + 1] = base + 2 + density * 88; data[i + 2] = base + 12 + density * 120; data[i + 3] = 255
    }
  }
}
const a = new Uint8ClampedArray(W * H * 4), b = new Uint8ClampedArray(W * H * 4)
let t = performance.now(); oldBand(a); const to = performance.now() - t
t = performance.now(); paintBand(b); const tn = performance.now() - t
let diff = 0
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
console.log(`старый ${to.toFixed(0)} мс, новый ${tn.toFixed(0)} мс, разных байт: ${diff}`)
