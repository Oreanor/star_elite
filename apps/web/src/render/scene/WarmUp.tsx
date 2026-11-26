import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { type Material, type Object3D, type Texture, WebGLRenderTarget } from 'three'
import { loadsPending } from '../../session/sceneReady'
import { holdRender } from '../renderGate'

/**
 * ПРОГРЕВ СЦЕНЫ — пока на титуле дрожит корабль, а не на «вжухе».
 *
 * Замер старта: первый показ сцены стоил ~1.3 с ожидания компиляции шейдеров и ~1 с заливки
 * текстур — главный поток, прямо на срыве корабля. Здесь то же самое делается заранее:
 *
 * 1. Ждём, пока доедут модели и текстуры (`DefaultLoadingManager`), — материалы GLB
 *    появляются в сцене только после разбора файла. С потолком: сеть не должна держать титул.
 * 2. `compileAsync` — все программы сцены разом, в том числе пустых мешей эффектов (они
 *    невидимы, но первый взрыв не должен ждать шейдер). С `KHR_parallel_shader_compile`
 *    драйвер компилирует в своих потоках, а мы лишь опрашиваем готовность.
 * 3. `initTexture` — заливка в видеокарту загруженных текстур.
 *
 * Компилируем В RENDER TARGET, а не на экран: кадр рисует композер в свой буфер, и для буфера
 * у three другой вариант программы (без тон-маппинга, линейный цвет). Прогрев «экранного»
 * варианта ушёл бы впустую — на первом кадре всё скомпилировалось бы заново.
 *
 * Пока идёт прогрев, кадр не рисуется (`holdRender`): иначе первый же кадр синхронно
 * скомпилировал бы всё сам, и прогрев потерял бы смысл. Титул в это время непрозрачен.
 */

/** Сколько ждать загрузок, мс. Дальше прогреваем, что есть: остальное зальётся под пеленой. */
const LOADS_MAX_WAIT_MS = 6000
/** Очередь пуста столько подряд — значит, разбор моделей не заказал новых файлов. */
const LOADS_QUIET_MS = 200
const POLL_MS = 50

function collectTextures(root: Object3D, out: Set<Texture>): void {
  const add = (value: unknown) => {
    if (value && typeof value === 'object' && (value as Texture).isTexture) out.add(value as Texture)
  }
  const fromMaterial = (material: Material) => {
    for (const value of Object.values(material)) add(value)
    const uniforms = (material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms
    if (uniforms) for (const u of Object.values(uniforms)) add(u.value)
  }
  root.traverse((object) => {
    const material = (object as Object3D & { material?: Material | Material[] }).material
    if (Array.isArray(material)) material.forEach(fromMaterial)
    else if (material) fromMaterial(material)
  })
}

/** Заливать можно только текстуру с готовой картинкой — иначе three лишь предупредит. */
function uploadable(texture: Texture): boolean {
  const image = texture.image as { complete?: boolean } | null | undefined
  return texture.version > 0 && image != null && image.complete !== false
}

export function WarmUp({ onWarm }: { onWarm: () => void }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    let alive = true
    holdRender('warmup', true)

    const waitLoads = () =>
      new Promise<void>((resolve) => {
        const start = performance.now()
        let quietSince = -1
        const poll = () => {
          if (!alive) return resolve()
          const now = performance.now()
          if (loadsPending()) quietSince = -1
          else if (quietSince < 0) quietSince = now
          if ((quietSince >= 0 && now - quietSince >= LOADS_QUIET_MS) || now - start >= LOADS_MAX_WAIT_MS) {
            resolve()
            return
          }
          setTimeout(poll, POLL_MS)
        }
        poll()
      })

    const warm = async () => {
      await waitLoads()
      if (!alive) return
      const target = new WebGLRenderTarget(1, 1)
      const previous = gl.getRenderTarget()
      gl.setRenderTarget(target)
      // Синхронная часть `compileAsync` (заказ программ) идёт внутри вызова — цель буфера
      // должна стоять именно на нём; дальше промис лишь ждёт готовности.
      const compiled = gl.compileAsync(scene, camera)
      gl.setRenderTarget(previous)
      await compiled
      target.dispose()
      if (!alive) return
      const textures = new Set<Texture>()
      collectTextures(scene, textures)
      for (const texture of textures) if (uploadable(texture)) gl.initTexture(texture)
    }

    warm()
      .catch((error: unknown) => console.warn('[warmup]', error))
      .finally(() => {
        if (!alive) return
        holdRender('warmup', false)
        // Пара настоящих кадров — и только тогда «готово»: первый кадр после паузы ещё
        // доделывает то, чего прогрев не знает (небо в кубическую карту, проходы композера).
        requestAnimationFrame(() => requestAnimationFrame(() => alive && onWarm()))
      })

    return () => {
      alive = false
      holdRender('warmup', false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera])

  return null
}
