import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 860 } })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:5240/', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.getByRole('button', { name: 'СТАРТ' }).click()
await p.waitForTimeout(800)
await p.keyboard.press('KeyG')
await p.waitForTimeout(1500)

// Спрашиваем у самой сцены, куда проецируются инстансы звёзд.
const spots = await p.evaluate(() => {
  const canvases = [...document.querySelectorAll('canvas')]
  for (const c of canvases) {
    const r3f = c.__r3f
    if (!r3f?.root) continue
    const st = r3f.root.getState()
    let mesh = null
    st.scene.traverse((o) => { if (o.isInstancedMesh && o.count > 100) mesh = o })
    if (!mesh) continue
    const rect = c.getBoundingClientRect()
    const THREE = mesh.matrixWorld.constructor
    const m = new (mesh.instanceMatrix.constructor === undefined ? Object : Object)()
    const out = []
    const arr = mesh.instanceMatrix.array
    const cam = st.camera
    const v = new (Object.getPrototypeOf(cam.position).constructor)()
    for (let i = 0; i < mesh.count; i++) {
      v.set(arr[i*16+12], arr[i*16+13], arr[i*16+14])
      v.applyMatrix4(mesh.matrixWorld)
      const d = v.distanceTo(cam.position)
      v.project(cam)
      if (v.z > 1 || Math.abs(v.x) > 0.6 || Math.abs(v.y) > 0.6) continue
      out.push({ i, d, x: rect.left + (v.x*0.5+0.5)*rect.width, y: rect.top + (-v.y*0.5+0.5)*rect.height })
    }
    out.sort((a, b) => a.d - b.d)
    return { total: mesh.count, near: out.slice(0, 24) }
  }
  return null
})
if (!spots) { console.log('сцену не нашли'); await b.close(); process.exit(1) }
console.log('инстансов звёзд:', spots.total, '| кандидатов в кадре:', spots.near.length)

const jump = p.getByRole('button', { name: 'ПРЫЖОК' })
let hit = null
for (const s of spots.near) {
  await p.mouse.move(s.x, s.y)
  await p.waitForTimeout(60)
  await p.mouse.click(s.x, s.y)
  await p.waitForTimeout(120)
  if (await jump.count()) { hit = s; break }
}
if (!hit) { console.log('ни один инстанс не кликнулся'); await p.screenshot({path:'apps/web/_panel.png'}); await b.close(); process.exit(1) }
console.log('звезда', hit.i, 'поймана; ПРЫЖОК активен:', await jump.isEnabled())
await p.screenshot({ path: 'apps/web/_panel.png' })

await jump.click()
await p.waitForTimeout(2500)
await p.screenshot({ path: 'apps/web/_after.png' })
console.log('карта закрылась:', (await jump.count()) === 0)
await b.close()
