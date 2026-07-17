import type { CSSProperties } from 'react'
import type { ShipEntity, World } from '@elite/sim'

/**
 * Портреты пилотов. Лица НЕ нарезаны на файлы: на каждую расу и эмоцию — один лист
 * 6×6 (36 разных персонажей), а нужная клетка вырезается ПО КООРДИНАТАМ под маску:
 * в вебе через `background-position`, в HUD-канвасе через `drawImage` c sub-rect.
 *
 * Пилот = (вид, индекс 0..35): вид берётся из его персоны (переезжает с ним при
 * смене борта), индекс — стабильный хеш личности. Эмоция выбирает, с какого листа
 * брать клетку, и выводится из состояния борта — без RNG, детерминированно.
 *
 * Пока листов нет — крой ничего не показывает (404), и наружу проступает
 * плейсхолдер-инициал. Появятся файлы в `public/portraits/` — лица встанут сами.
 */

export type Emotion = 'neutral' | 'joy' | 'pain' | 'anger' | 'fear' | 'sadness'

/**
 * Номер листа по эмоции: файл называется `<раса>-<номер>.png`. Порядок задан
 * художником: 1 нейтраль, 2 радость, 3 страх, 4 злость, 5 боль, 6 грусть.
 */
const EMOTION_FILE: Record<Emotion, string> = {
  neutral: '1',
  joy: '2',
  fear: '3',
  anger: '4',
  pain: '5',
  sadness: '6',
}

/** Имя вида (рус, из sim) → id папки ассетов. Неизвестный вид — земляне. Четыре расы. */
const SPECIES_ASSET: Record<string, string> = {
  'Земляне': 'human',
  'Гуманоиды': 'humanoids',
  'Синтеты': 'robots',
  'Фелиды': 'felines',
}

/** Сторона сетки: лист 6×6 = 36 лиц на расу. */
export const PORTRAIT_GRID = 6

export function speciesAsset(species: string): string {
  return SPECIES_ASSET[species] ?? 'human'
}

/**
 * URL листа эмоции для вида. Раскладка как в `docs/pilots/`: папка на расу, файл на
 * эмоцию по номеру — `public/portraits/<раса>/<номер>.png`, напр. `human/3.png` (страх).
 */
export function portraitSheet(species: string, emotion: Emotion): string {
  return `/portraits/${speciesAsset(species)}/${EMOTION_FILE[emotion]}.png`
}

/** Хеш строки в 32 бита: разные имена — разные лица, но детерминированно. */
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/**
 * Стабильный индекс лица пилота 0..35. Сид — ИМЯ пилота (`pilotName`, дано при
 * рождении): оно не меняется от знакомства и восстанавливается у повторной встречи,
 * поэтому лицо НЕ прыгает по ходу разговора и узнаётся при новой встрече. Раньше сид
 * брался из `acquaintanceId ?? id`, а он присваивается на первой реплике — оттого лицо
 * и «превращалось» в другого человека, стоило заговорить.
 */
export function portraitIndex(ship: ShipEntity): number {
  // Игрок ВЫБРАЛ лицо в создании персонажа — оно и есть, без хеша имени.
  if (ship.persona.portrait !== undefined) return ship.persona.portrait
  const h = hashString(ship.pilotName || String(ship.id))
  return h % (PORTRAIT_GRID * PORTRAIT_GRID)
}

/** Клетка лица в сетке: столбец/строка из индекса. */
export function portraitCell(index: number): { col: number; row: number } {
  return { col: index % PORTRAIT_GRID, row: Math.floor(index / PORTRAIT_GRID) }
}

/**
 * Транзиентная эмоция по ИСХОДУ разговора: грусть при сдаче/грабеже, радость от
 * сделки. Живёт в UI, не в домене — домен эмоций не знает. Ключ — id борта, гаснет
 * по модельному времени. Ставится из окна разговора, читается портретами везде.
 */
const outcomeEmotion = new Map<number, { emotion: Emotion; at: number }>()
/** Сколько держится эмоция исхода, с модельного времени. */
const OUTCOME_TTL = 6

export function markOutcomeEmotion(shipId: number, emotion: Emotion, time: number): void {
  // Подчищаем протухшее, чтобы Map не рос вечно: борты гибнут, id не переиспользуются,
  // а эмоция исхода живёт лишь `OUTCOME_TTL`. Сметаем только когда накопилось — дёшево.
  if (outcomeEmotion.size > 24) {
    for (const [id, m] of outcomeEmotion) if (time - m.at >= OUTCOME_TTL) outcomeEmotion.delete(id)
  }
  outcomeEmotion.set(shipId, { emotion, at: time })
}

/** Сброс транзиентной эмоции (закрыли разговор — не тащим гримасу в HUD). */
export function clearOutcomeEmotion(shipId: number): void {
  outcomeEmotion.delete(shipId)
}

/**
 * Эмоция из состояния борта — детерминированно, без RNG. Порядок = приоритет:
 * боль (только что попали) → исход разговора (сдался — грусть, сделка — радость) →
 * страх (ломается/уходит прыжком) → злость (враг или обида) → радость (расположен
 * к тебе) → нейтраль.
 */
export function pilotEmotion(ship: ShipEntity, world: World): Emotion {
  if (world.time - ship.lastHitAt < 1) return 'pain'
  const mark = outcomeEmotion.get(ship.id)
  if (mark && world.time - mark.at >= 0 && world.time - mark.at < OUTCOME_TTL) return mark.emotion
  if (ship.ai?.mode === 'evade' || (ship.ai?.warpTimer ?? -1) >= 0) return 'fear'
  if (ship.faction === 'hostile' || (ship.ai?.grievance ?? 0) > 0) return 'anger'
  const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)
  if (rec?.relationship === 'friendly') return 'joy'
  return 'neutral'
}

/**
 * CSS-крой клетки для веба: лист как фон, увеличенный в 6× (клетка занимает бокс),
 * и сдвинутый на нужный столбец/строку. `background-position` в процентах для сетки
 * N делит диапазон на N−1 шагов — оттого `(col / (GRID−1)) * 100`.
 */
export function portraitStyle(species: string, index: number, emotion: Emotion): CSSProperties {
  const { col, row } = portraitCell(index)
  const span = PORTRAIT_GRID - 1
  return {
    backgroundImage: `url(${portraitSheet(species, emotion)})`,
    backgroundSize: `${PORTRAIT_GRID * 100}% ${PORTRAIT_GRID * 100}%`,
    backgroundPosition: `${(col / span) * 100}% ${(row / span) * 100}%`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
  }
}

/**
 * СЛОВО — особый бог, и аватар у него СВОЙ, вне сетки рас: один и тот же космонавт (похожий
 * на Большого Лебовски) в ВОСЬМИ эмоциях, выложенных В ОДИН РЯД на листе `dude.jpg`. Порядок
 * кадров слева направо задан ТЗ. Своя восьмёрка эмоций (не 6 расовых): бог мимике богаче.
 */
export type DivineEmotion =
  | 'neutral' | 'smile' | 'laugh' | 'tired' | 'confusion' | 'surprise' | 'frown' | 'angry'

/**
 * Расовая эмоция (6) → божественная (8). Слово реагирует лицом на ход разговора тем же
 * baseline'ом, что и обычные пилоты (радость от сделки, злость от хамства). Полную восьмёрку
 * (смех, непонимание, удивление порознь) даст отдельное поле `emotion` из ответа модели.
 */
const EMOTION_TO_DIVINE: Record<Emotion, DivineEmotion> = {
  neutral: 'neutral', joy: 'smile', pain: 'tired', anger: 'angry', fear: 'surprise', sadness: 'frown',
}
export function emotionToDivine(e: Emotion): DivineEmotion {
  return EMOTION_TO_DIVINE[e]
}

/** Лист бога: 8 кадров в ряд, `public/dude.jpg`. */
export const DUDE_SHEET = '/dude.jpg'
const DUDE_COLS = 8
const DUDE_ORDER: readonly DivineEmotion[] = [
  'neutral', 'smile', 'laugh', 'tired', 'confusion', 'surprise', 'frown', 'angry',
]

/** CSS-крой кадра бога: лист 800%×100%, сдвиг по столбцу. Неизвестная эмоция → нейтраль (кадр 0). */
export function dudeStyle(emotion: DivineEmotion): CSSProperties {
  const col = Math.max(0, DUDE_ORDER.indexOf(emotion))
  return {
    backgroundImage: `url(${DUDE_SHEET})`,
    backgroundSize: `${DUDE_COLS * 100}% 100%`,
    backgroundPosition: `${(col / (DUDE_COLS - 1)) * 100}% 0%`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
  }
}

/** Кэш листов для HUD-канваса: один `Image` на URL, грузится лениво. */
const sheetCache = new Map<string, HTMLImageElement>()

export function loadSheet(url: string): HTMLImageElement {
  let img = sheetCache.get(url)
  if (!img) {
    img = new Image()
    img.src = url
    sheetCache.set(url, img)
  }
  return img
}

/** Лист догружен и годен к отрисовке (не 404 и не пустой). */
export function sheetReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0
}

/**
 * Прогреть ВСЕ листы портретов разом: 4 расы × 6 эмоций = 24 файла. Любое лицо в игре —
 * это клетка одного из них, поэтому грузить порознь незачем: качаем всё на старте (и на
 * экране создания персонажа лица уже готовы). После этого `useSheetLoading` почти всегда
 * видит `complete` — помехи-прелоадер остаются лишь подстраховкой на холодной загрузке.
 */
export function preloadPortraits(): void {
  const assets = [...new Set(Object.values(SPECIES_ASSET))]
  // Нейтральные — первым проходом: это лицо по умолчанию в списках, контактах и на
  // создании персонажа. Эмоции нужны лишь в разговоре, их догружаем следом.
  for (const asset of assets) loadSheet(`/portraits/${asset}/${EMOTION_FILE.neutral}.png`)
  for (const asset of assets) {
    for (const num of Object.values(EMOTION_FILE)) {
      if (num !== EMOTION_FILE.neutral) loadSheet(`/portraits/${asset}/${num}.png`)
    }
  }
}
