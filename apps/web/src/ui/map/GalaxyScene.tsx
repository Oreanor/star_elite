import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
} from 'three'
import {
  STAR_CLASSES,
  type StarSystem,
} from '@elite/sim'
import { UI } from '../theme'
import { t } from '../i18n'

/**
 * 3D-сцена карты галактики: звёзды (шейдер точек), «вы здесь», сфера дальности прыжка, маршрут,
 * подпись звезды под курсором и орбитальная камера. Меняется вместе с видом карты, а не с её
 * интерфейсом (поиск, фильтры, карточки).
 */

/** Каталожный радиус Солнца (класс G) — единица размера на карте. */
const SOLAR_CATALOG_R = STAR_CLASSES.find((c) => c.id === 'G')!.radius

/** Радиус звезды в R☉ из каталожных единиц генератора. */
export function formatStarSize(catalogRadius: number): string {
  const r = catalogRadius / SOLAR_CATALOG_R
  const n = r >= 100 ? String(Math.round(r)) : r >= 10 ? r.toFixed(0) : r >= 1 ? r.toFixed(1) : r.toFixed(2)
  return t('map.starSize', { n })
}

/** Световых лет в парсеке. Астрономы меряют парсеками, пилоты — годами. */
export const LY_PER_PARSEC = 3.26156

/**
 * Радиус звезды на карте, св.г. Класс задаёт размер: гигант виден гигантом.
 *
 * Числа маленькие намеренно. Диск — шестьдесят световых лет, среднее расстояние
 * между соседями около трёх; звезда радиусом в световой год закрывала собой
 * треть этого промежутка, и карта читалась как каша из шариков, а не как звёздное
 * поле. Настоящая звезда на таком масштабе — точка, и точкой ей и место.
 */
function starScale(radiusUnits: number): number {
  // Радиусы классов — от нейтронной до O; корень сжимает разброс, иначе карлики
  // пропадают, а гиганты заливают поле. Нормируем на типичный O (~16 R☉).
  return 0.05 + Math.sqrt(radiusUnits / SOLAR_CATALOG_R / 16) * 0.18
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

/**
 * Порог наведения на точку, св. годы. По самой звезде курсором не попасть:
 * она в четверть светового года, а на экране это два пикселя.
 */
const HOVER_LY = 0.9

export function Stars({
  systems,
  hovered,
  selected,
  highlight,
  visible,
  onHover,
  onSelect,
}: {
  systems: StarSystem[]
  hovered: number | null
  selected: number | null
  /** Найденная поиском система — подсветить, как выбранную. */
  highlight: number | null
  /** Прошла ли звезда фильтр обитаемости. Отсеянная гаснет и не ловит курсор. */
  visible: boolean[]
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
      if (i === hovered || i === selected || i === highlight) _colour.lerp(_white, 0.6)
      // Отсеянные фильтром гаснут до тлеющей искры: они на месте, но не мешают.
      else if (!visible[i]) _colour.multiplyScalar(0.14)
      colors.setXYZ(i, _colour.r, _colour.g, _colour.b)
    })
    colors.needsUpdate = true
  }, [geometry, systems, hovered, selected, highlight, visible])

  return (
    <points
      geometry={geometry}
      material={material}
      frustumCulled={false}
      onPointerMove={(e) => {
        e.stopPropagation()
        // ВЫБИРАЕМЫ ВСЕ звёзды, даже вне зоны прыжка и отсеянные фильтром: фильтр лишь
        // притеняет (эмфаза), а не запрещает выбор. Зона прыжка решает только, активна ли
        // кнопка прыжка в панельке (`jumpBlock`), — но затаргетить и разглядеть можно любую.
        onHover(e.index != null ? e.index : null)
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation()
        if (e.index != null) onSelect(e.index)
      }}
    />
  )
}

/** Треугольник-указатель «ВЫ»: вершиной вниз, к звезде, телом над ней. В плоскости XY. */
const youMarkerGeometry = (() => {
  const g = new BufferGeometry()
  // Остриё чуть выше звезды (0,1), основание ещё выше (2.6) — капля-указатель над точкой.
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-0.9, 2.6, 0, 0.9, 2.6, 0, 0.0, 1.0, 0]), 3),
  )
  return g
})()

/**
 * Где ты сам. Синий треугольник над звездой да подпись «ВЫ»: жёлтое кольцо путалось
 * с боевым захватом, а обвести звезду цветом «цели» — сказать «стреляй сюда». Синий —
 * фосфор навигации; треугольник вершиной к звезде читается указателем с любого угла.
 */
export function YouAreHere({ at }: { at: Vector3 }) {
  const ref = useRef<Mesh>(null)
  const material = useMemo(() => new MeshBasicMaterial({ color: UI.PRIMARY, toneMapped: false }), [])
  useEffect(() => () => material.dispose(), [material])
  // Билборд: копируем поворот камеры — треугольник стоит остриём к звезде, телом вверх
  // экрана, каким бы боком ни повернули карту.
  useFrame((state) => {
    if (ref.current) ref.current.quaternion.copy(state.camera.quaternion)
  })
  return <mesh ref={ref} geometry={youMarkerGeometry} material={material} position={[at.x, at.y, at.z]} raycast={() => null} />
}

/** Подпись «ВЫ» у своей звезды. DOM поверх канваса: её двигает кадр, а не React. */
export function YouLabel({ at, box }: { at: Vector3; box: React.RefObject<HTMLDivElement | null> }) {
  const { camera, size } = useThree()
  useFrame(() => {
    const el = box.current
    if (!el) return
    _screen.copy(at).project(camera)
    if (_screen.z > 1) {
      el.style.opacity = '0'
      return
    }
    const x = (_screen.x * 0.5 + 0.5) * size.width
    const y = (-_screen.y * 0.5 + 0.5) * size.height
    el.style.opacity = '1'
    // Над остриём треугольника; центрируем на точку своим же transform.
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - 34)}px) translate(-50%, -50%)`
  })
  return null
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
    // Окружность в ЛОКАЛЬНОЙ плоскости XY (нормаль +Z): билборд ниже развернёт её к камере.
    points[i * 3] = Math.cos(angle)
    points[i * 3 + 1] = Math.sin(angle)
    points[i * 3 + 2] = 0
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(points, 3))
  return g
})()

/**
 * Две окружности достижимости: сплошная — текущий ЗАРЯД (докуда долетишь сейчас),
 * тусклая снаружи — предел МОДЕЛИ (докуда с полным баком). Разрыв между ними и
 * есть израсходованное топливо; заправишься — сплошная дорастёт до тусклой.
 *
 * БИЛБОРД: кольцо всегда развёрнуто к камере (кватернион группы = кватернион камеры),
 * поэтому на экране это ровный КРУГ при любом наклоне/повороте карты, а не лежачий
 * эллипс, что вращается с диском. Так радиус достижимости читается как СФЕРА вокруг
 * звезды — «докуда дотянешься», — а не как плоское кольцо в плоскости галактики.
 */
export function JumpSphere({ at, charge, max }: { at: Vector3; charge: number; max: number }) {
  const ref = useRef<Group>(null)
  useFrame((state) => {
    if (ref.current) ref.current.quaternion.copy(state.camera.quaternion)
  })

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
    <group ref={ref} position={[at.x, at.y, at.z]}>
      {charge < max - 1e-6 && (
        <lineLoop geometry={jumpRingGeometry} material={maxMat} scale={max} raycast={() => null} />
      )}
      {charge > 0 && (
        <lineLoop geometry={jumpRingGeometry} material={chargeMat} scale={charge} raycast={() => null} />
      )}
    </group>
  )
}

/** Пунктир от текущей звезды к той, на которую навели. Отрезок, а не дуга: диск плоский. */
export function Route({ from, to }: { from: Vector3; to: Vector3 | null }) {
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
export const _screen = new Vector3()

export function StarLabel({ at, box }: { at: Vector3 | null; box: React.RefObject<HTMLDivElement | null> }) {
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
/** Центр галактики — цель камеры по умолчанию, пока поиск ни на что не навёл. */
export const _origin = /* @__PURE__ */ new Vector3()

const _look = /* @__PURE__ */ new Vector3()

export function OrbitCamera({
  control,
}: {
  control: { yaw: number; pitch: number; distance: number; target: Vector3 }
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera

  useFrame(() => {
    const { yaw, pitch, distance, target } = control
    // Точку взгляда ведём к цели плавно: поиск «подлетает» к системе, а не прыгает.
    _look.lerp(target, 0.12)
    camera.position.set(
      _look.x + distance * Math.cos(pitch) * Math.sin(yaw),
      _look.y + distance * Math.sin(pitch),
      _look.z + distance * Math.cos(pitch) * Math.cos(yaw),
    )
    camera.lookAt(_look)
  })
  return null
}

export const positionOf = (s: StarSystem) => new Vector3(s.x, s.z, s.y)
