import { priceOf, type ShipModule, type World } from '@elite/sim'
import { t } from '../i18n'
import { trend } from '../theme'
import { DIM, type Column } from './chrome'
import { displayName, headlineCompare } from './Equipment'
import { formatStat, statNumber } from './format'

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
  opts: { hardpointIndex?: number; price?: (m: ShipModule) => React.ReactNode } = {},
): Column<ShipModule>[] {
  const compareOf = (m: ShipModule) => headlineCompare(world, m, opts.hardpointIndex)
  const columns: Column<ShipModule>[] = [
    // Ширин колонкам НЕ задаём: таблица сама отдаёт каждой ширину по содержимому. Все числа
    // в одну строку, переносится лишь название — и только когда места правда не хватает.
    { key: 'name', header: t('station.col.name'), cell: (m) => displayName(m), sortValue: (m) => displayName(m) },
    // Сравнение одной ячейкой, прижатой вправо: «156 → 135 м/с ▼». Сортируется по новому значению.
    {
      key: 'compare',
      header: t('station.col.compare'),
      align: 'right',
      sortValue: (m) => compareOf(m)?.to ?? -Infinity,
      cell: (m) => {
        const cmp = compareOf(m)
        if (!cmp) return <span style={{ color: DIM }}>·</span>
        const same = cmp.to === cmp.from
        const tone = trend(cmp.better)
        return (
          <span className="whitespace-nowrap">
            {/* Единица — один раз, в конце, у нового значения. Равное — без цвета и со «=». */}
            <span style={{ color: DIM }}>{statNumber(cmp.key, cmp.from)} → </span>
            <span style={{ color: same ? DIM : tone.color }}>
              {formatStat(cmp.key, cmp.to)} {same ? '=' : tone.mark}
            </span>
          </span>
        )
      },
    },
    {
      key: 'mass',
      header: t('station.col.mass'),
      align: 'right',
      sortValue: (m) => m.mass,
      cell: (m) => <span className="whitespace-nowrap" style={{ color: DIM }}>{formatStat('mass', m.mass, 1)}</span>,
    },
  ]
  if (opts.price) {
    columns.push({
      key: 'price',
      header: t('station.col.price'),
      align: 'right',
      sortValue: (m) => priceOf(m),
      cell: opts.price,
    })
  }
  return columns
}
