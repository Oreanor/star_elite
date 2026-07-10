import { GALAXY, GEMINABLE, SYLLABLES, VOWELS } from '../../config/galaxy'
import { makeRng, type Rng } from '../../core/math'

/**
 * Имя системы: ГОЛОВА + 0..2 СЕРЕДИНЫ + ХВОСТ, то есть 2..4 слога.
 *
 * Наборы разделены не для красоты: у имени должны быть начало и окончание,
 * иначе выходит бормотание вместо топонима. Поверх — два приёма звучности:
 * зияния («Тааран») и удвоение согласной («Даррион»).
 */

function pick<T>(rng: Rng, table: readonly T[], fallback: T): T {
  return table[Math.floor(rng() * table.length)] ?? fallback
}

const isVowel = (ch: string) => VOWELS.includes(ch)

/**
 * Удваивает одну согласную, стоящую между двумя гласными.
 * Только там: в стыке «Дар|сион» удвоение дало бы нечитаемое «Дарссион».
 */
function geminate(name: string, rng: Rng): string {
  const lower = name.toLowerCase()
  const spots: number[] = []
  for (let i = 1; i < lower.length - 1; i++) {
    const ch = lower[i] ?? ''
    const prev = lower[i - 1] ?? ''
    const next = lower[i + 1] ?? ''
    if (GEMINABLE.includes(ch) && isVowel(prev) && isVowel(next)) spots.push(i)
  }
  if (spots.length === 0) return name

  const at = spots[Math.floor(rng() * spots.length)] ?? spots[0]!
  return name.slice(0, at) + name[at] + name.slice(at)
}

/**
 * Отсев непроизносимого. Слоги стыкуются вслепую, и «Тибовматтерра» —
 * закономерный результат, а не редкая неудача. Дешевле отбросить и пересобрать,
 * чем усложнять правила стыковки.
 */
function isPronounceable(name: string): boolean {
  const s = name.toLowerCase()
  if (s.length > GALAXY.MAX_NAME_LEN) return false
  if (/[^аеиоуыэюяё]{3,}/.test(s)) return false // три согласных подряд
  if (/[аеиоуыэюяё]{3,}/.test(s)) return false // три гласных подряд
  return true
}

function assemble(rng: Rng): string {
  const head: string = pick(rng, SYLLABLES.HEAD, 'Дар')
  const tail: string = pick(rng, SYLLABLES.TAIL, 'ион')

  // Длинный хвост уже несёт два слога. Ещё две середины — и имя разваливается.
  const maxMiddles = tail.length >= 4 ? 1 : 2
  const middles = Math.floor(rng() * (maxMiddles + 1))

  let name = head
  let prev = ''
  for (let i = 0; i < middles; i++) {
    // Зияние вместо обычного слога — но не два подряд, это уже вой.
    const useVowel = rng() < GALAXY.VOWEL_CHANCE && !isVowel(prev.charAt(0))
    let syl = useVowel ? pick(rng, SYLLABLES.VOWEL, 'иа') : pick(rng, SYLLABLES.MID, 'ан')
    if (syl === prev) syl = pick(rng, SYLLABLES.MID, 'ор')
    name += syl
    prev = syl
  }

  name += tail === prev ? pick(rng, SYLLABLES.TAIL, 'ия') : tail

  if (rng() < GALAXY.GEMINATE_CHANCE) name = geminate(name, rng)
  return name
}

export function systemName(rng: Rng): string {
  // Поток ГПСЧ продолжается между попытками, поэтому результат остаётся детерминированным.
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = assemble(rng)
    if (isPronounceable(name)) return name
  }
  // Голова + хвост произносимы всегда: середины и есть источник спотыканий.
  return pick(rng, SYLLABLES.HEAD, 'Дар') + pick(rng, SYLLABLES.TAIL, 'ион')
}

/**
 * Имя галактики. Тот же генератор: у звезды и у галактики одна фонетика, потому
 * что называли их одни и те же люди.
 *
 * Выводится из зерна, как и всё остальное, — своим потоком бросков. Общий с
 * `placeSystem` связал бы имя с расположением звёзд: сменив имя, мы сдвинули бы
 * галактику. Прыжок сквозь ядро приведёт в галактику с другим зерном, и её имя
 * найдётся тем же вызовом, без единой таблицы.
 */
export function galaxyName(seed: number): string {
  return systemName(makeRng(seed ^ 0x6a09e667))
}

/** Планеты нумеруются римскими цифрами от имени системы — как в астрономии. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'] as const

export function planetName(system: string, index: number): string {
  return `${system} ${ROMAN[index] ?? String(index + 1)}`
}

/** Спутник получает букву при номере планеты: «Даррион II a». */
export function moonName(planet: string, index: number): string {
  return `${planet} ${String.fromCharCode(97 + index)}`
}
