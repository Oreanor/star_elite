// Что внутри функции: собственное время потомков в её поддереве. node subtree.mjs file.cpuprofile name [line]
import fs from 'node:fs'
const [file, name, line] = process.argv.slice(2)
const p = JSON.parse(fs.readFileSync(file, 'utf8'))
const byId = new Map(p.nodes.map((n) => [n.id, n]))
const dt = new Map()
for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0))
const self = new Map()
const key = (n) => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`
const walk = (id, inside) => {
  const n = byId.get(id)
  const hit = inside || (n.callFrame.functionName === name && (!line || n.callFrame.lineNumber + 1 === +line))
  if (hit) self.set(key(n), (self.get(key(n)) ?? 0) + (dt.get(id) ?? 0))
  for (const c of n.children ?? []) walk(c, hit)
}
walk(p.nodes[0].id, false)
const all = [...self.values()].reduce((a, b) => a + b, 0)
console.log(`${name}: ${(all / 1000).toFixed(0)} мс`)
for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${(us / 1000).toFixed(0).padStart(5)} мс  ${k}`)
