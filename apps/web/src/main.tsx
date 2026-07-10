import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('нет #root')

// StrictMode намеренно выключен: он монтирует дерево дважды, и мир создался бы
// в двух экземплярах, а игровая петля запустилась бы поверх самой себя.
createRoot(root).render(<App />)
