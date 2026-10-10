import {
  AUX_KINDS,
  moduleFault,
  moduleStat,
  slotCategoryOf,
  type Loadout,
  type ModuleKind,
  type ShipModule,
} from '@elite/sim'
import { t, type Key } from '../i18n'
import { UI } from '../theme'
import { ACCENT, DIM } from '../station/chrome'
import { formatStat } from '../station/format'
import { displayName } from '../station/Equipment'

/**
 * Сетка слотов корабля: какие гнёзда есть у корпуса, что в них стоит и как они сгруппированы
 * по назначению. Меняется вместе с раскладкой слотов, а не с действиями над ними.
 */

/** Одна ячейка оснастки: установленный модуль или пустая точка подвески. */
export interface SlotView {
  key: string
  module: ShipModule | null
  hardpointIndex?: number
  optionKinds: ModuleKind[]
  /** Сколько пилонов свёрнуто в эту строку (ракеты) и их суммарный боезапас. */
  ammoTotal?: number
}

export interface CategoryCard {
  cat: string
  subs: SlotView[]
}

/**
 * Перечень слотов корабля — по ЁМКОСТИ корпуса, а не по установленному. Пустой слот
 * не пропадает из сетки, а остаётся плиткой «СВОБОДНО»: снятый модуль иначе некуда
 * вернуть, да и куда ставить новый — было бы не видно.
 *
 * Ракеты НЕ считаются по пилонам: пилоны несут один тип разом («либо одни, либо
 * другие»), поэтому все схлопнуты в одну плитку с суммарным боезапасом.
 * Действия верфи над ней идут по первому пилону — остальные того же вида.
 */
export function buildSlots(loadout: Loadout): SlotView[] {
  const rows: SlotView[] = []

  // Внутренние слоты заданы корпусом (chassis.slots). Раздаём установленные модули
  // по видам; на что не хватило — слот пуст. Порядок слотов — порядок корпуса.
  const pool = [...loadout.internals]
  loadout.chassis.slots.forEach((slot, i) => {
    // Слот сравниваем по КАТЕГОРИИ: аукс-ячейку могут занимать разные виды устройств.
    const idx = pool.findIndex((m) => slotCategoryOf(m.kind) === slot.kind)
    const module = idx >= 0 ? pool.splice(idx, 1)[0]! : null
    // Аукс предлагает ВСЕ свои виды (маскировка/ECM/бомба/скуп/миелофон); прочее — один вид.
    const optionKinds: ModuleKind[] = slot.kind === 'aux' ? [...AUX_KINDS] : [slot.kind]
    rows.push({ key: `int-${i}`, module, optionKinds })
  })

  // Орудийные точки — всегда в сетке, пустые тоже: снял ствол — ставь заново.
  // Ствол — своя строка; пилоны — ОДИН мунишн-слот (ракеты ИЛИ дрон-ракеты, один тип).
  const pylons: number[] = []
  loadout.chassis.hardpoints.forEach((hp, i) => {
    if (hp.kind === 'pylon') {
      pylons.push(i)
      return
    }
    rows.push({ key: `hp-${i}`, module: loadout.weapons[i] ?? null, hardpointIndex: i, optionKinds: ['laser'] })
  })

  // Мунишн — ОДНА плитка над всеми пилонами: один тип (ракеты или дрон), суммарный боезапас.
  // Пусто — плитка «СВОБОДНО», чтобы было куда снарядить. Пилонов нет вовсе — плитки нет.
  // Дрон-ракеты предлагаются тут же, как другой тип: слот принимает и 'missile', и 'drone'.
  const loaded = pylons.filter((i) => loadout.weapons[i])
  if (loaded.length > 0) {
    const ammoTotal = loaded.reduce((sum, i) => sum + moduleStat(loadout.weapons[i]!).value, 0)
    rows.push({
      key: 'missiles',
      module: loadout.weapons[loaded[0]!]!,
      hardpointIndex: loaded[0],
      optionKinds: ['missile', 'drone'],
      ammoTotal,
    })
  } else if (pylons.length > 0) {
    rows.push({ key: 'missiles-empty', module: null, hardpointIndex: pylons[0], optionKinds: ['missile', 'drone'] })
  }

  return rows
}

/** Порядок категорий в сетке — от «сердца» корабля к грузу и допам. */
export const CATEGORY_ORDER = [
  'engine', 'thrusters', 'shield', 'hyperdrive',
  'laser', 'missile', 'armour', 'cargo', 'aux',
] as const

export type SlotCard = (typeof CATEGORY_ORDER)[number]

/**
 * В какую карточку слота попадает вид модуля. Мунишн ('missile'+'drone') → 'missile'
 * (ракеты и дрон-ракеты висят на одних пилонах), аукс-виды → 'aux' (один доп. отсек),
 * прочее — само. Одна раскладка на экран корабля, магазин и справочник: где деталь
 * встанет, там её и ищут.
 */
export function cardOf(kind: ModuleKind): SlotCard {
  if (AUX_KINDS.has(kind)) return 'aux'
  if (kind === 'missile' || kind === 'drone') return 'missile'
  return kind as SlotCard
}

/** Категория слота у карточки — по первому виду: у мунишна их два, но это НЕ аукс. */
function categoryOf(s: SlotView): SlotCard {
  return cardOf(s.optionKinds[0] ?? 'engine')
}

/** Свернуть плоские под-слоты в карточки по КАТЕГОРИИ, в заданном порядке. Пустых нет. */
function groupCards(slots: readonly SlotView[]): CategoryCard[] {
  const cards: CategoryCard[] = []
  for (const cat of CATEGORY_ORDER) {
    const subs = slots.filter((s) => categoryOf(s) === cat)
    if (subs.length > 0) cards.push({ cat, subs })
  }
  return cards
}

/**
 * Оснастка КАРТОЧКАМИ ПО КАТЕГОРИИ: одна карточка на вид оборудования, а внутри —
 * 1–3 под-слота (лазеры, броня, груз, аукс), куда и ставят конкретные штуки. Под-слот
 * пуст — тускло «нет», занят — ярко краткое имя. Клик по под-слоту у причала открывает
 * мастерскую-модалку (выбрать/заменить/снять/купить); в полёте карточки только читают.
 * У груза под под-слотами — сводка суммарного тоннажа.
 */
export function SlotGrid({
  slots,
  onOpen,
  interactive,
  cargoCapacity,
}: {
  /**
   * Вместимость отсека — та же, что у самого отсека (`spec.cargoCapacity`). НЕ сумма
   * контейнеров: оборудование ест грузоподъёмность корпуса своей массой, и сумма
   * контейнеров врала бы — карточка 41 т, а в отсеке 33.
   */
  cargoCapacity: number
  slots: readonly SlotView[]
  onOpen: (key: string) => void
  /** Клик открывает мастерскую только у СВОЕГО борта на верфи. Чужой корпус — на просмотр. */
  interactive: boolean
}) {
  const cards = groupCards(slots)
  return (
    // Плотно: вся оснастка обязана влезть рядом с кораблём без прокрутки.
    <section className="border px-4 py-3" style={{ borderColor: DIM }}>
      <h2 className="mb-2 text-sm tracking-[0.3em]">{t('ship.tab.modules')}</h2>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(({ cat, subs }) => {
          const filled = subs.filter((s) => s.module)
          const cargoTons = cat === 'cargo' ? cargoCapacity : null
          return (
            <div key={cat} className="flex flex-col gap-1 border px-2.5 py-2" style={{ borderColor: DIM }}>
              {/* Шапка карточки: имя категории и «занято/всего», если под-слотов больше одного. */}
              <div className="flex items-baseline justify-between">
                <span className="text-[0.6rem] tracking-[0.2em]" style={{ color: DIM }}>
                  {t(('kind.' + cat) as Key).toUpperCase()}
                </span>
                {subs.length > 1 && (
                  <span className="text-[0.6rem]" style={{ color: DIM }}>
                    {filled.length}/{subs.length}
                  </span>
                )}
              </div>
              {/* Под-слоты: каждая единица — своя строка-кнопка. Пусто — тускло «нет». */}
              {subs.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={interactive ? () => onOpen(s.key) : undefined}
                  className={`flex items-baseline justify-between gap-2 border px-2 py-0.5 text-left transition-colors ${
                    interactive ? 'cursor-pointer hover:border-[#7fd6ff] hover:bg-[#7fd6ff]/10' : 'cursor-default'
                  }`}
                  style={{ borderColor: 'rgba(127,214,255,0.12)' }}
                >
                  <span
                    className="truncate text-xs leading-tight"
                    style={{ color: s.module && moduleFault(s.module) > 0 ? UI.DANGER : s.module ? ACCENT : DIM }}
                  >
                    {s.module ? displayName(s.module) : t('ship.slotEmpty')}
                  </span>
                  {s.module && (
                    // Сломанную деталь метим красным процентом поломки вместо массы —
                    // видно прямо на карточке, какую вести на ремонт, не открывая слот.
                    <span
                      className="shrink-0 text-[0.6rem]"
                      style={{ color: moduleFault(s.module) > 0 ? UI.DANGER : DIM }}
                    >
                      {moduleFault(s.module) > 0
                        ? `−${Math.round(moduleFault(s.module) * 100)}%`
                        : s.ammoTotal !== undefined
                          ? formatStat('ammo', s.ammoTotal)
                          : formatStat('mass', s.module.mass)}
                    </span>
                  )}
                </button>
              ))}
              {/* Груз: суммарный тоннаж установленных отсеков — то, что реально влезет. */}
              {cargoTons !== null && filled.length > 0 && (
                <span className="text-[0.6rem]" style={{ color: DIM }}>
                  {t('ship.cargoTotal', { tons: formatStat('cargo', cargoTons) })}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
