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

/**
 * Где уходит кадр по фазам — затем и замер, а не одна общая цифра: «45 fps» не говорит,
 * что чинить. Метки ставят крючки `useFrame` с приоритетами ВОКРУГ чужих: R3F зовёт
 * подписчиков по возрастанию приоритета, значит разность меток — время фазы, и при этом
 * ни Simulation, ни Post ничего о замере не знают.
 *
 * - `сим`    — Simulation (-100): такты мира, ИИ, контроллеры.
 * - `сцена`  — всё от -99 до 0: постановщики, объекты сцены, HUD — их `useFrame`.
 * - `рендер` — Post (1): композер. Это ЦП-сторона отрисовки (вызовы WebGL), не сама GPU.
 * - `вне`    — остаток интервала кадра: React, события, сборка мусора — или простой,
 *              если упор в видеокарту/vsync.
 * - `gpu`    — время видеокарты на весь кадр (EXT_disjoint_timer_query_webgl2). Нет
 *              расширения — строка пропадает, а не врёт нулём.
 */
const MARK_START = -1000
const MARK_SIM = -99.5 // сразу после Simulation (-100), до JumpDirector (-90)
const MARK_SCENE = 0.5 // после объектов сцены (0), до композера (1)

/** Сколько запросов таймера держать в полёте: ответ GPU приходит на кадр-другой позже. */
const QUERY_POOL = 6

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export function Probe() {
  const gl = useThree((s) => s.gl)
  const node = useRef<HTMLDivElement | null>(null)
  const shown = useRef(false)
  const acc = useRef({ dt: 0, sim: 0, scene: 0, render: 0, gpu: 0, gpuN: 0, calls: 0, tris: 0, n: 0 })
  const mark = useRef({ start: 0, sim: 0, scene: 0 })
  const timer = useRef<{ ext: TimerExt; free: WebGLQuery[]; flight: WebGLQuery[]; open: WebGLQuery | null } | null>(null)

  useEffect(() => {
    const el = document.createElement('div')
    el.id = 'probe'
    el.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:50;display:none;white-space:pre;' +
      'font:12px/1.25 monospace;color:#9ef01a;text-shadow:0 0 2px #000;pointer-events:none'
    document.body.appendChild(el)
    node.current = el

    const ctx = gl.getContext()
    const ext = ctx instanceof WebGL2RenderingContext
      ? (ctx.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null)
      : null
    if (ext && ctx instanceof WebGL2RenderingContext) {
      const free: WebGLQuery[] = []
      for (let i = 0; i < QUERY_POOL; i++) free.push(ctx.createQuery())
      timer.current = { ext, free, flight: [], open: null }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'F3') return
      e.preventDefault() // F3 в браузере открывает поиск по странице
      shown.current = !shown.current
      el.style.display = shown.current ? 'block' : 'none'
      // Счётчики — за ВЕСЬ кадр, а не за последний проход композера: three обнуляет их на
      // каждом render(), и прибор показывал «1 вызов» — только финальный блум.
      gl.info.autoReset = !shown.current
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      el.remove()
      node.current = null
      const t = timer.current
      if (t && ctx instanceof WebGL2RenderingContext) {
        if (t.open) ctx.endQuery(t.ext.TIME_ELAPSED_EXT)
        for (const q of [...t.free, ...t.flight, ...(t.open ? [t.open] : [])]) ctx.deleteQuery(q)
      }
      timer.current = null
    }
  }, [gl])

  useFrame(() => {
    if (!shown.current) return
    mark.current.start = performance.now()
    gl.info.reset()
    const t = timer.current
    const ctx = gl.getContext()
    if (!t || !(ctx instanceof WebGL2RenderingContext)) return
    // Собираем готовые ответы прошлых кадров. Disjoint — частота GPU прыгнула, замер
    // недостоверен: выбрасываем, а не усредняем мусор.
    const disjoint = ctx.getParameter(t.ext.GPU_DISJOINT_EXT) as boolean
    while (t.flight.length > 0) {
      const q = t.flight[0]!
      if (!(ctx.getQueryParameter(q, ctx.QUERY_RESULT_AVAILABLE) as boolean)) break
      t.flight.shift()
      if (!disjoint) {
        acc.current.gpu += (ctx.getQueryParameter(q, ctx.QUERY_RESULT) as number) / 1e6
        acc.current.gpuN++
      }
      t.free.push(q)
    }
    const q = t.free.pop()
    if (q) {
      ctx.beginQuery(t.ext.TIME_ELAPSED_EXT, q)
      t.open = q
    }
  }, MARK_START)

  useFrame(() => {
    if (shown.current) mark.current.sim = performance.now()
  }, MARK_SIM)

  useFrame(() => {
    if (shown.current) mark.current.scene = performance.now()
  }, MARK_SCENE)

  // Приоритет 2: ПОСЛЕ композера (у него 1), иначе счётчики читались бы до отрисовки кадра
  // и показывали ноль вызовов.
  useFrame((_, dt) => {
    const el = node.current
    if (!shown.current || !el) return
    const now = performance.now()
    const m = mark.current
    const a = acc.current
    const t = timer.current
    const ctx = gl.getContext()
    if (t?.open && ctx instanceof WebGL2RenderingContext) {
      ctx.endQuery(t.ext.TIME_ELAPSED_EXT)
      t.flight.push(t.open)
      t.open = null
    }
    a.dt += dt * 1000
    a.sim += m.sim - m.start
    a.scene += m.scene - m.sim
    a.render += now - m.scene
    a.calls += gl.info.render.calls
    a.tris += gl.info.render.triangles
    a.n++
    if (a.n < WINDOW) return

    const ms = a.dt / a.n
    const sim = a.sim / a.n
    const scene = a.scene / a.n
    const render = a.render / a.n
    const gpu = a.gpuN > 0 ? a.gpu / a.gpuN : null
    const calls = a.calls / a.n
    const tris = a.tris / a.n
    a.dt = a.sim = a.scene = a.render = a.gpu = a.gpuN = a.calls = a.tris = a.n = 0

    gl.getDrawingBufferSize(_size)
    const mem = gl.info.memory
    // textContent, а не setState: React в кадре не участвует (CLAUDE.md).
    el.textContent =
      `${ms.toFixed(1)} мс   ${(1000 / ms).toFixed(0)} fps\n` +
      `сим ${sim.toFixed(1)}  сцена ${scene.toFixed(1)}  рендер ${render.toFixed(1)}  вне ${Math.max(0, ms - sim - scene - render).toFixed(1)}\n` +
      (gpu !== null ? `gpu ${gpu.toFixed(1)} мс\n` : '') +
      `буфер ${_size.x}×${_size.y}  ${((_size.x * _size.y) / 1e6).toFixed(2)} Мпикс\n` +
      `выз ${calls.toFixed(0)}   тр ${(tris / 1000).toFixed(1)}k\n` +
      `тек ${mem.textures}   геом ${mem.geometries}   прог ${gl.info.programs?.length ?? 0}`
  }, 2)

  return null
}
