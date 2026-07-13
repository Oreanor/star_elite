import { useState } from 'react'
import {
  buy,
  canBuy,
  canFit,
  canUpgrade,
  fitDeltas,
  fitFromHold,
  hardpointIndices,
  isWeapon,
  moduleStat,
  upgradeCashCost,
  upgradeLevel,
  upgradeModule,
  type FitError,
  type PurchaseError,
  type ShipModule,
  type StatKey,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { moduleName } from '../i18n/dataNames'
import { t, type Key } from '../i18n'
import { Button, DIM } from './chrome'
import { credits, formatStat, statLabel } from './format'

/**
 * Снаряжение: мелкие кирпичики, из которых сложены верфь и экран корабля.
 *
 * Живут отдельно, потому что их причина меняться одна — как показать «плюс» модуля
 * и его установку. Верфь их собирает в действия, экран корабля — только читает.
 * Ни один не мутирует мир напрямую: домен делает операцию, `onChange` перерисовывает.
 */

/** Заголовочный «плюс» модуля словом и числом: «ЩИТ 128», «УРОН 34». Для карточек. */
export function moduleBenefit(module: ShipModule): string {
  const { key, value } = moduleStat(module)
  return `${statLabel(key)} ${formatStat(key, value)}`
}

/** Только ЧИСЛО заголовочной характеристики с единицей: «128», «2.60 рад/с²». Для колонки таблицы. */
export function headlineNumber(module: ShipModule): string {
  const { key, value } = moduleStat(module)
  return formatStat(key, value)
}

/**
 * Сравнение по ЗАГОЛОВОЧНОЙ характеристике: КОНКРЕТНО было → станет. Берём её запись
 * из `fitDeltas`; если заголовочной оси там нет (у двигателя это тяга, а меняется
 * скорость), падаем на первую значимую — чтобы сравнение не пропало у очевидного
 * апгрейда. null — сравнивать не с чем (тот же модуль, нечего установить).
 *
 * «Лучше/хуже» берём СТРОГО из `higherBetter` домена, а не из размера числа: у
 * расхода маскировки меньше — значит лучше, и стрелка обязана это знать.
 */
export interface HeadlineCompare {
  key: StatKey
  from: number
  to: number
  better: boolean
}

export function headlineCompare(world: World, module: ShipModule): HeadlineCompare | null {
  const { key } = moduleStat(module)
  const deltas = fitDeltas(world.player, module)
  const match = deltas.find((d) => d.key === key)
  const delta = match ?? deltas[0]
  if (!delta) return null
  const better = delta.higherBetter ? delta.to > delta.from : delta.to < delta.from
  return { key: delta.key, from: delta.from, to: delta.to, better }
}

/**
 * Клетка сравнения: «твоё → это» ▲/▼ %. Текущее погашено, новое светит цветом
 * исхода (зелёное лучше, красное хуже). Игроку не нужно помнить свой корабль —
 * оба числа рядом. Процент опускаем, когда сравнивать не с чем (было 0: пустой слот).
 */
export function CompareCell({ world, module }: { world: World; module: ShipModule }) {
  const cmp = headlineCompare(world, module)
  if (!cmp) return <span style={{ color: DIM }}>·</span>
  const color = cmp.better ? UI.ALLY : UI.DANGER
  const pct = cmp.from !== 0 ? Math.round(Math.abs((cmp.to - cmp.from) / cmp.from) * 100) : null
  return (
    <span className="whitespace-nowrap">
      <span style={{ color: DIM }}>{formatStat(cmp.key, cmp.from)} → </span>
      <span style={{ color }}>
        {formatStat(cmp.key, cmp.to)} {cmp.better ? '▲' : '▼'}
        {pct !== null ? ` ${pct}%` : ''}
      </span>
    </span>
  )
}

/** Read-only карточка модуля: его характеристика и вид. Экран корабля показывает только её. */
export function ModuleHeadline({ module }: { module: ShipModule }) {
  const { key, value } = moduleStat(module)
  return (
    <p className="text-sm">
      <span style={{ color: DIM }}>{statLabel(key)} </span>
      {formatStat(key, value)}
      <span style={{ color: DIM }}> · {t(`kind.${module.kind}` as Key)}</span>
    </p>
  )
}

/**
 * Сравнение «было → станет», если поставить модуль вместо стоящего. ▲ зелёным — лучше,
 * ▼ красным — хуже. `higherBetter` из домена: рост не всегда благо (у расхода наоборот).
 */
export function StatDeltas({ world, module }: { world: World; module: ShipModule }) {
  const deltas = fitDeltas(world.player, module)
  if (deltas.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {deltas.map((d) => {
        const better = d.higherBetter ? d.to > d.from : d.to < d.from
        const color = better ? UI.ALLY : UI.DANGER
        return (
          <li key={d.key} className="flex gap-2">
            <span className="w-24 shrink-0" style={{ color: DIM }}>
              {statLabel(d.key)}
            </span>
            <span style={{ color: DIM }}>{formatStat(d.key, d.from)} →</span>
            <span style={{ color }}>
              {formatStat(d.key, d.to)} {better ? '▲' : '▼'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Куда встанет оружие: первая подходящая точка подвески, пустая предпочтительнее
 * занятой. Повторяет логику `buy`/`fitFromHold` в домене, чтобы гашение кнопки и
 * само действие не разошлись в оценке слота.
 */
export function weaponSlot(world: World, module: ShipModule): number | undefined {
  if (!isWeapon(module)) return undefined
  const points = hardpointIndices(world.player.loadout, module.kind === 'missile' ? 'pylon' : 'gun')
  return points.find((i) => !world.player.loadout.weapons[i]) ?? points[0]
}

/** Ошибка установки из трюма — на кнопке вместо действия. */
function fitLabel(error: FitError): string {
  switch (error) {
    case 'no-room':
      return t('station.noRoom')
    case 'class-too-large':
      return t('station.wontFit')
    case 'already-installed':
      return t('station.fitted')
    case 'no-hardpoint':
      return t('station.noHardpoint')
    default: // wrong-kind, not-a-module
      return t('station.wrongSlot')
  }
}

/** Ошибка покупки — на кнопке вместо цены. */
function buyLabel(error: PurchaseError): string {
  switch (error) {
    case 'no-money':
      return t('station.noFunds')
    case 'already-installed':
      return t('station.fitted')
    case 'class-too-large':
      return t('station.wontFit')
    case 'no-hardpoint':
      return t('station.noHardpoint')
    default: // wrong-kind
      return t('station.wrongSlot')
  }
}

/**
 * Установить модуль ИЗ ТРЮМА — бесплатно, железо уже своё. Только на верфи: правило
 * держит вызывающий (кнопки нет в полёте), домен лишь исполняет. Гашение — через
 * `canFit`, тем же слотом, что выберет сам `fitFromHold`.
 */
export function FitButton({
  world,
  holdIndex,
  module,
  onChange,
}: {
  world: World
  holdIndex: number
  module: ShipModule
  onChange: () => void
}) {
  const error = canFit(world.player, module, weaponSlot(world, module))
  return (
    <Button
      small
      disabled={error !== null}
      onClick={() => {
        if (fitFromHold(world.player, holdIndex) === null) onChange()
      }}
    >
      {error === null ? t('station.fit') : fitLabel(error)}
    </Button>
  )
}

/**
 * Купить и поставить модуль из каталога. Слот выбирается автоматически (для оружия —
 * подходящий hardpoint), либо задаётся явно там, где строка привязана к слоту.
 */
export function BuyButton({
  world,
  module,
  onChange,
  hardpointIndex,
}: {
  world: World
  module: ShipModule
  onChange: () => void
  hardpointIndex?: number
}) {
  const slot = hardpointIndex ?? weaponSlot(world, module)
  const error = canBuy(world, world.player, module, slot)
  return (
    <Button
      small
      disabled={error !== null}
      onClick={() => {
        if (buy(world, world.player, module, slot) === null) onChange()
      }}
    >
      {error === null ? t('station.buy') : buyLabel(error)}
    </Button>
  )
}

/**
 * Имя модуля для показа: у прокачанного — с «+» на конце («Щит 2C+»). Это видимая
 * метка усиления. Само поле `name` в домене не трогаем — плюс живёт только в UI.
 */
export function displayName(module: ShipModule): string {
  const name = moduleName(module)
  return upgradeLevel(module) > 0 ? `${name}+` : name
}

/**
 * Улучшение ОДНОЙ характеристики модуля — РАЗОВОЕ (домен даёт всего один уровень).
 * Две дороги (см. `upgradeModule`): деньгами (+25%) или копией из трюма (+50%, копия
 * расходуется). Не плодим по кнопке на каждую — шеврон переключает вариант, единственная
 * кнопка его применяет. Достигнут потолок — показываем «МАКСИМУМ». Мутирует домен,
 * `onChange` перерисовывает экран, и новая характеристика видна тут же.
 *
 * Передаём ИМЕННО установленный экземпляр (`loadout.internals[i]`/`weapons[i]`):
 * домен сверяет модуль по ссылке.
 */
export function UpgradeControls({
  world,
  module,
  onChange,
}: {
  world: World
  module: ShipModule
  onChange: () => void
}) {
  // Выбранный путь: false — деньгами (+25%), true — копией (+50%). Шеврон их листает.
  const [useCopy, setUseCopy] = useState(false)
  const copyError = canUpgrade(world, world.player, module, true)
  const cashError = canUpgrade(world, world.player, module, false)
  // 'maxed' одинаков для обоих путей (уже прокачан либо аукс) — прокачивать нечего.
  if (copyError === 'maxed') {
    return (
      <p className="text-xs tracking-widest" style={{ color: DIM }}>
        {t('station.maxed')}
      </p>
    )
  }
  const error = useCopy ? copyError : cashError
  const label = useCopy
    ? t('station.upgradeCopy')
    : `${t('station.upgradeCash')} · ${credits(upgradeCashCost(module))}`
  return (
    <div className="flex items-stretch gap-1.5">
      <Button small onClick={() => setUseCopy((c) => !c)}>
        ‹
      </Button>
      <Button
        small
        disabled={error !== null}
        onClick={() => {
          if (upgradeModule(world, world.player, module, useCopy) === null) onChange()
        }}
      >
        {label}
      </Button>
      <Button small onClick={() => setUseCopy((c) => !c)}>
        ›
      </Button>
    </div>
  )
}
