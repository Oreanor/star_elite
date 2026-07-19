import {
  addCommodity,
  addFigurineSpecimens,
  COMMODITIES,
  freeCapacity,
  type CargoHold,
  type Commodity,
  type FigurineSpecimen,
} from '../cargo'
import type { ShipEntity, World } from '../world/entities'

/**
 * СДЕЛКА словами: передача товара и/или денег по итогу разговора.
 *
 * Модель ловит договорённость и описывает её этим объектом — а ДВИГАЕТ добро домен.
 * Направление `direction` — куда идёт ГРУЗ (и одиночные кредиты):
 *   `toYou`  — игрок получает, `toThem` — игрок отдаёт.
 *
 * Если в одной сделке и груз, и кредиты — это ПОКУПКА/ПРОДАЖА: деньги идут
 * НАВСТРЕЧУ грузу. Иначе одной командой нельзя купить статуэтку («груз тебе,
 * кредиты от тебя»). Сделка атомарна: не влезло / не хватило денег — ничего.
 *
 * Деньги собеседника «забортные»: его доля появляется или исчезает у игрока.
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
  /** true — кредиты списаны с игрока (покупка); false — зачислены ему. */
  creditsFromPlayer: boolean
}

function commodityById(id: string): Commodity | null {
  for (const c of Object.values(COMMODITIES)) if (c.id === id) return c
  return null
}

/** Сколько единиц товара влезет получателю. Масса 0 (статуэтки) — без лимита по тоннам. */
function roomFor(hold: CargoHold, commodity: Commodity, want: number): number {
  if (commodity.unitMass <= 0) return want
  return Math.floor(freeCapacity(hold) / commodity.unitMass)
}

/** Снять до `want` обычных единиц. Возвращает снятое; costBasis режется по доле. */
function takeCommodity(hold: CargoHold, commodity: Commodity, want: number): number {
  let taken = 0
  for (let i = hold.items.length - 1; i >= 0 && taken < want; i--) {
    const it = hold.items[i]!
    if (it.kind !== 'commodity' || it.commodity.id !== commodity.id) continue
    const n = Math.min(it.units, want - taken)
    if (it.costBasis !== undefined && it.units > 0) it.costBasis *= (it.units - n) / it.units
    it.units -= n
    taken += n
    if (it.units <= 0) hold.items.splice(i, 1)
  }
  return taken
}

/**
 * Снять статуэтки вместе с экземплярами (имена/облик). Без `specimens` —
 * безымянный слот: иначе старый сейв нельзя было бы передать вовсе.
 */
function takeFigurineSpecimens(hold: CargoHold, want: number): FigurineSpecimen[] {
  const out: FigurineSpecimen[] = []
  for (let i = hold.items.length - 1; i >= 0 && out.length < want; i--) {
    const it = hold.items[i]!
    if (it.kind !== 'commodity' || it.commodity.id !== COMMODITIES.FIGURINE.id) continue
    while (it.units > 0 && out.length < want) {
      const spec = it.specimens?.shift()
      out.push(
        spec ?? {
          titleId: 'mercy',
          variant: 0,
          radius: 10_000,
        },
      )
      it.units -= 1
    }
    if (it.units <= 0) hold.items.splice(i, 1)
  }
  return out
}

function countCommodity(hold: CargoHold, commodityId: string): number {
  let n = 0
  for (const it of hold.items) {
    if (it.kind === 'commodity' && it.commodity.id === commodityId) n += it.units
  }
  return n
}

/** Применить сделку. Возвращает, что РЕАЛЬНО перешло, — окно покажет это в ленте. */
export function applyTransfer(world: World, ship: ShipEntity, t: Transfer): TransferResult {
  const player = world.player
  const result: TransferResult = {
    direction: t.direction,
    commodityName: null,
    units: 0,
    credits: 0,
    creditsFromPlayer: false,
  }

  const commodity = t.commodityId ? commodityById(t.commodityId) : null
  const wantUnits = commodity ? Math.max(0, Math.floor(t.units ?? 0)) : 0
  const wantCredits = Math.max(0, Math.floor(t.credits ?? 0))
  // Груз + деньги в одном объекте = купля/продажа: оплата против потока груза.
  const trade = wantUnits > 0 && wantCredits > 0 && commodity != null

  if (commodity && wantUnits > 0) {
    const from = t.direction === 'toThem' ? player.hold : ship.hold
    const to = t.direction === 'toThem' ? ship.hold : player.hold
    const available = countCommodity(from, commodity.id)
    const room = roomFor(to, commodity, wantUnits)
    const canMove = Math.min(wantUnits, available, room)

    if (trade) {
      // Покупка (toYou): платит игрок. Продажа (toThem): платит бот (кредиты «из воздуха»).
      const playerPays = t.direction === 'toYou'
      if (playerPays && world.credits < wantCredits) return result
      if (canMove < wantUnits) return result // атомарно: меньше обещанного — ничего

      if (commodity.id === COMMODITIES.FIGURINE.id) {
        const specs = takeFigurineSpecimens(from, wantUnits)
        if (specs.length < wantUnits) return result
        addFigurineSpecimens(to, specs)
      } else {
        const moved = takeCommodity(from, commodity, wantUnits)
        if (moved < wantUnits) return result
        addCommodity(to, commodity, moved)
      }
      result.commodityName = commodity.name
      result.units = wantUnits

      if (playerPays) {
        world.credits -= wantCredits
        result.credits = wantCredits
        result.creditsFromPlayer = true
      } else {
        world.credits += wantCredits
        result.credits = wantCredits
        result.creditsFromPlayer = false
      }
      return result
    }

    // Только груз — как раньше (дар / конфискация).
    if (commodity.id === COMMODITIES.FIGURINE.id) {
      const specs = takeFigurineSpecimens(from, canMove)
      if (specs.length > 0) {
        addFigurineSpecimens(to, specs)
        result.commodityName = commodity.name
        result.units = specs.length
      }
    } else {
      const moved = takeCommodity(from, commodity, canMove)
      if (moved > 0) {
        addCommodity(to, commodity, moved)
        result.commodityName = commodity.name
        result.units = moved
      }
    }
  }

  if (wantCredits > 0 && !trade) {
    if (t.direction === 'toThem') {
      const paid = Math.min(wantCredits, world.credits)
      world.credits -= paid
      result.credits = paid
      result.creditsFromPlayer = true
    } else {
      world.credits += wantCredits
      result.credits = wantCredits
      result.creditsFromPlayer = false
    }
  }
  return result
}
