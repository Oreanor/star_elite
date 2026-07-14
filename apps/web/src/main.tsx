import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { preloadPortraits } from './ui/portrait'
import { preloadTitleAssets } from './ui/preload'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('нет #root')

// Прогреваем листы портретов сразу: все лица в игре — клетки этих 24 файлов,
// нейтральные первыми. К моменту первого портрета они уже в кэше браузера.
preloadPortraits()
// Титульная заставка: фон, лого, корабль и струи — до первого кадра меню.
preloadTitleAssets()

// StrictMode намеренно выключен: он монтирует дерево дважды, и мир создался бы
// в двух экземплярах, а игровая петля запустилась бы поверх самой себя.
createRoot(root).render(<App />)
