import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Vector3, type BufferGeometry } from 'three'
import { cargoMass, itemMass, itemName, type ShipModule, type ShipSpec, type World } from '@elite/sim'
import { cobraGeometry, droneGeometry, freighterGeometry, sidewinderGeometry } from '../../render/geometry/ships'
import { hullMaterial } from '../../render/materials/materials'
import { ACCENT, DIM, Panel, Row, Tabs } from '../station/chrome'

/**
 * Экран корабля (клавиша I). Читает мир и ничего в нём не меняет: чертёж, приборы
 * и трюм — витрина, а не мастерская. Переоснащение живёт на станции, в полёте
 * его нет, поэтому здесь ни одной кнопки-действия.
 *
 * Мир под экраном стоит: App отпускает курсор, а пауза в этой игре и есть
 * отпущенный курсор. Значит, анимировать чертёж собственным кадром безопасно —
 * симуляции он ничем не связан.
 */

const TABS = ['ХАРАКТЕРИСТИКИ', 'МОДУЛИ', 'ГРУЗ'] as const
type Tab = (typeof TABS)[number]

/** Поле зрения чертёжной камеры, град. Влезает и «Оса» в 3 м, и баржа в 60. */
const FOV = 32

export function ShipScreen({ world, onClose }: { world: World; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('ХАРАКТЕРИСТИКИ')
  const player = world.player

  // Escape закрывает экран — как на карте галактики. Клавишу I гасит App.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="absolute inset-0 overflow-auto bg-black/90 font-mono" style={{ color: ACCENT }}>
      <div className="mx-auto max-w-5xl px-8 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl tracking-[0.35em]">КОРАБЛЬ</h1>
            <p className="mt-1 text-sm tracking-widest" style={{ color: DIM }}>
              СИСТЕМА {world.systemName.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border px-4 py-2 text-sm tracking-[0.3em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
            style={{ borderColor: ACCENT }}
          >
            I — ЗАКРЫТЬ
          </button>
        </div>

        <div className="mt-8 flex flex-col gap-8 md:flex-row">
          {/* Чертёж: настоящий корпус игрока, а не картинка. Тот же меш и материал,
              что летают в бою (см. render/scene/Ships.tsx). */}
          <div className="shrink-0">
            <div
              className="h-80 w-80 border"
              style={{
                borderColor: DIM,
                background: 'radial-gradient(ellipse at center, rgba(20,44,74,0.35), rgba(2,6,12,0.6))',
              }}
            >
              <Blueprint chassisId={player.loadout.chassis.id} />
            </div>
            <p className="mt-3 text-lg tracking-[0.2em]">{player.name}</p>
            <p className="text-sm tracking-widest" style={{ color: DIM }}>
              {player.loadout.chassis.name.toUpperCase()}
            </p>
          </div>

          {/* Приборы разложены по вкладкам, как в меню станции: три свитка подряд
              не помещаются на экран, а вкладки держат их в одном месте. */}
          <div className="flex-1">
            <Tabs tabs={TABS} active={tab} onSelect={setTab} />
            {tab === 'ХАРАКТЕРИСТИКИ' && <Stats spec={player.spec} />}
            {tab === 'МОДУЛИ' && <Modules loadout={player.loadout} />}
            {tab === 'ГРУЗ' && <CargoList hold={player.hold} />}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Шасси → фабрика геометрии. Данные вместо ветвления: новый корпус — новая ветка
 *  здесь и новая фабрика, а не правка симуляции (её этот экран вообще не трогает). */
function chassisGeometry(id: string): BufferGeometry {
  switch (id) {
    case 'sidewinder':
      return sidewinderGeometry()
    case 'freighter':
      return freighterGeometry()
    case 'drone':
      return droneGeometry()
    default:
      return cobraGeometry() // cobra_mk3 — корпус игрока
  }
}

function Blueprint({ chassisId }: { chassisId: string }) {
  const geometry = useMemo(() => chassisGeometry(chassisId), [chassisId])

  // Кадрируем по сфере столкновений геометрии: корабль любого размера влезает
  // целиком и не тонет в слишком далёкой камере. d = R / sin(fov/2) — так сфера
  // радиуса R ровно вписывается по вертикали кадра; запас 1.35 оставляет поля.
  const { centre, camPos, distance } = useMemo(() => {
    const sphere = geometry.boundingSphere
    const r = sphere ? sphere.radius : 20
    const c = sphere ? sphere.center.clone() : new Vector3()
    const dist = (r / Math.sin((FOV / 2) * (Math.PI / 180))) * 1.35
    // Нос смотрит в −Z: заходим с носа, сверху и сбоку — вид «три четверти».
    const dir = new Vector3(0.7, 0.45, -1).setLength(dist)
    return { centre: c, camPos: [dir.x, dir.y, dir.z] as [number, number, number], distance: dist }
  }, [geometry])

  return (
    <Canvas
      // Полотно прозрачно: фон рисует панель под ним, а не рендерер.
      gl={{ antialias: true, alpha: true }}
      camera={{ fov: FOV, near: distance * 0.05, far: distance * 6, position: camPos }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      {/* Свет как в кабине (значения из render/scene/Lighting.tsx): жёсткий тёплый
          ключевой от «звезды», холодная слабая заливка и небесная подсветка снизу,
          чтобы теневой борт не проваливался в чёрное. */}
      <directionalLight position={[-4, 6, 8]} intensity={1.9} color={0xfff2dd} />
      <directionalLight position={[6, 3, -6]} intensity={0.55} color={0xa8c4e6} />
      <hemisphereLight args={[0x4a6480, 0x141a22, 0.5]} />
      <SpinningShip geometry={geometry} centre={centre} />
    </Canvas>
  )
}

/** Медленно вращается сам. Экран на паузе, кадр здесь не связан с симуляцией. */
function SpinningShip({ geometry, centre }: { geometry: BufferGeometry; centre: Vector3 }) {
  const ref = useRef<Group>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.5
  })
  return (
    <group ref={ref}>
      {/* Меш сдвинут в начало координат, чтобы вращаться вокруг собственного
          центра, а не вокруг точки крепления геометрии. */}
      <mesh geometry={geometry} material={hullMaterial()} position={[-centre.x, -centre.y, -centre.z]} />
    </group>
  )
}

function Stats({ spec }: { spec: ShipSpec }) {
  const t = spec.tuning
  return (
    <Panel title="ХАРАКТЕРИСТИКИ">
      <ul className="space-y-1">
        <Stat name="Корпус" value={String(Math.round(spec.hull.hull))} />
        <Stat name="Щит" value={String(Math.round(spec.hull.shield))} />
        <Stat name="Масса" value={String(Math.round(spec.mass))} unit="т" />
        <Stat name="Макс. скорость" value={String(Math.round(t.MAX_SPEED))} unit="м/с" />
        {/* Угловое ускорение по осям: «тяжесть» носа. Оно переживёт перебалансировку,
            а голая цифра скорости разворота — нет. Две значащие цифры: доли важны. */}
        <Stat name="Тангаж" value={t.PITCH_ACCEL.toFixed(2)} unit="рад/с²" />
        <Stat name="Рыскание" value={t.YAW_ACCEL.toFixed(2)} unit="рад/с²" />
        <Stat name="Крен" value={t.ROLL_ACCEL.toFixed(2)} unit="рад/с²" />
        <Stat name="Дальность прыжка" value={spec.jumpRange.toFixed(1)} unit="св.г." />
        <Stat name="Трюм" value={String(Math.round(spec.cargoCapacity))} unit="т" />
        <Stat name="Энергия" value={String(Math.round(spec.power.capacity))} unit="ед." />
      </ul>
    </Panel>
  )
}

/** Строка характеристики поверх прайсовой Row: значение в колонке цены, единица — в пометке. */
function Stat({ name, value, unit }: { name: string; value: string; unit?: string }) {
  return (
    <Row name={name} price={value} note={unit}>
      {null}
    </Row>
  )
}

/** Виды модулей по-русски: в списке «двигатель» и «щит» различимы, не читая имя целиком. */
const KIND_LABEL: Record<ShipModule['kind'], string> = {
  engine: 'двигатель',
  thrusters: 'маневровые',
  shield: 'щит',
  armour: 'броня',
  laser: 'лазер',
  missile: 'ракеты',
  cargo: 'трюм',
  hyperdrive: 'гиперпривод',
  cloak: 'маскировка',
  drone: 'БПЛА',
}

function Modules({ loadout }: { loadout: World['player']['loadout'] }) {
  // Пустые точки подвески пропускаем: пилон без оружия — не модуль.
  const mounted = loadout.weapons.filter((w): w is NonNullable<typeof w> => w !== null)
  return (
    <>
      <Panel title="ВНУТРЕННИЕ МОДУЛИ">
        <ul className="space-y-1">
          {loadout.internals.map((m, i) => (
            <ModuleRow key={`${m.id}-${i}`} module={m} />
          ))}
        </ul>
      </Panel>
      <Panel title="ОРУДИЯ">
        {mounted.length === 0 ? (
          <p className="text-sm" style={{ color: DIM }}>
            Пилоны пусты.
          </p>
        ) : (
          <ul className="space-y-1">
            {mounted.map((m, i) => (
              <ModuleRow key={`${m.id}-${i}`} module={m} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

function ModuleRow({ module }: { module: ShipModule }) {
  return (
    <Row name={module.name} price={`кл. ${module.class}`} note={KIND_LABEL[module.kind]}>
      {null}
    </Row>
  )
}

function CargoList({ hold }: { hold: World['player']['hold'] }) {
  return (
    <Panel title="ГРУЗ">
      <p className="mb-3 text-xs tracking-widest" style={{ color: DIM }}>
        ЗАНЯТО {Math.round(cargoMass(hold))} ИЗ {hold.capacity} Т
      </p>
      {hold.items.length === 0 ? (
        <p className="text-sm" style={{ color: DIM }}>
          Пусто.
        </p>
      ) : (
        <ul className="space-y-1">
          {hold.items.map((item, i) => (
            // Индекс в ключе намеренно: одинаковые товары уже сложены в стопку, а
            // разные модули различаются именем — ключ обязан пережить продажу соседа.
            <Row key={`${itemName(item)}-${i}`} name={itemName(item)} price={`${itemMass(item)} т`} note="">
              {null}
            </Row>
          ))}
        </ul>
      )}
    </Panel>
  )
}
