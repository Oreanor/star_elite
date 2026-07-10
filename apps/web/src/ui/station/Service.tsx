import { hullDamage, missingRounds, rearm, rearmCost, repair, repairCost, type World } from '@elite/sim'
import { Button, DIM, Panel } from './chrome'

/**
 * Ремонт и боезапас — две услуги, а не два экрана.
 *
 * Щит здесь не чинят: он восстанавливается сам, и брать за это деньги значило бы
 * продавать время. Ракеты, наоборот, расходник: пусковая остаётся на пилоне,
 * кончается только боекомплект, и без пополнения это оружие на один вылет.
 */
export function Service({ world, onChange }: { world: World; onChange: () => void }) {
  const player = world.player

  const damage = hullDamage(player)
  const cost = repairCost(player)
  const canRepair = damage > 0 && world.credits >= cost

  const rounds = missingRounds(player)
  const rearmPrice = rearmCost(player)
  const canRearm = rounds > 0 && world.credits >= rearmPrice

  return (
    <Panel title="РЕМОНТ И БОЕЗАПАС">
      <p className="text-sm" style={{ color: DIM }}>
        Корпус {Math.round(player.hull)} / {player.spec.hull.hull}
        {damage > 0 ? ` · починка ${cost} кр.` : ' · повреждений нет'}
      </p>

      <p className="mt-1 text-sm" style={{ color: DIM }}>
        {rounds > 0 ? `Не хватает ракет: ${rounds} · пополнить ${rearmPrice} кр.` : 'Пилоны снаряжены'}
      </p>

      <div className="flex gap-3">
        <Button
          disabled={!canRepair}
          onClick={() => {
            if (repair(world, player)) onChange()
          }}
        >
          {damage > 0 ? 'ПОЧИНИТЬ КОРПУС' : 'КОРПУС ЦЕЛ'}
        </Button>

        <Button
          disabled={!canRearm}
          onClick={() => {
            if (rearm(world, player)) onChange()
          }}
        >
          {rounds > 0 ? 'ПОПОЛНИТЬ РАКЕТЫ' : 'РАКЕТЫ НА МЕСТЕ'}
        </Button>
      </div>
    </Panel>
  )
}
