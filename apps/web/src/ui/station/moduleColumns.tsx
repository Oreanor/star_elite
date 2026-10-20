import { moduleStat, priceOf, type ShipModule, type World } from '@elite/sim'
import { t } from '../i18n'
import { trend } from '../theme'
import { DIM, type Column } from './chrome'
import { displayName, headlineCompare } from './Equipment'
import { formatStat, statLabel } from './format'

/**
 * Колонки таблицы ОБОРУДОВАНИЯ — одни на всю игру: магазин в торговле, магазин и трюм в окне
 * слота. Прежде окно слота рисовало свои карточки-кнопки, а торговля — таблицу, и одно и то же
 * железо выглядело по-разному. Все колонки сортируются кликом по заголовку.
 *
 * `hardpointIndex` — точка подвески открытого слота: «было → станет» у оружия считается против
 * того, что стоит именно в ней. `price` — ячейка цены (у магазина она своя: причина, если не
 * купить); нет — колонки цены нет (трюм: железо уже твоё).
 */
export function moduleColumns(
  world: World,
  opts: { hardpointIndex?: number; price?: (m: ShipModule) => React.ReactNode; rows?: readonly ShipModule[] } = {},
): Column<ShipModule>[] {
  const compareOf = (m: ShipModule) => headlineCompare(world, m, opts.hardpointIndex)
  // Шапка сравнения — САМА характеристика («ЩИТ», «УРОН»). У смешанного списка (доп.
  // оборудование: ECM, бомба, маскировка) одной на всех нет — тогда она в каждой ячейке.
  const keys = new Set((opts.rows ?? []).map((m) => compareOf(m)?.key ?? moduleStat(m).key))
  const mixed = keys.size !== 1
  const compareHeader = mixed ? '' : statLabel([...keys][0]!)
  const columns: Column<ShipModule>[] = [
    // Имя забирает остаток и обрезается: полное «было → станет» раздувало таблицу вбок.
    {
      key: 'name',
      header: t('station.col.name'),
      cell: (m) => {
        const name = displayName(m)
        return <span className="block truncate" title={name}>{name}</span>
      },
      sortValue: (m) => displayName(m),
    },
    // Только характеристика этого железа и стрелка: зелёная — лучше стоящего, красная — хуже.
    // «156 → 135» в колонке не пишем: это и был горизонтальный скролл.
    {
      key: 'compare',
      width: '11rem',
      header: compareHeader,
      align: 'right',
      sortValue: (m) => compareOf(m)?.to ?? moduleStat(m).value,
      cell: (m) => {
        const cmp = compareOf(m)
        if (!cmp) {
          const own = moduleStat(m)
          return (
            <span className="inline-flex w-full items-baseline justify-end gap-1 whitespace-nowrap" style={{ color: DIM }}>
              <span>
                {mixed && `${statLabel(own.key)} `}
                {formatStat(own.key, own.value)}
              </span>
              <span className="inline-block w-[1em] shrink-0" />
            </span>
          )
        }
        const tone = trend(cmp.better)
        const changed = cmp.to !== cmp.from
        return (
          <span className="inline-flex w-full items-baseline justify-end gap-1 whitespace-nowrap">
            <span style={{ color: DIM }}>
              {mixed && `${statLabel(cmp.key)} `}
              {formatStat(cmp.key, cmp.to)}
            </span>
            {/* Слот стрелки одной ширины на всех строках: цифры прижаты вправо, стрелки — столбиком. */}
            <span className="inline-block w-[1em] shrink-0 text-center" style={{ color: changed ? tone.color : 'transparent' }}>
              {changed ? tone.mark : '▲'}
            </span>
          </span>
        )
      },
    },
    {
      key: 'mass',
      width: '4.5rem',
      header: t('station.col.mass'),
      align: 'right',
      sortValue: (m) => m.mass,
      cell: (m) => <span className="whitespace-nowrap" style={{ color: DIM }}>{formatStat('mass', m.mass, 1)}</span>,
    },
  ]
  if (opts.price) {
    columns.push({
      key: 'price',
      // Узкая: иначе table-fixed делит остаток поровну с именем, и между массой и ценой дыра.
      width: '7rem',
      header: t('station.col.price'),
      align: 'right',
      sortValue: (m) => priceOf(m),
      cell: opts.price,
    })
  }
  return columns
}
