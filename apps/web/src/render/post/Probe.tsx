import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector2 } from 'three'

/**
 * ЗАМЕР КАДРА. Прибор, а не украшение: без него «почему 30» решается гаданием, а в этом
 * проекте гадать запрещено — «баланс меряется, а не угадывается» (CLAUDE.md), и к кадрам
 * правило то же. Дважды подряд правдоподобный подозреваемый оказывался не тем.
 *
 * Показывает то, по чему видна ПРИРОДА упора, а не просто «медленно»:
 *
 * - `мс` против `fps` — упор в GPU держит ровные 33.3 (вертикальная синхронизация вполовину),
 *   упор в JS даёт рваные числа. Это первое, что надо знать: дальше искать на видеокарте или
 *   в скрипте.
 * - `буфер` — сколько пикселей рисуем НА САМОМ ДЕЛЕ. Главное число: цена почти всего в кадре
 *   (блум, логарифмическая глубина, сглаживание) линейна по площади, и 2560×1440 против
 *   640×360 — это в шестнадцать раз больше работы при том же кадре.
 * - `выз` (draw calls) и `тр` — цена со стороны CPU и геометрии. Правило проекта — один вызов
 *   на класс объектов; сотни вызовов означали бы, что батчинг сломан.
 * - `тек`/`геом` — что живёт в видеопамяти. Текстуры Meshy по 2048² уже раз стоили гигабайта.
 *
 * `F3` — показать/скрыть.
 *
 * Узел DOM создаём руками, а не возвращаем разметкой: компонент живёт ВНУТРИ `<Canvas>`, где
 * React мастерит объекты three, а не элементы страницы, — `<div>` там просто не отрисовался бы.
 * А внутри быть обязан: только оттуда виден `useFrame` и счётчики рендерера. Оверлей на DOM
 * намеренно: это не HUD (тот растр и в общей пиксельной сетке с 3D), а инструмент
 * разработчика — ему быть чётким важнее, чем стильным.
 */

/** Окно усреднения, кадров. Мгновенное `dt` скачет и читается плохо. */
const WINDOW = 30

const _size = /* @__PURE__ */ new Vector2()

export function Probe() {
  const gl = useThree((s) => s.gl)
  const node = useRef<HTMLDivElement | null>(null)
  const shown = useRef(false)
  const acc = useRef(0)
  const frames = useRef(0)

  useEffect(() => {
    const el = document.createElement('div')
    el.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:50;display:none;white-space:pre;' +
      'font:12px/1.25 monospace;color:#9ef01a;text-shadow:0 0 2px #000;pointer-events:none'
    document.body.appendChild(el)
    node.current = el

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'F3') return
      e.preventDefault() // F3 в браузере открывает поиск по странице
      shown.current = !shown.current
      el.style.display = shown.current ? 'block' : 'none'
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      el.remove()
      node.current = null
    }
  }, [])

  // Приоритет 2: ПОСЛЕ композера (у него 1), иначе счётчики читались бы до отрисовки кадра
  // и показывали ноль вызовов.
  useFrame((_, dt) => {
    const el = node.current
    if (!shown.current || !el) return
    acc.current += dt
    frames.current++
    if (frames.current < WINDOW) return

    const ms = (acc.current / frames.current) * 1000
    acc.current = 0
    frames.current = 0

    gl.getDrawingBufferSize(_size)
    const r = gl.info.render
    const m = gl.info.memory
    // textContent, а не setState: React в кадре не участвует (CLAUDE.md).
    el.textContent =
      `${ms.toFixed(1)} мс   ${(1000 / ms).toFixed(0)} fps\n` +
      `буфер ${_size.x}×${_size.y}  ${((_size.x * _size.y) / 1e6).toFixed(2)} Мпикс\n` +
      `выз ${r.calls}   тр ${(r.triangles / 1000).toFixed(1)}k\n` +
      `тек ${m.textures}   геом ${m.geometries}   прог ${gl.info.programs?.length ?? 0}`
  }, 2)

  return null
}
