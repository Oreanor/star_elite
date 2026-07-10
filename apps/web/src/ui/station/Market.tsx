import {
  buyCommodity,
  canBuyCommodity,
  commodityBuyPrice,
  commodityStock,
  commodityStockAt,
  type Commodity,
  type World,
} from '@elite/sim'
import { Button, DIM, Panel, Row } from './chrome'

/**
 * Прилавок. Цена выведена из уровня развития системы и её строя плюс запаса на
 * складе — не назначена вручную. Дёшево там, где товар производят; дорого, где
 * его ввозят. Возить выгодно между системами, а не через этот же прилавок:
 * покупка выше продажи на спред.
 */
export function Market({ world, onChange }: { world: World; onChange: () => void }) {
  const player = world.player

  return (
    <Panel title="ТОВАРЫ">
      <p className="mb-4 text-xs" style={{ color: DIM }}>
        Цена — от развития системы, строя и запаса. Мало на складе дороже, много дешевле.
        Прибыль в перевозке: бери там, где дёшево, вези туда, где дорого.
      </p>

      <ul className="space-y-1">
        {commodityStock().map((commodity) => {
          const error = canBuyCommodity(world, player, commodity)
          const price = commodityBuyPrice(world, commodity)
          const stockN = commodityStockAt(world, commodity)
          return (
            <Row
              key={commodity.id}
              name={commodity.contraband ? `${commodity.name} ⚠` : commodity.name}
              price={`${price} кр.`}
              note={priceHint(commodity, price, stockN)}
            >
              <Button
                small
                disabled={error !== null}
                onClick={() => {
                  if (buyCommodity(world, player, commodity, 1) > 0) onChange()
                }}
              >
                {error === 'no-money' ? 'НЕТ ДЕНЕГ' : error === 'no-room' ? 'ТРЮМ ПОЛОН' : 'КУПИТЬ'}
              </Button>
            </Row>
          )
        })}
      </ul>
    </Panel>
  )
}

/** «дёшево / дорого» относительно каталога + сколько на складе — весь сигнал рынка в строке. */
function priceHint(commodity: Commodity, price: number, stock: number): string {
  const ratio = price / commodity.basePrice
  const tag = ratio < 0.95 ? 'дёшево' : ratio > 1.3 ? 'дорого' : '·'
  return `${commodity.unitMass} т · ${tag} · на складе ${stock}`
}
