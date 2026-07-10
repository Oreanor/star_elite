import { useState } from 'react'
import { findStation, undock, type World } from '@elite/sim'
import { Button, DIM, ACCENT, Tabs } from './chrome'
import { Hold } from './Hold'
import { Market } from './Market'
import { Service } from './Service'
import { Shipyard } from './Shipyard'

/**
 * Меню станции. Единственный экран, где React уместен: мир стоит, кадров нет,
 * а списки и цены — ровно то, ради чего он придуман.
 *
 * Здесь только композиция: панели не знают друг о друге, а этот файл не знает
 * их правил. Состояние живёт в мире, не в React. `version` — счётчик перерисовок:
 * покупка мутирует мир, и React про это узнать иначе не может. Это честнее, чем
 * копировать снаряжение корабля в стейт и потом синхронизировать обратно.
 *
 * Панели разложены по вкладкам, а не свалены в один свиток: четыре подряд не
 * помещались на экран, и «ОТЧАЛИТЬ» приходилось искать прокруткой.
 */

const TABS = ['РЕМОНТ', 'АПГРЕЙД', 'ТОРГОВЛЯ'] as const
type Tab = (typeof TABS)[number]

interface Props {
  world: World
  onUndock: () => void
}

export function StationMenu({ world, onUndock }: Props) {
  const [version, bump] = useState(0)
  const [tab, setTab] = useState<Tab>('РЕМОНТ')
  const onChange = () => bump(version + 1)

  const station = findStation(world)

  return (
    <div className="absolute inset-0 overflow-auto bg-black/90 font-mono" style={{ color: ACCENT }}>
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="text-3xl tracking-[0.35em]">{station?.name ?? 'СТАНЦИЯ'}</h1>
        <p className="mt-1 text-sm tracking-widest" style={{ color: DIM }}>
          СИСТЕМА {world.systemName.toUpperCase()} · КРЕДИТОВ {world.credits.toLocaleString('ru')}
        </p>

        <Tabs tabs={TABS} active={tab} onSelect={setTab} />

        {tab === 'РЕМОНТ' && <Service world={world} onChange={onChange} />}
        {tab === 'АПГРЕЙД' && <Shipyard world={world} onChange={onChange} />}
        {/* Торговля — это две половины одной сделки: прайс станции и то, что в трюме.
            Разносить их по вкладкам значило бы заставить пилота помнить цены наизусть. */}
        {tab === 'ТОРГОВЛЯ' && (
          <>
            <Market world={world} onChange={onChange} />
            <Hold world={world} onChange={onChange} />
          </>
        )}

        <div className="mt-8 flex justify-end">
          <Button
            onClick={() => {
              undock(world)
              onUndock()
            }}
          >
            ОТЧАЛИТЬ
          </Button>
        </div>
      </div>
    </div>
  )
}
