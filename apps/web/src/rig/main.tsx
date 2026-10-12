import { createRoot } from 'react-dom/client'
import { preloadHulls } from '../render/geometry/ships'
import { RigTool } from './RigTool'
import '../styles.css'

/**
 * РЕДАКТОР ОСНАСТКИ — отдельная страница дев-инструмента (`/rig.html` при `npm run dev`).
 * Игры здесь нет: только корпус, его дула, подвесы и сопла — и готовый конфиг для вставки.
 */
const root = document.getElementById('root')
if (!root) throw new Error('нет #root')
preloadHulls()
createRoot(root).render(<RigTool />)
