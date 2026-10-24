import { AI, PERCEPTION, TARGETING } from '../../config/ai'
import { healthFraction } from '../combat/damage'
import type { Faction, ShipEntity, World } from '../world/entities'
import { knowsOf } from './perception'

/**
 * Кто кому враг. Правило, а не таблица «все против игрока» — иначе полиция
 * никогда не подерётся с пиратами, а бой перестаёт быть частью мира.
 */
export function isHostileTo(a: Faction, b: Faction): boolean {
  if (a === b) return false
  if (a === 'neutral' || b === 'neutral') return false
  // Пираты против всех, кто не пират; полиция и игрок — союзники по умолчанию.
  if (lawful(a) && lawful(b)) return false
  return true
}

const lawful = (f: Faction): boolean => f === 'player' || f === 'police'

/** Фракция для вражды: чужой живой игрок — как игрок (см. `ShipEntity.peer`). */
const factionOf = (s: ShipEntity): Faction => (s.peer ? 'player' : s.faction)

/**
 * Враг ли `other` для `self`: по фракции ИЛИ лично. Личная вражда (`ai.foes`) — то, чего
 * фракции не знают: пират и торговец, отказавший ему в грузе, не воюют фракциями, но
 * воюют друг с другом. Взаимна: достаточно записи у одного из двоих.
 */
export function isFoe(self: ShipEntity, other: ShipEntity): boolean {
  if (isHostileTo(factionOf(self), factionOf(other))) return true
  return (self.ai?.foes.includes(other.id) ?? false) || (other.ai?.foes.includes(self.id) ?? false)
}

/** Важность цели — множитель цены (`TARGETING`): меньше — желаннее. */
function importance(self: ShipEntity, other: ShipEntity, patron: ShipEntity | null, now: number): number {
  const shotMe = self.lastAttackerId === other.id && now - self.lastHitAt < PERCEPTION.FIRE_AWARE
  const shotPatron = patron != null && patron.lastAttackerId === other.id && now - patron.lastHitAt < PERCEPTION.FIRE_AWARE
  const threat = shotMe ? TARGETING.SHOT_ME : shotPatron ? TARGETING.SHOT_PATRON : other.ai?.targetId === self.id ? TARGETING.HUNTS_ME : 1
  // Почти добитого добить: множитель от FINISH (на нуле) до 1 (целый).
  return threat * (TARGETING.FINISH + (1 - TARGETING.FINISH) * healthFraction(other))
}

/**
 * ВРАЖДЕБЕН ЛИ ИГРОКУ — одно понятие для всего, что смотрит со стороны игрока: метки HUD,
 * тон разговора, бомба, «можно ли отлучиться». Пират — по фракции; обиженный мирный — лично
 * (`ai.foes`), а его ФРАКЦИЯ остаётся мирной. Прежде обида переводила торговца во фракцию
 * пиратов: его била полиция, пираты считали своим, он сам выходил грабить, а за его гибель
 * платили награду, как за пирата.
 */
export function hostileToPlayer(world: World, s: ShipEntity): boolean {
  return s !== world.player && (s.faction === 'hostile' || isFoe(s, world.player))
}

/** Записать личную вражду (без дублей). Вторая сторона узнает о ней через `isFoe`. */
export function declareFoe(self: ShipEntity, other: ShipEntity): void {
  const foes = self.ai?.foes
  if (foes && !foes.includes(other.id)) foes.push(other.id)
}

/**
 * Цель — враг, о котором бот ЗНАЕТ (видит по прямой или только что получил от него), с
 * наименьшей ЦЕНОЙ: дистанция × важность (`TARGETING`). Стрелок по мне или по нанимателю,
 * охотник за мной, почти добитый — дешевле прочих. Прилипание к текущей цели намеренное:
 * бот, каждый кадр меняющий жертву, не доводит ни одной атаки до конца.
 */
export function selectTarget(self: ShipEntity, world: World): ShipEntity | null {
  const current = self.ai?.targetId ?? null
  const patronId = self.ai?.escortOf ?? null
  const patron = patronId == null ? null : patronId === world.player.id ? world.player : (world.ships.find((s) => s.id === patronId) ?? null)

  let best: ShipEntity | null = null
  let bestDistance = Infinity

  // Игрок (индекс −1) и борта — без склейки в новый массив: выбор цели идёт у каждого бота
  // в такте размышления, и `[player, ...ships]` плодил по массиву на бот.
  for (let i = world.player.alive ? -1 : 0; i < world.ships.length; i++) {
    const other = i < 0 ? world.player : world.ships[i]!
    if (other === self || !other.alive) continue
    if (!isFoe(self, other)) continue
    // Замаскированного и стыкующегося не видит; за планетой — не видит, пока тот не стреляет.
    if (!knowsOf(self, other, world)) continue

    const distance = other.state.pos.distanceTo(self.state.pos)
    // Стрелок, которого чувствуешь, может быть и за радиусом: от него не отмахиваются.
    const effective = Math.min(distance, AI.AWARENESS)

    // Текущей цели даём фору: менять её стоит только ради заметно более важной.
    const bias = other.id === current ? AI.TARGET_STICKINESS : 1
    const cost = effective * bias * importance(self, other, patron, world.time)
    if (cost < bestDistance) {
      bestDistance = cost
      best = other
    }
  }
  return best
}
