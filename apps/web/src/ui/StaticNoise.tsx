import { useEffect, useRef } from 'react'

/**
 * ТВ-помехи как прелоадер: закрывает пустой аватар, пока лист портретов летит с
 * сервера (на проде это заметно). Два «кадра» помех — мелкое зерно (как жпег) и
 * горизонтальные потёки (как вебп): зерно часто-часто вертится на 90°, а раз в 1–2 с
 * пара кадров разбавляется полосами. Плюс мелкий сдвиг — чтобы паттерн не застывал.
 *
 * Никакого React в цикле: тайлы генерим ОДИН раз в data-URI, а в кадре меняем лишь
 * `backgroundImage` и `transform` напрямую в `style` — как и всё живое в проекте.
 */

/** Тайлы шума генерим лениво в браузере и кэшируем на модуль: canvas не для теста/сборки. */
let tiles: { grain: string[]; bars: string[] } | null = null

function pick(list: string[]): string {
  return list[(Math.random() * list.length) | 0] ?? ''
}

/**
 * Один тайл шума в data-URI. `grain` — равномерное зерно; `bars` — у каждой строки
 * свой уровень яркости (горизонтальные потёки) плюс редкие почти-белые строки-вспышки,
 * как срыв синхронизации на кассете. Сид фиксирован — вариативность даёт сама анимация.
 */
function makeTile(kind: 'grain' | 'bars', seed: number): string {
  const size = 90
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const image = ctx.createImageData(size, size)
  const data = image.data
  let s = seed >>> 0
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000)
  for (let y = 0; y < size; y++) {
    const rowBias = kind === 'bars' ? 0.35 + rnd() * 0.65 : 1
    const rowFlash = kind === 'bars' && rnd() < 0.08 ? 0.6 : 0
    for (let x = 0; x < size; x++) {
      const raw = rnd()
      const v = kind === 'bars' ? Math.min(1, raw * rowBias + rowFlash) : raw
      const c = (v * 255) | 0
      const i = (y * size + x) * 4
      data[i] = c
      data[i + 1] = c
      data[i + 2] = c
      data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

const ROT = [0, 90, 180, 270]

export function StaticNoise() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!tiles) {
      tiles = {
        grain: [makeTile('grain', 0x1234abcd), makeTile('grain', 0x9e3779b9)],
        bars: [makeTile('bars', 0x51ed270b), makeTile('bars', 0x27d4eb2f)],
      }
    }
    const el = ref.current
    const t = tiles
    if (!el || !t.grain[0]) return

    let raf = 0
    let last = 0
    let barsUntil = 0
    let nextBarsAt = 0
    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      // «Часто-часто», но не каждый кадр: ~16 раз/с, иначе мельтешение сливается в серость.
      if (now - last < 62) return
      last = now
      if (nextBarsAt === 0) nextBarsAt = now + 1000 + Math.random() * 1000

      let img: string
      if (now < barsUntil) {
        img = pick(t.bars)
      } else if (now >= nextBarsAt) {
        // Пара кадров полос, затем снова зерно; следующая вставка через 1–2 с.
        barsUntil = now + 130
        nextBarsAt = now + 1000 + Math.random() * 1000
        img = pick(t.bars)
      } else {
        img = pick(t.grain)
      }
      const r = ROT[(Math.random() * 4) | 0]
      const ox = (Math.random() * 6 - 3) | 0
      const oy = (Math.random() * 6 - 3) | 0
      el.style.backgroundImage = `url(${img})`
      // scale чуть больше 1 — чтобы поворот на 90° и сдвиг не оголяли угол.
      el.style.transform = `translate(${ox}px, ${oy}px) rotate(${r}deg) scale(1.18)`
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        ref={ref}
        className="h-full w-full"
        style={{ backgroundSize: '100% 100%', imageRendering: 'pixelated', opacity: 0.9 }}
      />
    </div>
  )
}
