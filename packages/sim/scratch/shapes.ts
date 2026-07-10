/**
 * Как выглядят шесть форм галактик. Печатает вид сверху (плоскость XY) и вид
 * с ребра (XZ) — чтобы видеть, что диск плоский, а эллиптическая не блин.
 *
 * Исследование, не тест: смотрит глаз, а не expect.
 */
import { GALAXY, GALAXY_SHAPES } from '../src/config/galaxy'
import { placeSystem, galaxyShape } from '../src/domain/galaxy/shape'

const W = 61
const H = 27
const RAMP = ' .:-=+*#%@'

/** Ищет зерно, дающее нужную форму: форма выводится из зерна, а не назначается. */
function seedFor(id: string): number {
  for (let s = 1; s < 5000; s++) if (galaxyShape(s).id === id) return s
  throw new Error(`не нашлось зерна для формы ${id}`)
}

function draw(seed: number, edgeOn: boolean): string[] {
  const grid = Array.from({ length: H }, () => new Array<number>(W).fill(0))
  const R = GALAXY.RADIUS_LY * 1.05

  for (let i = 0; i < GALAXY.COUNT; i++) {
    const p = placeSystem(i, seed)
    const vertical = edgeOn ? p.z : p.y
    const cx = Math.round(((p.x / R) * 0.5 + 0.5) * (W - 1))
    // Вид с ребра растянут вчетверо, иначе диск сливается в одну строку.
    const scale = edgeOn ? 4 : 1
    const cy = Math.round(((-vertical * scale) / R / 2 + 0.5) * (H - 1))
    const row = grid[cy]
    if (row && cx >= 0 && cx < W) row[cx] = (row[cx] ?? 0) + 1
  }

  const peak = Math.max(...grid.flat())
  return grid.map((row) =>
    row
      .map((n) => {
        if (n === 0) return ' '
        const t = Math.min(1, Math.log1p(n) / Math.log1p(peak))
        return RAMP[Math.max(1, Math.round(t * (RAMP.length - 1)))]
      })
      .join(''),
  )
}

for (const shape of GALAXY_SHAPES) {
  const seed = seedFor(shape.id)
  console.log(`\n\n══ ${shape.name.toUpperCase()}  (зерно ${seed})`)
  const top = draw(seed, false)
  console.log(top.join('\n'))
  console.log(`── с ребра (вертикаль растянута ×4) ${'─'.repeat(24)}`)
  console.log(draw(seed, true).slice(8, 19).join('\n'))
}
