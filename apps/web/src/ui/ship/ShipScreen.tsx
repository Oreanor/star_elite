import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Group, Vector3, type BufferGeometry } from 'three'
import type { ModuleKind, ShipModule, ShipSpec, World } from '@elite/sim'
import { cobraGeometry, droneGeometry, freighterGeometry, sidewinderGeometry } from '../../render/geometry/ships'
import { hullMaterial } from '../../render/materials/materials'
import { t, useLang } from '../i18n'
import { ACCENT, Column, DIM, Panel, Table, Tabs } from '../station/chrome'
import { StatId, formatStat, statLabel } from '../station/format'
import { ModuleHeadline, displayName, headlineNumber } from '../station/Equipment'
import { SlotDetail } from '../station/SlotDetail'
import { KindBrowser } from '../station/KindBrowser'
import { Hold } from '../station/Hold'

/**
 * Экран корабля (клавиша I) и он же — ВЕРФЬ у причала. ОДИН компонент, а не два:
 * пользователь просил, чтобы «на станции была такая же панелька, как по I».
 * Разницу задаёт `docked`: в полёте это витрина (чертёж, статы, груз — только
 * читать), у причала — мастерская (почини, замени, улучши слот).
 *
 * Характеристики и модули НАМЕРЕННО на одной вкладке: меняя оснастку, пилот тут
 * же видит, как поехали статы, — ради этого их и держат бок о бок.
 *
 * Мир под экраном стоит (App отпускает курсор — пауза это и есть отпущенный
 * курсор), поэтому анимировать чертёж собственным кадром безопасно, а мутации
 * оснастки перерисовывают экран через `bump`: React узнать иначе не может.
 */

/** Поле зрения чертёжной камеры, град. Влезает и «Оса» в 3 м, и баржа в 60. */
const FOV = 32

export function ShipScreen({
  world,
  onClose,
  docked = false,
}: {
  world: World
  onClose: () => void
  docked?: boolean
}) {
  useLang()
  const [tab, setTab] = useState<'outfit' | 'cargo'>('outfit')
  // Счётчик перерисовок: установка/улучшение мутируют мир, статы обязаны догнать.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const player = world.player

  // Escape закрывает экран — как на карте галактики. Клавишу I гасит App.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabs = [
    { id: 'outfit' as const, label: t('ship.tab.outfit') },
    { id: 'cargo' as const, label: t('ship.tab.cargo') },
  ]

  return (
    <div className="absolute inset-0 overflow-auto bg-black/90 font-mono" style={{ color: ACCENT }}>
      <div className="mx-auto max-w-5xl px-8 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl tracking-[0.35em]">{docked ? t('station.shipyard.title') : t('ship.title')}</h1>
            <p className="mt-1 text-sm tracking-widest" style={{ color: DIM }}>
              {t('station.system')} {world.systemName.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border px-4 py-2 text-sm tracking-[0.3em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
            style={{ borderColor: ACCENT }}
          >
            {docked ? t('menu.back') : `I — ${t('ship.close')}`}
          </button>
        </div>

        <div className="mt-8 flex flex-col gap-8 md:flex-row">
          {/* Чертёж: настоящий корпус игрока, тот же меш и материал, что летают в бою. */}
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

          <div className="min-w-0 flex-1">
            <Tabs tabs={tabs.map((x) => x.label)} active={tabs.find((x) => x.id === tab)!.label} onSelect={(label) => setTab(tabs.find((x) => x.label === label)!.id)} />

            {tab === 'outfit' ? (
              <div className="space-y-6">
                {/* Модули и статы рядом: правка слота слева тут же двигает числа справа. */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <Modules world={world} docked={docked} onChange={bump} />
                  <Stats spec={player.spec} />
                </div>
                {/* Каталог по видам — только у причала: покупать оснастку в полёте нельзя. */}
                {docked && <KindBrowser world={world} onChange={bump} />}
              </div>
            ) : (
              <Hold world={world} onChange={bump} atStation={docked} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Одна ячейка оснастки: установленный модуль или пустая точка подвески. */
interface SlotView {
  key: string
  module: ShipModule | null
  hardpointIndex?: number
  optionKinds: ModuleKind[]
}

/** Перечень слотов корабля. В полёте — только занятые; у причала ещё и пустые пилоны. */
function buildSlots(world: World, docked: boolean): SlotView[] {
  const loadout = world.player.loadout
  const rows: SlotView[] = []
  loadout.internals.forEach((m, i) => rows.push({ key: `int-${i}`, module: m, optionKinds: [m.kind] }))
  loadout.chassis.hardpoints.forEach((hp, i) => {
    const weapon = loadout.weapons[i]
    if (!weapon && !docked) return // пустой пилон в полёте не модуль — не показываем
    const optionKinds: ModuleKind[] = weapon ? [weapon.kind] : hp.kind === 'pylon' ? ['missile'] : ['laser']
    rows.push({ key: `hp-${i}`, module: weapon ?? null, hardpointIndex: i, optionKinds })
  })
  return rows
}

function Modules({ world, docked, onChange }: { world: World; docked: boolean; onChange: () => void }) {
  const columns: Column<SlotView>[] = [
    {
      key: 'name',
      header: t('station.col.name'),
      cell: (s) =>
        s.module ? displayName(s.module) : <span style={{ color: DIM }}>{t('ship.slotEmpty')}</span>,
    },
    {
      key: 'benefit',
      header: t('station.col.benefit'),
      align: 'right',
      cell: (s) => <span style={{ color: DIM }}>{s.module ? headlineNumber(s.module) : '—'}</span>,
    },
    {
      key: 'class',
      header: t('station.col.class'),
      align: 'right',
      cell: (s) => (s.module ? <span style={{ color: DIM }}>{`${t('stat.class')} ${s.module.class}`}</span> : ''),
    },
  ]

  return (
    <div className="space-y-6">
      <Panel title={t('ship.tab.modules')}>
        <Table
          columns={columns}
          rows={buildSlots(world, docked)}
          rowKey={(s) => s.key}
          detail={(s) =>
            docked ? (
              <SlotDetail world={world} module={s.module} optionKinds={s.optionKinds} onChange={onChange} />
            ) : s.module ? (
              // В полёте оснастку не трогают: клик даёт только справку о модуле.
              <ModuleHeadline module={s.module} />
            ) : null
          }
        />
      </Panel>
    </div>
  )
}

/** Строки характеристик корабля. Читаются из `spec` при каждом рендере — после
 *  установки модуля `spec` уже пересобран доменом, и числа едут сами. */
interface StatRow {
  id: StatId
  value: number
}

function Stats({ spec }: { spec: ShipSpec }) {
  const tuning = spec.tuning
  const rows: StatRow[] = [
    { id: 'hull', value: spec.hull.hull },
    { id: 'shield', value: spec.hull.shield },
    { id: 'mass', value: spec.mass },
    { id: 'speed', value: tuning.MAX_SPEED },
    // Угловые ускорения — «тяжесть» носа; переживут перебалансировку лучше голой цифры.
    { id: 'pitch', value: tuning.PITCH_ACCEL },
    { id: 'yaw', value: tuning.YAW_ACCEL },
    { id: 'roll', value: tuning.ROLL_ACCEL },
    { id: 'jump', value: spec.jumpRange },
    { id: 'cargo', value: spec.cargoCapacity },
    { id: 'energy', value: spec.power.capacity },
  ]

  const columns: Column<StatRow>[] = [
    { key: 'name', header: '', cell: (r) => <span style={{ color: DIM }}>{statLabel(r.id)}</span> },
    { key: 'value', header: '', align: 'right', cell: (r) => formatStat(r.id, r.value) },
  ]

  return (
    <Panel title={t('ship.tab.stats')}>
      <Table columns={columns} rows={rows} rowKey={(r) => r.id} />
    </Panel>
  )
}

// ─── Чертёж (без изменений: своя причина меняться) ─────────────────────────────

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
  // целиком. d = R / sin(fov/2) — сфера радиуса R вписывается по вертикали; 1.35 — поля.
  const { centre, camPos, distance } = useMemo(() => {
    const sphere = geometry.boundingSphere
    const r = sphere ? sphere.radius : 20
    const c = sphere ? sphere.center.clone() : new Vector3()
    const dist = (r / Math.sin((FOV / 2) * (Math.PI / 180))) * 1.35
    const dir = new Vector3(0.7, 0.45, -1).setLength(dist)
    return { centre: c, camPos: [dir.x, dir.y, dir.z] as [number, number, number], distance: dist }
  }, [geometry])

  return (
    <Canvas
      gl={{ antialias: true, alpha: true }}
      camera={{ fov: FOV, near: distance * 0.05, far: distance * 6, position: camPos }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
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
      <mesh geometry={geometry} material={hullMaterial()} position={[-centre.x, -centre.y, -centre.z]} />
    </group>
  )
}
