/**
 * Лоурез карт звёзд для галактического LOD.
 * Источник: public/stars/star-*.webp (1774×887) → public/stars/lo/ (512×256).
 *
 *   node apps/web/scripts/star-lo.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'public/stars')
const outDir = path.join(srcDir, 'lo')
const IDS = ['O', 'B', 'A', 'F', 'G', 'K', 'M']

/** 512×256: equirect 2:1 — читаемо на LOD галактики без full 1774×887. */
const W = 512
const H = 256

fs.mkdirSync(outDir, { recursive: true })
for (const id of IDS) {
  const src = path.join(srcDir, `star-${id}.webp`)
  const dst = path.join(outDir, `star-${id}.webp`)
  await sharp(src)
    .resize(W, H, { kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 78, effort: 5 })
    .toFile(dst)
  const kb = (fs.statSync(dst).size / 1024).toFixed(1)
  console.log(`star-${id}.webp → lo/ ${W}×${H} ${kb}KB`)
}
