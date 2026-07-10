import { makeRng } from '../src/core/math/random'
import { systemName } from '../src/domain/galaxy/names'
import { GALAXY } from '../src/config/galaxy'

const nameFor = (i: number) => systemName(makeRng(GALAXY.SEED ^ Math.imul(i, 0x9e3779b1)))
const names = Array.from({ length: 2500 }, (_, i) => nameFor(i))

console.log('--- первые 48 ---')
for (let i = 0; i < 48; i += 8) console.log('  ' + names.slice(i, i + 8).join(', '))

const again = Array.from({ length: 2500 }, (_, i) => nameFor(i))
console.log('\nдетерминизм:', names.every((n, i) => n === again[i]) ? 'ок' : 'СЛОМАН')

const unique = new Set(names)
const lens = names.map((n) => n.length)
console.log(`уникальных: ${unique.size}/${names.length}`)
console.log(`длина: ${Math.min(...lens)}..${Math.max(...lens)}, средняя ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1)}`)

const has = (re: RegExp) => names.filter((n) => re.test(n))
const pct = (n: number) => `${((n / names.length) * 100).toFixed(0)}%`

const vowelPairs = has(/[аеиоуыэюя]{2}/i)
const consDouble = has(/([^аеиоуыэюяё\s])\1/i)
console.log(`\nзияния:   ${vowelPairs.length} (${pct(vowelPairs.length)}) →`, vowelPairs.slice(0, 6).join(', '))
console.log(`удвоения: ${consDouble.length} (${pct(consDouble.length)}) →`, consDouble.slice(0, 6).join(', '))
console.log('-ония:', has(/ония$/).slice(0, 6).join(', '))
console.log('-люкс:', has(/люкс$/).slice(0, 4).join(', '))
