import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Group, Vector3, type BufferGeometry } from 'three'
import { chassisGeometry } from '../../render/geometry/ships'
import { hullMaterialFor } from '../../render/materials/materials'
import { ACCENT, DIM } from '../station/chrome'

/**
 * Чертёж корабля: вращающаяся модель корпуса с зумом и стрелками перелистывания.
 */

/** Состояние вращения чертежа. Живёт в ref, а не в state: его крутит кадр, не React. */
export interface DragState {
  dragging: boolean
  lastX: number
  lastY: number
  /** Ручной доворот от перетаскивания — гаснет к нулю, когда отпустили. */
  yaw: number
  pitch: number
  /** Холостое вращение — копится, пока не тянут. */
  base: number
  /** Приближение колесом: множитель дистанции камеры. 1 — как кадрировали, меньше — ближе. */
  zoom: number
}

/** Поле зрения чертёжной камеры, град. Влезает и «Оса» в 3 м, и баржа в 60. */
const FOV = 32

/** Стрелка-кнопка листания каталога корпусов под моделью. */
export function ArrowButton({
  dir,
  onClick,
}: {
  dir: 'left' | 'right'
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Полупрозрачный фон: стрелка лежит ПОВЕРХ корабля, и без подложки её грань
      // теряется на светлом борту.
      className="cursor-pointer border bg-black/40 px-3 py-1 text-sm backdrop-blur-sm transition-colors hover:bg-[#7fd6ff] hover:text-black"
      style={{ borderColor: DIM, color: ACCENT }}
    >
      {dir === 'left' ? '◄' : '►'}
    </button>
  )
}

/** Пределы зума колеса: ближе половины кадрирующей дистанции корабль упрётся в near. */
const ZOOM_MIN = 0.45

const ZOOM_MAX = 2.6

export function Blueprint({ chassisId }: { chassisId: string }) {
  const geometry = useMemo(() => chassisGeometry(chassisId), [chassisId])
  const drag = useRef<DragState>({ dragging: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0, base: 0, zoom: 1 })

  // Кадрируем по сфере столкновений геометрии: корабль любого размера влезает
  // целиком. d = R / sin(fov/2) — сфера радиуса R вписывается по вертикали; 1.35 — поля.
  const { centre, camPos, distance } = useMemo(() => {
    const sphere = geometry.boundingSphere
    const r = sphere ? sphere.radius : 20
    const c = sphere ? sphere.center.clone() : new Vector3()
    const dist = (r / Math.sin((FOV / 2) * (Math.PI / 180))) * 0.85
    const dir = new Vector3(0.7, 0.45, -1).setLength(dist)
    return { centre: c, camPos: [dir.x, dir.y, dir.z] as [number, number, number], distance: dist }
  }, [geometry])

  const onDown = (e: React.PointerEvent) => {
    const d = drag.current
    d.dragging = true
    d.lastX = e.clientX
    d.lastY = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d.dragging) return
    d.yaw += (e.clientX - d.lastX) * 0.01
    // Тангаж ограничен: перевернуть кверху брюхом чертёж незачем, и так не «отвалится».
    d.pitch = Math.max(-1, Math.min(1, d.pitch + (e.clientY - d.lastY) * 0.01))
    d.lastX = e.clientX
    d.lastY = e.clientY
  }
  const onUp = (e: React.PointerEvent) => {
    drag.current.dragging = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // указатель уже отпущен — не важно
    }
  }
  // Колесо приближает и отдаляет борт. Множитель на «щелчок», зажат в пределах, чтобы
  // не влететь внутрь модели и не потерять её вдали. Дистанцию ведёт кадр (SpinningShip).
  const onWheel = (e: React.WheelEvent) => {
    const d = drag.current
    d.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, d.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12)))
  }

  return (
    <div
      className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onWheel={onWheel}
    >
      <Canvas
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: FOV, near: distance * 0.05, far: distance * 6, position: camPos }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <directionalLight position={[-4, 6, 8]} intensity={1.9} color={0xfff2dd} />
        <directionalLight position={[6, 3, -6]} intensity={0.55} color={0xa8c4e6} />
        <hemisphereLight args={[0x4a6480, 0x141a22, 0.5]} />
        <SpinningShip geometry={geometry} centre={centre} drag={drag} chassisId={chassisId} camPos={camPos} />
      </Canvas>
    </div>
  )
}

/**
 * Крутится сам, а под перетаскиванием слушается мыши и, отпущенный, ВЫРАВНИВАЕТСЯ
 * обратно: ручной доворот плавно гаснет к нулю, и холостое вращение продолжается
 * с того места. Экран на паузе — кадр здесь не связан с симуляцией.
 */
function SpinningShip({
  geometry,
  centre,
  drag,
  chassisId,
  camPos,
}: {
  geometry: BufferGeometry
  centre: Vector3
  drag: React.RefObject<DragState>
  chassisId: string
  camPos: [number, number, number]
}) {
  const ref = useRef<Group>(null)
  // Базовое направление камеры от центра: зум лишь масштабирует эту дистанцию.
  const base = useMemo(() => new Vector3(...camPos), [camPos])
  useFrame((state, dt) => {
    const d = drag.current
    if (!d) return
    if (!d.dragging) {
      d.base += dt * 0.5
      const k = Math.min(1, dt * 5) // возврат к нулю за доли секунды, без рывка
      d.yaw += (0 - d.yaw) * k
      d.pitch += (0 - d.pitch) * k
    }
    if (ref.current) {
      ref.current.rotation.y = d.base + d.yaw
      ref.current.rotation.x = d.pitch
    }
    // Камеру ведёт кадр, а не проп: зум живёт в ref, React о нём не знает.
    state.camera.position.copy(base).multiplyScalar(d.zoom)
    state.camera.lookAt(0, 0, 0)
  })
  return (
    <group ref={ref}>
      <mesh geometry={geometry} material={hullMaterialFor(chassisId)} position={[-centre.x, -centre.y, -centre.z]} />
    </group>
  )
}
