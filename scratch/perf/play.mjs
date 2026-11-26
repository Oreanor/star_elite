/**
 * Стенд замера кадра на ЭТОЙ машине: headless Edge на настоящей видеокарте (ANGLE/D3D11).
 * Не тест — прогон для глаз, как и всё в scratch/.
 *
 * Сценарий: новый пилот → START (заставка со «вжухом») → станция → отстыковка → полёт.
 * На заставке пишет интервалы кадров и долгие задачи главного потока, на станции и в
 * полёте — показания Probe (F3): фазы кадра, GPU, вызовы. Плюс CPU-профили (CDP) с
 * разбивкой по функциям — собирать игру для этого надо БЕЗ минификации, иначе имена `a`, `b`.
 *
 * Запуск: node scratch/perf/play.mjs [url] [метка]
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.argv[2] ?? 'http://localhost:5176/'
const TAG = process.argv[3] ?? 'run'
const OUT = path.join(import.meta.dirname, 'out', TAG)
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
})
const page = await browser.newPage({ viewport: { width: 1536, height: 864 } })
const cdp = await page.context().newCDPSession(page)
const log = (...a) => console.log(`[${TAG}]`, ...a)
page.on('pageerror', (e) => log('pageerror', e.message))

async function profile(name, ms) {
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 })
  await cdp.send('Profiler.start')
  await page.waitForTimeout(ms)
  const { profile } = await cdp.send('Profiler.stop')
  fs.writeFileSync(path.join(OUT, `${name}.cpuprofile`), JSON.stringify(profile))
  summarize(name, profile)
}

/** Собственное и включительное время по функциям. Включительное — без двойного счёта рекурсии. */
function summarize(name, p) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const dt = new Map()
  for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0))
  const key = (n) => {
    const f = n.callFrame
    const file = f.url.split('/').pop()?.split('?')[0] ?? ''
    return `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`
  }
  const self = new Map()
  const total = new Map()
  let all = 0
  for (const [id, us] of dt) {
    all += us
    const n = byId.get(id)
    self.set(key(n), (self.get(key(n)) ?? 0) + us)
    const seen = new Set()
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const k = key(byId.get(cur))
      if (seen.has(k)) continue
      seen.add(k)
      total.set(k, (total.get(k) ?? 0) + us)
    }
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `  ${(us / 1000).toFixed(0).padStart(6)} мс ${((us / all) * 100).toFixed(1).padStart(5)}%  ${k}`).join('\n')
  const text = `== ${name}: ${(all / 1000).toFixed(0)} мс выборок\n-- собственное\n${top(self, 25)}\n-- включительное\n${top(total, 40)}\n`
  fs.writeFileSync(path.join(OUT, `${name}.txt`), text)
  log(`профиль ${name} → ${path.join(OUT, name + '.txt')}`)
}

async function probe(label, ms) {
  // Окно Probe — 30 кадров; снимаем несколько показаний подряд.
  const reads = []
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    await page.waitForTimeout(1000)
    reads.push(await page.evaluate(() => document.getElementById('probe')?.textContent ?? '(нет probe)'))
  }
  log(`${label}:\n${reads.slice(-3).join('\n--\n')}`)
  fs.writeFileSync(path.join(OUT, `${label}.probe.txt`), reads.join('\n--\n'))
}

const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) })

// Один и тот же мир в каждом прогоне: стартовую систему нового пилота клиент выбирает
// случайно, и без зерна прогоны сравнивали бы разные сцены (статуя рядом — и упор в GPU).
const SEED = Number(process.env.SEED ?? 1)
await page.addInitScript((seed) => {
  let a = seed >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}, SEED)

// Опыт: отрезать фоновую догрузку (портреты, чужие корпуса), чтобы увидеть её цену на вжухе.
if (process.env.BLOCK) for (const pat of process.env.BLOCK.split(',')) await page.route('**/' + pat + '/**', (r) => r.abort())
await page.goto(URL)
// Опыты с титулом: спрятать отдельный эффект и посмотреть, уйдёт ли рывок.
const EXP = {
  nowarp: '[style*="title-dust-warp"]{display:none!important}',
  noclap: '[style*="title-ship-clap"]{display:none!important}',
  noblend: '.mix-blend-screen,.mix-blend-overlay{mix-blend-mode:normal!important}',
}
if (process.env.EXP) await page.addStyleTag({ content: process.env.EXP.split(',').map((k) => EXP[k]).join(' ') })
await page.getByRole('button', { name: 'START' }).waitFor()
await shot('0-create')

// --- Заставка: интервалы кадров и долгие задачи от нажатия START ---
await page.evaluate(() => {
  const rec = { frames: [], long: [], t0: performance.now() }
  window.__rec = rec
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) rec.long.push([Math.round(e.startTime - rec.t0), Math.round(e.duration)])
  }).observe({ type: 'longtask' })
  let last = performance.now()
  const tick = (t) => {
    rec.frames.push([Math.round(t - rec.t0), +(t - last).toFixed(1)])
    last = t
    if (t - rec.t0 < 25000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  // Момент срыва — появление варп-штрихов (TitleWarp монтируется по launched).
  new MutationObserver(() => {
    if (rec.launch === undefined && document.querySelector('[style*="title-dust-warp"]')) rec.launch = Math.round(performance.now() - rec.t0)
  }).observe(document.body, { subtree: true, childList: true })
})
// Профайлер сам по себе ломает интервалы кадров — профиль загрузки только по просьбе.
const profiling = process.env.PROFILE ? profile('1-boot', 9000) : Promise.resolve()
await page.getByRole('button', { name: 'START' }).click()
// Снимков немного: каждый сам по себе — внеочередной кадр и портит замер интервалов.
let prev = 0
for (const ms of [1500, 3000]) {
  await page.waitForTimeout(ms - prev)
  prev = ms
  await shot(`1-title-${ms}`)
}
await profiling
await page.waitForFunction(() => window.__rec.launch !== undefined, null, { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(2500)
const rec = await page.evaluate(() => window.__rec)
if (rec.launch !== undefined) {
  const from = rec.launch, to = rec.launch + 1500
  const win = rec.frames.filter(([t]) => t > from && t <= to)
  const worst = Math.max(0, ...win.map(([, d]) => d))
  const over = win.filter(([, d]) => d > 20).length
  const longIn = rec.long.filter(([t, d]) => t < to && t + d > from)
  log(`вжух в ${from} мс от START; за 1.5 с после: кадров ${win.length}, худший интервал ${worst} мс, >20 мс: ${over}, долгих задач ${longIn.length} (${longIn.map((l) => l.join('+')).join(' ')})`)
} else log('вжуха не дождались')
const slow = rec.frames.filter(([, d]) => d > 20)
log(`заставка: кадров ${rec.frames.length}, медленных (>20мс) ${slow.length}`)
log(`  медленные t:интервал ${slow.map((f) => f.join(':')).join(' ')}`)
log(`  долгие задачи t+длит ${rec.long.map((l) => l.join('+')).join(' ')}`)
fs.writeFileSync(path.join(OUT, '1-title-frames.json'), JSON.stringify(rec))

// --- Станция ---
await page.waitForTimeout(3000)
await shot('2-station')
await page.keyboard.press('F3')
await probe('2-station', 6000)

// --- Отстыковка и полёт ---
const undock = page.getByRole('button', { name: 'UNDOCK' })
if (await undock.count()) {
  await undock.first().click()
  await page.waitForTimeout(9000) // кино вылета
  await shot('3-undocked')
  // Захват курсора в headless может не даться — тогда игра под меню паузы. Клик по канвасу.
  await page.mouse.click(768, 432)
  await page.waitForTimeout(1500)
  await shot('3-flight')
  await probe('3-flight', 8000)
  await profile('3-flight', 5000)
} else {
  log('кнопки UNDOCK нет — смотри 2-station.png')
}

await browser.close()
