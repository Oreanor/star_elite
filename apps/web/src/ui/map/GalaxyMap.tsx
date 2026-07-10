import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  MeshBasicMaterial,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
} from 'three'
import {
  ARRIVAL,
  CORE_INDEX,
  GALAXY,
  arrivalBounds,
  capitalOf,
  galaxyName,
  galaxyShape,
  generateGalaxy,
  jumpBlock,
  jumpDistance,
  stationSeat,
  systemDefFor,
  type Arrival,
  type StarSystem,
  type SystemDef,
  type World,
} from '@elite/sim'
import { jumpTo, useSession } from '../../app/GameContext'
import { UI } from '../theme'

/**
 * Карта галактики.
 *
 * 2500 звёзд — одно облако точек, то есть один вызов отрисовки. Узкое место
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

/**
 * Радиус звезды на карте, св.г. Класс задаёт размер: гигант виден гигантом.
 *
 * Числа маленькие намеренно. Диск — шестьдесят световых лет, среднее расстояние
 * между соседями около трёх; звезда радиусом в световой год закрывала собой
 * треть этого промежутка, и карта читалась как каша из шариков, а не как звёздное
 * поле. Настоящая звезда на таком масштабе — точка, и точкой ей и место.
 */
function starScale(radiusUnits: number): number {
  // Радиусы классов лежат от 60 (нейтронная) до 2400 (голубой гигант) — это
  // сорок раз. Корень сжимает разброс: иначе карлики становятся невидимы.
  return 0.05 + Math.sqrt(radiusUnits / 2400) * 0.18
}

/**
 * Звёзды рисуются ТОЧКАМИ, а не сферами.
 *
 * У сферы на карте нет ни одной честной точки: её полюса, грани и терминатор
 * ничего не значат, а стоит она двадцать треугольников. Круглый спрайт передаёт
 * ровно то, что известно, — положение, цвет и класс, — и не притворяется, будто
 * с шестидесяти световых лет видна форма светила.
 *
 * Размер задаётся в СВЕТОВЫХ ГОДАХ и уменьшается с расстоянием: `projectionMatrix[1][1]`
 * это 1/tg(fov/2), и вместе с полувысотой окна оно переводит размер в пиксели.
 * Постоянный `gl_PointSize` дал бы наклейки на объективе — одинаковые и вблизи,
 * и на другом краю галактики.
 */
const starVertex = /* glsl */ `
attribute float size;

uniform float uHalfHeight;
/** Наименьший размер точки, пикселей: иначе дальний край галактики исчезает. */
uniform float uMinPixels;

varying vec3 vColor;

void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  float pixels = size * projectionMatrix[1][1] * uHalfHeight / max(-mv.z, 0.001);
  gl_PointSize = max(pixels * 2.0, uMinPixels);
}
`

const starFragment = /* glsl */ `
varying vec3 vColor;

void main() {
  // Круг, а не квадрат. Мягкий край: точка в один-два пикселя без него мерцает.
  float d = length(gl_PointCoord - vec2(0.5));
  float alpha = 1.0 - smoothstep(0.34, 0.5, d);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`

const _colour = new Color()
const _white = /* @__PURE__ */ new Color(0xffffff)

interface Picked {
  system: StarSystem
  distance: number
  blocked: ReturnType<typeof jumpBlock>
}

/**
 * Порог наведения на точку, св. годы. По самой звезде курсором не попасть:
 * она в четверть светового года, а на экране это два пикселя.
 */
const HOVER_LY = 0.9

function Stars({
  systems,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  systems: StarSystem[]
  hovered: number | null
  selected: number | null
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
}) {
  const { size, raycaster } = useThree()

  // Порог живёт на самом луче: три пары скобок в пропсе Canvas требовали бы
  // задать заодно и Mesh, и Line, и Sprite — то есть переписать то, что и так верно.
  useEffect(() => {
    if (raycaster.params.Points) raycaster.params.Points.threshold = HOVER_LY
  }, [raycaster])

  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    const positions = new Float32Array(systems.length * 3)
    const sizes = new Float32Array(systems.length)

    systems.forEach((s, i) => {
      positions[i * 3] = s.x
      positions[i * 3 + 1] = s.z // экран: Y вверх, диск лежит в XZ
      positions[i * 3 + 2] = s.y
      sizes[i] = starScale(s.star.radius)
    })

    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setAttribute('size', new BufferAttribute(sizes, 1))
    g.setAttribute('color', new BufferAttribute(new Float32Array(systems.length * 3), 3))
    g.computeBoundingSphere()
    return g
  }, [systems])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: starVertex,
        fragmentShader: starFragment,
        uniforms: { uHalfHeight: { value: 1 }, uMinPixels: { value: 1.6 } },
        transparent: true,
        depthWrite: false,
        vertexColors: true,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  // Пиксели на световой год зависят от высоты окна. Растянули окно — точки
  // обязаны вырасти вместе с ним, иначе звёзды худеют при полноэкранном режиме.
  material.uniforms.uHalfHeight!.value = size.height / 2

  /**
   * Цвета. Звезда горит своим светом независимо от того, дотянется ли до неё
   * привод: галактика существует не ради него.
   *
   * Раньше недостижимые тускнели втрое, и карта распадалась на живой пузырь
   * вокруг корабля и серую пыль вокруг. Дальность прыжка и без того нарисована
   * сферой; гасить три четверти галактики ради того, что уже показано, — значит
   * сказать одно и то же дважды, потеряв во второй раз всю картину.
   *
   * Пересчитываются только при смене наведения или выбора — не в кадре.
   */
  useEffect(() => {
    const colors = geometry.getAttribute('color') as BufferAttribute
    systems.forEach((s, i) => {
      _colour.setHex(s.star.color)
      if (i === hovered || i === selected) _colour.lerp(_white, 0.6)
      colors.setXYZ(i, _colour.r, _colour.g, _colour.b)
    })
    colors.needsUpdate = true
  }, [geometry, systems, hovered, selected])

  return (
    <points
      geometry={geometry}
      material={material}
      frustumCulled={false}
      onPointerMove={(e) => {
        e.stopPropagation()
        onHover(e.index ?? null)
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation()
        if (e.index != null) onSelect(e.index)
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
  return <mesh geometry={geometry} material={material} position={at} scale={0.8} raycast={() => null} />
}

/**
 * Дальность прыжка. Не сфера, а ОКРУЖНОСТЬ в плоскости диска.
 *
 * Прозрачный шар накрывал собой полгалактики и читался как туман: звёзды внутри
 * него тонули, а граница — единственное, что он должен был показать, — не имела
 * ни одной чёткой точки. Диск плоский, звёзды лежат в нём, и предел привода
 * честно рисуется линией: вот сюда достаёт, а сюда уже нет.
 */
const JUMP_RING_SEGMENTS = 160

const jumpRingGeometry = (() => {
  const points = new Float32Array(JUMP_RING_SEGMENTS * 3)
  for (let i = 0; i < JUMP_RING_SEGMENTS; i++) {
    const angle = (i / JUMP_RING_SEGMENTS) * Math.PI * 2
    points[i * 3] = Math.cos(angle)
    points[i * 3 + 1] = 0 // окружность лежит в плоскости диска
    points[i * 3 + 2] = Math.sin(angle)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(points, 3))
  return g
})()

/**
 * Две окружности достижимости: сплошная — текущий ЗАРЯД (докуда долетишь сейчас),
 * тусклая снаружи — предел МОДЕЛИ (докуда с полным баком). Разрыв между ними и
 * есть израсходованное топливо; заправишься — сплошная дорастёт до тусклой.
 */
function JumpSphere({ at, charge, max }: { at: Vector3; charge: number; max: number }) {
  const chargeMat = useMemo(
    () => new LineBasicMaterial({ color: UI.PRIMARY, transparent: true, opacity: 0.6, toneMapped: false }),
    [],
  )
  const maxMat = useMemo(
    () => new LineBasicMaterial({ color: UI.PRIMARY, transparent: true, opacity: 0.16, toneMapped: false }),
    [],
  )

  if (max <= 0) return null
  return (
    <>
      {charge < max - 1e-6 && (
        <lineLoop geometry={jumpRingGeometry} material={maxMat} position={at} scale={max} raycast={() => null} />
      )}
      {charge > 0 && (
        <lineLoop geometry={jumpRingGeometry} material={chargeMat} position={at} scale={charge} raycast={() => null} />
      )}
    </>
  )
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
 * Подпись у самой звезды.
 *
 * Имя обязано стоять там, где смотрит глаз, — иначе взгляд ходит от курсора в
 * угол экрана и обратно, и на карте из 2500 точек это единственное движение,
 * которое приходится делать каждый раз.
 *
 * Подпись — это DOM поверх канваса, а не спрайт: текст в текстуре на карте с
 * бесконечным зумом либо мылится, либо стоит атласа. Проекция считается в кадре
 * и пишется прямо в `style.transform`: React о движении камеры не знает.
 */
const _screen = new Vector3()

function StarLabel({ at, box }: { at: Vector3 | null; box: React.RefObject<HTMLDivElement | null> }) {
  const { camera, size } = useThree()

  useFrame(() => {
    const el = box.current
    if (!el) return
    if (!at) {
      el.style.opacity = '0'
      return
    }

    _screen.copy(at).project(camera)
    // Точка за спиной камеры проецируется зеркально: без этого подпись висела бы
    // на противоположном краю экрана, будто звезда впереди.
    if (_screen.z > 1) {
      el.style.opacity = '0'
      return
    }

    const x = (_screen.x * 0.5 + 0.5) * size.width
    const y = (-_screen.y * 0.5 + 0.5) * size.height
    el.style.opacity = '1'
    el.style.transform = `translate(${Math.round(x + 12)}px, ${Math.round(y - 8)}px)`
  })

  return null
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
  'out-of-charge': 'ЗАРЯД ИЗРАСХОДОВАН · К ЗВЕЗДЕ ИЛИ СТАНЦИИ',
  'same-system': 'ВЫ УЖЕ ЗДЕСЬ',
  docked: 'СНАЧАЛА ОТЧАЛЬТЕ',
}

export function GalaxyMap({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const world = session.world

  // 2500 систем строятся за миллисекунды, но не каждый кадр: зерно задаёт всё.
  const systems = useMemo(() => generateGalaxy(world.galaxySeed), [world.galaxySeed])
  // Имя и форма выводятся из того же зерна: галактика не хранится нигде.
  const galaxy = useMemo(
    () => ({ name: galaxyName(world.galaxySeed), shape: galaxyShape(world.galaxySeed) }),
    [world.galaxySeed],
  )

  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const control = useRef({ yaw: 0.6, pitch: 0.5, distance: GALAXY.RADIUS_LY * 2.6 })
  const dragging = useRef(false)
  const label = useRef<HTMLDivElement>(null)

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

  const doJump = (index: number, arrival: Arrival | null) => {
    if (jumpTo(session, index, arrival)) onClose()
  }

  return (
    <div
      // Та же голограмма над консолью, что и у карты системы: обе карты — один
      // прибор, и рамка у них обязана быть одна. Полотно звёзд прозрачно, поэтому
      // диск галактики лежит прямо на подсвеченном стекле панели.
      className="absolute inset-0 flex items-center justify-center backdrop-blur-md"
      style={{ background: 'radial-gradient(ellipse at center, rgba(12,34,60,0.66), rgba(0,3,8,0.93))' }}
    >
      <div
        className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] items-stretch overflow-hidden rounded-2xl border font-mono"
        style={{
          color: UI.PRIMARY,
          borderColor: 'rgba(124,196,255,0.3)',
          background: 'linear-gradient(150deg, rgba(40,95,150,0.18), rgba(8,22,42,0.4))',
          boxShadow: '0 0 70px rgba(60,150,255,0.16), inset 0 0 90px rgba(80,180,255,0.06)',
        }}
      >
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
        <Canvas
          camera={{ fov: 45, near: 0.1, far: 4000 }}
          // Полотно прозрачно: фон рисует панель, а не рендерер. Иначе чёрный
          // прямоугольник вырезал бы дыру в подсвеченном стекле.
          gl={{ antialias: true, alpha: true }}
        >
          <OrbitCamera control={control.current} />
          <Stars
            systems={systems}
            hovered={hovered}
            selected={selected}
            onHover={setHovered}
            onSelect={setSelected}
          />
          <JumpSphere at={here} charge={world.player.jumpCharge} max={world.player.spec.jumpRange} />
          <YouAreHere at={here} />
          <Route from={here} to={picked ? positionOf(picked.system) : null} />
          <StarLabel at={picked ? positionOf(picked.system) : null} box={label} />
        </Canvas>

        <div className="pointer-events-none absolute inset-x-0 top-0 p-6">
          <div className="text-xl tracking-[0.3em]">ГАЛАКТИКА {galaxy.name.toUpperCase()}</div>
          <div className="mt-1 text-xs tracking-widest" style={{ color: UI.DIM }}>
            {galaxy.shape.name.toUpperCase()} · {systems.length} ЗВЁЗД
          </div>
        </div>

        {/* Подпись живёт всегда: её двигает кадр, а не React. Пропадает — гаснет. */}
        <div
          ref={label}
          className="pointer-events-none absolute left-0 top-0 text-sm leading-tight opacity-0"
          style={{ willChange: 'transform' }}
        >
          <div className="tracking-widest">{picked?.system.name.toUpperCase() ?? ''}</div>
          <div style={{ color: UI.DIM }}>{picked ? formatRange(picked.distance) : ''}</div>
        </div>
      </div>

        <SystemPanel
          systems={systems}
          world={world}
          selected={selected}
          onJump={doJump}
          onClose={onClose}
        />
      </div>
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
  onJump: (index: number, arrival: Arrival | null) => void
  onClose: () => void
}) {
  const system = selected != null ? systems[selected] : null

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l p-6" style={{ borderColor: UI.DIM }}>
      {/* Название галактики уже стоит над картой. Здесь — только то, чего там нет:
          где ты и насколько далеко тебя увезёт привод. */}
      <p className="text-xs tracking-widest" style={{ color: UI.DIM }}>
        ВЫ ЗДЕСЬ: {world.systemName.toUpperCase()} · ЗАРЯД{' '}
        {world.player.jumpCharge.toFixed(0)}/{world.player.spec.jumpRange.toFixed(0)} СВ.Г.
      </p>

      {!system ? (
        <p className="mt-10 text-sm leading-relaxed" style={{ color: UI.DIM }}>
          Окружность — предел гиперпривода. Что за ней, берут приводом помощнее,
          а не терпением.
        </p>
      ) : (
        <SystemDetails
          // Выбор точки выхода принадлежит СИСТЕМЕ: сменил звезду — крестик снят.
          key={selected}
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
  onJump: (index: number, arrival: Arrival | null) => void
}) {
  const distance = jumpDistance(world, index)
  const blocked = jumpBlock(world, index)
  const capital = capitalOf(system)
  const core = index === CORE_INDEX

  /**
   * Описание системы, по которому её и построят. Считается из индекса и зерна —
   * ничего не хранится, поэтому и на карте, и в мире это одна и та же система.
   */
  const def = useMemo(() => systemDefFor(index, world.galaxySeed), [index, world.galaxySeed])
  const [arrival, setArrival] = useState<Arrival | null>(null)

  return (
    <div className="mt-5 flex flex-1 flex-col">
      <h1 className="text-3xl leading-none tracking-[0.2em]">{system.name.toUpperCase()}</h1>
      <dl className="mt-5 space-y-1 text-sm">
        <Row label="СВЕТИЛО" value={system.companion ? `${system.star.className} · двойная` : system.star.className} />
        <Row label="РАССТОЯНИЕ" value={formatRange(distance)} />
        <Row label="ПЛАНЕТ" value={String(system.planets.length)} />
        <Row label="ОХРАНА" value={system.security} />
        {capital && <Row label="СТОЛИЦА" value={`${capital.name} · ${capital.settlement.economy}`} />}
        {capital && <Row label="СТРОЙ" value={`${capital.settlement.government} · ТУ ${capital.settlement.techLevel}`} />}
        <Row label="ТОПЛИВО" value={system.star.scoopable ? 'зачерпнуть можно' : 'не зачерпнуть'} />
        {system.dyson && (
          <Row
            label="МЕГАСТРУКТУРА"
            value={system.dyson.ruined ? 'сфера Дайсона · руины' : 'сфера Дайсона'}
          />
        )}
      </dl>

      {core && (
        <p className="mt-4 text-xs leading-relaxed" style={{ color: UI.WARN }}>
          ЯДРО ГАЛАКТИКИ. За горизонтом событий — выход из чёрной дыры другой галактики.
        </p>
      )}

      <Orrery def={def} arrival={arrival} onPick={setArrival} />
      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: UI.DIM }}>
        {describeArrival(def, arrival)}
      </p>

      <button
        type="button"
        disabled={blocked !== null}
        onClick={() => onJump(index, arrival)}
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
 * Схема системы: звезда, орбиты и КРЕСТИК точки выхода.
 *
 * Схема строится из `SystemDef` — из того самого описания, по которому будет
 * собран мир, а не из карточки генератора. Иначе крестик указывал бы на планету,
 * которой в системе не окажется: родная система задана вручную и генератору не
 * подчиняется, а прыгать домой можно, как в любую другую.
 *
 * Радиус логарифмический — иначе внутренние миры слипаются в точку у светила,
 * а внешний уезжает за край. Азимут настоящий: `atan2(z, x)` от звезды, поэтому
 * клик по схеме — это клик по месту в системе, а не по картинке.
 */
const ORRERY_VIEW = 160
const ORRERY_CENTRE = ORRERY_VIEW / 2
/** Внутренняя орбита ложится сюда, внешняя — на `HUB + REACH`. */
const ORRERY_HUB = 12
const ORRERY_REACH = 62
/** Ближе этого к планете крестик прилипает к ней. Попасть в точку в 2 единицы мышью нельзя. */
const SNAP = 7

interface Ring {
  name: string
  orbit: number
  angle: number
  radius: number
  giant: boolean
  station: boolean
  x: number
  y: number
}

function rings(def: SystemDef): Ring[] {
  const seat = stationSeat(def)
  const bounds = arrivalBounds(def)
  if (!bounds) return []

  /**
   * Логарифм берётся от ОТНОШЕНИЯ орбиты к внутренней, а не от неё самой.
   *
   * Орбиты расходятся геометрически, поэтому в логарифме они стоят через равные
   * промежутки — но только если отсчитывать от первой. Абсолютный логарифм делил
   * `lg(2.4e10)` на `lg(1e12)`, и внутренняя планета оказывалась сразу на семидесяти
   * процентах радиуса: все миры любой системы жались к краю, а середина пустовала.
   *
   * Единственная планета отношения не имеет — ей отводится середина: рисовать её
   * у самого светила было бы такой же ложью, как и на краю.
   */
  const span = Math.log(bounds.max / bounds.min)

  return def.planets.map((p, i) => {
    const orbit = Math.hypot(p.pos[0] - def.star.pos[0], p.pos[2] - def.star.pos[2])
    const angle = Math.atan2(p.pos[2] - def.star.pos[2], p.pos[0] - def.star.pos[0])
    const radius = ORRERY_HUB + (span > 1e-6 ? Math.log(orbit / bounds.min) / span : 0.5) * ORRERY_REACH
    return {
      name: p.name,
      orbit,
      angle,
      radius,
      giant: p.type === 'Газовый гигант',
      station: i === seat,
      x: ORRERY_CENTRE + radius * Math.cos(angle),
      y: ORRERY_CENTRE + radius * Math.sin(angle),
    }
  })
}

/** Обратный ход шкалы: из радиуса на схеме — в орбиту в метрах. */
function orbitAt(def: SystemDef, radius: number): number {
  const bounds = arrivalBounds(def)
  if (!bounds) return 0
  const span = Math.log(bounds.max / bounds.min)
  if (span <= 1e-6) return bounds.min
  const k = (radius - ORRERY_HUB) / ORRERY_REACH
  return bounds.min * Math.exp(k * span)
}

function Orrery({
  def,
  arrival,
  onPick,
}: {
  def: SystemDef
  arrival: Arrival | null
  onPick: (arrival: Arrival | null) => void
}) {
  const plotted = rings(def)
  if (plotted.length === 0) {
    return (
      <p className="mt-6 text-xs" style={{ color: UI.DIM }}>
        Планет нет. Лететь не к чему, кроме самой звезды.
      </p>
    )
  }

  const bounds = arrivalBounds(def)!
  const inner = ORRERY_HUB
  const outer = ORRERY_HUB + ORRERY_REACH

  const pick = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * ORRERY_VIEW - ORRERY_CENTRE
    const y = ((event.clientY - box.top) / box.height) * ORRERY_VIEW - ORRERY_CENTRE

    // Планета важнее пустоты: попасть мышью в точку в две единицы нельзя.
    const near = plotted.findIndex((p) => Math.hypot(p.x - ORRERY_CENTRE - x, p.y - ORRERY_CENTRE - y) < SNAP)
    if (near >= 0) {
      onPick({ kind: 'body', planet: near })
      return
    }

    const radius = Math.hypot(x, y)
    // Пустое место — только внутри пояса. Домен зажмёт и сам, но крестик обязан
    // встать туда, куда корабль в самом деле выйдет, а не туда, куда ткнули.
    const clamped = Math.min(outer, Math.max(inner, radius))
    onPick({ kind: 'point', orbit: orbitAt(def, clamped), angle: Math.atan2(y, x) })
  }

  const cross = crossAt(def, plotted, arrival)

  return (
    <svg
      viewBox={`0 0 ${ORRERY_VIEW} ${ORRERY_VIEW}`}
      className="mt-6 w-full cursor-crosshair"
      onClick={pick}
      role="img"
      aria-label={`Схема системы ${def.name}`}
    >
      {/* Пояс выхода: между этими окружностями можно ткнуть в пустоту. */}
      <circle cx={ORRERY_CENTRE} cy={ORRERY_CENTRE} r={(inner + outer) / 2}
        fill="none" stroke={UI.PRIMARY} strokeWidth={outer - inner} opacity="0.05" />

      {/*
        Двойная. Разнос пары — миллионы километров против миллиардов до планет:
        в масштабе схемы они слились бы в одну точку. Поэтому спутник отрисован
        условно рядом с главной — не по орбите, а как знак «здесь два солнца».
      */}
      {def.companion && (
        <circle cx={ORRERY_CENTRE + 5} cy={ORRERY_CENTRE - 4} r="3.4"
          fill={`#${def.companion.color.toString(16).padStart(6, '0')}`} />
      )}
      <circle cx={ORRERY_CENTRE} cy={ORRERY_CENTRE} r="6" fill={`#${def.star.color.toString(16).padStart(6, '0')}`} />
      {plotted.map((p) => (
        <g key={p.name}>
          <circle cx={ORRERY_CENTRE} cy={ORRERY_CENTRE} r={p.radius} fill="none" stroke={UI.DIM} strokeWidth="0.4" opacity="0.5" />
          {/* Газовый гигант виден гигантом и на схеме. */}
          <circle cx={p.x} cy={p.y} r={p.giant ? 3.4 : 2} fill={p.station ? UI.PRIMARY : UI.DIM} />
        </g>
      ))}

      {cross && <Cross x={cross.x} y={cross.y} />}
      {/* Сброс выбора: клик по звезде. Отдельной кнопки он не стоит. */}
      <circle cx={ORRERY_CENTRE} cy={ORRERY_CENTRE} r="8" fill="transparent"
        onClick={(e) => { e.stopPropagation(); onPick(null) }} />
      <title>{`Пояс выхода: ${formatOrbit(bounds.min)} — ${formatOrbit(bounds.max)}`}</title>
    </svg>
  )
}

/** Где стоит крестик. Тело — на своей отметке, пустое место — по орбите и азимуту. */
function crossAt(def: SystemDef, plotted: Ring[], arrival: Arrival | null): { x: number; y: number } | null {
  if (!arrival) return null
  if (arrival.kind === 'body') {
    const p = plotted[arrival.planet]
    return p ? { x: p.x, y: p.y } : null
  }
  const bounds = arrivalBounds(def)
  if (!bounds) return null
  const span = Math.log(bounds.max / bounds.min)
  const orbit = Math.min(bounds.max, Math.max(bounds.min, arrival.orbit))
  const r = ORRERY_HUB + (span > 1e-6 ? Math.log(orbit / bounds.min) / span : 0.5) * ORRERY_REACH
  return { x: ORRERY_CENTRE + r * Math.cos(arrival.angle), y: ORRERY_CENTRE + r * Math.sin(arrival.angle) }
}

function Cross({ x, y }: { x: number; y: number }) {
  const arm = 5
  return (
    <g stroke={UI.TARGET} strokeWidth="0.8" style={{ pointerEvents: 'none' }}>
      <line x1={x - arm} y1={y} x2={x - 1.5} y2={y} />
      <line x1={x + 1.5} y1={y} x2={x + arm} y2={y} />
      <line x1={x} y1={y - arm} x2={x} y2={y - 1.5} />
      <line x1={x} y1={y + 1.5} x2={x} y2={y + arm} />
      <circle cx={x} cy={y} r="6.5" fill="none" strokeDasharray="1.5 2" opacity="0.7" />
    </g>
  )
}

const AU = 149_597_870_700
const formatOrbit = (metres: number) => `${(metres / AU).toFixed(2)} а.е.`

/**
 * Что пилот увидит, выйдя из прыжка. Слова, а не координаты: «в миллионе
 * километров от причала» говорит о дороге больше, чем «x = 1.4·10¹¹».
 */
function describeArrival(def: SystemDef, arrival: Arrival | null): string {
  if (!def.planets.length) return 'Выход у звезды: планет здесь нет.'
  if (!arrival) return 'Крестик на схеме — точка выхода. Пустое место или мир; звезда снимает выбор.'

  if (arrival.kind === 'body') {
    const planet = def.planets[arrival.planet]
    if (!planet) return ''
    const berth = stationSeat(def) === arrival.planet
    return berth
      ? `Выход в ${(ARRIVAL.STANDOFF / 1000).toFixed(0)} тыс. км от причала: минута крейсерского хода.`
      : `Выход у мира ${planet.name}, в ${(ARRIVAL.STANDOFF / 1000).toFixed(0)} тыс. км над поверхностью.`
  }

  return `Выход в пустоте, ${formatOrbit(arrivalOrbit(def, arrival.orbit))} от светила. Оттуда лететь самому.`
}

const arrivalOrbit = (def: SystemDef, orbit: number): number => {
  const bounds = arrivalBounds(def)
  return bounds ? Math.min(bounds.max, Math.max(bounds.min, orbit)) : orbit
}
