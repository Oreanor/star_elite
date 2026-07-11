import { addCommodity, COMMODITIES, freeCapacity, type CargoHold, type Commodity } from '../cargo'
import type { ShipEntity, World } from '../world/entities'

/**
 * СДЕЛКА словами: передача товара и/или денег по итогу разговора.
 *
 * Модель ловит договорённость (отдал груз, вернул, откупился, выпросил, отдал долю
 * с продажи, «именем закона») и описывает её этим объектом — а ДВИГАЕТ добро домен,
 * детерминированно, как и всякий исход. Согласие взвешивает характер собеседника;
 * домен же следит лишь за тем, чтобы товар не родился из воздуха и счёт не ушёл в
 * минус: переносим ровно столько, сколько ЕСТЬ у отправителя и ВЛЕЗАЕТ получателю.
 *
 * Направление — относительно ИГРОКА: `toThem` — игрок отдаёт, `toYou` — получает.
 * Деньги собеседника «забортные»: он торгует где-то ещё, и его доля/оплата просто
 * появляется или исчезает у игрока — свой кошелёк боту не заводим.
 */

export type TransferDirection = 'toThem' | 'toYou'

export interface Transfer {
  direction: TransferDirection
  /** id товара из COMMODITIES, если двигается груз. */
  commodityId?: string | null
  units?: number
  credits?: number
}

export interface TransferResult {
  direction: TransferDirection
  commodityName: string | null
  /** Сколько единиц товара реально перешло (могло быть меньше обещанного). */
  units: number
  /** Сколько кредитов реально перешло. */
  credits: number
}

function commodityById(id: string): Commodity | null {
  for (const c of Object.values(COMMODITIES)) if (c.id === id) return c
  return null
}

/** Снять до `want` единиц товара из трюма. Возвращает снятое, режет costBasis по доле. */
function takeCommodity(hold: CargoHold, commodity: Commodity, want: number): number {
  let taken = 0
  for (let i = hold.items.length - 1; i >= 0 && taken < want; i--) {
    const it = hold.items[i]!
    if (it.kind !== 'commodity' || it.commodity.id !== commodity.id) continue
    const n = Math.min(it.units, want - taken)
    // Уходит доля стопки — уходит и доля уплаченного за неё: иначе на остатке
    // прибыль посчиталась бы завышенной.
    if (it.costBasis !== undefined && it.units > 0) it.costBasis *= (it.units - n) / it.units
    it.units -= n
    taken += n
    if (it.units <= 0) hold.items.splice(i, 1)
  }
  return taken
}

/** Применить сделку. Возвращает, что РЕАЛЬНО перешло, — окно покажет это в ленте. */
export function applyTransfer(world: World, ship: ShipEntity, t: Transfer): TransferResult {
  const player = world.player
  const result: TransferResult = { direction: t.direction, commodityName: null, units: 0, credits: 0 }

  const commodity = t.commodityId ? commodityById(t.commodityId) : null
  const wantUnits = commodity ? Math.max(0, Math.floor(t.units ?? 0)) : 0
  if (commodity && wantUnits > 0) {
    const from = t.direction === 'toThem' ? player.hold : ship.hold
    const to = t.direction === 'toThem' ? ship.hold : player.hold
    // Не больше, чем влезет получателю по массе, и не больше, чем есть у отправителя.
    const roomUnits = Math.floor(freeCapacity(to) / commodity.unitMass)
    const moved = takeCommodity(from, commodity, Math.min(wantUnits, roomUnits))
    if (moved > 0) {
      addCommodity(to, commodity, moved)
      result.commodityName = commodity.name
      result.units = moved
    }
  }

  const wantCredits = Math.max(0, Math.floor(t.credits ?? 0))
  if (wantCredits > 0) {
    if (t.direction === 'toThem') {
      const paid = Math.min(wantCredits, world.credits) // в минус счёт не уводим
      world.credits -= paid
      result.credits = paid
    } else {
      world.credits += wantCredits
      result.credits = wantCredits
    }
  }
  return result
}
