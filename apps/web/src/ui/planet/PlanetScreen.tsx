import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Group,
  Mesh,
  MeshLambertMaterial,
  Plane,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
  type Texture,
} from 'three'
import { bodyMass, findStation, type BodyEntity, type World } from '@elite/sim'
import { loadPlanetTexture, pickVariant, planetLook } from '../../render/sky/planets'
import { t, useLang } from '../i18n'
import {
  economyName,
  governmentName,
  planetTypeName,
  properName,
  speciesName,
} from '../i18n/dataNames'
import { formatDistance } from '../hud/project'
import { useWheelZoom } from '../map/useWheelZoom'
import { ACCENT, DIM } from '../station/chrome'
import { UI } from '../theme'

/**
 * ПЛАНЕТА — паспорт мира, под которым стоишь: слева числа, справа сам мир, крупно и
 * вращаясь. Одна и та же вкладка у причала и в полёте: станция — не отдельная сущность
 * для пилота, а постройка на орбите этого мира, и смотреть их порознь незачем.
 *
 * Шар настоящий: та же текстура, что и в космосе, потому что она выбирается по ТИПУ
 * поверхности из домена (`body.surface`) и зерну тела — тем же путём, что в `Bodies`.
 * Угадывать по картинке нечего, тип известен точно.
 *
 * Расстояния лун и причала в схеме СЖАТЫ: настоящие отношения орбит увели бы спутник
 * за край кадра, а показать надо «что вокруг чего вертится», а не масштабную модель.
 * Все ЧИСЛА при этом честные и живут в колонке слева.
 */

/** Радиус планеты в единицах сцены. Камера и орбиты меряются от него. */
const R = 1

/** Масса Земли, кг — в ней меряем массу мира: «5.97e24 кг» пилоту ничего не говорит. */
const EARTH_MASS = 5.972e24
/** Радиус Земли, м — для «столько-то земных». */
const EARTH_RADIUS = 6_371_000
/** Гравитационная постоянная, м³/(кг·с²). Тяжесть считаем настоящую, не игровую. */
const G = 6.674e-11
/** Ускорение свободного падения на Земле, м/с² — тяжесть удобнее в g. */
const G_EARTH = 9.80665

const _sphere = new SphereGeometry(1, 48, 32)
/** Переиспользуемые для проекции и захвата: в кадре и в драге не аллоцируем. */
const _screen = new Vector3()
const _ndc = new Vector2()
const _ray = new Raycaster()
const _hit = new Vector3()
/** Плоскость орбит (y=0): по ней и ловим мышь, когда тянут спутник. */
const _plane = new Plane(new Vector3(0, 1, 0), 0)

/** Спутники этого мира и его причал — по родителю орбиты, а не по близости. */
function satellitesOf(world: World, planet: BodyEntity): { moons: BodyEntity[]; station: BodyEntity | null } {
  const moons = world.bodies.filter((b) => b.kind === 'moon' && b.orbit?.parentId === planet.id)
  const own = world.bodies.find((b) => b.kind === 'station' && b.orbit?.parentId === planet.id)
  return { moons, station: own ?? (findStation(world)?.orbit?.parentId === planet.id ? findStation(world) : null) }
}

/** Кратчайшая разность углов, рад: −π…π. Иначе догон шёл бы «через весь круг». */
function shortestAngle(delta: number): number {
  return ((delta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
}

/**
 * Экспоненциальное сближение за шаг: доля пути, которую проходят за `dt` при постоянной
 * τ. Не зависит от частоты кадров — в отличие от наивного `x += d * 0.1`, который на
 * 144 Гц сходится вдвое быстрее, чем на 72.
 */
function approach(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau)
}

/**
 * Шар с настоящей текстурой мира. Вращается сам — вокруг своей оси, в свою сторону.
 *
 * Его можно РАСКРУТИТЬ мышью: драг по горизонтали крутит шар, а на отпускании остаётся
 * маховик — набранная скорость гаснет трением и возвращается к собственной. Это витрина,
 * и трение здесь бутафорское: домен о нём не знает, вращение мира в симуляции своё.
 */
function Globe({ body, spin, radius }: { body: BodyEntity; spin: number; radius: number }) {
  const ref = useRef<Mesh>(null)
  /** Текущая угловая скорость шара на витрине, рад/с. Драг её задаёт, трение возвращает. */
  const vel = useRef(spin)
  const drag = useRef<{ x: number; at: number } | null>(null)
  const look = planetLook(body.surface)
  // Зерно то же, что в сцене (`Bodies`): вкладка обязана показывать ТОТ ЖЕ мир, что за окном.
  const seed = body.id * 7919
  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => loadPlanetTexture(look, pickVariant(look, seed), setTexture), [look, seed])

  const material = useMemo(() => new MeshLambertMaterial({ color: body.color }), [body.color])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    material.map = texture
    material.color.set(texture ? 0xffffff : body.color)
    material.needsUpdate = true
  }, [material, texture, body.color])

  // Драг живёт на окне, а не на самом шаре: увёл курсор за край планеты — вращение не
  // должно обрываться. Слушатели ставятся только на время захвата.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      const m = ref.current
      if (!d || !m) return
      const dx = e.clientX - d.x
      const dt = Math.max(0.008, (e.timeStamp - d.at) / 1000)
      const step = dx * 0.01
      m.rotation.y += step
      // Скорость маховика — из ЖЕСТА: сколько прокрутил за секунду, столько и полетит.
      vel.current = step / dt
      drag.current = { x: e.clientX, at: e.timeStamp }
    }
    const onUp = () => {
      drag.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  // Вращение — по кадру, а не по времени мира: это витрина, и она крутится, даже когда
  // мир на паузе у причала. Знак берём у собственного вращения тела: обратное вращение
  // бывает, и выглядит правильно только настоящим.
  useFrame((_, dt) => {
    const m = ref.current
    if (!m || drag.current) return // в руке шар крутит жест, а не кадр
    // Трение: набранная драгом скорость плавно возвращается к собственной. Ноль трения
    // означал бы вечно раскрученный шар, мгновенное — что маховика вовсе нет.
    vel.current += (spin - vel.current) * approach(dt, 1.6)
    m.rotation.y += dt * vel.current
  })

  return (
    <mesh
      ref={ref}
      geometry={_sphere}
      material={material}
      scale={radius}
      onPointerDown={(e) => {
        e.stopPropagation()
        drag.current = { x: e.clientX, at: e.timeStamp }
      }}
    >
      {/* Наклон оси — из данных тела: терминатор и полюса получаются сами. */}
    </mesh>
  )
}

/**
 * Спутник или причал на своём кольце: маленький шар, идущий по орбите вокруг мира.
 *
 * Каждый ПОДПИСАН: без имени крутящаяся точка — просто точка, и не отличить луну от
 * причала. Подпись — обычный div поверх полотна, её позицию пишет кадр прямо в стиль
 * (тот же приём, что у имён на карте галактики): React в кадре не участвует.
 */
function Satellite({
  radius,
  orbit,
  rate,
  phase,
  color,
  id,
  boxes,
}: {
  radius: number
  orbit: number
  rate: number
  /** Начальный угол. Берётся из фазы орбиты тела, а не бросается: одно зерно — одна картина. */
  phase: number
  color: number
  /** Кому принадлежит подпись — id тела: по нему она и лежит в общей карте ссылок. */
  id: number
  /** Подписи всех спутников. Двигаются тем же кадром, что и сами шары. */
  boxes: React.RefObject<Map<number, HTMLDivElement>>
}) {
  const ref = useRef<Group>(null)
  const material = useMemo(() => new MeshLambertMaterial({ color }), [color])
  useEffect(() => () => material.dispose(), [material])
  /** Где спутник ПОКАЗАН. Его и тянет мышь. */
  const angle = useRef(phase)
  /** Где он ДОЛЖЕН быть по расписанию. Идёт своим ходом, что бы ни делала рука. */
  const truth = useRef(phase)
  const held = useRef(false)
  const { camera, gl } = useThree()

  // Держим на окне: увёл курсор мимо крошечного шарика — хват не должен срываться.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!held.current) return
      // Куда указывает мышь В ПЛОСКОСТИ ОРБИТЫ: луч камеры через курсор пересекаем с
      // плоскостью y=0. Радиус кольца не трогаем — тянуть можно только ВДОЛЬ орбиты.
      const rect = gl.domElement.getBoundingClientRect()
      _ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      _ray.setFromCamera(_ndc, camera)
      if (!_ray.ray.intersectPlane(_plane, _hit)) return
      angle.current = Math.atan2(_hit.z, _hit.x)
    }
    const onUp = () => {
      held.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [camera, gl])

  useFrame(({ size }, dt) => {
    const m = ref.current
    if (!m) return

    // Расписание идёт всегда — даже пока луну держат в руке. Отпустил — она НЕ прыгает
    // на своё место, а ДОГОНЯЕТ его: собственный ход плюс экспоненциальное сближение,
    // поэтому чем дальше утащил, тем дольше и быстрее возвращается.
    truth.current += dt * rate
    if (!held.current) {
      angle.current += dt * rate
      angle.current += shortestAngle(truth.current - angle.current) * approach(dt, 1.1)
    }
    m.position.set(Math.cos(angle.current) * orbit, 0, Math.sin(angle.current) * orbit)

    const el = boxes.current.get(id)
    if (!el) return
    _screen.copy(m.position).project(camera)
    // За спиной камеры точка проецируется зеркально — подпись висела бы не с той стороны.
    if (_screen.z > 1) {
      el.style.opacity = '0'
      return
    }
    el.style.opacity = '1'
    el.style.transform = `translate(${Math.round((_screen.x * 0.5 + 0.5) * size.width + 8)}px, ${Math.round(
      (-_screen.y * 0.5 + 0.5) * size.height,
    )}px) translate(0, -50%)`
  })

  return (
    <group ref={ref}>
      <mesh geometry={_sphere} material={material} scale={radius} />
      {/*
        Зона захвата: прозрачный шар втрое больше видимого. Увеличивать сам спутник
        нельзя — его размер значит «во сколько раз меньше планеты», а поймать мышью
        крупинку в шесть сотых радиуса невозможно. `visible` не годится: невидимое
        R3F не трассирует вовсе, поэтому берём прозрачный материал.
      */}
      <mesh
        geometry={_sphere}
        scale={Math.max(radius * 3, R * 0.14)}
        onPointerDown={(e) => {
          e.stopPropagation() // иначе тот же жест раскрутит и планету под ним
          held.current = true
        }}
        onPointerOver={() => (gl.domElement.style.cursor = 'grab')}
        onPointerOut={() => (gl.domElement.style.cursor = '')}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * Камера смотрит в центр с постоянного направления, а колесо двигает её ВДОЛЬ этого луча.
 * Дальний предел щедрый: отдалиться надо не «немного», а так, чтобы в кадр попали и
 * дальние кольца спутников, и причал. Ближний — чтобы шар не пролез сквозь камеру.
 */
const CAM_DIR = new Vector3(0, 0.26, 1).normalize()
const CAM_NEAR = R * 1.7
const CAM_FAR = R * 40

/** Камера-рельса: положение живёт в ref, кадр его применяет. React в этом не участвует. */
function CameraRig({ dist }: { dist: React.RefObject<number> }) {
  useFrame(({ camera }) => {
    camera.position.copy(CAM_DIR).multiplyScalar(dist.current)
    camera.lookAt(0, 0, 0)
  })
  return null
}

/** Строка паспорта: подпись — значение. Двоеточие обязательно: имя без рода не читается. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1" style={{ borderColor: 'rgba(124,196,255,0.12)' }}>
      <span className="shrink-0 text-xs tracking-widest" style={{ color: DIM }}>
        {label}:
      </span>
      <span className="min-w-0 truncate text-right text-sm">{value}</span>
    </div>
  )
}

/** Период обращения/вращения из угловой скорости: часы, пока не наберётся сутки. */
function formatPeriod(ratePerSec: number): string {
  if (!Number.isFinite(ratePerSec) || Math.abs(ratePerSec) < 1e-12) return '—'
  const seconds = (2 * Math.PI) / Math.abs(ratePerSec)
  const hours = seconds / 3600
  return hours < 48
    ? t('planet.hours', { n: hours >= 10 ? Math.round(hours) : hours.toFixed(1) })
    : t('planet.days', { n: Math.round(hours / 24) })
}

export function PlanetScreen({ world, planet }: { world: World; planet: BodyEntity | null }) {
  useLang()
  // Хуки — ДО всякого раннего возврата: мир под тобой бывает и null (пустая система),
  // и порядок хуков не имеет права от этого меняться.
  const box = useRef<HTMLDivElement>(null)
  /** Удаление камеры от центра. Живёт в ref: зум не должен перерисовывать паспорт. */
  const dist = useRef(R * 4.2)
  useWheelZoom(box, (dy) => {
    dist.current = Math.max(CAM_NEAR, Math.min(CAM_FAR, dist.current * (dy > 0 ? 1.12 : 0.89)))
  })
  /**
   * Подписи спутников и причала: по одному div на тело, собираем ссылки по id. Позицию
   * каждой двигает кадр (`Satellite`), поэтому здесь только текст и сбор ссылок. Планету
   * не подписываем — она в заголовке слева, и в кадре она одна такая.
   */
  const labels = useRef<Map<number, HTMLDivElement>>(new Map())

  if (!planet) {
    return (
      <div className="font-mono text-sm" style={{ color: DIM }}>
        {t('hud.noData')}
      </div>
    )
  }

  const { moons, station } = satellitesOf(world, planet)
  const star = world.bodies.find((b) => b.kind === 'star') ?? null
  const settlement = planet.settlement
  const mass = bodyMass(planet)
  const gravity = (G * mass) / (planet.radius * planet.radius)

  // Схема вокруг шара: кольца разведены равномерно, а не по настоящим орбитам —
  // у Луны отношение 60 радиусов, и в кадре остался бы один пиксель планеты.
  const ring = (i: number) => R * 1.7 + i * R * 0.55

  return (
    // `overflow-hidden` здесь обязателен: подписи спутников — абсолютные div'ы, которые
    // кадр сдвигает за край полотна, и без обрезки они распирали панель обеими полосами
    // прокрутки. Паспорт слева прокручивается сам, внутри своей колонки.
    <div className="flex min-h-0 w-full flex-1 items-stretch gap-6 overflow-hidden font-mono" style={{ color: ACCENT }}>
      <div className="flex min-h-0 w-1/3 min-w-0 shrink-0 flex-col">
        <h1 className="text-xl tracking-[0.3em]">{properName(planet.name).toUpperCase()}</h1>
        <p className="mb-4 mt-1 text-[11px] tracking-widest opacity-50">
          {t('station.system')} {properName(world.systemName).toUpperCase()}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <Fact label={t('planet.type')} value={planetTypeName(planet.surface)} />
          <Fact
            label={t('planet.radius')}
            value={`${Math.round(planet.radius / 1000).toLocaleString()} ${t('unit.km')} · ×${(planet.radius / EARTH_RADIUS).toFixed(2)}`}
          />
          <Fact label={t('planet.mass')} value={t('planet.earthMass', { n: (mass / EARTH_MASS).toFixed(2) })} />
          <Fact label={t('planet.gravity')} value={`${(gravity / G_EARTH).toFixed(2)} g`} />
          {/* Сутки — из собственного вращения, год — из угловой скорости орбиты. Оба
              числа домен уже держит: угол считается как `spin·t`, а не копится. */}
          <Fact label={t('planet.day')} value={formatPeriod(planet.spin)} />
          {planet.orbit && <Fact label={t('planet.year')} value={formatPeriod(planet.orbit.rate)} />}
          {star && (
            <Fact label={t('planet.orbit')} value={formatDistance(planet.pos.distanceTo(star.pos))} />
          )}
          <Fact label={t('planet.moons')} value={moons.length > 0 ? String(moons.length) : t('planet.none')} />
          <Fact
            label={t('station.title')}
            value={station ? properName(station.name) : t('planet.none')}
          />

          {/* Жизнь — свойство ПЛАНЕТЫ, а не системы: рынок причала берёт экономику отсюда. */}
          {settlement ? (
            <>
              <Fact label={t('station.population')} value={t('station.popUnit', { n: Math.round(planet.population * 10) / 10 })} />
              <Fact label={t('station.government')} value={governmentName(settlement.government)} />
              <Fact label={t('station.economy')} value={economyName(settlement.economy)} />
              <Fact label={t('station.tech')} value={String(settlement.techLevel)} />
              <Fact label={t('station.species')} value={speciesName(settlement.species)} />
            </>
          ) : (
            <Fact label={t('map.life')} value={t('map.life.none')} />
          )}
        </div>
      </div>

      {/* Мир — крупно и на прозрачном фоне: за полотном остаётся стекло панели.
          Колесо приближает и отдаляет (тот же хук, что у карт: гасит зум страницы). */}
      <div ref={box} className="relative min-h-0 w-2/3 overflow-hidden touch-none select-none">
        <Canvas
          camera={{
            fov: 40,
            // Стартовое положение — то же, что потом держит кадр: иначе первый кадр дёргается.
            position: [CAM_DIR.x * R * 4.2, CAM_DIR.y * R * 4.2, CAM_DIR.z * R * 4.2],
            near: 0.01,
            far: CAM_FAR * 4,
          }}
          gl={{ antialias: true, alpha: true }}
        >
          <CameraRig dist={dist} />
          {/* Свет как в игре: жёсткий направленный от звезды плюс слабая заливка, чтобы
              теневая сторона не была чёрной дырой. Терминатор получается сам. */}
          <directionalLight position={[4, 2, 3]} intensity={2.6} />
          <ambientLight intensity={0.22} />
          <Globe body={planet} spin={planet.spin >= 0 ? 0.12 : -0.12} radius={R} />
          {moons.map((m, i) => (
            <Satellite
              key={m.id}
              // Спутник мельче планеты, но не пылинка: отношение радиусов сжато корнем.
              radius={Math.max(R * 0.06, R * Math.sqrt(m.radius / planet.radius) * 0.4)}
              orbit={ring(i)}
              rate={0.25 / (i + 1)}
              phase={m.orbit?.phase ?? 0}
              color={m.color}
              id={m.id}
              boxes={labels}
            />
          ))}
          {station && (
            <Satellite
              radius={R * 0.05}
              orbit={ring(moons.length)}
              rate={0.5}
              phase={station.orbit?.phase ?? 0}
              color={0xffffff}
              id={station.id}
              boxes={labels}
            />
          )}
        </Canvas>

        {/* Подписи спутников и причала — только ИМЯ, без рода: здесь и так видно, кто есть
            кто (шар на орбите — луна, белая точка — причал), а «СПУТНИК:» перед каждым
            именем был бы шумом. Позицию двигает кадр. */}
        {[...moons, ...(station ? [station] : [])].map((b) => (
          <div
            key={b.id}
            ref={(el) => {
              if (el) labels.current.set(b.id, el)
              else labels.current.delete(b.id)
            }}
            className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-[11px] tracking-widest opacity-0"
            style={{ color: b.kind === 'station' ? UI.STATION : UI.PLANET, willChange: 'transform' }}
          >
            {properName(b.name)}
          </div>
        ))}
      </div>
    </div>
  )
}
