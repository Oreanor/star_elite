import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { useSession } from './GameContext'
import { FlightCamera } from '../render/camera/FlightCamera'
import { Post } from '../render/post/Post'
import { Probe } from '../render/post/Probe'
import { PIXEL_SCALE, RENDER } from '../render/config'
import { Simulation } from '../render/scene/Simulation'
import { JumpDirector, PortalPublisher } from '../render/scene/JumpFx'
import { JumpPortalWorldView } from '../render/scene/JumpPortalWorldView'
import { UndockDirector } from '../render/scene/UndockFx'
import { WorldVisuals } from '../render/scene/WorldVisuals'
import { promotedJumpPortalWorld } from '../render/scene/jumpPortalWorld'
import { Dust } from '../render/scene/Dust'
import { attachInput } from '../platform/input/input'
import { Hud } from '../ui/hud/Hud'
import { RemotePortalDirector } from './RemotePortalDirector'

/**
 * Сборка сцены. Критический порядок кадров закреплён приоритетами: Simulation
 * шагает мир на -100, портал синхронизирует устье на -90, Post рисует на 1.
 * Порядок JSX остаётся смысловым и не является скрытой синхронизацией.
 */
function Scene({ epoch }: { epoch: number }) {
  const hasPromotedWorld = promotedJumpPortalWorld(useSession().world) !== null
  return (
    <>
      <Simulation />
      <RemotePortalDirector />
      {/* Крутит время сцены вылета — до камеры и HUD, чтобы те читали свежий прогресс. */}
      <UndockDirector />

      {!hasPromotedWorld && <WorldVisuals key={epoch} />}

      <FlightCamera />
      {/* Пыль центрируется по уже рассчитанной камере, иначе её куб остаётся у корабля. */}
      {!hasPromotedWorld && <Dust />}
      <Hud />

      {/* Последним: композер рисует кадр целиком, отключая автоотрисовку R3F. */}
      <Post />
      {/* После композера: счётчики рендерера читаются, когда кадр уже нарисован. F3. */}
      <Probe />
    </>
  )
}

/**
 * Канвас монтируется СРАЗУ, а тяжёлая сцена — только по `ready` (нажат СТАРТ).
 *
 * Захват курсора требует, чтобы канвас уже существовал В МОМЕНТ жеста: иначе первое
 * нажатие «СТАРТ» ловить нечего, запрос проваливается, и заставка уходит лишь со
 * второго. Поэтому пустой канвас (и `attachInput` на нём) живут с загрузки страницы,
 * а полумиллионное небо и геометрия планет строятся уже под нажатием — там это
 * читается как загрузка, а не как поломка.
 */
export function Game({ ready }: { ready: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const session = useSession()

  /**
   * При смене системы пересобираются только объекты мира. Камера, симуляция и Post
   * остаются смонтированы: их скрытое состояние и GPU-буферы не должны сбрасываться
   * в тот самый кадр, когда корабль пересекает портал.
   */
  const [epoch, setEpoch] = useState(session.world.epoch)
  useEffect(() => {
    session.onSystemChange = setEpoch
    return () => {
      session.onSystemChange = null
    }
  }, [session])

  // Ввод вешаем на настоящий WebGL-канвас: pointer lock требует именно его.
  useEffect(() => {
    const canvas = hostRef.current?.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return
    return attachInput(canvas)
  }, [])

  return (
    <div ref={hostRef} className="relative h-full w-full bg-black">
      <Canvas
        // dpr < 1 уменьшает буфер, CSS растягивает его обратно ближайшим соседом.
        dpr={1 / PIXEL_SCALE}
        gl={{
          antialias: RENDER.ANTIALIAS,
          // Обычный буфер глубины разваливается на диапазоне 0.5 м … 4000 км.
          logarithmicDepthBuffer: RENDER.LOG_DEPTH,
          // Stencil — маска портала прыжка (вторая комната в овале кольца).
          stencil: true,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: RENDER.FOV_CHASE, near: RENDER.NEAR, far: RENDER.FAR }}
        style={{ imageRendering: PIXEL_SCALE > 1 ? 'pixelated' : 'auto' }}
      >
        {/* Пока не нажат СТАРТ — канвас пуст (только контекст ради захвата курсора).
            Постановщик прыжка — ВНЕ ключа: подмена мира не должна его размонтировать. */}
        {ready && (
          <>
            <Scene epoch={epoch} />
            {/* Приоритет -90: уже после Simulation (-100), но до объектов сцены (0)
                и Post (1). Поэтому collider, клип и кольцо видят одну позу кадра. */}
            <JumpDirector />
            <PortalPublisher />
            <JumpPortalWorldView />
          </>
        )}
      </Canvas>

      {/* HUD поверх 3D. pointer-events отключены: клик должен уходить в канвас. */}
      <canvas
        id="hud"
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ imageRendering: PIXEL_SCALE > 1 ? 'pixelated' : 'auto' }}
      />
    </div>
  )
}
