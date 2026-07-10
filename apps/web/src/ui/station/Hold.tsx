import {
  holdSellValue,
  itemName,
  itemSellValue,
  sellCargo,
  sellItem,
  type CargoItem,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { Button, DIM, Panel, Row } from './chrome'

/**
 * Трюм. Цена продажи — местная, рыночная: тот же груз в другой системе стоит иначе.
 * У каждой позиции помечена ВЫГОДА, если её покупали: выручка минус уплаченное,
 * зелёным в плюс, красным в минус. Добыча и трофеи достались даром — у них цены
 * входа нет, они идут как находка и вся выручка в плюс.
 */
export function Hold({ world, onChange }: { world: World; onChange: () => void }) {
  const player = world.player
  const total = holdSellValue(world, player)

  return (
    <Panel title="ТРЮМ">
      {player.hold.items.length === 0 ? (
        <p className="text-sm" style={{ color: DIM }}>
          Пусто. Сбей пирата и подбери контейнер — он подберётся сам, если подойти тихо.
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {player.hold.items.map((item, index) => {
              const revenue = itemSellValue(world, item)
              const mark = profitMark(item, revenue)
              return (
                <Row
                  // Индекс в ключе намеренно: одинаковые товары уже сложены в одну стопку,
                  // а разные модули различаются именем. Ключ обязан пережить продажу соседа.
                  key={`${itemName(item)}-${index}`}
                  name={itemName(item)}
                  price={`${revenue} кр.`}
                  note={mark.text}
                  noteColor={mark.color}
                >
                  <Button
                    small
                    onClick={() => {
                      if (sellItem(world, player, index) > 0) onChange()
                    }}
                  >
                    ПРОДАТЬ
                  </Button>
                </Row>
              )
            })}
          </ul>

          <Button
            onClick={() => {
              if (sellCargo(world, player) > 0) onChange()
            }}
          >
            ПРОДАТЬ ВСЁ ЗА {total} КР.
          </Button>
        </>
      )}
    </Panel>
  )
}

/**
 * Пометка выгоды на позиции. Куплено — показываем абсолютный выигрыш/проигрыш от
 * продажи ЗДЕСЬ. Не куплено (добыча, трофейный модуль) — «находка»: сравнивать не с чем.
 */
function profitMark(item: CargoItem, revenue: number): { text: string; color: string } {
  const basis = item.kind === 'commodity' ? item.costBasis : undefined
  if (basis === undefined) return { text: 'находка', color: DIM }

  const profit = revenue - basis
  const sign = profit >= 0 ? '+' : '−'
  return { text: `${sign}${Math.abs(profit)} кр.`, color: profit >= 0 ? UI.ALLY : UI.DANGER }
}
