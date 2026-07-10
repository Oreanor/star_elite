import { generateGalaxy } from '../src/domain/galaxy/generate'
import { capitalOf, isInhabited, settledPlanets, stationsOf, totalPopulation } from '../src/domain/galaxy/types'
import { torusDistance } from '../src/domain/galaxy/torus'
import { GALAXY_SIZE } from '../src/config/galaxy'

const t0 = performance.now()
const g = generateGalaxy()
const ms = performance.now() - t0

console.log(`сгенерировано ${g.length} систем за ${ms.toFixed(1)} мс`)
console.log('детерминизм:', JSON.stringify(generateGalaxy()) === JSON.stringify(g) ? 'ок' : 'СЛОМАН')
console.log('уникальных имён:', new Set(g.map((s) => s.name)).size)

const inhabited = g.filter(isInhabited)
const dockable = g.filter((s) => stationsOf(s).length > 0)
console.log(`\nобитаемых систем: ${inhabited.length} (${((inhabited.length / g.length) * 100).toFixed(0)}%)`)
console.log(`систем со станциями: ${dockable.length}`)
console.log(`обитаемых планет всего: ${g.reduce((n, s) => n + settledPlanets(s).length, 0)}`)
console.log(`станций всего: ${g.reduce((n, s) => n + stationsOf(s).length, 0)}`)

// Инварианты, которые обязаны держаться.
const bad = {
  'обитаемая система без планет': inhabited.filter((s) => s.planets.length === 0).length,
  'обитаемая система без столицы': inhabited.filter((s) => capitalOf(s) === null).length,
  'станция без поселения': g.reduce(
    (n, s) => n + s.planets.filter((p) => p.station && !p.settlement).length, 0),
  'поселение без имени': g.reduce(
    (n, s) => n + settledPlanets(s).filter((p) => !p.name).length, 0),
  'необитаемая система с поселением': g.filter((s) => !isInhabited(s) && settledPlanets(s).length > 0).length,
}
console.log('\n--- инварианты ---')
for (const [k, v] of Object.entries(bad)) console.log(`  ${v === 0 ? '✓' : '✗'} ${k}: ${v}`)

const multi = inhabited.filter((s) => settledPlanets(s).length > 1)
console.log(`\nсистем с несколькими обитаемыми мирами: ${multi.length}`)

const example = multi.find((s) => settledPlanets(s).length >= 3) ?? multi[0]
if (example) {
  console.log(`\n--- ${example.name} (${example.star.className}, охрана: ${example.security}) ---`)
  console.log(`население системы: ${totalPopulation(example)} млн, столица: ${capitalOf(example)?.name}`)
  for (const p of example.planets) {
    const s = p.settlement
    const st = p.station
    console.log(`  ${s ? '●' : '·'} ${p.name.padEnd(16)} ${p.type.padEnd(15)} ${p.moons.length} спутн.`)
    if (s) console.log(`      ${s.government}, ${s.economy}, тех ${s.techLevel}, ${s.population} млн — ${s.species}`)
    if (st) console.log(`      ⚓ ${st.name}, орбита ${st.orbit} м`)
  }
}

console.log('\n--- тор: расстояние через край короче прямого ---')
const a = g[0]!
const b = g[49]!
console.log(
  `  ${a.name} → ${b.name}: прямое ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(1)}, ` +
    `по тору ${torusDistance(a.x, a.y, b.x, b.y, GALAXY_SIZE).toFixed(1)} св.лет`,
)
