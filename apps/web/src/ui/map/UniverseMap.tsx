import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import { useSession } from '../../app/GameContext'
import {
  selectTorusTarget,
  toggleTorusAutopilot,
  torusTargetVertex,
} from '../../app/control/torusAutopilot'
import { torusView } from '../../app/control/torusFlight'
import { TORUS } from '../../render/config'
import { GRID } from '../../render/scene/HypertorusLayer'
import { nameOfVertex, vertexOfNode } from '../../render/scene/torusNodes'
import { UI } from '../theme'
import { properName } from '../i18n/dataNames'
import { t } from '../i18n'
import { MapCard, MapFrame, MapRow } from './MapFrame'

/**
 * КАРТА МИРА — вселенная как ОБЫЧНЫЙ ШАР вокруг корабля, который вертят мышью.
 *
 * Никаких гиперпроекций: в комнате их и так довольно, и читать по ним расстояние нельзя —
 * стереографика растягивает дальнее в бесконечность и жмёт ближнее к центру. Здесь всё прямо:
 * НАПРАВЛЕНИЕ точки на шаре — то самое, куда надо повернуть нос, а ВЫНОС от центра — честная
 * дуга до галактики по S³ (γ = acos(−w), от нуля под ногами до π у противоположного края мира).
 *
 * Карта только ВЫБИРАЕТ цель. Ход даёт J — уже в полёте. Разведено нарочно: дорога к дальней
 * галактике идёт СКВОЗЬ чужие узлы, и «выбрал = полетел» выбрасывало бы у первой встречной.
 */

/** Радиус шара карты в её собственных единицах. Число ни на что не влияет, кроме камеры. */
const R = 100

/**
 * Камера смотрит в центр с постоянного направления (шар вертится сам), а колесо двигает её
 * ВДОЛЬ этого луча. Пределы: ближе 0.35R середина шара разъезжается за края кадра, дальше 5R
 * точки сливаются в пятно — за этими границами карта перестаёт что-либо показывать.
 */
const CAM_DIR = new Vector3(0, 0.18, 0.98).normalize()
const CAM_DIST = 2.75
const CAM_MIN = 0.35
const CAM_MAX = 5

interface Item {
  vertex: number
  name: string
  /** Дуга до галактики по S³, радианы: 0 — под ногами, π — предельно далеко. */
  gamma: number
  /** Единичное направление в МИРОВЫХ осях — куда поворачивать нос. */
  dir: Vector3
}

const _q = new Quaternion()

/** Снимок вселенной вокруг игрока: направление и дальность каждой галактики. */
function snapshot(names: (i: number) => string): Item[] {
  const view = torusView()
  const out: Item[] = []
  for (let i = 0; i < GRID.vertCount; i++) {
    const o = i * 4
    const x = GRID.verts[o]!
    const y = GRID.verts[o + 1]!
    const z = GRID.verts[o + 2]!
    const w = GRID.verts[o + 3]!
    // Та же поза, что двигает решётку в комнате: карта и полёт обязаны видеть одно и то же.
    const rx = view[0]! * x + view[1]! * y + view[2]! * z + view[3]! * w
    const ry = view[4]! * x + view[5]! * y + view[6]! * z + view[7]! * w
    const rz = view[8]! * x + view[9]! * y + view[10]! * z + view[11]! * w
    const rw = view[12]! * x + view[13]! * y + view[14]! * z + view[15]! * w
    const len = Math.hypot(rx, ry, rz)
    const dir = len > 1e-9 ? new Vector3(rx / len, ry / len, rz / len) : new Vector3(0, 0, -1)
    out.push({
      vertex: i,
      name: names(i),
      gamma: Math.acos(Math.min(1, Math.max(-1, -rw))),
      dir,
    })
  }
  return out
}

/** Точка карты: направление × вынос по дальности. Под ногами — центр шара. */
function place(item: Item, out: Vector3): Vector3 {
  return out.copy(item.dir).multiplyScalar((item.gamma / Math.PI) * R)
}

const _base = new Color(0x4d7fa8)
const _sel = new Color(UI.TARGET)
const _home = new Color(0x7fd6ff)
const _cross = new Color(0xffffff)
const _v = new Vector3()

function Field({
  items,
  selected,
  homeVertex,
  nose,
  onPick,
  pin,
}: {
  items: Item[]
  selected: number | null
  homeVertex: number
  nose: Vector3
  onPick: (vertex: number) => void
  /** Плашка выбранной галактики: её двигает кадр, как подписи на карте галактики. */
  pin: React.RefObject<HTMLDivElement | null>
}) {
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)
  const group = useRef<Group>(null)
  const drag = useRef({ yaw: 0.6, pitch: 0.5 })
  /** Удаление камеры от центра шара. Колесо меняет его, направление взгляда постоянно. */
  const dist = useRef(R * CAM_DIST)
  /** Сколько пикселей утянули с нажатия — по нему отличаем клик по точке от вращения шара. */
  const dragged = useRef(0)

  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(items.length * 3), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(items.length * 3), 3))
    return g
  }, [items])
  useEffect(() => () => geometry.dispose(), [geometry])

  // Позиции и цвета переписываем при смене выбора — точек семь сотен, это даром.
  useEffect(() => {
    const pos = geometry.getAttribute('position').array as Float32Array
    const col = geometry.getAttribute('color').array as Float32Array
    items.forEach((it, i) => {
      place(it, _v)
      pos[i * 3] = _v.x
      pos[i * 3 + 1] = _v.y
      pos[i * 3 + 2] = _v.z
      const c =
        it.vertex === selected
          ? _sel
          : it.vertex === TORUS.MONUMENT_NODE
            ? _cross
            : it.vertex === homeVertex
              ? _home
              : _base
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    })
    geometry.getAttribute('position').needsUpdate = true
    geometry.getAttribute('color').needsUpdate = true
  }, [geometry, items, selected, homeVertex])

  const material = useMemo(
    () =>
      new PointsMaterial({
        size: R * 0.022,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  // Каркас предельной сферы: её край — противоположный конец замкнутого мира, дальше некуда.
  const shell = useMemo(() => new SphereGeometry(R, 24, 16), [])
  useEffect(() => () => shell.dispose(), [shell])

  /**
   * МОНУМЕНТ — не точка, а крестик из трёх отрезков: среди семисот крупинок белая ничем не
   * выделяется, а «Кресты» ищут глазами чаще всего. Тот же приём, что на карте куста.
   */
  const crossGeo = useMemo(() => {
    const item = items.find((it) => it.vertex === TORUS.MONUMENT_NODE)
    const g = new BufferGeometry()
    const p = new Float32Array(18)
    if (item) {
      place(item, _v)
      const a = R * 0.045
      const axes = [
        [a, 0, 0],
        [0, a, 0],
        [0, 0, a],
      ] as const
      axes.forEach((ax, k) => {
        p[k * 6] = _v.x - ax[0]
        p[k * 6 + 1] = _v.y - ax[1]
        p[k * 6 + 2] = _v.z - ax[2]
        p[k * 6 + 3] = _v.x + ax[0]
        p[k * 6 + 4] = _v.y + ax[1]
        p[k * 6 + 5] = _v.z + ax[2]
      })
    }
    g.setAttribute('position', new BufferAttribute(p, 3))
    return g
  }, [items])
  useEffect(() => () => crossGeo.dispose(), [crossGeo])
  const crossMat = useMemo(() => new LineBasicMaterial({ color: 0xffffff }), [])
  useEffect(() => () => crossMat.dispose(), [crossMat])

  // Луч по НОСУ корабля: карта в мировых осях, поэтому целиться можно прямо по нему.
  const noseGeo = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(6), 3))
    return g
  }, [])
  useEffect(() => {
    const p = noseGeo.getAttribute('position').array as Float32Array
    p[3] = nose.x * R * 1.15
    p[4] = nose.y * R * 1.15
    p[5] = nose.z * R * 1.15
    noseGeo.getAttribute('position').needsUpdate = true
  }, [noseGeo, nose])
  useEffect(() => () => noseGeo.dispose(), [noseGeo])
  const noseMat = useMemo(() => new LineBasicMaterial({ color: 0xffd24a }), [])
  useEffect(() => () => noseMat.dispose(), [noseMat])

  /**
   * ВРАЩЕНИЕ И ЗУМ — на указателях, а не на мыши: одни и те же обработчики обслуживают мышь,
   * перо и пальцы. Одна точка тянет шар, две — щипок меняет удаление камеры; колесо делает то
   * же самое одной рукой. Всё живёт в ref: React в кадре не участвует.
   */
  useEffect(() => {
    const points = new Map<number, { x: number; y: number }>()
    /** Расстояние между пальцами на прошлом событии; 0 — щипок не начат. */
    let spread = 0

    const zoom = (factor: number) => {
      dist.current = Math.max(R * CAM_MIN, Math.min(R * CAM_MAX, dist.current * factor))
    }
    const twoPointSpread = (): number => {
      const [a, b] = [...points.values()]
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    }

    const onDown = (e: PointerEvent) => {
      points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      dragged.current = 0
      spread = points.size >= 2 ? twoPointSpread() : 0
      canvas.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      const prev = points.get(e.pointerId)
      if (!prev) return
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      points.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (points.size >= 2) {
        // ЩИПОК: пальцы разошлись — приближаем. Первое движение только задаёт базу, иначе
        // рывок на старте: пока `spread` нулевой, отношение брать не из чего.
        const now = twoPointSpread()
        if (spread > 0 && now > 0) zoom(spread / now)
        spread = now
        dragged.current += Math.abs(dx) + Math.abs(dy)
        return
      }
      dragged.current += Math.abs(dx) + Math.abs(dy)
      drag.current.yaw -= dx * 0.006
      drag.current.pitch = Math.max(-1.45, Math.min(1.45, drag.current.pitch - dy * 0.006))
    }
    const onUp = (e: PointerEvent) => {
      points.delete(e.pointerId)
      spread = 0
    }
    // Колесо: шаг экспоненциальный, поэтому «на один щелчок» приближает одинаково и вблизи,
    // и вдали. `passive:false` — иначе браузер не даст отменить прокрутку страницы.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoom(Math.exp(e.deltaY * 0.0012))
    }

    // Без этого браузер съедает жесты сам: одним пальцем крутит страницу, двумя — масштаб.
    const prevTouch = canvas.style.touchAction
    canvas.style.touchAction = 'none'
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.style.touchAction = prevTouch
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      // Ушли с карты, не сняв мышь с точки — курсор так и остался бы «пальцем» на всём экране.
      document.body.style.cursor = ''
    }
  }, [canvas])

  useFrame(({ size }) => {
    const g = group.current
    if (!g) return
    g.rotation.set(drag.current.pitch, drag.current.yaw, 0)
    camera.position.copy(CAM_DIR).multiplyScalar(dist.current)
    camera.lookAt(0, 0, 0)

    // Карточка цели — булавкой у её точки. Место считает кадр: шар вертится драгом, и
    // перерисовывать дерево ради движения плашки нельзя. Точку берём ПОСЛЕ поворота
    // группы (`updateMatrixWorld`), иначе плашка отставала бы от точки на кадр.
    const el = pin.current
    if (!el) return
    const item = selected != null ? items.find((it) => it.vertex === selected) : undefined
    if (!item) {
      el.style.opacity = '0'
      return
    }
    g.updateMatrixWorld()
    place(item, _v).applyMatrix4(g.matrixWorld).project(camera)
    if (_v.z > 1) {
      el.style.opacity = '0'
      return
    }
    const x = (_v.x * 0.5 + 0.5) * size.width
    const y = (-_v.y * 0.5 + 0.5) * size.height
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = x > size.width * 0.55 ? x - w - 12 : x + 12
    el.style.opacity = '1'
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, Math.min(size.height - h - 4, y - h / 2)))}px)`
  })

  return (
    <group ref={group}>
      <points
        geometry={geometry}
        material={material}
        frustumCulled={false}
        // Клик по точке = выбор галактики. Тянул мышью — это было вращение шара, а не выбор:
        // без этой проверки любое вращение заканчивалось бы случайной сменой цели.
        onClick={(e) => {
          e.stopPropagation()
          if (dragged.current > 4 || e.index === undefined) return
          const it = items[e.index]
          if (it) onPick(it.vertex)
        }}
        onPointerOver={() => {
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = ''
        }}
      />
      <lineSegments geometry={crossGeo} material={crossMat} frustumCulled={false} />
      <lineSegments geometry={noseGeo} material={noseMat} frustumCulled={false} />
      <mesh geometry={shell}>
        <meshBasicMaterial wireframe transparent opacity={0.12} color={0x2c5c80} />
      </mesh>
    </group>
  )
}

export function UniverseMap({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const universe = session.universe
  const homeVertex = vertexOfNode(session.bush.node)

  // Снимок на открытие: пока карта на экране, мир стоит, а пересчитывать 720 дуг каждый
  // кадр ради неподвижной картинки незачем.
  const items = useMemo(() => snapshot((i) => nameOfVertex(universe, i)), [universe])
  const nose = useMemo(() => {
    _q.copy(session.world.player.state.quat)
    return new Vector3(0, 0, -1).applyQuaternion(_q)
  }, [session])

  const [query, setQuery] = useState('')
  /**
   * ВЫБОР ОДИН НА ВСЮ ИГРУ и живёт в `torusAutopilot`. Здешнее состояние — только зеркало для
   * перерисовки: тыкнул на карте — цель тут же помечена и в комнате, выбрал Tab’ом в полёте —
   * она уже помечена, когда откроешь карту. Двух списков «что выбрано» быть не должно.
   */
  const [selected, setSelected] = useState<number | null>(torusTargetVertex())
  const pick = (vertex: number) => {
    selectTorusTarget(vertex)
    setSelected(vertex)
  }

  const found = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items
    // Ближние первыми — тот же порядок, что у Tab в комнате.
    return [...list].sort((a, b) => a.gamma - b.gamma).slice(0, 200)
  }, [items, query])

  const target = items.find((it) => it.vertex === selected) ?? null
  /** Плашка цели поверх поля: позицию ей пишет кадр внутри `Field`, а не React. */
  const pin = useRef<HTMLDivElement>(null)

  return (
    <MapFrame
      title={t('map.view.universe')}
      subtitle={`${items.length} ${t('map.view.galaxy')}`}
      aside={
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ПОИСК ГАЛАКТИКИ"
            className="w-full shrink-0 border bg-transparent px-3 py-2 text-xs tracking-widest outline-none"
            style={{ borderColor: 'rgba(124,196,255,0.35)', color: UI.PRIMARY }}
          />

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {found.map((it) => (
              <MapRow
                key={it.vertex}
                kind={t('map.view.galaxy')}
                name={
                  properName(it.name).toUpperCase() +
                  (it.vertex === homeVertex ? ' ·ДОМ' : '') +
                  (it.vertex === TORUS.MONUMENT_NODE ? ' ·КРЕСТ' : '')
                }
                meta={`${Math.round((it.gamma * 180) / Math.PI)}°`}
                color={UI.PRIMARY}
                active={it.vertex === selected}
                onClick={() => pick(it.vertex)}
              />
            ))}
          </div>

          {/* Отдельной кнопки «ЦЕЛЬ» нет: выбор применяется сразу по клику — и на карте, и в
              комнате. Здесь остаётся только тронуться, а закрыть карту — общий выход панели. */}
          <button
            type="button"
            disabled={target === null}
            onClick={() => {
              if (!target) return
              toggleTorusAutopilot()
              onClose()
            }}
            className="shrink-0 cursor-pointer border px-4 py-2 text-xs tracking-widest disabled:opacity-40"
            style={{ borderColor: 'rgba(124,196,255,0.35)' }}
          >
            ВЕСТИ
          </button>
        </>
      }
    >
      <div
        className="absolute inset-0 overflow-hidden rounded-lg border"
        style={{ borderColor: 'rgba(124,196,255,0.28)' }}
      >
        <Canvas
          camera={{
            fov: 45,
            near: 1,
            far: 2000,
            // Стартовое положение — то же, что потом держит кадр: иначе первый кадр дёргается.
            position: [
              CAM_DIR.x * R * CAM_DIST,
              CAM_DIR.y * R * CAM_DIST,
              CAM_DIR.z * R * CAM_DIST,
            ],
          }}
          gl={{ antialias: true, alpha: true }}
          // Порог попадания по точке — чуть больше её экранного размера: точки мелкие, и
          // без запаса в них не попасть мышью. Промах по шару выбор не сбрасывает.
          onCreated={({ camera, raycaster }) => {
            camera.lookAt(0, 0, 0)
            raycaster.params.Points.threshold = R * 0.03
          }}
        >
          <Field
            items={items}
            selected={selected}
            homeVertex={homeVertex}
            nose={nose}
            onPick={pick}
            pin={pin}
          />
        </Canvas>

        {/* Карточка цели — поверх поля, у самой точки. Не часть вёрстки: её появление
            ничего не двигает, а место ей каждый кадр считает `Field`. */}
        {target && (
          <div ref={pin} className="pointer-events-none absolute left-0 top-0 z-30 w-64 max-w-[80%] opacity-0" style={{ willChange: 'transform' }}>
            <MapCard
              kind={t('map.view.galaxy')}
              name={properName(target.name).toUpperCase()}
              color={UI.PRIMARY}
              locked
              lines={[
                // Дальность — в градусах дуги: 0° под ногами, 180° край мира. Единственная
                // честная мера в замкнутой вселенной, где «километров до» не существует.
                `${t('map.distance')}: ${Math.round((target.gamma * 180) / Math.PI)}°`,
                target.vertex === homeVertex ? 'ДОМ' : null,
                target.vertex === TORUS.MONUMENT_NODE ? 'КРЕСТЫ' : null,
              ]}
            />
          </div>
        )}
      </div>
    </MapFrame>
  )
}
