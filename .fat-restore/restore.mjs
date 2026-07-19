import fs from 'fs'
import { execSync } from 'child_process'

const transcript =
  'C:/Users/User01/.cursor/projects/c-work-elite/agent-transcripts/5a291f5c-08bd-444c-b6a2-0727ec843a30/5a291f5c-08bd-444c-b6a2-0727ec843a30.jsonl'
const lines = fs.readFileSync(transcript, 'utf8').split(/\n/).filter(Boolean)

const ops = []
function norm(p) {
  return String(p || '').replace(/\\/g, '/')
}
function interesting(p) {
  return p.includes('apps/web/src/render/') || p.includes('apps/web/src/ui/hud/drawFlare')
}

for (const line of lines) {
  let o
  try {
    o = JSON.parse(line)
  } catch {
    continue
  }
  const content = o?.message?.content
  if (!Array.isArray(content)) continue
  for (const c of content) {
    if (c.type !== 'tool_use') continue
    const p = norm(c.input?.path)
    if (!interesting(p)) continue
    if (c.name === 'Write' && c.input?.contents != null) {
      ops.push({ kind: 'write', path: p, contents: c.input.contents })
    }
    if (c.name === 'StrReplace' && c.input?.old_string != null) {
      ops.push({
        kind: 'replace',
        path: p,
        old: c.input.old_string,
        neu: c.input.new_string,
        all: !!c.input.replace_all,
      })
    }
  }
}

const destOf = (p) => {
  const base = p.split('/').pop()
  if (base === 'drawFlare.ts') return 'C:/work/elite/apps/web/src/ui/hud/drawFlare.ts'
  if (base === 'starLight.ts') return 'C:/work/elite/apps/web/src/render/starLight.ts'
  if (['Lighting.tsx', 'Bodies.tsx', 'Exhaust.tsx', 'Dust.tsx'].includes(base)) {
    return `C:/work/elite/apps/web/src/render/scene/${base}`
  }
  if (['ships.ts', 'stationGlb.ts'].includes(base)) {
    return `C:/work/elite/apps/web/src/render/geometry/${base}`
  }
  if (['atmosphere.ts', 'cityLights.ts', 'materials.ts'].includes(base)) {
    return `C:/work/elite/apps/web/src/render/materials/${base}`
  }
  if (base === 'config.ts') return 'C:/work/elite/apps/web/src/render/config.ts'
  return null
}

// Reset mutable targets (except config — keep current DUST white + other WIP) to HEAD first
const reset = [
  'apps/web/src/render/config.ts',
  'apps/web/src/render/scene/Lighting.tsx',
  'apps/web/src/render/scene/Bodies.tsx',
  'apps/web/src/render/scene/Exhaust.tsx',
  'apps/web/src/render/scene/Dust.tsx',
  'apps/web/src/render/materials/atmosphere.ts',
  'apps/web/src/render/materials/cityLights.ts',
  'apps/web/src/render/materials/materials.ts',
  'apps/web/src/render/geometry/ships.ts',
  'apps/web/src/render/geometry/stationGlb.ts',
  'apps/web/src/ui/hud/drawFlare.ts',
]
execSync(`git checkout HEAD -- ${reset.join(' ')}`, { cwd: 'C:/work/elite', stdio: 'inherit' })

let ok = 0
let fail = 0
for (const op of ops) {
  const dest = destOf(op.path)
  if (!dest) continue
  if (op.kind === 'write') {
    fs.writeFileSync(dest, op.contents)
    console.log('write', dest.split('/').pop())
    ok++
    continue
  }
  if (!fs.existsSync(dest)) {
    console.log('missing', dest)
    fail++
    continue
  }
  let text = fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n')
  const old = op.old.replace(/\r\n/g, '\n')
  const neu = op.neu.replace(/\r\n/g, '\n')
  if (!text.includes(old)) {
    console.log('FAIL', dest.split('/').pop(), JSON.stringify(old.slice(0, 80)))
    fail++
    continue
  }
  text = op.all ? text.split(old).join(neu) : text.replace(old, neu)
  fs.writeFileSync(dest, text)
  ok++
}
console.log('done ok', ok, 'fail', fail)

// Keep dust white (user request earlier) — fat had STAR_TINT, we zero it.
const cfgPath = 'C:/work/elite/apps/web/src/render/config.ts'
let cfg = fs.readFileSync(cfgPath, 'utf8')
if (cfg.includes('STAR_TINT: 0.42')) {
  cfg = cfg.replace(
    /\/\*\* Базовый цвет обычной пыли[\s\S]*?STAR_TINT: 0\.42,/,
    `/** Базовый цвет обычной пыли (без тинта звездой — всегда нейтрально-белый). */
  COLOR: 0xe8eef4,
  /** Доля спектра звезды в цвете пыли / лазерного следа. 0 = пыль не желтеет у солнц. */
  STAR_TINT: 0,`,
  )
  fs.writeFileSync(cfgPath, cfg)
  console.log('dust kept white')
} else if (cfg.includes('export const DUST')) {
  // Fat restore may have inserted COLOR/STAR_TINT differently — force white tint.
  cfg = cfg.replace(/(export const DUST = \{[\s\S]*?)STAR_TINT:\s*[\d.]+,/, '$1STAR_TINT: 0,')
  if (!/export const DUST = \{[\s\S]*?COLOR:/.test(cfg)) {
    cfg = cfg.replace(
      /(GLOW_COLOR:\s*0xbfe6ff,)/,
      `$1
  COLOR: 0xe8eef4,
  STAR_TINT: 0,`,
    )
  } else {
    cfg = cfg.replace(/(export const DUST = \{[\s\S]*?COLOR:\s*)0x[0-9a-fA-F]+,/, '$10xe8eef4,')
  }
  fs.writeFileSync(cfgPath, cfg)
  console.log('dust tint forced white')
}
