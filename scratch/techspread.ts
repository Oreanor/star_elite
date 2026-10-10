import { generateGalaxy } from '../packages/sim/src/domain/galaxy/generate'
import { GALAXY } from '../packages/sim/src/config/galaxy'

const systems = generateGalaxy(GALAXY.SEED)
const hist = new Map<number, { worlds: number; stations: number }>()
let total = 0
for (const s of systems) for (const p of s.planets) {
  const st = p.settlement
  if (!st) continue
  total++
  const h = hist.get(st.techLevel) ?? { worlds: 0, stations: 0 }
  h.worlds++
  if (p.station) h.stations++
  hist.set(st.techLevel, h)
}
console.log('systems', systems.length, 'inhabited', total)
for (const t of [...hist.keys()].sort((a, b) => a - b)) console.log(t, hist.get(t))
