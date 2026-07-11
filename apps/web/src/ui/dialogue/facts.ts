import {
  itemName,
  localSettlement,
  type Persona,
  type Relationship,
  type ShipEntity,
  type Topic,
  type World,
} from '@elite/sim'
import { chassisName, economyName, governmentName, properName, speciesName } from '../i18n/dataNames'

/**
 * СНИМОК МИРА для разговора. Чтобы собеседник не сочинял вселенную из воздуха,
 * ему дают факты: где он, что вокруг, что в трюмах, опасно ли место. Это не сам
 * промпт — это структура; в слова её разворачивает сетевой слой (`negotiator`).
 *
 * Живёт в ui, потому что читает домен и локализует имена (строй, экономика, товар).
 * Ниже по зависимостям сеть не спускаем: `negotiator` в app лишь ПОЛУЧАЕТ этот
 * контекст и историю, а App прокидывает функцию в окно — иначе ui звало бы app.
 */

export interface WorldSnapshot {
  systemName: string
  government: string
  economy: string
  techLevel: number
  species: string
  /** Сколько чего в системе: пилоту-собеседнику это знать положено. */
  planets: number
  moons: number
  stations: number
  bodyNames: string[]
  /** Оценка места одной фразой: спокойно / анархия / рядом стычка. */
  danger: string
  /** Обитаемые миры системы, каждый со СВОИМ строем/экономикой/расой (per-planet). */
  worlds: { name: string; type: string; economy: string; government: string; species: string; populationM: number }[]
}

export interface PartySnapshot {
  name: string
  /** Модель корпуса словом, а не id. */
  ship: string
  persona: Persona
  hullPct: number
  shieldPct: number
  /** Трюм словами: «Руда ×20, Металлы ×10» или «пусто». */
  cargo: string
  /** Роль/намерение: пират, торговец, нанятый эскорт. */
  role: string
}

export interface NegotiationContext {
  world: WorldSnapshot
  /** Собеседник. */
  them: PartySnapshot
  /** Игрок — глазами собеседника. */
  you: PartySnapshot
  /** Куда направляется игрок: цель в системе или намеченный прыжок. */
  yourHeading: string
  distanceM: number
  /** Текущее отношение собеседника к игроку — итог прошлых бесед, если были. */
  stance: Relationship
  /** Что механически можно у него попросить прямо сейчас (незаблокированное). */
  allowedIntents: Topic[]
  /**
   * Встречались ли раньше. Пока всегда false: корабли трафика случайны и мир их
   * не помнит. Поле — задел под будущую память знакомств (репутация, старые долги).
   */
  metBefore: boolean
}

/** Одна реплика ленты. */
export interface ChatTurn {
  who: 'you' | 'them' | 'system'
  text: string
}

/** Ответ переговорщика: слова + пойманное действие. */
export interface NegotiatorReply {
  text: string
  /** Действие, к которому призвал игрок и на которое собеседник дал ответ. */
  intent: Topic | null
  /** Согласился ли на это действие. Значимо лишь при непустом intent. */
  agree: boolean
  /** Сменилось ли отношение по итогу реплики. null — без изменений. */
  stance: Relationship | null
  /** Собеседник кладёт трубку: договорено, надоело или психанул. */
  hangup: boolean
  /** Откуда реплика: живая модель или локальный запас на случай обрыва связи. */
  source: 'model' | 'fallback'
}

const pct = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 100) : 0)

/** Трюм в короткую строку. Больше шести позиций собеседнику ни к чему. */
function holdSummary(ship: ShipEntity): string {
  const items = ship.hold.items
  if (items.length === 0) return 'пусто'
  const shown = items.slice(0, 6).map(itemName)
  return items.length > 6 ? `${shown.join(', ')}…` : shown.join(', ')
}

/** Роль собеседника: чем он занят и как относится к игроку. */
function roleOf(other: ShipEntity, playerId: number): string {
  if (other.faction === 'hostile') return 'пират, вышел на разбой'
  if (other.ai?.escortOf === playerId) return 'нанят тобой в сопровождение'
  return 'мирный торговец на рейсе'
}

function party(ship: ShipEntity, role: string): PartySnapshot {
  return {
    name: ship.name,
    ship: chassisName(ship.loadout.chassis.name),
    persona: ship.persona,
    hullPct: pct(ship.hull, ship.spec.hull.hull),
    shieldPct: pct(ship.shield, ship.spec.hull.shield),
    cargo: holdSummary(ship),
    role,
  }
}

/**
 * Собрать контекст переговоров из мира. `allowedIntents` считает домен
 * (`linesFor` минус заблокированное) и передаёт вызывающий: правило одно.
 */
export function buildContext(world: World, other: ShipEntity, allowedIntents: Topic[]): NegotiationContext {
  const set = localSettlement(world)
  const planets = world.bodies.filter((b) => b.kind === 'planet')
  const moons = world.bodies.filter((b) => b.kind === 'moon')
  const stations = world.bodies.filter((b) => b.kind === 'station')

  const hostiles = world.ships.filter((s) => s.alive && s.faction === 'hostile').length
  const anarchy = /анарх/i.test(set.government)
  const danger =
    hostiles > 0
      ? `неспокойно: рядом враждебных бортов — ${hostiles}`
      : anarchy
        ? 'анархия, закон тут не работает'
        : 'патрулируется, относительно спокойно'

  const record = world.acquaintances.find((a) => a.id === other.acquaintanceId)
  const navBody = world.bodies.find((b) => b.id === world.navTargetId)
  const heading =
    world.jumpTargetIndex != null
      ? 'намечен гиперпрыжок в другую систему'
      : navBody
        ? `идёт к ${properName(navBody.name)}`
        : 'без определённой цели'

  return {
    world: {
      systemName: properName(world.systemName),
      government: governmentName(set.government),
      economy: economyName(set.economy),
      techLevel: set.techLevel,
      species: speciesName(set.species),
      planets: planets.length,
      moons: moons.length,
      stations: stations.length,
      bodyNames: [...planets, ...stations].slice(0, 6).map((b) => properName(b.name)),
      danger,
      // Обитаемые миры — каждый со своим поселением: в одной системе аграрная
      // колония и промышленная столица читаются по-разному, и бот это знает.
      worlds: world.bodies
        .filter((b) => b.settlement)
        .map((b) => ({
          name: properName(b.name),
          type: b.surface ?? '—',
          economy: economyName(b.settlement!.economy),
          government: governmentName(b.settlement!.government),
          species: speciesName(b.settlement!.species),
          populationM: Math.round(b.settlement!.population),
        })),
    },
    them: party(other, roleOf(other, world.player.id)),
    you: party(world.player, 'вольный пилот'),
    yourHeading: heading,
    distanceM: Math.round(other.state.pos.distanceTo(world.player.state.pos)),
    stance: record?.relationship ?? 'neutral',
    allowedIntents,
    // Узнаёт, только если виделись РАНЬШЕ: у записи больше одной встречи. В первый
    // разговор запись родится по ходу дела, но встреча всё ещё первая — не «узнаёт».
    metBefore: (record?.meetings ?? 0) > 1,
  }
}
