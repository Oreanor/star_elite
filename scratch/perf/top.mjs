// Сводка CPU-профиля: собственное и включительное время. node top.mjs file.cpuprofile [N]
import fs from 'node:fs'
const [file, nArg] = process.argv.slice(2)
const N = Number(nArg ?? 30)
const p = JSON.parse(fs.readFileSync(file, 'utf8'))
const byId = new Map(p.nodes.map((n) => [n.id, n]))
const parent = new Map()
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const dt = new Map()
for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0))
const key = (n) => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`
const self = new Map(), total = new Map()
let all = 0
for (const [id, us] of dt) {
  all += us
  const k0 = key(byId.get(id))
  self.set(k0, (self.get(k0) ?? 0) + us)
  const seen = new Set()
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const k = key(byId.get(cur))
    if (seen.has(k)) continue
    seen.add(k)
    total.set(k, (total.get(k) ?? 0) + us)
  }
}
const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, N).map(([k, us]) => `  ${(us / 1000).toFixed(0).padStart(6)} мс ${((us / all) * 100).toFixed(1).padStart(5)}%  ${k}`).join('\n')
console.log(`${(all / 1000).toFixed(0)} мс\n-- собственное\n${top(self)}\n-- включительное\n${top(total)}`)
