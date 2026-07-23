import { FramebufferTexture, Scene, Vector2, type Camera, type Object3D, type Texture, type WebGLRenderer } from 'three'

/**
 * Линзы чёрных дыр рисуются НЕ вместе со сценой, а отдельным проходом после неё.
 *
 * Причина одна: линзе нужен уже нарисованный кадр. Пока она была обычным мешем внутри
 * сцены, читать ей было нечего, кроме `scene.background`, — и всё, что нарисовано
 * геометрией (планета, станции, трафик), в искажение не попадало вовсе: пузырь пробивал
 * в планете круглую дыру со звёздами. Проход после `RenderPass` видит кадр целиком.
 *
 * Глубина у прохода общая со сценой (пишем в тот же буфер, `depthWrite: false`), поэтому
 * корабль перед пузырём по-прежнему честно его закрывает.
 */

const overlay = new Scene()
let frame: FramebufferTexture | null = null
const _size = new Vector2()

/** Линза встаёт в проход, а не в сцену мира. Возвращает снятие — для размонтирования. */
export function addBlackHoleLens(lens: Object3D): () => void {
  overlay.add(lens)
  return () => {
    overlay.remove(lens)
  }
}

/** Есть ли что рисовать. Ни одной видимой линзы — прохода нет вовсе, кадр не копируем. */
export function blackHoleOverlayActive(): boolean {
  for (const child of overlay.children) if (child.visible) return true
  return false
}

/** Снимок кадра ДО линз: его и читает шейдер вместо одного неба. */
export function blackHoleFrame(): Texture | null {
  return frame
}

export function renderBlackHoleOverlay(renderer: WebGLRenderer, camera: Camera): void {
  if (!blackHoleOverlayActive()) return

  renderer.getDrawingBufferSize(_size)
  const w = Math.max(1, Math.floor(_size.x))
  const h = Math.max(1, Math.floor(_size.y))
  if (!frame || frame.image.width !== w || frame.image.height !== h) {
    frame?.dispose()
    frame = new FramebufferTexture(w, h)
  }
  // Копия кадра, а не чтение буфера напрямую: рисовать в цель и одновременно читать её
  // нельзя. copyFramebufferToTexture — один glCopyTexSubImage, без прохода полноэкранным квадом.
  renderer.copyFramebufferToTexture(frame)

  const prevAutoClear = renderer.autoClear
  renderer.autoClear = false
  renderer.render(overlay, camera)
  renderer.autoClear = prevAutoClear
}
