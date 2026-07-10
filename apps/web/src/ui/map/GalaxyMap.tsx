import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  LineDashedMaterial,
  LineSegments,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  SphereGeometry,
  Vector3,
} from 'three'
import {
  CORE_INDEX,
  GALAXY,
  capitalOf,
  generateGalaxy,
  jumpBlock,
  jumpDistance,
  type StarSystem,
  type World,
} from '@elite/sim'
import { jumpTo, useSession } from '../../app/GameContext'
import { UI } from '../theme'

/**
 * Карта галактики.
 *
 * 2500 звёзд — один `InstancedMesh`, то есть один вызов отрисовки. Узкое место
 * тут никогда не GPU: телефон нарисует и сто тысяч точек. Узкое место — ПОДПИСИ,
 * поэтому имя показывается ровно одно, под курсором.
 *
 * Мир под картой стоит: она отпускает курсор, а пауза в этой игре и есть
 * отпущенный курсор.
 *
 * Своё полотно, а не игровое: у карты собственная камера, собственный масштаб
 * (световые годы, а не метры) и собственное вращение. Мешать их с полётной
 * сценой значило бы тащить в неё логарифмический буфер глубины и плавающее начало.
 */

/** Световых лет в парсеке. Астрономы меряют парсеками, пилоты — годами. */
const LY_PER_PARSEC = 3.26156

/** Радиус звезды на карте, св.г. Класс задаёт размер: гигант виден гигантом. */
function starScale(radiusUnits: number): number {
  // Радиусы классов лежат от 60 (нейтронная) до 2400 (голубой гигант) — это
  // сорок раз. Корень сжимает разброс: иначе карлики становятся невидимы.
  return 0.22 + Math.sqrt(radiusUnits / 2400) * 0.75
}

const _dummy = new Object3D()
const _colour = new Color()

interface Picked {
  system: StarSystem
  distance: number
  blocked: ReturnType<typeof jumpBlock>
}

function Stars({
  systems,
  world,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  systems: StarSystem[]
  world: World
  hovered: number | null
  selected: number | null
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
}) {
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => new IcosahedronGeometry(1, 1), [])
  const material = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), [])

  // Матрицы и цвета ставятся ОДИН раз: галактика не шевелится, крутится камера.
  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return

    systems.forEach((s, i) => {
      _dummy.position.set(s.x, s.z, s.y) // экран: Y вверх, диск лежит в XZ
      _dummy.scale.setScalar(starScale(s.star.radius))
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
      mesh.setColorAt(i, _colour.setHex(s.star.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    /**
     * Ограничивающая сфера считается ОДИН раз и кэшируется. Первый кадр застаёт
     * матрицы ещё единичными — все звёзды в начале координат, — и сфера остаётся
     * радиусом в единицу. Луч в неё не попадает, и наведение молчит на всей карте.
     */
    mesh.computeBoundingSphere()
  }, [systems])

  // Подсветка: достижимое горит, недостижимое тускнеет. Пересчитывается только
  // при смене наведения или выбора — не в кадре.
  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return

    systems.forEach((s, i) => {
      const reachable = jumpBlock(world, i) === null
      _colour.setHex(s.star.color)
      if (i === hovered || i === selected) _colour.lerp(_colour.clone().setHex(0xffffff), 0.6)
      else if (!reachable && i !== world.systemIndex) _colour.multiplyScalar(0.32)
      mesh.setColorAt(i, _colour)
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [systems, world, hovered, selected])

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, systems.length]}
      frustumCulled={false}
      onPointerMove={(e) => {
        e.stopPropagation()
        onHover(e.instanceId ?? null)
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation()
        if (e.instanceId != null) onSelect(e.instanceId)
      }}
    />
  )
}

/**
 * Где ты сам. Каркасная клетка вокруг родной звезды: закрасить её было бы нечестно —
 * звезда там своего класса и своего цвета, а метка не должна его подменять.
 */
function YouAreHere({ at }: { at: Vector3 }) {
  const geometry = useMemo(() => new IcosahedronGeometry(1, 1), [])
  const material = useMemo(
    () => new MeshBasicMaterial({ color: UI.TARGET, wireframe: true, toneMapped: false }),
    [],
  )
  // Метка не мишень: указатель обязан проходить сквозь неё к звёздам.
  return <mesh geometry={geometry} material={material} position={at} scale={1.9} raycast={() => null} />
}

/** Сфера дальности прыжка вокруг текущей звезды. Ровно то, что достаёт привод. */
function JumpSphere({ at, radius }: { at: Vector3; radius: number }) {
  const geometry = useMemo(() => new SphereGeometry(1, 32, 20), [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: UI.PRIMARY,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )
  if (radius <= 0) return null
  // Сфера прозрачна и огромна: без этого она перехватывала бы наведение
  // у каждой звезды внутри себя — то есть ровно у тех, куда можно прыгнуть.
  return <mesh geometry={geometry} material={material} position={at} scale={radius} raycast={() => null} />
}

/** Пунктир от текущей звезды к той, на которую навели. Отрезок, а не дуга: диск плоский. */
function Route({ from, to }: { from: Vector3; to: Vector3 | null }) {
  const ref = useRef<LineSegments>(null)

  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(6), 3))
    return g
  }, [])
  const material = useMemo(
    () => new LineDashedMaterial({ color: UI.PRIMARY, dashSize: 0.9, gapSize: 0.7, transparent: true, opacity: 0.8 }),
    [],
  )

  useEffect(() => {
    const line = ref.current
    if (!line || !to) return
    const array = geometry.getAttribute('position').array as Float32Array
    array[0] = from.x
    array[1] = from.y
    array[2] = from.z
    array[3] = to.x
    array[4] = to.y
    array[5] = to.z
    geometry.getAttribute('position').needsUpdate = true
    // Без этого штрихи не появятся: длина дуги считается по вершинам.
    line.computeLineDistances()
  }, [geometry, from, to])

  if (!to) return null
  return <lineSegments ref={ref} geometry={geometry} material={material} frustumCulled={false} raycast={() => null} />
}

/**
 * Камера-орбита вокруг центра галактики. Своя, а не библиотечная: нужны ровно
 * три жеста, и тащить ради них зависимость незачем.
 */
function OrbitCamera({ control }: { control: { yaw: number; pitch: number; distance: number } }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera

  useFrame(() => {
    const { yaw, pitch, distance } = control
    camera.position.set(
      distance * Math.cos(pitch) * Math.sin(yaw),
      distance * Math.sin(pitch),
      distance * Math.cos(pitch) * Math.cos(yaw),
    )
    camera.lookAt(0, 0, 0)
  })
  return null
}

const positionOf = (s: StarSystem) => new Vector3(s.x, s.z, s.y)

function formatRange(ly: number): string {
  return `${ly.toFixed(1)} св.г. · ${(ly / LY_PER_PARSEC).toFixed(2)} пк`
}

const BLOCK_REASON: Record<string, string> = {
  'no-drive': 'ГИПЕРПРИВОД НЕ УСТАНОВЛЕН',
  'out-of-range': 'ВНЕ ДАЛЬНОСТИ ПРИВОДА',
  'same-system': 'ВЫ УЖЕ ЗДЕСЬ',
  docked: 'СНАЧАЛА ОТЧАЛЬТЕ',
}

export function GalaxyMap({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const world = session.world

  // 2500 систем строятся за миллисекунды, но не каждый кадр: зерно задаёт всё.
  const systems = useMemo(() => generateGalaxy(world.galaxySeed), [world.galaxySeed])

  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const control = useRef({ yaw: 0.6, pitch: 0.5, distance: GALAXY.RADIUS_LY * 2.6 })
  const dragging = useRef(false)

  const here = positionOf(systems[world.systemIndex]!)
  const marked = hovered ?? selected
  const picked: Picked | null =
    marked != null && systems[marked]
      ? {
          system: systems[marked]!,
          distance: jumpDistance(world, marked),
          blocked: jumpBlock(world, marked),
        }
      : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const doJump = (index: number) => {
    if (jumpTo(session, index)) onClose()
  }

  return (
    <div className="absolute inset-0 flex bg-black font-mono" style={{ color: UI.PRIMARY }}>
      <div
        className="relative flex-1 cursor-grab active:cursor-grabbing"
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
        onPointerMove={(e) => {
          if (!dragging.current) return
          control.current.yaw -= e.movementX * 0.005
          // Не даём перевернуться через полюс: карта — не кабина.
          control.current.pitch = Math.max(-1.4, Math.min(1.4, control.current.pitch + e.movementY * 0.005))
        }}
        onWheel={(e) => {
          const d = control.current.distance * (1 + Math.sign(e.deltaY) * 0.12)
          control.current.distance = Math.max(GALAXY.RADIUS_LY * 0.12, Math.min(GALAXY.RADIUS_LY * 5, d))
        }}
      >
        <Canvas camera={{ fov: 45, near: 0.1, far: 4000 }} gl={{ antialias: true }}>
          <OrbitCamera control={control.current} />
          <Stars
            systems={systems}
            world={world}
            hovered={hovered}
            selected={selected}
            onHover={setHovered}
            onSelect={setSelected}
          />
          <JumpSphere at={here} radius={world.player.spec.jumpRange} />
          <YouAreHere at={here} />
          <Route from={here} to={picked ? positionOf(picked.system) : null} />
        </Canvas>

        <div className="pointer-events-none absolute inset-x-0 top-0 p-6 text-xs tracking-widest" style={{ color: UI.DIM }}>
          ТАЩИТЬ — ВРАЩАТЬ · КОЛЕСО — МАСШТАБ · НАВЕСТИ — ЗАМЕРИТЬ · КЛИК — ВЫБРАТЬ
        </div>

        {picked && (
          <div className="pointer-events-none absolute bottom-6 left-6 text-sm">
            <div className="text-base tracking-widest">{picked.system.name.toUpperCase()}</div>
            <div style={{ color: UI.DIM }}>{formatRange(picked.distance)}</div>
          </div>
        )}
      </div>

      <SystemPanel
        systems={systems}
        world={world}
        selected={selected}
        onJump={doJump}
        onClose={onClose}
      />
    </div>
  )
}

/** Плашка выбранной системы: что за звезда, кто там живёт, и можно ли долететь. */
function SystemPanel({
  systems,
  world,
  selected,
  onJump,
  onClose,
}: {
  systems: StarSystem[]
  world: World
  selected: number | null
  onJump: (index: number) => void
  onClose: () => void
}) {
  const system = selected != null ? systems[selected] : null

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l p-6" style={{ borderColor: UI.DIM }}>
      <h1 className="text-xl tracking-[0.3em]">ГАЛАКТИКА</h1>
      <p className="mt-1 text-xs tracking-widest" style={{ color: UI.DIM }}>
        {world.systemName.toUpperCase()} · ПРИВОД {world.player.spec.jumpRange.toFixed(0)} СВ.Г.
      </p>

      {!system ? (
        <p className="mt-10 text-sm leading-relaxed" style={{ color: UI.DIM }}>
          Сфера показывает, куда достаёт гиперпривод. Тусклые звёзды — вне дальности:
          их берут приводом помощнее, а не терпением.
        </p>
      ) : (
        <SystemDetails
          system={system}
          index={selected!}
          world={world}
          onJump={onJump}
        />
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-auto w-full cursor-pointer border py-2 text-sm tracking-[0.3em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
        style={{ borderColor: UI.PRIMARY }}
      >
        G — ЗАКРЫТЬ
      </button>
    </aside>
  )
}

function SystemDetails({
  system,
  index,
  world,
  onJump,
}: {
  system: StarSystem
  index: number
  world: World
  onJump: (index: number) => void
}) {
  const distance = jumpDistance(world, index)
  const blocked = jumpBlock(world, index)
  const capital = capitalOf(system)
  const core = index === CORE_INDEX

  return (
    <div className="mt-6 flex flex-1 flex-col">
      <h2 className="text-lg tracking-widest">{system.name.toUpperCase()}</h2>
      <dl className="mt-3 space-y-1 text-sm">
        <Row label="СВЕТИЛО" value={system.star.className} />
        <Row label="РАССТОЯНИЕ" value={formatRange(distance)} />
        <Row label="ПЛАНЕТ" value={String(system.planets.length)} />
        <Row label="ОХРАНА" value={system.security} />
        {capital && <Row label="СТОЛИЦА" value={`${capital.name} · ${capital.settlement.economy}`} />}
        {capital && <Row label="СТРОЙ" value={`${capital.settlement.government} · ТУ ${capital.settlement.techLevel}`} />}
        <Row label="ТОПЛИВО" value={system.star.scoopable ? 'зачерпнуть можно' : 'не зачерпнуть'} />
      </dl>

      {core && (
        <p className="mt-4 text-xs leading-relaxed" style={{ color: UI.WARN }}>
          ЯДРО ГАЛАКТИКИ. За горизонтом событий — выход из чёрной дыры другой галактики.
        </p>
      )}

      <Orrery system={system} />

      <button
        type="button"
        disabled={blocked !== null}
        onClick={() => onJump(index)}
        className={`mt-6 w-full border py-3 text-sm tracking-[0.3em] transition-colors ${
          blocked ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-[#7fd6ff] hover:text-black'
        }`}
        style={{ borderColor: blocked ? UI.DIM : UI.PRIMARY, color: blocked ? UI.DIM : UI.PRIMARY }}
      >
        {blocked ? BLOCK_REASON[blocked] : 'ПРЫЖОК'}
      </button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-xs" style={{ color: UI.DIM }}>
        {label}
      </dt>
      <dd className="flex-1">{value}</dd>
    </div>
  )
}

/**
 * Схема системы: звезда и орбиты. Радиус логарифмический — иначе внутренние
 * миры слипаются в точку у светила, а внешний уезжает за край.
 */
function Orrery({ system }: { system: StarSystem }) {
  if (system.planets.length === 0) {
    return (
      <p className="mt-6 text-xs" style={{ color: UI.DIM }}>
        Планет нет. Лететь не к чему, кроме самой звезды.
      </p>
    )
  }

  const maxOrbit = Math.max(...system.planets.map((p) => p.orbit))
  // Внешняя орбита обязана уместиться в квадрат 160: центр в 80, значит радиус ≤ 74.
  const scale = (orbit: number) => 12 + (Math.log10(1 + orbit) / Math.log10(1 + maxOrbit)) * 62

  return (
    <svg viewBox="0 0 160 160" className="mt-6 w-full" role="img" aria-label={`Схема системы ${system.name}`}>
      <circle cx="80" cy="80" r="6" fill={`#${system.star.color.toString(16).padStart(6, '0')}`} />
      {system.planets.map((p, i) => {
        const r = scale(p.orbit)
        const a = i * 2.399963
        return (
          <g key={p.name}>
            <circle cx="80" cy="80" r={r} fill="none" stroke={UI.DIM} strokeWidth="0.4" opacity="0.5" />
            <circle
              cx={80 + r * Math.cos(a)}
              cy={80 + r * Math.sin(a)}
              // Газовый гигант виден гигантом и на схеме.
              r={p.type === 'Газовый гигант' ? 3.4 : 2}
              fill={p.station ? UI.PRIMARY : UI.DIM}
            />
          </g>
        )
      })}
    </svg>
  )
}
