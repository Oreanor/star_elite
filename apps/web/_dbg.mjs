import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 860 } })
await p.goto('http://localhost:5240/', { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
await p.getByRole('button', { name: 'СТАРТ' }).click()
await p.waitForTimeout(600)
await p.keyboard.press('KeyG')
await p.waitForTimeout(1500)
console.log(await p.evaluate(() => {
  return [...document.querySelectorAll('canvas')].map((c) => ({
    id: c.id, w: c.width,
    keys: Object.keys(c).filter(k => k.startsWith('__')),
    r3f: c.__r3f ? Object.keys(c.__r3f) : null,
  }))
}))
await b.close()
