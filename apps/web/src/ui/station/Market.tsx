import { buyCommodity, canBuyCommodity, commodityPrice, commodityStock, type World } from '@elite/sim'
import { Button, DIM, Panel, Row } from './chrome'

/**
 * Прилавок. Станция продаёт дороже, чем принимает, поэтому купить и тут же
 * продать — всегда убыток. Прибыль обязана приходить из перевозки между
 * системами; пока их нет, товар покупают ради того, чтобы было что возить.
 */
export function Market({ world, onChange }: { world: World; onChange: () => void }) {
  const player = world.player

  return (
    <Panel title="ТОВАРЫ">
      <p className="mb-4 text-xs" style={{ color: DIM }}>
        Станция берёт наценку. Возить выгодно между системами, а не через прилавок.
        Контрабанда дороже именно потому, что за неё полагается штраф.
      </p>

      <ul className="space-y-1">
        {commodityStock().map((commodity) => {
          const error = canBuyCommodity(world, player, commodity)
          return (
            <Row
              key={commodity.id}
              name={commodity.contraband ? `${commodity.name} ⚠` : commodity.name}
              price={`${commodityPrice(commodity)} кр.`}
              note={`${commodity.unitMass} т`}
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
