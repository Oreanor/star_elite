import { cargoMass, cargoValue, itemName, itemValue, sellCargo, sellItem, type World } from '@elite/sim'
import { Button, DIM, Panel, Row } from './chrome'

/**
 * Трюм. Здесь трофеи превращаются в деньги: снятое с пирата досталось даром,
 * поэтому продаётся по каталогу — без наценки, но и без скидки.
 *
 * Продажа поштучная, а не только «всё разом»: контрабанду иногда выгоднее
 * довезти до другой системы, а лом сбыть немедленно.
 */
export function Hold({ world, onChange }: { world: World; onChange: () => void }) {
  const player = world.player
  const used = cargoMass(player.hold)
  const total = cargoValue(player)

  return (
    <Panel title="ТРЮМ">
      <p className="mb-4 text-xs" style={{ color: DIM }}>
        Занято {used.toFixed(1)} из {player.hold.capacity.toFixed(1)} т · груз на борту стоит {total} кр.
        Тонны в трюме режут ускорения — это считается, а не назначается.
      </p>

      {player.hold.items.length === 0 ? (
        <p className="text-sm" style={{ color: DIM }}>
          Пусто. Сбей пирата и подбери контейнер — он подберётся сам, если подойти тихо.
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {player.hold.items.map((item, index) => (
              <Row
                // Индекс в ключе намеренно: одинаковые товары уже сложены в одну стопку,
                // а разные модули различаются именем. Ключ обязан пережить продажу соседа.
                key={`${itemName(item)}-${index}`}
                name={itemName(item)}
                price={`${itemValue(item)} кр.`}
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
            ))}
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
