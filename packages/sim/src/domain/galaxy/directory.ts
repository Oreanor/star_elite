import { SYSTEM_FEATURES, hasFeature, type SystemFeature } from './features'
import { distanceLy, type Spot3 } from './shape'
import { canDock, capitalOf, isSettled, moduleClassAvailable, type StarSystem } from './types'

/**
 * ЗВЁЗДНЫЙ СПРАВОЧНИК — что станция знает о галактике за пределами своей системы. Диспетчер
 * держит полную правду о своей округе, но на «где ближайший высокий тех», «где квазар» прежде
 * разводил руками: его знание кончалось на краю системы. Каталог звёзд у станции есть (по нему
 * считают прыжки), и навигационная служба отвечает по нему — тем же фактам, что видит карта.
 *
 * Чистая выборка из каталога: без рендера, без слов. Слова и перевод имён — у слоя связи.
 */

/** Карточка системы для справки: только то, за чем летят. */
export interface DirectoryEntry {
  index: number
  name: string
  /** От текущей системы, св.г. */
  ly: number
  /** Высший тех-уровень её миров; 0 — необитаема. */
  maxTech: number
  /** Высший класс железа на её причалах; 0 — причалов нет. */
  gearClass: number
  canDock: boolean
  /** Столица — самый населённый мир: её строй, экономика, раса. null — необитаема. */
  capital: { government: string; economy: string; species: string; populationM: number } | null
  features: SystemFeature[]
  /**
   * Самый развитый мир системы — ИМЕННО куда лететь: «планета покруче» называется по имени,
   * с причалом, если он есть. null — обитаемых нет.
   */
  best: { planet: string; tech: number; station: string | null } | null
}

/** Ближайшая система с признаком — «где ближайший …». */
export interface DirectoryNotable {
  /** Особенность звезды или `topTech` — тех не ниже `DIRECTORY.TOP_TECH`. */
  what: SystemFeature | 'topTech'
  entry: DirectoryEntry
}

export interface GalaxyDirectory {
  /** Соседи по близости — без текущей системы. */
  near: DirectoryEntry[]
  /** Ближайшая система каждого рода, где бы она ни была. Рода, которого в галактике нет, тут нет. */
  notable: DirectoryNotable[]
}

/** Порог «высокого теха»: с него на причалах железо класса 4 (`moduleClassAvailable`). */
export const DIRECTORY = {
  TOP_TECH: 13,
  NEAR: 12,
} as const

function entryOf(system: StarSystem, from: Spot3, galaxySeed: number): DirectoryEntry {
  let maxTech = 0
  let gearClass = 0
  for (const p of system.planets) {
    if (isSettled(p)) maxTech = Math.max(maxTech, p.settlement.techLevel)
    gearClass = Math.max(gearClass, moduleClassAvailable(p))
  }
  const cap = capitalOf(system)
  let best: DirectoryEntry['best'] = null
  for (const p of system.planets) {
    if (!isSettled(p) || (best && best.tech >= p.settlement.techLevel)) continue
    best = { planet: p.name, tech: p.settlement.techLevel, station: p.station?.name ?? null }
  }
  return {
    best,
    index: system.index,
    name: system.name,
    ly: Math.round(distanceLy(from, system) * 10) / 10,
    maxTech,
    gearClass,
    canDock: canDock(system),
    capital: cap
      ? {
          government: cap.settlement.government,
          economy: cap.settlement.economy,
          species: cap.settlement.species,
          populationM: cap.settlement.population,
        }
      : null,
    features: SYSTEM_FEATURES.filter((f) => hasFeature(system, f, galaxySeed)),
  }
}

/**
 * Собрать справку от системы `here` по каталогу `systems` (с правками бога — их наносит
 * вызывающий через `applyDelta`). Один проход по каталогу: ближайшие и рекорды разом.
 */
export function galaxyDirectory(systems: readonly StarSystem[], here: number, galaxySeed: number, nearCount: number = DIRECTORY.NEAR): GalaxyDirectory {
  const home = systems.find((s) => s.index === here)
  if (!home) return { near: [], notable: [] }

  const byDistance = systems
    .filter((s) => s.index !== here)
    .map((s) => ({ s, d: distanceLy(home, s) }))
    .sort((a, b) => a.d - b.d)

  const near = byDistance.slice(0, nearCount).map(({ s }) => entryOf(s, home, galaxySeed))

  const notable: DirectoryNotable[] = []
  const wanted: (SystemFeature | 'topTech')[] = ['topTech', ...SYSTEM_FEATURES]
  for (const what of wanted) {
    const found = byDistance.find(({ s }) =>
      what === 'topTech'
        ? s.planets.some((p) => isSettled(p) && p.settlement.techLevel >= DIRECTORY.TOP_TECH)
        : hasFeature(s, what, galaxySeed),
    )
    if (found) notable.push({ what, entry: entryOf(found.s, home, galaxySeed) })
  }
  return { near, notable }
}

/** Имя для сравнения: без кавычек и регистра, ё как е. */
function plain(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/[«»"'“”„]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Система по ИМЕНИ, как её назвал второй пилот. Сперва точное совпадение, потом вхождение;
 * имена в галактике повторяются — берём ближайшую к `here`. null — такой нет.
 */
export function findSystemByName(systems: readonly StarSystem[], name: string, here: number): number | null {
  const want = plain(name)
  if (!want) return null
  const home = systems.find((s) => s.index === here)
  const near = (list: readonly StarSystem[]): number | null => {
    let best: StarSystem | null = null
    let bestD = Infinity
    for (const s of list) {
      const d = home ? distanceLy(home, s) : 0
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best ? best.index : null
  }
  const exact = systems.filter((s) => plain(s.name) === want)
  if (exact.length > 0) return near(exact)
  return near(systems.filter((s) => plain(s.name).includes(want) || want.includes(plain(s.name))))
}
