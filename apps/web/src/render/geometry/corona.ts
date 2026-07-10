import { CanvasTexture, SRGBColorSpace } from 'three'

/**
 * Корона звезды — радиальный градиент на билборде, а не геометрия.
 *
 * Свечение вокруг звезды нельзя сделать мешем: у него нет поверхности, оно есть
 * рассеяние света в атмосфере глаза и в оптике. Билборд с аддитивным градиентом
 * даёт ровно то же и стоит один треугольник на кадр.
 *
 * Градиент квадратичный, а не линейный: линейный даёт заметное кольцо на краю,
 * потому что глаз ловит разрыв производной яркости, а не саму яркость.
 */

let cache: CanvasTexture | null = null

export function coronaTexture(size = 256): CanvasTexture {
  if (cache) return cache

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')!
  const centre = size / 2

  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre)
  // Ядро выжжено добела: аддитивное смешивание всё равно уводит центр в белый.
  gradient.addColorStop(0.0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.12, 'rgba(255,244,214,0.95)')
  gradient.addColorStop(0.26, 'rgba(255,214,150,0.55)')
  gradient.addColorStop(0.45, 'rgba(255,180,110,0.20)')
  gradient.addColorStop(0.70, 'rgba(255,150,90,0.05)')
  gradient.addColorStop(1.0, 'rgba(255,140,80,0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  cache = new CanvasTexture(canvas)
  cache.colorSpace = SRGBColorSpace
  return cache
}
