/**
 * Аудит WebGL в полёте: какие программы ПЕРЕСОБИРАЮТСЯ в кадре и какие буферы льются.
 * Перехватывает методы контекста до загрузки страницы, three.js о нём не знает.
 *
 * Запуск: node scratch/perf/gl-audit.mjs [url]
 */
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5176/'
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1536, height: 864 } })
page.on('pageerror', (e) => console.log('pageerror', e.message))

await page.addInitScript((seed) => {
  let a = seed >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}, Number(process.env.SEED ?? 1))
await page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype
  const audit = { links: [], sub: new Map(), data: new Map(), frames: 0, uniforms: 0, draws: 0 }
  window.__audit = audit
  const src = new WeakMap()
  const shaders = new WeakMap()
  const name = (s) => {
    const m = /#define SHADER_NAME (\S+)/.exec(s)
    const defs = [...s.matchAll(/#define (\w+)/g)].map((d) => d[1]).filter((d) => !/^(SHADER_|PI|RECIPROCAL|EPSILON|saturate|whiteComplement|LOG2|HIGH_PRECISION|GAMMA|LINEAR|USE_LOGDEPTHBUF|STANDARD|DITHER)/.test(d))
    return `${m ? m[1] : '?'} [${defs.slice(0, 12).join(' ')}]`
  }
  const shaderSource = P.shaderSource
  P.shaderSource = function (sh, s) { src.set(sh, s); return shaderSource.call(this, sh, s) }
  const attach = P.attachShader
  P.attachShader = function (pr, sh) {
    const l = shaders.get(pr) ?? []
    l.push(sh)
    shaders.set(pr, l)
    return attach.call(this, pr, sh)
  }
  const link = P.linkProgram
  P.linkProgram = function (pr) {
    const v = (shaders.get(pr) ?? []).map((sh) => src.get(sh) ?? '').find((s) => s.includes('gl_Position')) ?? ''
    audit.links.push([Math.round(performance.now()), name(v)])
    return link.call(this, pr)
  }
  const bump = (map, k, bytes) => {
    const e = map.get(k) ?? [0, 0]
    e[0]++
    e[1] += bytes
    map.set(k, e)
  }
  const size = (d, a, b) => (typeof d === 'number' ? d : d ? (b ?? (d.byteLength - (a ?? 0) * (d.BYTES_PER_ELEMENT ?? 1)) / 1) * (b !== undefined ? d.BYTES_PER_ELEMENT ?? 1 : 1) : 0)
  const sub = P.bufferSubData
  P.bufferSubData = function (t, off, d, so, len) {
    const bytes = len !== undefined ? len * (d.BYTES_PER_ELEMENT ?? 1) : d.byteLength
    bump(audit.sub, `${d.constructor.name}:${d.length}`, bytes)
    return sub.apply(this, arguments)
  }
  const data = P.bufferData
  P.bufferData = function (t, d) {
    bump(audit.data, typeof d === 'number' ? `size:${d}` : `${d.constructor.name}:${d.length}`, size(d))
    return data.apply(this, arguments)
  }
  audit.tri = new Map()
  const tri = (mode, count, inst) => {
    const k = mode + ':' + count + (inst > 1 ? 'x' + inst : '')
    const prim = mode === 4 ? count / 3 : mode === 1 ? count / 2 : count
    const e = audit.tri.get(k) ?? [0, 0]
    e[0]++
    e[1] += prim * inst
    audit.tri.set(k, e)
  }
  const de = P.drawElements, da = P.drawArrays, dei = P.drawElementsInstanced, dai = P.drawArraysInstanced
  P.drawElements = function (mode, count) { audit.draws++; tri(mode, count, 1); return de.apply(this, arguments) }
  P.drawArrays = function (mode, first, count) { audit.draws++; tri(mode, count, 1); return da.apply(this, arguments) }
  P.drawElementsInstanced = function (mode, count, t, o, inst) { audit.draws++; tri(mode, count, inst); return dei.apply(this, arguments) }
  P.drawArraysInstanced = function (mode, first, count, inst) { audit.draws++; tri(mode, count, inst); return dai.apply(this, arguments) }
  for (const m of Object.getOwnPropertyNames(P).filter((n) => n.startsWith('uniform'))) {
    const f = P[m]
    if (typeof f !== 'function') continue
    P[m] = function () { audit.uniforms++; return f.apply(this, arguments) }
  }
  const tick = () => { audit.frames++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})

await page.goto(URL)
await page.getByRole('button', { name: 'START' }).click()
await page.getByRole('button', { name: 'UNDOCK' }).first().waitFor({ timeout: 60000 })
await page.waitForTimeout(2000)
await page.getByRole('button', { name: 'UNDOCK' }).first().click()
await page.waitForTimeout(10000)
await page.mouse.click(768, 432)
await page.waitForTimeout(3000)

const reset = () => page.evaluate(() => { globalThis.__pc = new Map(); globalThis.__ms = new Map(); const a = window.__audit; a.links = []; a.sub = new Map(); a.data = new Map(); a.frames = 0; a.uniforms = 0; a.draws = 0; a.tri = new Map() })
await reset()
await page.waitForTimeout(4000)
const r = await page.evaluate(() => {
  const a = window.__audit
  const top = (m) => [...m].sort((x, y) => y[1][1] - x[1][1]).slice(0, 20).map(([k, [n, b]]) => `${(n / a.frames).toFixed(1).padStart(6)}/кадр ${((b / a.frames) / 1024).toFixed(0).padStart(6)} КБ/кадр  ${k}`)
  const links = new Map()
  for (const [, n] of a.links) links.set(n, (links.get(n) ?? 0) + 1)
  return {
    frames: a.frames,
    perFrame: { draws: (a.draws / a.frames).toFixed(0), uniforms: (a.uniforms / a.frames).toFixed(0), links: (a.links.length / a.frames).toFixed(2) },
    links: [...links].sort((x, y) => y[1] - x[1]).slice(0, 20),
    sub: top(a.sub),
    data: top(a.data),
    tri: [...a.tri].sort((x, y) => y[1][1] - x[1][1]).slice(0, 15).map(([k, [n, p]]) => `${(p / a.frames / 1000).toFixed(1).padStart(7)}k прим/кадр  ${(n / a.frames).toFixed(1)} выз/кадр  режим:число ${k}`),
    ms: [...(globalThis.__ms ?? new Map())].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, n]) => `${(n / a.frames).toFixed(1)}/кадр  ${k}`),
    pc: [...(globalThis.__pc ?? new Map())].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, n]) => `${(n / a.frames).toFixed(1).padStart(6)}/кадр  ${k}`),
  }
})
console.log(`кадров ${r.frames}`, r.perFrame)
console.log('-- linkProgram за окно:')
for (const [n, c] of r.links) console.log(`  ${c}×  ${n}`)
console.log('-- bufferSubData:')
for (const l of r.sub) console.log('  ' + l)
console.log('-- bufferData:')
for (const l of r.data) console.log('  ' + l)
console.log('-- смены программы (getProgram) по причинам:')
for (const l of r.pc) console.log('  ' + l)
console.log('-- примитивы по вызовам (4 = треугольники):')
for (const l of r.tri) console.log('  ' + l)
console.log('-- MeshBasicMaterial needsUpdate/dispose:')
for (const l of r.ms) console.log('  ' + l)
await browser.close()
