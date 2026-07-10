/**
 * Прогон рынка для глаз: цены товара по тех-уровням, разброс контрабанды по строю,
 * и прибыль реального маршрута. Не тест — исследование баланса. Запуск:
 *   npx tsx packages/sim/scratch/market.ts
 */
import { COMMODITIES } from '../src/domain/cargo/items'
import type { Settlement } from '../src/domain/galaxy/types'
import { unitBuyPrice, unitSellPrice, stockLevel } from '../src/domain/station/market'

const SEED = 0xC0FFEE

function s(techLevel: number, government: Settlement['government'] = 'Демократия'): Settlement {
  return { economy: 'Промышленная', government, techLevel, population: 3, species: '—' }
}

const goods = Object.values(COMMODITIES)

console.log('=== цена ПОКУПКИ по тех-уровню (кредиты за ед.) ===')
console.log(['товар'.padEnd(12), 'база', 'ТУ2', 'ТУ5', 'ТУ8', 'ТУ11', 'ТУ14'].join('\t'))
for (const g of goods) {
  const row = [2, 5, 8, 11, 14].map((tl, i) => unitBuyPrice(g, s(tl), 100 + i, SEED))
  console.log([g.name.padEnd(12), g.basePrice, ...row].join('\t'))
}

console.log('\n=== контрабанда: анархия → корпорация ===')
for (const g of goods.filter((x) => x.contraband)) {
  const an = unitBuyPrice(g, s(6, 'Анархия'), 200, SEED)
  const co = unitBuyPrice(g, s(6, 'Корпорация'), 200, SEED)
  console.log(`${g.name.padEnd(12)} анархия ${an}\tкорпорация ${co}\t×${(co / an).toFixed(2)}`)
}

console.log('\n=== запас на складе (ед.) у ТУ5 vs ТУ13 ===')
for (const g of goods) {
  const low = stockLevel(g, s(5), 300, SEED)
  const high = stockLevel(g, s(13), 301, SEED)
  console.log(`${g.name.padEnd(12)} ТУ5 ${low}\tТУ13 ${high}`)
}

console.log('\n=== маршрут: купить у высокотеха (ТУ13), продать аграрию (ТУ3) ===')
for (const g of goods) {
  const buy = unitBuyPrice(g, s(13), 400, SEED)
  const sell = unitSellPrice(g, s(3), 401, SEED)
  const profit = sell - buy
  const mark = profit > 0 ? `+${profit}` : `${profit}`
  console.log(`${g.name.padEnd(12)} купил ${buy}\tпродал ${sell}\t${mark} за ед. (${((profit / buy) * 100).toFixed(0)}%)`)
}

console.log('\n=== обратный маршрут: сырьё аграрию → высокотеху ===')
for (const g of goods.filter((x) => x.tier <= 6 && !x.contraband)) {
  const buy = unitBuyPrice(g, s(3), 402, SEED)
  const sell = unitSellPrice(g, s(13), 403, SEED)
  const profit = sell - buy
  const mark = profit > 0 ? `+${profit}` : `${profit}`
  console.log(`${g.name.padEnd(12)} купил ${buy}\tпродал ${sell}\t${mark} за ед. (${((profit / buy) * 100).toFixed(0)}%)`)
}
