import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })
const page = await browser.newPage()
await page.goto('about:blank')
console.log(await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return [c.getParameter(e.UNMASKED_RENDERER_WEBGL), !!c.getExtension('EXT_disjoint_timer_query_webgl2')] }))
console.log(await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => (++n < 120 ? requestAnimationFrame(f) : r((n / (performance.now() - t0)) * 1000)); requestAnimationFrame(f) })))
await browser.close()
