import { useSyncExternalStore } from 'react'
import { currentLang, subscribeLang, type Lang } from './i18n'

/**
 * Перерисовать компонент при смене языка.
 *
 * `useSyncExternalStore` — ровно тот случай, для которого его и завели: истина
 * живёт вне React (её читает и HUD, который не компонент), а дерево обязано
 * узнать об изменении. Хранить язык в состоянии значило бы завести вторую копию
 * и однажды её рассинхронизировать.
 *
 * Компоненту достаточно ВЫЗВАТЬ этот хук: возвращаемый язык нужен редко, но
 * подписка обязательна, иначе `t()` вернёт новое слово только при следующей
 * перерисовке по чужой причине.
 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, currentLang, currentLang)
}
