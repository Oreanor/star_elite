import { useEffect, useRef } from 'react'

/**
 * Мерцание неба на заставке. Несколько сотен точек над звёздным полем медленно
 * дышат прозрачностью — период у каждой свой, от единиц до десятков секунд, поэтому
 * вместе они не мигают гирляндой, а тихо переливаются, как настоящее небо.
 *
 * Это заставка, а не игровой кадр: здесь можно и `Math.random`, и `performance.now`
 * (запрет на них — про домен, который обязан быть детерминированным; тут его нет).
 * Рисуем на канвасе, а не в DOM: пара сотен точек, каждый кадр меняющих прозрачность, —
 * это работа для растра, а не для сотен перерисовываемых узлов.
 */

const STAR_COUNT = 340

// Палитра неба: белые и голубые — часто, жёлтые — реже, красные — совсем редко.
// Порядок задаёт и частоту: индекс берётся смещённым к началу, к тёплым не дотянуться.
const COLORS = ['#ffffff', '#eaf3ff', '#bcd8ff', '#9fc6ff', '#ffe9a8', '#ffd27a', '#ff9d84', '#ff7a6a'] as const

interface Star {
  x: number // доля ширины 0..1
  y: number // доля высоты 0..1
  size: number // сторона квадратика, CSS-пиксели
  color: string
  omega: number // угловая частота дыхания, рад/с
  phase: number
  lo: number // прозрачность в провале
  hi: number // прозрачность на пике
}

function makeStars(): Star[] {
  const stars: Star[] = []
  for (let i = 0; i < STAR_COUNT; i++) {
    // Смещаем выбор цвета к началу палитры: тёплые тона — редкость на небе.
    const warm = Math.random() ** 2.4
    const color = COLORS[Math.min(COLORS.length - 1, Math.floor(warm * COLORS.length))]!
    // Период от 2 до 17 секунд — разброс и есть то, что мешает синхронному миганию.
    const period = 2 + Math.random() * 15
    stars.push({
      x: Math.random(),
      y: Math.random(),
      // Пиксель в один — не видно; крупнее, 2×2, а часть 3×3 для разнокалиберности неба.
      size: Math.random() < 0.85 ? 2 : 3,
      color,
      omega: (2 * Math.PI) / period,
      phase: Math.random() * Math.PI * 2,
      // Дышат на ВСЮ амплитуду: гаснут до нуля и разгораются до полной — иначе не видно.
      lo: 0,
      hi: 0.85 + Math.random() * 0.15,
    })
  }
  return stars
}

export function TitleStars() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const stars = makeStars()
    let w = 0
    let h = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    // ResizeObserver, а не window.resize: он же отдаёт ПЕРВЫЙ размер, когда канвас
    // уже разложен, — иначе при нулевом размере на монтировании ничего не рисуется.
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let raf = 0
    const tick = () => {
      const t = performance.now() / 1000
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        // Прозрачность дышит по синусу между провалом и пиком — плавно, без скачков.
        const k = 0.5 + 0.5 * Math.sin(s.omega * t + s.phase)
        ctx.globalAlpha = s.lo + (s.hi - s.lo) * k
        ctx.fillStyle = s.color
        ctx.fillRect(s.x * w, s.y * h, s.size, s.size)
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
}
