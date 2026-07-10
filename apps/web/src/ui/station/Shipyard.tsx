import {
  MODULE_CATALOGUE,
  buy,
  canBuy,
  hardpointIndices,
  isWeapon,
  priceOf,
  stock,
  type PurchaseError,
  type ShipModule,
  type World,
} from '@elite/sim'
import { Button, DIM, Panel, Row } from './chrome'

/** Верфь: железо. Апгрейд вытесняет установленное и возвращает часть цены. */
export function Shipyard({ world, onChange }: { world: World; onChange: () => void }) {
  const player = world.player

  const catalogue = stock(MODULE_CATALOGUE)
  const pylons = hardpointIndices(player.loadout, 'pylon')
  const guns = hardpointIndices(player.loadout, 'gun')

  /** Куда встанет оружие: первая подходящая точка подвески. */
  const slotFor = (module: ShipModule): number | undefined => {
    if (!isWeapon(module)) return undefined
    const points = module.kind === 'missile' ? pylons : guns
    // Пустая точка предпочтительнее занятой: не выбрасываем то, что уже стоит.
    return points.find((i) => !player.loadout.weapons[i]) ?? points[0]
  }

  return (
    <Panel title="ВЕРФЬ">
      <p className="mb-4 text-xs" style={{ color: DIM }}>
        Масса {player.spec.mass.toFixed(1)} т · тяга {player.spec.tuning.THRUST} кН · разворот{' '}
        {player.spec.tuning.PITCH_RATE.toFixed(2)} рад/с. Тяжёлое железо режет манёвренность —
        это считается, а не назначается.
      </p>

      <ul className="space-y-1">
        {catalogue.map((module) => {
          const error = canBuy(world, player, module, slotFor(module))
          return (
            <Row key={module.id} name={module.name} price={`${priceOf(module)} кр.`} note={`${module.mass} т`}>
              <Button
                small
                disabled={error !== null}
                onClick={() => {
                  if (buy(world, player, module, slotFor(module)) === null) onChange()
                }}
              >
                {error === null ? 'КУПИТЬ' : label(error)}
              </Button>
            </Row>
          )
        })}
      </ul>
    </Panel>
  )
}

function label(error: PurchaseError): string {
  if (error === 'no-money') return 'НЕТ ДЕНЕГ'
  if (error === 'already-installed') return 'УЖЕ СТОИТ'
  if (error === 'class-too-large') return 'НЕ ВЛЕЗЕТ'
  if (error === 'no-hardpoint') return 'НЕТ ПОДВЕСКИ'
  return 'НЕ ТОТ СЛОТ'
}
