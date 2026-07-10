import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 860 } })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:5240/', { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
await p.getByRole('button', { name: 'СТАРТ' }).click()
await p.waitForTimeout(1000)
await p.keyboard.press('KeyG')
await p.waitForTimeout(1200)
// Ядро галактики проецируется у центра полотна.
for (const [x, y] of [[500,430],[503,433],[497,427],[520,450],[470,410]]) {
  await p.mouse.move(x, y)
  await p.waitForTimeout(150)
}
await p.screenshot({ path: 'apps/web/_hover.png' })
await p.mouse.click(403, 556)
await p.waitForTimeout(400)
await p.screenshot({ path: 'apps/web/_panel.png' })
console.log('ok')
await b.close()
