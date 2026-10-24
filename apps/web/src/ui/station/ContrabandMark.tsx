import { t } from '../i18n'
import { UI } from '../theme'

/**
 * Знак запрещёнки у имени товара — ОДИН на рынок, трюм и окно сделки: возить можно, а купить
 * или продать — штраф. В трюме его не было, и рабов везли, не зная, что сбыть их не выйдет.
 */
export function ContrabandMark() {
  const hint = t('station.contraband')
  return (
    <span className="ml-2 cursor-help" style={{ color: UI.WARN }} title={hint} aria-label={hint}>
      ⚠
    </span>
  )
}
