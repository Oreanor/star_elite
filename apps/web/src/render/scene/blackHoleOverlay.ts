import {
  FramebufferTexture,
  HalfFloatType,
  Mesh,
  PlaneGeometry,
  RedFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three'

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
let depthCopy: WebGLRenderTarget | null = null
let copyScene: Scene | null = null
let copyMaterial: ShaderMaterial | null = null
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

/**
 * Снимок ГЛУБИНЫ кадра в обычную текстуру.
 *
 * Читать depthTexture цели, в которую сам же рисуешь, нельзя: это петля обратной связи,
 * и WebGL её ловит — draw call просто не выполнится. Поэтому глубина сперва переливается
 * полноэкранным квадом в свою цель, и уже её читает линза. Полукратная точность: сравнение
 * «ближе дыры или дальше» её переживает с запасом.
 */
function copyDepth(renderer: WebGLRenderer, camera: Camera, sceneDepth: Texture, w: number, h: number): void {
  if (!copyScene) {
    copyMaterial = new ShaderMaterial({
      uniforms: { uDepth: { value: null as Texture | null } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uDepth;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(uDepth, vUv).x, 0.0, 0.0, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    })
    const quad = new Mesh(new PlaneGeometry(2, 2), copyMaterial)
    // Квад живёт в координатах КЛИПА (шейдер игнорирует матрицы), поэтому обычный отбор
    // по фрустуму выкинул бы его, стоит камере смотреть в сторону, — и глубина не снялась бы.
    quad.frustumCulled = false
    copyScene = new Scene()
    copyScene.add(quad)
  }
  if (!depthCopy || depthCopy.width !== w || depthCopy.height !== h) {
    depthCopy?.dispose()
    depthCopy = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RedFormat,
      depthBuffer: false,
      stencilBuffer: false,
    })
  }
  copyMaterial!.uniforms.uDepth!.value = sceneDepth
  const previous = renderer.getRenderTarget()
  renderer.setRenderTarget(depthCopy)
  renderer.render(copyScene, camera)
  renderer.setRenderTarget(previous)
}

/**
 * Раздать линзам всё, что знает только проход: кадр до линзы, его глубину и проекцию.
 * Физику дыры (радиусы, время, позу) пишет компонент — она от прохода не зависит.
 */
function feedLenses(camera: PerspectiveCamera, depth: Texture | null): void {
  for (const child of overlay.children) {
    const material = (child as Mesh).material as ShaderMaterial | undefined
    const u = material?.uniforms
    if (!u?.uSceneMap) continue
    u.uSceneMap.value = frame
    u.uHasScene!.value = frame != null
    u.uDepthMap!.value = depth
    u.uHasDepth!.value = depth != null
    u.uProj!.value = camera.projectionMatrix
    u.uFar!.value = camera.far
  }
}

export function renderBlackHoleOverlay(renderer: WebGLRenderer, camera: Camera, sceneDepth: Texture | null): void {
  if (!blackHoleOverlayActive()) return

  renderer.getDrawingBufferSize(_size)
  const w = Math.max(1, Math.floor(_size.x))
  const h = Math.max(1, Math.floor(_size.y))
  if (sceneDepth) copyDepth(renderer, camera, sceneDepth, w, h)

  if (!frame || frame.image.width !== w || frame.image.height !== h) {
    frame?.dispose()
    frame = new FramebufferTexture(w, h)
  }
  // Копия кадра, а не чтение буфера напрямую: рисовать в цель и одновременно читать её
  // нельзя. copyFramebufferToTexture — один glCopyTexSubImage, без прохода полноэкранным квадом.
  renderer.copyFramebufferToTexture(frame)

  feedLenses(camera as PerspectiveCamera, sceneDepth ? depthCopy?.texture ?? null : null)

  const prevAutoClear = renderer.autoClear
  renderer.autoClear = false
  renderer.render(overlay, camera)
  renderer.autoClear = prevAutoClear
}
