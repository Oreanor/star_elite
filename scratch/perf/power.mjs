// На сети ли ноутбук: на батарее Chromium режет кадр до 30 fps, и замер врёт.
import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'msedge', headless: true })
const p = await b.newPage()
await p.goto('about:blank')
console.log(await p.evaluate(async () => { const x = await navigator.getBattery(); return { charging: x.charging, level: x.level } }))
await b.close()
