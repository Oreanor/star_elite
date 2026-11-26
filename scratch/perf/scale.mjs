/**
 * Развёртка по масштабу: от корабля в системе — к галактике и дальше, с замером на каждом шаге.
 * Не тест — прогон для глаз. Зажимает рост (E) и раз в STEP_MS снимает Probe и скриншот.
 *
 * Запуск: SEED=1 node scratch/perf/scale.mjs [url] [метка] [секунд роста]
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.argv[2] ?? 'http://localhost:5176/'
const TAG = process.argv[3] ?? 'scale'
const GROW_S = Number(process.argv[4] ?? 40)
const STEP_MS = 1500
const OUT = path.join(import.meta.dirname, 'out', TAG)
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
})
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1536), height: Number(process.env.H ?? 864) } })
const log = (...a) => console.log(`[${TAG}]`, ...a)
page.on('pageerror', (e) => log('pageerror', e.message))
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

await page.goto(URL)
await page.getByRole('button', { name: 'START' }).click()
await page.getByRole('button', { name: 'UNDOCK' }).first().waitFor({ timeout: 60000 })
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'UNDOCK' }).first().click()
await page.waitForTimeout(9000)
await page.mouse.click(Number(process.env.W ?? 1536) / 2, Number(process.env.H ?? 864) / 2)
await page.waitForTimeout(1500)
await page.keyboard.press('F3')
await page.waitForTimeout(2500)

const readProbe = () => page.evaluate(() => document.getElementById('probe')?.textContent ?? '')
const rows = []
const sample = async (label) => {
  const text = await readProbe()
  const fps = /(\d+) fps/.exec(text)?.[1] ?? '?'
  const ms = /([\d.]+) мс/.exec(text)?.[1] ?? '?'
  const phases = /сим ([\d.]+)\s+сцена ([\d.]+)\s+рендер ([\d.]+)/.exec(text)
  const gpu = /gpu ([\d.]+)/.exec(text)?.[1] ?? '?'
  const calls = /выз (\d+)/.exec(text)?.[1] ?? '?'
  const tris = /тр ([\d.]+k)/.exec(text)?.[1] ?? '?'
  const row = `${label.padEnd(8)} ${fps.padStart(3)} fps ${ms.padStart(5)} мс | сим ${phases?.[1]} сцена ${phases?.[2]} рендер ${phases?.[3]} | gpu ${gpu} | выз ${calls} тр ${tris}`
  rows.push(row)
  log(row)
  await page.screenshot({ path: path.join(OUT, `${label}.png`) })
}

await sample('t0')
await page.keyboard.down('KeyE')
for (let t = STEP_MS; t <= GROW_S * 1000; t += STEP_MS) {
  await page.waitForTimeout(STEP_MS)
  await sample(`g${(t / 1000).toFixed(1)}`)
}
await page.keyboard.up('KeyE')
// Постоять на достигнутом масштабе: замер без самого роста (у роста свои эффекты — блюр, рябь).
await page.waitForTimeout(3000)
await sample('hold')
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
await cdp.send('Profiler.start')
await page.waitForTimeout(4000)
const { profile } = await cdp.send('Profiler.stop')
fs.writeFileSync(path.join(OUT, 'hold.cpuprofile'), JSON.stringify(profile))
fs.writeFileSync(path.join(OUT, 'rows.txt'), rows.join('\n') + '\n')
await browser.close()
