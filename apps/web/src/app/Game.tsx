import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { useSession } from './GameContext'
import { FlightCamera } from '../render/camera/FlightCamera'
import { Post } from '../render/post/Post'
import { PIXEL_SCALE, RENDER } from '../render/config'
import { AsteroidField } from '../render/scene/Asteroids'
import { Bodies } from '../render/scene/Bodies'
import { Titans } from '../render/scene/Titans'
import { Cockpit } from '../render/scene/Cockpit'
import { DockingCorridor } from '../render/scene/DockingCorridor'
import { Dyson } from '../render/scene/Dyson'
import { Dust } from '../render/scene/Dust'
import { CargoPods, Explosions, Missiles, TractorBeam, Tracers } from '../render/scene/Effects'
import { Exhaust } from '../render/scene/Exhaust'
import { Lighting } from '../render/scene/Lighting'
import { Drones, EnemyShips, FreighterShips, PlayerShip } from '../render/scene/Ships'
import { Simulation } from '../render/scene/Simulation'
import { Sky } from '../render/scene/Sky'
import { Starfield } from '../render/scene/Starfield'
import { WingMissiles } from '../render/scene/WingMissiles'
import { attachInput } from '../platform/input/input'
import { Hud } from '../ui/hud/Hud'

/**
 * Сборка сцены. Порядок компонентов важен: R3F зовёт useFrame в порядке
 * монтирования, поэтому Simulation стоит первым (шагает мир), а Hud — последним
 * (читает уже посчитанный кадр вместе с камерой).
 */
function Scene() {
  return (
    <>
      <Simulation />

      <Sky />
      <Lighting />
      <Starfield />
      <Dust />

      <Bodies />
      <Dyson />
      <AsteroidField />
      <Titans />
      <DockingCorridor />

      <PlayerShip />
      <WingMissiles />
      <EnemyShips />
      <FreighterShips />
      <Drones />
      <CargoPods />
      <TractorBeam />
      <Missiles />

      {/* Аддитивные струи — после корпусов: они не пишут глубину и обязаны
          лечь поверх уже нарисованной кормы. */}
      <Exhaust />

      <Tracers />
      <Explosions />
      <Cockpit />

      <FlightCamera />
      <Hud />

      {/* Последним: композер рисует кадр целиком, отключая автоотрисовку R3F. */}
      <Post />
    </>
  )
}

export function Game() {
  const hostRef = useRef<HTMLDivElement>(null)
  const session = useSession()

  /**
   * Прыжок пересобирает сцену целиком. Планеты, пояс и небо строятся один раз
   * при монтировании; подменённый под ними мир они не заметят, и «Тиррион»
   * останется висеть в кадре новой системы. `key` — не костыль: это признание,
   * что миры до и после прыжка не связаны ничем, кроме корабля.
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
          powerPreference: 'high-performance',
        }}
        camera={{ fov: RENDER.FOV_CHASE, near: RENDER.NEAR, far: RENDER.FAR }}
        style={{ imageRendering: PIXEL_SCALE > 1 ? 'pixelated' : 'auto' }}
      >
        <Scene key={epoch} />
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
