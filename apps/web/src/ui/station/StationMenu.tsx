import { useReducer, useState } from 'react'
import { findStation, localSettlement, undock, type World } from '@elite/sim'
import { currentLang, t, useLang, type Key } from '../i18n'
import { speciesName } from '../i18n/dataNames'
import { ACCENT, Button, Column, DIM, Panel, Table } from './chrome'
import { Hold } from './Hold'
import { Market } from './Market'
import { ShipScreen } from '../ship/ShipScreen'

/**
 * Экран станции. По умолчанию — НЕ меню, а «где я причалил»: имя мира и его паспорт
 * (экономика, строй, тех-уровень, население). Верфь, магазин и карты — то, КУДА
 * с этого экрана уходят, а не первое, что видит пилот.
 *
 * Здесь только композиция и навигация. Правил панели не знают друг о друге; мир
 * мутируют лишь через домен, а `bump` перерисовывает то, что от мира зависит
 * (кредиты после сделки). Это честнее, чем копировать состояние корабля в React.
 *
 * Карты — те же компоненты, что и в полёте: станция их не переписывает, а лишь
 * просит App открыть (`onOpenMap`). Прыгать из дока нельзя, но выбрать курс — да.
 */
export function StationMenu({
  world,
  onUndock,
  onOpenMap,
}: {
  world: World
  onUndock: () => void
  onOpenMap: (which: 'system' | 'galaxy') => void
}) {
  useLang()
  const [view, setView] = useState<'home' | 'ship' | 'shop'>('home')
  const [, bump] = useReducer((n: number) => n + 1, 0)

  // Верфь — тот же ShipScreen, только у причала: полный оверлей поверх меню.
  if (view === 'ship') {
    return <ShipScreen world={world} docked onClose={() => setView('home')} />
  }

  const station = findStation(world)
  const credits = world.credits.toLocaleString(currentLang() === 'ru' ? 'ru' : 'en-US')

  return (
    <div className="absolute inset-0 overflow-auto bg-black/90 font-mono" style={{ color: ACCENT }}>
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="text-3xl tracking-[0.35em]">{station?.name ?? t('station.title')}</h1>
        <p className="mt-1 text-sm tracking-widest" style={{ color: DIM }}>
          {t('station.system')} {world.systemName.toUpperCase()} · {t('station.credits')} {credits}
        </p>

        {view === 'shop' ? (
          <>
            <div className="mt-6">
              <Button small onClick={() => setView('home')}>
                {t('menu.back')}
              </Button>
            </div>
            <Market world={world} onChange={bump} />
            <Hold world={world} onChange={bump} atStation />
          </>
        ) : (
          <>
            <LocationReadout world={world} />

            <nav className="mt-6 flex flex-wrap gap-3">
              <Button small onClick={() => setView('ship')}>
                {t('station.nav.ship')}
              </Button>
              <Button small onClick={() => setView('shop')}>
                {t('station.nav.shop')}
              </Button>
              <Button small onClick={() => onOpenMap('system')}>
                {t('station.nav.system')}
              </Button>
              <Button small onClick={() => onOpenMap('galaxy')}>
                {t('station.nav.galaxy')}
              </Button>
            </nav>

            <div className="mt-8 flex justify-end">
              <Button
                onClick={() => {
                  undock(world)
                  onUndock()
                }}
              >
                {t('station.undock')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface Fact {
  key: string
  label: string
  value: string
}

/** Паспорт мира: экономика/строй локализуются, тех-уровень и население — числа. */
function LocationReadout({ world }: { world: World }) {
  const s = localSettlement(world)
  const population = Math.round(s.population * 10) / 10

  const rows: Fact[] = [
    { key: 'economy', label: t('station.economy'), value: t(ECON_KEY[s.economy] ?? 'station.economy') },
    { key: 'government', label: t('station.government'), value: t(GOV_KEY[s.government] ?? 'station.government') },
    { key: 'tech', label: t('station.tech'), value: String(s.techLevel) },
    { key: 'population', label: t('station.population'), value: t('station.popUnit', { n: population }) },
    { key: 'species', label: t('station.species'), value: speciesName(s.species) },
  ]

  const columns: Column<Fact>[] = [
    { key: 'label', header: '', width: '12rem', cell: (r) => <span style={{ color: DIM }}>{r.label}</span> },
    { key: 'value', header: '', cell: (r) => r.value },
  ]

  return (
    <Panel title={t('station.title')}>
      <Table columns={columns} rows={rows} rowKey={(r) => r.key} />
    </Panel>
  )
}

/**
 * Русские строки генератора → ключи словаря. Генератор говорит на языке оригинала
 * («Промышленная»), а показать надо на выбранном; перевод живёт здесь, в слое UI,
 * чтобы домену язык был не нужен вовсе (ему стоять на сервере без экрана).
 */
const ECON_KEY: Record<string, Key> = {
  'Аграрная': 'econ.agri',
  'Добывающая': 'econ.extract',
  'Перерабатывающая': 'econ.refine',
  'Промышленная': 'econ.industrial',
  'Высокие технологии': 'econ.hightech',
  'Туризм': 'econ.tourism',
  'Сервисная': 'econ.service',
}

const GOV_KEY: Record<string, Key> = {
  'Анархия': 'gov.anarchy',
  'Феодализм': 'gov.feudal',
  'Многовластие': 'gov.multi',
  'Диктатура': 'gov.dictator',
  'Коммунизм': 'gov.communist',
  'Конфедерация': 'gov.confed',
  'Демократия': 'gov.democracy',
  'Корпорация': 'gov.corporate',
}
