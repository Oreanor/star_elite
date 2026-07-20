import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { initWorldClock } from './app/net/worldClock'
import { preloadHulls } from './render/geometry/ships'
import { preloadPortraits } from './ui/portrait'
import { preloadTitleAssets } from './ui/preload'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('нет #root')

// Общий игровой календарь: якорь в sim, онлайн — смещение Firebase Server Time.
initWorldClock()

// ПОРЯДОК ЗДЕСЬ ЗНАЧИМ. Заставка — первое, что видит игрок, и она не должна делить
// канал ни с корпусами (семь мегабайт GLB), ни с портретами (24 листа). Раньше и те,
// и другие вставали в очередь раньше неё — корпуса на импорте модуля, портреты строкой
// выше, — и меню дорисовывалось уже после того, как полоса загрузки погасла.
//
// Сначала титульные PNG (со снятой растеризацией), и только потом всё остальное:
// корпуса нужны к первому вылету, портреты — к первому разговору, а это ещё позже.
void preloadTitleAssets().then(() => {
  preloadHulls()
  preloadPortraits()
})

// StrictMode намеренно выключен: он монтирует дерево дважды, и мир создался бы
// в двух экземплярах, а игровая петля запустилась бы поверх самой себя.
createRoot(root).render(<App />)
