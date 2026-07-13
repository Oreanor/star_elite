import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useWheelZoom } from './useWheelZoom'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
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
  CORE_INDEX,
  GALAXY,
  arrivalBounds,
  galaxyName,
  galaxyShape,
  generateGalaxy,
  isInhabited,
  jumpBlock,
  jumpDistance,
  livingContacts,
  stationSeat,
  stationsOf,
  systemDefFor,
  systemLife,
  type Arrival,
  type StarSystem,
  type SystemDef,
  type World,
} from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { useOnlinePlayers } from '../../app/net/presence'
import { jumping, startDepart } from '../../app/control/jumpFx'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { galaxyShapeName, lifeName, properName } from '../i18n/dataNames'

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
        // Отсеянная фильтром звезда курсора не ловит: наводимся только на видимые.
        onHover(e.index != null && visible[e.index] ? e.index : null)
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation()
        if (e.index != null && visible[e.index]) onSelect(e.index)
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
function YouAreHere({ at }: { at: Vector3 }) {
  const ref = useRef<Mesh>(null)
  const material = useMemo(() => new MeshBasicMaterial({ color: UI.PRIMARY, toneMapped: false }), [])
  useEffect(() => () => material.dispose(), [material])
  // Билборд: копируем поворот камеры — треугольник стоит остриём к звезде, телом вверх
  // экрана, каким бы боком ни повернули карту.
  useFrame((state) => {
    if (ref.current) ref.current.quaternion.copy(state.camera.quaternion)
  })
  return <mesh ref={ref} geometry={youMarkerGeometry} material={material} position={at} raycast={() => null} />
}

/** Подпись «ВЫ» у своей звезды. DOM поверх канваса: её двигает кадр, а не React. */
function YouLabel({ at, box }: { at: Vector3; box: React.RefObject<HTMLDivElement | null> }) {
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
/** Центр галактики — цель камеры по умолчанию, пока поиск ни на что не навёл. */
const _origin = /* @__PURE__ */ new Vector3()
const _look = /* @__PURE__ */ new Vector3()

function OrbitCamera({
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

const positionOf = (s: StarSystem) => new Vector3(s.x, s.z, s.y)

/** Тон знакомого на карте — тот же фиолетовый, что и на карте системы: одна метка на обе. */
const CONTACT_MAP = '#b98bff'

/** Ромб-метка знакомого: билборд в плоскости XY, вершинами по осям. Заливка — два треугольника. */
const contactMarkerGeometry = (() => {
  const g = new BufferGeometry()
  const r = 1.6
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, r, 0, r, 0, 0, 0, -r, 0, 0, r, 0, 0, -r, 0, -r, 0, 0]), 3),
  )
  return g
})()

/** Система с живыми знакомыми и их имена — для меток на карте галактики. */
interface ContactSystem {
  index: number
  names: string[]
  pos: Vector3
}

/** Сгруппировать живых знакомых по системам: одна метка на систему, имена — под ней. */
function contactSystemsOf(world: World, systems: readonly StarSystem[]): ContactSystem[] {
  const byIndex = new Map<number, string[]>()
  for (const c of livingContacts(world)) {
    const names = byIndex.get(c.record.systemIndex) ?? []
    names.push(c.record.name)
    byIndex.set(c.record.systemIndex, names)
  }
  const out: ContactSystem[] = []
  for (const [index, names] of byIndex) {
    const system = systems[index]
    if (system) out.push({ index, names, pos: positionOf(system) })
  }
  return out
}

/**
 * Метки знакомых на звёздном поле: фиолетовый ромб-билборд у каждой системы, где есть
 * живой знакомый. Со знакомыми нет случайных встреч — их положение известно всегда, и
 * карта показывает, в какой системе кто. Раскраску держим отдельной от облака звёзд:
 * это не небесное тело, а «где мои люди».
 */
function ContactStars({ systems }: { systems: ContactSystem[] }) {
  const material = useMemo(() => new MeshBasicMaterial({ color: CONTACT_MAP, toneMapped: false }), [])
  useEffect(() => () => material.dispose(), [material])
  const refs = useRef<(Mesh | null)[]>([])
  // Билборд: ромбы всегда лицом к камере, как ни поверни карту.
  useFrame((state) => {
    for (const m of refs.current) if (m) m.quaternion.copy(state.camera.quaternion)
  })
  return (
    <>
      {systems.map((s, i) => (
        <mesh
          key={s.index}
          ref={(m) => {
            refs.current[i] = m
          }}
          geometry={contactMarkerGeometry}
          material={material}
          position={s.pos}
          raycast={() => null}
        />
      ))}
    </>
  )
}

/**
 * Подписи имён у меток знакомых. DOM поверх канваса, двигается кадром (не React):
 * проецируем точку системы на экран и ставим ярлык рядом. За кулисами — те же div'ы,
 * что заведены в оверлее; здесь только их позиция.
 */
function ContactLabels({
  systems,
  boxes,
}: {
  systems: ContactSystem[]
  boxes: React.RefObject<Map<number, HTMLDivElement>>
}) {
  const { camera, size } = useThree()
  useFrame(() => {
    for (const s of systems) {
      const el = boxes.current.get(s.index)
      if (!el) continue
      _screen.copy(s.pos).project(camera)
      if (_screen.z > 1) {
        el.style.opacity = '0'
        continue
      }
      const x = (_screen.x * 0.5 + 0.5) * size.width
      const y = (-_screen.y * 0.5 + 0.5) * size.height
      el.style.opacity = '1'
      el.style.transform = `translate(${Math.round(x + 9)}px, ${Math.round(y)}px) translate(0, -50%)`
    }
  })
  return null
}

/** Тон живого игрока на карте — розовый, как на радаре (`UI.PLAYER`): одна семантика. */
const PLAYER_MAP = UI.PLAYER

/** Ромб-метка игрока: чуть крупнее контактной (r=2.0), билборд в плоскости XY. */
const playerMarkerGeometry = (() => {
  const g = new BufferGeometry()
  const r = 2.0
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, r, 0, r, 0, 0, 0, -r, 0, 0, r, 0, 0, -r, 0, -r, 0, 0]), 3),
  )
  return g
})()

/** Система с онлайн-игроками и их имена — для меток на карте галактики. */
interface PlayerSystem {
  index: number
  names: string[]
  pos: Vector3
}

/** Сгруппировать онлайн-игроков по системам: одна метка на систему, имена под ней. */
function playerSystemsOf(
  peers: readonly { systemIndex: number; name: string }[],
  systems: readonly StarSystem[],
): PlayerSystem[] {
  const byIndex = new Map<number, string[]>()
  for (const p of peers) {
    const names = byIndex.get(p.systemIndex) ?? []
    names.push(p.name)
    byIndex.set(p.systemIndex, names)
  }
  const out: PlayerSystem[] = []
  for (const [index, names] of byIndex) {
    const system = systems[index]
    if (system) out.push({ index, names, pos: positionOf(system) })
  }
  return out
}

/**
 * Метки ЖИВЫХ игроков на звёздном поле: розовый ромб у каждой системы, где сейчас
 * онлайн-игрок (из presence). Отдельно от меток знакомых (`ContactStars` — NPC из
 * реестра): это «где сейчас люди». Цвет тот же, что игроку на радаре.
 */
function PlayerStars({ systems }: { systems: PlayerSystem[] }) {
  const material = useMemo(() => new MeshBasicMaterial({ color: PLAYER_MAP, toneMapped: false }), [])
  useEffect(() => () => material.dispose(), [material])
  const refs = useRef<(Mesh | null)[]>([])
  useFrame((state) => {
    for (const m of refs.current) if (m) m.quaternion.copy(state.camera.quaternion)
  })
  return (
    <>
      {systems.map((s, i) => (
        <mesh
          key={s.index}
          ref={(m) => {
            refs.current[i] = m
          }}
          geometry={playerMarkerGeometry}
          material={material}
          position={s.pos}
          raycast={() => null}
        />
      ))}
    </>
  )
}

/** Подписи имён игроков у их меток. DOM поверх канваса, двигается кадром (не React). */
function PlayerLabels({
  systems,
  boxes,
}: {
  systems: PlayerSystem[]
  boxes: React.RefObject<Map<number, HTMLDivElement>>
}) {
  const { camera, size } = useThree()
  useFrame(() => {
    for (const s of systems) {
      const el = boxes.current.get(s.index)
      if (!el) continue
      _screen.copy(s.pos).project(camera)
      if (_screen.z > 1) {
        el.style.opacity = '0'
        continue
      }
      const x = (_screen.x * 0.5 + 0.5) * size.width
      const y = (-_screen.y * 0.5 + 0.5) * size.height
      el.style.opacity = '1'
      // Ниже метки: имена игроков смещаем вниз, чтоб не наложиться на подпись знакомого.
      el.style.transform = `translate(${Math.round(x + 9)}px, ${Math.round(y + 12)}px) translate(0, -50%)`
    }
  })
  return null
}

function formatRange(ly: number): string {
  return `${ly.toFixed(1)} ${t('unit.ly')} · ${(ly / LY_PER_PARSEC).toFixed(2)} ${t('unit.pc')}`
}

/** Почему прыжок запрещён — код домена в строку интерфейса. */
const BLOCK_KEY = {
  'no-drive': 'map.block.noDrive',
  'out-of-range': 'map.block.range',
  'out-of-charge': 'map.block.charge',
  'same-system': 'map.block.here',
  docked: 'map.block.docked',
  cruising: 'map.block.cruising',
} as const

function blockLabel(reason: NonNullable<ReturnType<typeof jumpBlock>>): string {
  return t(BLOCK_KEY[reason])
}

export function GalaxyMap({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  useLang()
  const session = useSession()
  const world = session.world

  // 2500 систем строятся за миллисекунды, но не каждый кадр: зерно задаёт всё.
  const systems = useMemo(() => generateGalaxy(world.galaxySeed), [world.galaxySeed])
  // Имя и форма выводятся из того же зерна: галактика не хранится нигде.
  const galaxy = useMemo(
    () => ({ name: galaxyName(world.galaxySeed), shape: galaxyShape(world.galaxySeed) }),
    [world.galaxySeed],
  )

  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [hovered, setHovered] = useState<number | null>(null)
  // Выбор берётся из МИРА и туда же пишется: намеченная у причала цель обязана
  // пережить закрытие карты и отчаливание — прыгать-то можно только отчалив.
  const [selected, setSelected] = useState<number | null>(world.jumpTargetIndex)

  // Фильтр по характеру системы: всё / со станциями (разумная раса колонизовала) /
  // с примитивной жизнью (фауна, без причала) / пустые (нет обитаемых миров). Отсеянные
  // звёзды гаснут и перестают ловить курсор — глаз не спорит с сотнями лишних точек.
  const [filter, setFilter] = useState<'all' | 'stations' | 'primitive' | 'empty'>('all')
  // Показывать ли метки знакомых и живых игроков. По умолчанию да — но их можно убрать.
  const [showContacts, setShowContacts] = useState(true)
  // Поиск по имени системы / её планеты / причала. Совпадение подсвечиваем и наводим камеру.
  const [query, setQuery] = useState('')

  // Категория системы: станция (раса колонизовала) → примитивная жизнь (фауна, без
  // причала) → пусто (нет обитаемых миров). Правило то же, что в генерации: причал
  // строят только играбельные расы, у одной фауны его не бывает.
  const category = useMemo(
    () =>
      systems.map((s): 'stations' | 'primitive' | 'empty' =>
        stationsOf(s).length > 0 ? 'stations' : isInhabited(s) ? 'primitive' : 'empty',
      ),
    [systems],
  )
  const visible = useMemo(
    () => systems.map((_, i) => filter === 'all' || category[i] === filter),
    [systems, filter, category],
  )
  const search = query.trim().toLowerCase()
  const searchIndex = useMemo(() => {
    if (search.length < 2) return null
    const hit = (name: string) => properName(name).toLowerCase().includes(search)
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i]!
      if (hit(s.name)) return i
      if (s.planets.some((p) => hit(p.name) || (p.station != null && hit(p.station.name)))) return i
    }
    return null
  }, [search, systems])

  const chooseSystem = (index: number) => {
    setSelected(index)
    // Затаргетились: выбор переживёт закрытие карты и отчаливание. Точку выхода по
    // умолчанию ставим на причал системы (место станции), если он там есть.
    world.jumpTargetIndex = index
    const seat = stationSeat(systemDefFor(index, world.galaxySeed))
    world.jumpArrivalPlanet = seat >= 0 ? seat : null
  }
  const control = useRef({ yaw: 0.6, pitch: 0.5, distance: GALAXY.RADIUS_LY * 2.6, target: new Vector3() })
  const dragging = useRef(false)
  const label = useRef<HTMLDivElement>(null)
  const you = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  // Метки знакомых: где живые контакты по системам. Div'ы подписей собираем в карту по
  // индексу системы — их позицию каждый кадр двигает `ContactLabels`, а не React.
  const contactSystems = contactSystemsOf(world, systems)
  const contactBoxes = useRef<Map<number, HTMLDivElement>>(new Map())
  // Онлайн-игроки по системам (из presence) — розовые метки рядом с метками знакомых.
  const peers = useOnlinePlayers()
  const playerSystems = playerSystemsOf(peers, systems)
  const playerBoxes = useRef<Map<number, HTMLDivElement>>(new Map())

  // Зум колесом/щипком — только карта. Нативный слушатель гасит браузерный зум.
  useWheelZoom(viewport, (deltaY) => {
    const d = control.current.distance * (1 + Math.sign(deltaY) * 0.12)
    control.current.distance = Math.max(GALAXY.RADIUS_LY * 0.12, Math.min(GALAXY.RADIUS_LY * 5, d))
  })

  // Камера плавно наезжает на найденную поиском систему; без поиска висит над центром.
  const searchPos = searchIndex != null ? positionOf(systems[searchIndex]!) : null
  control.current.target = searchPos ?? _origin

  const here = positionOf(systems[world.systemIndex]!)
  // Наведён курсор → он; иначе найденное поиском; иначе выбранная цель прыжка.
  const marked = hovered ?? searchIndex ?? selected
  const picked: Picked | null =
    marked != null && systems[marked]
      ? {
          system: systems[marked]!,
          distance: jumpDistance(world, marked),
          blocked: jumpBlock(world, marked),
        }
      : null

  // Встроенной в консоль клавишами заведует сама консоль — второго слушателя не вешаем.
  useEffect(() => {
    if (embedded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, embedded])

  const doJump = (index: number, arrival: Arrival | null) => {
    // Кино уже идёт — второй запуск пересобрал бы позу на середине. Отсекаем.
    if (jumping()) return
    // Не прыгаем мгновенно: запускаем кино отправления и закрываем карту, чтобы мир
    // снова пошёл. Сам прыжок исполнит постановщик под чёрным экраном.
    startDepart(session.world, index, arrival)
    onClose()
  }

  const content = (
    <>
      {/* Единый расклад всех трёх карт: полотно в левых 2/3, пульт и инфо — в правой 1/3. */}
      <div
        ref={viewport}
        className="relative w-2/3 cursor-grab active:cursor-grabbing"
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
        onPointerMove={(e) => {
          if (!dragging.current) return
          control.current.yaw -= e.movementX * 0.005
          // Не даём перевернуться через полюс: карта — не кабина.
          control.current.pitch = Math.max(-1.4, Math.min(1.4, control.current.pitch + e.movementY * 0.005))
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
            highlight={searchIndex}
            visible={visible}
            onHover={setHovered}
            onSelect={chooseSystem}
          />
          <JumpSphere at={here} charge={world.player.jumpCharge} max={world.player.spec.jumpRange} />
          <YouAreHere at={here} />
          <YouLabel at={here} box={you} />
          {showContacts && (
            <>
              <ContactStars systems={contactSystems} />
              <ContactLabels systems={contactSystems} boxes={contactBoxes} />
              <PlayerStars systems={playerSystems} />
              <PlayerLabels systems={playerSystems} boxes={playerBoxes} />
            </>
          )}
          <Route from={here} to={picked ? positionOf(picked.system) : null} />
          <StarLabel at={picked ? positionOf(picked.system) : null} box={label} />
        </Canvas>

        {/* Подпись «ВЫ» и имя под курсором живут всегда: их двигает кадр, а не React. */}
        <div
          ref={you}
          className="pointer-events-none absolute left-0 top-0 text-[11px] font-bold tracking-widest opacity-0"
          style={{ color: UI.PRIMARY, willChange: 'transform' }}
        >
          {t('map.you')}
        </div>
        <div
          ref={label}
          className="pointer-events-none absolute left-0 top-0 text-sm leading-tight opacity-0"
          style={{ willChange: 'transform' }}
        >
          <div className="tracking-widest">{picked ? properName(picked.system.name).toUpperCase() : ''}</div>
          <div style={{ color: UI.DIM }}>{picked ? formatRange(picked.distance) : ''}</div>
        </div>

        {/* Подписи знакомых — по одной на систему с живым контактом. Позицию каждой
            двигает кадр (`ContactLabels`), поэтому тут только текст и сбор ссылок.
            Скрыты вместе с метками, когда галочка знакомых снята. */}
        {showContacts && contactSystems.map((s) => (
          <div
            key={s.index}
            ref={(el) => {
              if (el) contactBoxes.current.set(s.index, el)
              else contactBoxes.current.delete(s.index)
            }}
            className="pointer-events-none absolute left-0 top-0 text-[11px] tracking-widest opacity-0"
            style={{ color: CONTACT_MAP, willChange: 'transform' }}
          >
            {s.names.map((n) => properName(n)).join(', ').toUpperCase()}
          </div>
        ))}

        {/* Подписи имён онлайн-игроков — по одной на систему, где кто-то есть. Позицию
            двигает кадр (`PlayerLabels`); имена — как есть (это подписи людей, не собственные
            имена систем), поэтому без `properName`-транслита. */}
        {showContacts && playerSystems.map((s) => (
          <div
            key={s.index}
            ref={(el) => {
              if (el) playerBoxes.current.set(s.index, el)
              else playerBoxes.current.delete(s.index)
            }}
            className="pointer-events-none absolute left-0 top-0 text-[11px] font-bold tracking-widest opacity-0"
            style={{ color: PLAYER_MAP, willChange: 'transform' }}
          >
            {s.names.join(', ').toUpperCase()}
          </div>
        ))}

      </div>

      {/* Правая 1/3: заголовок галактики, пульт (поиск / фильтр / знакомые) и выбранная
          система. Гасим pointer-события, чтобы возня в пульте не крутила диск карты. */}
      <div
        className="flex w-1/3 shrink-0 flex-col gap-3 overflow-y-auto pl-1 text-xs"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div>
          <div className="text-xl tracking-[0.3em]">
            {t('map.galaxy')} {properName(galaxy.name).toUpperCase()}
          </div>
          <div className="mt-1 tracking-widest" style={{ color: UI.DIM }}>
            {galaxyShapeName(galaxy.shape).toUpperCase()} · {t('map.starsCount', { n: systems.length })}
          </div>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('map.search')}
          className="w-full rounded border bg-black/40 px-3 py-1.5 tracking-widest outline-none placeholder:opacity-40"
          style={{
            borderColor: search.length >= 2 && searchIndex == null ? UI.WARN : 'rgba(124,196,255,0.35)',
            color: UI.PRIMARY,
          }}
        />
        {search.length >= 2 && searchIndex == null && (
          <span style={{ color: UI.WARN }}>{t('map.searchNone')}</span>
        )}

        {/* Фильтр по характеру системы: все / со станциями / примитивная жизнь / пусто. */}
        <div className="flex flex-wrap gap-1">
          {(['all', 'stations', 'primitive', 'empty'] as const).map((f) => {
            const on = filter === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className="cursor-pointer border px-2 py-1 tracking-widest transition-colors"
                style={{
                  borderColor: on ? UI.PRIMARY : UI.DIM,
                  backgroundColor: on ? UI.PRIMARY : 'transparent',
                  color: on ? '#000' : UI.DIM,
                }}
              >
                {t(`map.filter.${f}` as 'map.filter.all')}
              </button>
            )
          })}
        </div>

        <label className="flex cursor-pointer items-center gap-2 tracking-widest" style={{ color: UI.DIM }}>
          <input
            type="checkbox"
            checked={showContacts}
            onChange={(e) => setShowContacts(e.target.checked)}
            className="cursor-pointer accent-[#7fd6ff]"
          />
          {t('map.showContacts')}
        </label>

        {/* Выбранная система — карточка прямо в колонке (раньше плашка у курсора).
            Ничего не выбрано — столбец пуст, без подсказок. */}
        {selected != null && systems[selected] && (
          <SystemPopup
            key={selected}
            inline
            system={systems[selected]!}
            world={world}
            index={selected}
            docked={world.docked}
            onArrival={(planet) => {
              world.jumpArrivalPlanet = planet
              bump()
            }}
            onJump={() => doJump(selected, world.jumpArrivalPlanet != null ? { kind: 'body', planet: world.jumpArrivalPlanet } : null)}
            onClose={() => {
              setSelected(null)
              world.jumpTargetIndex = null
              world.jumpArrivalPlanet = null
              bump()
            }}
          />
        )}
      </div>
    </>
  )

  // Встроена в консоль: рамку и фон даёт стеклянная панель, карте — заполнить её.
  if (embedded) {
    return (
      <div className="flex h-full min-h-[30rem] items-stretch gap-6 overflow-hidden font-mono" style={{ color: UI.PRIMARY }}>
        {content}
      </div>
    )
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
        className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] items-stretch gap-6 overflow-hidden rounded-2xl border p-6 font-mono"
        style={{
          color: UI.PRIMARY,
          borderColor: 'rgba(124,196,255,0.3)',
          background: 'linear-gradient(150deg, rgba(40,95,150,0.18), rgba(8,22,42,0.4))',
          boxShadow: '0 0 70px rgba(60,150,255,0.16), inset 0 0 90px rgba(80,180,255,0.06)',
        }}
      >
        {content}
      </div>
    </div>
  )
}

/**
 * Плашка выбранной системы — всплывает У КУРСОРА по клику на звезду. Показывает лишь
 * то, ради чего систему выбирают: имя, сколько миров и причалов, до чего дошла жизнь,
 * и СХЕМКУ, где точку выхода ставят ТОЛЬКО у планеты со станцией — в пустоту больше
 * не прыгают. У причала прыжка нет: там только метят цель, а метка переживёт отчаливание;
 * прыгают уже в полёте — кнопкой здесь или клавишей H в кабине.
 */
function SystemPopup({
  system,
  world,
  index,
  docked,
  at,
  inline = false,
  onArrival,
  onJump,
  onClose,
}: {
  system: StarSystem
  world: World
  index: number
  docked: boolean
  /** Позиция плашки у курсора — только для всплывающего режима. В `inline` не нужна. */
  at?: { x: number; y: number; w: number; h: number }
  /** Встроена в колонку инфо (статичная карточка), а не всплывает у курсора. */
  inline?: boolean
  onArrival: (planet: number | null) => void
  onJump: () => void
  onClose: () => void
}) {
  const def = useMemo(() => systemDefFor(index, world.galaxySeed), [index, world.galaxySeed])
  const core = index === CORE_INDEX
  const blocked = docked ? null : jumpBlock(world, index)

  // Все причалы системы — индексы их планет. Порядок планет в карте и в мире совпадает
  // (мост строит SystemDef.planets один-к-одному), поэтому индекс годится и для выхода.
  const stations = stationsOf(system)
  const stationPlanets = useMemo(
    () => new Set(stations.map((s) => system.planets.indexOf(s.planet))),
    [system, stations],
  )

  // Всплывающий режим — прижимаем плашку к полю карты у курсора. Встроенная (`inline`)
  // карточка просто течёт в колонке инфо: ни абсолюта, ни фиксированной ширины.
  const PW = 384
  const PH = 220
  const pos = at && !inline
    ? { left: Math.max(8, Math.min(at.x + 12, at.w - PW - 8)), top: Math.max(8, Math.min(at.y, at.h - PH - 8)) }
    : null

  return (
    <div
      className={inline ? 'rounded-lg border p-4' : 'absolute z-30 w-96 rounded-lg border p-4 backdrop-blur-md'}
      style={{
        ...(pos ?? {}),
        borderColor: 'rgba(124,196,255,0.4)',
        background: 'rgba(8,22,42,0.88)',
        boxShadow: '0 0 30px rgba(60,150,255,0.2)',
        color: UI.PRIMARY,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex gap-4">
        {/* Слева — данные и действие. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base leading-tight tracking-[0.2em]">{properName(system.name).toUpperCase()}</h3>
            <button type="button" onClick={onClose} className="cursor-pointer text-lg leading-none" style={{ color: UI.DIM }}>
              ×
            </button>
          </div>

          <dl className="mt-3 space-y-1 text-sm">
            <Row label={t('map.planets')} value={String(system.planets.length)} />
            <Row label={t('map.stations')} value={String(stations.length)} />
            <Row label={t('map.life')} value={lifeName(systemLife(system))} />
          </dl>

          {core && <p className="mt-3 text-[11px] leading-relaxed" style={{ color: UI.WARN }}>{t('map.core')}</p>}

          {!docked && (
            <button
              type="button"
              disabled={blocked !== null}
              onClick={onJump}
              className={`mt-auto w-full border py-2 text-sm tracking-[0.3em] transition-colors ${
                blocked ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-[#7fd6ff] hover:text-black'
              }`}
              style={{ borderColor: blocked ? UI.DIM : UI.PRIMARY, color: blocked ? UI.DIM : UI.PRIMARY }}
            >
              {blocked ? blockLabel(blocked) : core ? t('map.jumpGalaxy') : t('map.jump')}
            </button>
          )}
        </div>

        {/* Справа — схемка выхода: все причалы системы кликаются, выбранный — крестиком. */}
        <div className="w-40 shrink-0">
          <StationPicker def={def} stationPlanets={stationPlanets} selected={world.jumpArrivalPlanet} onPick={onArrival} />
          {stations.length > 1 && (
            <p className="mt-2 text-[10px] leading-tight" style={{ color: UI.DIM }}>
              {t('map.pickStation', { n: stations.length })}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Схемка выхода: звезда в центре, планеты по орбитам. Кликается ТОЛЬКО планета со
 * станцией — туда и выйдешь, к причалу. Клик по звезде — выход у светила (без причала).
 * Произвольную точку больше не ставят: прыгать имеет смысл лишь туда, где есть жизнь.
 */
function StationPicker({
  def,
  stationPlanets,
  selected,
  onPick,
}: {
  def: SystemDef
  /** Индексы планет со станциями — все они кликаются как точки выхода. */
  stationPlanets: Set<number>
  /** Индекс планеты-со-станцией, у которой назначен выход, или null — у звезды. */
  selected: number | null
  onPick: (planet: number | null) => void
}) {
  const plotted = rings(def, stationPlanets)
  if (plotted.length === 0) {
    return (
      <p className="text-[11px]" style={{ color: UI.DIM }}>
        {t('map.noPlanets')}
      </p>
    )
  }
  const marked = selected != null ? plotted[selected] : null

  return (
    <div>
      <svg viewBox={`0 0 ${ORRERY_VIEW} ${ORRERY_VIEW}`} className="w-full" role="img" aria-label={`Схема ${def.name}`}>
        {/* Звезда — и точка выхода у светила: клик по ней снимает причал. */}
        <circle
          cx={ORRERY_CENTRE}
          cy={ORRERY_CENTRE}
          r="6"
          fill={`#${def.star.color.toString(16).padStart(6, '0')}`}
          className="cursor-pointer"
          onClick={() => onPick(null)}
        />
        {plotted.map((p, i) => (
          <g key={p.name}>
            <circle cx={ORRERY_CENTRE} cy={ORRERY_CENTRE} r={p.radius} fill="none" stroke={UI.DIM} strokeWidth="0.4" opacity="0.5" />
            {/* Планета со станцией светит фосфором и кликается; прочие — тусклые, мимо них. */}
            <circle cx={p.x} cy={p.y} r={p.giant ? 3.4 : 2} fill={p.station ? UI.PRIMARY : UI.DIM} opacity={p.station ? 1 : 0.4} />
            {/* Зона под палец: в точку в 2 единицы мышью не попасть. Только у станций. */}
            {p.station && (
              <circle cx={p.x} cy={p.y} r="7" fill="transparent" className="cursor-pointer" onClick={() => onPick(i)} />
            )}
          </g>
        ))}
        {marked && <Cross x={marked.x} y={marked.y} />}
      </svg>
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

function rings(def: SystemDef, stationPlanets: Set<number>): Ring[] {
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
      station: stationPlanets.has(i),
      x: ORRERY_CENTRE + radius * Math.cos(angle),
      y: ORRERY_CENTRE + radius * Math.sin(angle),
    }
  })
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

