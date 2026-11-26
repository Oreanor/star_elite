// Треугольники и вес каждой GLB-модели: из JSON-чанка, без загрузки геометрии.
import fs from 'node:fs'
import path from 'node:path'
const root = process.argv[2]
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.glb') && files.push(path.join(d, e.name)) }
walk(root)
for (const f of files) {
  const b = fs.readFileSync(f)
  const len = b.readUInt32LE(12)
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8'))
  let tris = 0, prims = 0
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    prims++
    const acc = json.accessors[p.indices ?? p.attributes.POSITION]
    tris += p.indices !== undefined ? acc.count / 3 : acc.count / 3
  }
  const imgs = (json.images ?? []).length
  console.log(`${(tris / 1000).toFixed(1).padStart(7)}k тр  ${String(prims).padStart(3)} прим  ${String(imgs).padStart(2)} карт  ${(b.length / 1e6).toFixed(1).padStart(5)} МБ  ${path.relative(root, f)}`)
}
