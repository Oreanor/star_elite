import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, Points, PointsMaterial } from 'three'
import { GALAXY, atNode, galaxyShape, generateGalaxy } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { UI } from '../theme'
import { galaxyShapeName, properName } from '../i18n/dataNames'

/**
 * КАРТА НА КУСТЕ. Между галактиками показывать нечего — можно висеть в пустоте между узлами;
 * панель это и говорит. Стоя в узле, карта открывает ТУ галактику, на которой стоишь: её
 * зерно — у узла куста (`universe.nodes[node].seed`), а не у текущего мира. Пока это ОБЗОР —
 * звёздное поле и имя; вход в галактику по выбору звезды (честный выход с куста) — отдельный шаг.
 *
 * Отдельный компонент, а не режим `GalaxyMap`: та карта завязана на текущий мир (прыжок,
 * знакомые, «ВЫ»), и мешать в неё чужую галактику значило бы городить всюду условия. Здесь
 * куст самодостаточен и ничего из мира не трогает.
 */

const _c = new Color()

/** Медленно вращающееся звёздное поле галактики узла — точки, без выбора и прыжка. */
function GalaxyField({ seed }: { seed: number }) {
  const ref = useRef<Points>(null)

  const geometry = useMemo(() => {
    const systems = generateGalaxy(seed)
    const positions = new Float32Array(systems.length * 3)
    const colors = new Float32Array(systems.length * 3)
    systems.forEach((s, i) => {
      positions[i * 3] = s.x
      positions[i * 3 + 1] = s.z // экран: Y вверх, диск в XZ (как в GalaxyMap)
      positions[i * 3 + 2] = s.y
      _c.setHex(s.star.color)
      colors[i * 3] = _c.r
      colors[i * 3 + 1] = _c.g
      colors[i * 3 + 2] = _c.b
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setAttribute('color', new BufferAttribute(colors, 3))
    return g
  }, [seed])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(
    () =>
      new PointsMaterial({
        size: GALAXY.RADIUS_LY * 0.012,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.06
  })

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />
}

export function BushMap({ embedded = false }: { embedded?: boolean; onClose?: () => void }) {
  const session = useSession()
  const bush = session.bush
  const node = session.universe.nodes[bush.node]
  const inNode = atNode(bush)

  const body = inNode && node ? (
    <div className="flex h-full w-full flex-col">
      <div className="mb-3">
        <div className="text-xl tracking-[0.3em]">ГАЛАКТИКА {properName(node.name).toUpperCase()}</div>
        <div className="mt-1 tracking-widest" style={{ color: UI.DIM }}>
          {galaxyShapeName(galaxyShape(node.seed)).toUpperCase()} · {GALAXY.COUNT} ЗВЁЗД
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border" style={{ borderColor: 'rgba(124,196,255,0.28)' }}>
        <Canvas
          camera={{ fov: 45, near: 0.1, far: 4000, position: [0, GALAXY.RADIUS_LY * 1.3, GALAXY.RADIUS_LY * 2.4] }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
        >
          <GalaxyField seed={node.seed} />
        </Canvas>
        <div
          className="pointer-events-none absolute bottom-3 left-3 text-[11px] tracking-widest"
          style={{ color: UI.DIM }}
        >
          ВХОД В ГАЛАКТИКУ ПО ЗВЕЗДЕ — СКОРО
        </div>
      </div>
    </div>
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
      <div className="text-2xl tracking-[0.35em]" style={{ color: UI.PRIMARY }}>
        МЕЖДУ ГАЛАКТИКАМИ
      </div>
      <div className="max-w-md text-sm tracking-widest" style={{ color: UI.DIM }}>
        {node ? `КУРС НА ${properName(node.name).toUpperCase()}` : ''}
        <div className="mt-2 opacity-70">В ПУСТОТЕ КУСТА КАРТЕ НЕЧЕГО ПОКАЗАТЬ. ВСТАНЬ В УЗЛЕ.</div>
      </div>
    </div>
  )

  if (embedded) {
    return (
      <div className="flex min-h-[30rem] flex-1 flex-col font-mono" style={{ color: UI.PRIMARY }}>
        {body}
      </div>
    )
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center backdrop-blur-md" style={{ background: 'radial-gradient(ellipse at center, rgba(12,34,60,0.66), rgba(0,3,8,0.93))' }}>
      <div
        className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] flex-col rounded-2xl border p-6 font-mono"
        style={{ color: UI.PRIMARY, borderColor: 'rgba(124,196,255,0.3)', background: 'linear-gradient(150deg, rgba(40,95,150,0.18), rgba(8,22,42,0.4))' }}
      >
        {body}
      </div>
    </div>
  )
}
