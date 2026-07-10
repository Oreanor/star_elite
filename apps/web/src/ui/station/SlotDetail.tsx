import {
  hullDamage,
  missingRounds,
  rearm,
  rearmCost,
  repair,
  repairCost,
  type CargoItem,
  type ModuleKind,
  type ShipModule,
  type World,
} from '@elite/sim'
import { t } from '../i18n'
import { Button, Column, DIM, Table } from './chrome'
import {
  CompareCell,
  FitButton,
  ModuleHeadline,
  StatDeltas,
  UpgradeControls,
  displayName,
  headlineNumber,
} from './Equipment'

/**
 * Верфь, действия над ОДНИМ слотом. Раскрывается под именем модуля: почини,
 * замени, улучши. Только на верфи — правило держит вызывающий (в полёте эту
 * карточку не показывают вовсе), домен лишь исполняет операции.
 *
 * Отдельный файл, потому что его причина меняться одна — «что можно сделать со
 * снаряжением у причала». Экран корабля лишь перечисляет слоты и рисует статы.
 */
export function SlotDetail({
  world,
  module,
  optionKinds,
  onChange,
}: {
  world: World
  /** null — пустая точка подвески: вытеснять нечего, только установить. */
  module: ShipModule | null
  optionKinds: readonly ModuleKind[]
  onChange: () => void
}) {
  return (
    <div className="space-y-3">
      {module && <ModuleHeadline module={module} />}
      {module && <RepairSection world={world} module={module} onChange={onChange} />}
      <ReplaceSection world={world} optionKinds={optionKinds} installedId={module?.id} onChange={onChange} />
      {module && (
        <Section label={t('station.upgrade')}>
          <UpgradeControls world={world} module={module} onChange={onChange} />
        </Section>
      )}
    </div>
  )
}

/** Заголовок раздела действий: «ПОЧИНИТЬ», «ЗАМЕНИТЬ», «УЛУЧШИТЬ». */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-xs tracking-[0.25em]" style={{ color: DIM }}>
        {label}
      </h4>
      {children}
    </div>
  )
}

/**
 * Починка. Per-module прочности в домене нет и выдумывать её нельзя, поэтому чиним
 * то, что домен действительно считает: корпус (у брони) и боезапас пусковой (у ракет).
 * Прочим слотам чинить нечего — раздел не показываем.
 */
function RepairSection({ world, module, onChange }: { world: World; module: ShipModule; onChange: () => void }) {
  const player = world.player

  if (module.kind === 'armour') {
    const damage = hullDamage(player)
    if (damage <= 0) return null
    const cost = repairCost(player)
    return (
      <Section label={t('station.repair')}>
        <p className="mb-1 text-xs" style={{ color: DIM }}>
          {t('station.service.hullDmg', { cur: Math.round(player.hull), max: player.spec.hull.hull, cost })}
        </p>
        <Button
          small
          disabled={world.credits < cost}
          onClick={() => {
            if (repair(world, player)) onChange()
          }}
        >
          {t('station.service.repair')}
        </Button>
      </Section>
    )
  }

  if (module.kind === 'missile') {
    const rounds = missingRounds(player)
    if (rounds <= 0) return null
    const cost = rearmCost(player)
    return (
      <Section label={t('station.repair')}>
        <p className="mb-1 text-xs" style={{ color: DIM }}>
          {t('station.service.rearmNeed', { n: rounds, cost })}
        </p>
        <Button
          small
          disabled={world.credits < cost}
          onClick={() => {
            if (rearm(world, player)) onChange()
          }}
        >
          {t('station.service.rearm')}
        </Button>
      </Section>
    )
  }

  return null
}

/**
 * Замена СВОИМ железом из трюма (бесплатно, `fitFromHold`): снятое ранее или трофей.
 * Покупка нового живёт в каталоге по видам (см. `KindBrowser`) — здесь только своё,
 * чтобы верф не двоил один и тот же прайс в двух местах. Сравнение ▲/▼ показывает,
 * лучше вариант стоящего или хуже, ещё до установки.
 */
function ReplaceSection({
  world,
  optionKinds,
  installedId,
  onChange,
}: {
  world: World
  optionKinds: readonly ModuleKind[]
  installedId?: string
  onChange: () => void
}) {
  // Индексы живого трюма: установка их сдвигает, поэтому берём заново каждый рендер.
  const options: Option[] = world.player.hold.items
    .map((item, index) => ({ item, index }))
    .filter(
      (o): o is { item: Extract<CargoItem, { kind: 'module' }>; index: number } =>
        o.item.kind === 'module' && optionKinds.includes(o.item.module.kind) && o.item.module.id !== installedId,
    )
    .map(({ item, index }) => ({
      key: `hold-${item.module.id}-${index}`,
      module: item.module,
      action: <FitButton world={world} holdIndex={index} module={item.module} onChange={onChange} />,
    }))

  if (options.length === 0) {
    return (
      <Section label={`${t('station.replace')} · ${t('station.fromHold')}`}>
        <p className="text-xs" style={{ color: DIM }}>
          {t('station.noOptions')}
        </p>
      </Section>
    )
  }

  const columns: Column<Option>[] = [
    { key: 'name', header: t('station.col.name'), cell: (o) => displayName(o.module) },
    {
      key: 'param',
      header: t('station.col.benefit'),
      align: 'right',
      cell: (o) => <span style={{ color: DIM }}>{headlineNumber(o.module)}</span>,
    },
    { key: 'cmp', header: t('station.improvement'), align: 'right', cell: (o) => <CompareCell world={world} module={o.module} /> },
    { key: 'act', header: '', align: 'right', cell: (o) => o.action },
  ]

  return (
    <Section label={`${t('station.replace')} · ${t('station.fromHold')}`}>
      <Table
        columns={columns}
        rows={options}
        rowKey={(o) => o.key}
        // Раскрытие — полный расклад «было → станет», строка остаётся короткой.
        detail={(o) => <StatDeltas world={world} module={o.module} />}
      />
    </Section>
  )
}

/** Вариант замены слота из трюма: имя-число-сравнение в строке, полный расклад — в раскрытии. */
interface Option {
  key: string
  module: ShipModule
  action: React.ReactNode
}
