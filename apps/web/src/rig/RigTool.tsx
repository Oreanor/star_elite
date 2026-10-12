import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, CircleGeometry, DoubleSide, Float32BufferAttribute, MeshBasicMaterial, SphereGeometry, type Mesh } from 'three'
import { CHASSIS_CATALOGUE } from '@elite/sim'
import { chassisGeometry, chassisMissileScale, chassisNozzles, glbMaterial, missileGeometry } from '../render/geometry/ships'
import { hullMaterialFor, missileMaterial } from '../render/materials/materials'
import { fromChassis, itemLabel, itemPoints, moveItem, printout, resizeItem, toEntry, type RigState } from './rigModel'

/**
 * РЕДАКТОР ОСНАСТКИ — отдельная страница. Листаешь корпуса, выбираешь пункт (лазер, подвес,
 * сопло) и двигаешь его стрелками; у сопла и подвеса — ещё и размер. Справа — готовый конфиг
 * для `chassis.ts` и `ships.ts`. «СОХРАНИТЬ В ИГРУ» пишет оснастку в `packages/sim/src/config/rig.json`
 * (через dev-сервер) — игра читает её оттуда сразу. Несохранённый черновик корпуса помнится в браузере.
 *
 *   [ / ]  или PgUp / PgDn  — предыдущий / следующий корпус
 *   Tab / Shift+Tab         — следующий / предыдущий пункт (или клик в списке)
 *   ← / →                   — влево / вправо (у пары — шире / уже)
 *   ↑ / ↓                   — вперёд / назад вдоль корпуса
 *   Shift + ↑ / ↓           — выше / ниже
 *   + / −                   — размер: радиус сопла, размер ракет на подвесах
 *   Alt (держать)           — точно (в пять раз медленнее)
 *   Мышь: тянуть — облёт, колесо — ближе / дальше
 */

// Ключ с версией: черновики прежней схемы (без номеров точек) не подхватываются.
const STORE = (id: string) => `rig2:${id}`
/** Как часто панель догоняет правку, пока клавиша зажата, мс. */
const PANEL_MS = 60

const _sphere = new SphereGeometry(1, 12, 8)
const _disc = new CircleGeometry(1, 20)
const _mat = {
  laser: new MeshBasicMaterial({ color: 0x48d6ff }),
  nozzle: new MeshBasicMaterial({ color: 0xff8a3c, side: DoubleSide, transparent: true, opacity: 0.85 }),
  pick: new MeshBasicMaterial({ color: 0xfff15a }),
  pickDisc: new MeshBasicMaterial({ color: 0xfff15a, side: DoubleSide }),
  beam: new MeshBasicMaterial({ color: 0x48d6ff, transparent: true, opacity: 0.35 }),
}

function loadState(id: string): RigState | null {
  try {
    const raw = localStorage.getItem(STORE(id))
    return raw ? (JSON.parse(raw) as RigState) : null
  } catch {
    return null
  }
}

function saveState(state: RigState): void {
  try {
    localStorage.setItem(STORE(state.chassisId), JSON.stringify(state))
  } catch {
    // хранилище закрыто — правка живёт до перезагрузки, и только
  }
}

function freshState(index: number): RigState {
  const chassis = CHASSIS_CATALOGUE[index]!
  return fromChassis(chassis, chassisNozzles(chassis.id), chassisMissileScale(chassis.id))
}

export function RigTool() {
  const [hull, setHull] = useState(0)
  const [selected, setSelected] = useState(0)
  const [, bump] = useState(0)
  const chassis = CHASSIS_CATALOGUE[hull]!
  /** Состояние правки текущего корпуса. null — меш ещё грузится, сопла не известны. */
  const state = useRef<RigState | null>(null)
  const held = useRef(new Set<string>())
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle')

  const refresh = useCallback(() => bump((n) => n + 1), [])

  // Сменился корпус — забыть прежнее состояние; новое заведёт кадр, когда меш доедет.
  useEffect(() => {
    state.current = loadState(chassis.id)
    setSelected(0)
    refresh()
  }, [chassis.id, refresh])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault()
        const n = state.current?.items.length ?? 0
        if (n > 0) setSelected((s) => (s + (e.shiftKey ? n - 1 : 1)) % n)
        return
      }
      if (e.code === 'BracketLeft' || e.code === 'PageUp') {
        e.preventDefault()
        setHull((h) => (h + CHASSIS_CATALOGUE.length - 1) % CHASSIS_CATALOGUE.length)
        return
      }
      if (e.code === 'BracketRight' || e.code === 'PageDown') {
        e.preventDefault()
        setHull((h) => (h + 1) % CHASSIS_CATALOGUE.length)
        return
      }
      if (e.code.startsWith('Arrow') || e.altKey) e.preventDefault()
      held.current.add(e.code)
    }
    const up = (e: KeyboardEvent) => held.current.delete(e.code)
    const blur = () => held.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const reset = () => {
    try {
      localStorage.removeItem(STORE(chassis.id))
    } catch {
      // нечего сбрасывать
    }
    state.current = glbMaterial(chassis.id) ? freshState(hull) : null
    refresh()
  }

  /** В игру: dev-сервер пишет запись корпуса в `rig.json`; черновик браузера больше не нужен. */
  const save = async () => {
    const s = state.current
    if (!s) return
    setSaved('busy')
    try {
      const res = await fetch('/__rig/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chassisId: s.chassisId, entry: toEntry(chassis, s) }),
      })
      if (!res.ok) throw new Error(await res.text())
      try {
        localStorage.removeItem(STORE(s.chassisId))
      } catch {
        // нечего стирать
      }
      setSaved('ok')
    } catch {
      setSaved('fail')
    }
    window.setTimeout(() => setSaved('idle'), 1800)
  }

  const text = state.current ? printout(state.current) : 'Корпус грузится…'
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="flex h-screen w-screen bg-[#05101a] font-mono text-[#7fd6ff]">
      <div className="relative min-w-0 flex-1">
        <Canvas camera={{ fov: 40, near: 0.05, far: 5000, position: [0, 20, 40] }}>
          <ambientLight intensity={0.35} />
          <directionalLight position={[5, 8, 6]} intensity={2.2} />
          <Scene
            hull={hull}
            selected={selected}
            state={state}
            held={held}
            onChange={refresh}
            onReady={(s) => {
              state.current = s
              refresh()
            }}
          />
        </Canvas>
        <div className="pointer-events-none absolute left-4 top-3 text-xs leading-relaxed text-[#3f7391]">
          [ ] — корпус · Tab — пункт · ←→ влево/вправо (пара — шире/уже) · ↑↓ вперёд/назад · Shift+↑↓ выше/ниже ·
          +/− размер (сопло, ракеты) · Alt — точно · мышь — облёт, колесо — зум
        </div>
      </div>

      <aside className="flex w-[30rem] shrink-0 flex-col gap-3 overflow-hidden border-l border-[#123247] p-4 text-sm">
        <div className="flex items-center justify-between">
          <button className="px-2 text-lg hover:text-white" onClick={() => setHull((h) => (h + CHASSIS_CATALOGUE.length - 1) % CHASSIS_CATALOGUE.length)}>
            ‹
          </button>
          <div className="text-center">
            <div className="text-base tracking-[0.12em] text-white">{chassis.name}</div>
            <div className="text-xs text-[#3f7391]">
              {chassis.id} · {hull + 1} / {CHASSIS_CATALOGUE.length}
            </div>
          </div>
          <button className="px-2 text-lg hover:text-white" onClick={() => setHull((h) => (h + 1) % CHASSIS_CATALOGUE.length)}>
            ›
          </button>
        </div>

        {state.current && (
          <div className="flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto">
            {state.current.items.map((it, i) => (
              <button
                key={i}
                onClick={() => setSelected(i)}
                className="flex justify-between px-2 py-0.5 text-left text-xs"
                style={{ background: i === selected ? '#123247' : 'transparent', color: i === selected ? '#fff15a' : undefined }}
              >
                <span>{itemLabel(state.current!, i)}</span>
                <span className="text-[#3f7391]">
                  x {it.x.toFixed(2)} y {it.y.toFixed(2)} z {it.z.toFixed(2)}
                  {it.kind === 'nozzle' ? ` r ${it.radius.toFixed(2)}` : ''}
                </span>
              </button>
            ))}
            <div className="px-2 pt-1 text-xs text-[#3f7391]">ракеты на подвесах ×{state.current.missileScale.toFixed(2)}</div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            className="border border-[#fff15a] px-3 py-1 text-xs text-[#fff15a] hover:text-white disabled:opacity-40"
            onClick={() => void save()}
            disabled={!state.current || saved === 'busy'}
          >
            {saved === 'ok' ? 'СОХРАНЕНО' : saved === 'fail' ? 'НЕ ВЫШЛО — dev-сервер?' : 'СОХРАНИТЬ В ИГРУ'}
          </button>
          <button className="border border-[#3f7391] px-3 py-1 text-xs hover:text-white" onClick={copy}>
            {copied ? 'СКОПИРОВАНО' : 'КОПИРОВАТЬ КОНФИГ'}
          </button>
          <button className="border border-[#3f7391] px-3 py-1 text-xs hover:text-white" onClick={reset}>
            СБРОСИТЬ КОРПУС
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-[#030a12] p-2 text-[0.7rem] leading-snug text-[#9fe2ff]">{text}</pre>
      </aside>
    </div>
  )
}

function Scene({
  hull,
  selected,
  state,
  held,
  onChange,
  onReady,
}: {
  hull: number
  selected: number
  state: React.RefObject<RigState | null>
  held: React.RefObject<Set<string>>
  onChange: () => void
  onReady: (s: RigState) => void
}) {
  const chassis = CHASSIS_CATALOGUE[hull]!
  const ship = useRef<Mesh>(null)
  const markers = useRef<Mesh[]>([])
  const missiles = useRef<Mesh[]>([])
  const beams = useRef<Mesh[]>([])
  const holdTime = useRef(0)
  const lastPanel = useRef(0)
  const dirty = useRef(false)
  const missile = useMemo(missileGeometry, [])
  const missileMat = useMemo(missileMaterial, [])
  const beamGeom = useMemo(() => {
    const g = new BufferGeometry()
    // Тонкий луч вдоль −Z: видно, куда бьёт дуло (нос в −Z).
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0.05, 0, -1, -0.05, 0, -1], 3))
    return g
  }, [])
  useOrbit(chassis.radius)

  useFrame((_, dt) => {
    const mesh = ship.current
    if (mesh) {
      const g = chassisGeometry(chassis.id)
      if (mesh.geometry !== g) mesh.geometry = g
      const m = hullMaterialFor(chassis.id)
      if (mesh.material !== m) mesh.material = m
    }
    // Меш доехал — теперь сопла корпуса известны: заводим правку (если в памяти не было).
    if (!state.current && glbMaterial(chassis.id)) onReady(freshState(hull))
    const s = state.current
    if (!s || s.chassisId !== chassis.id) return

    edit(s, dt)
    place(s)
    if (dirty.current && performance.now() - lastPanel.current > PANEL_MS) {
      lastPanel.current = performance.now()
      dirty.current = false
      saveState(s)
      onChange()
    }
  })

  function edit(s: RigState, dt: number): void {
    const item = s.items[selected]
    const keys = held.current
    if (!item) return
    const has = (c: string) => keys.has(c)
    const shift = has('ShiftLeft') || has('ShiftRight')
    const fine = has('AltLeft') || has('AltRight') ? 0.2 : 1
    const left = has('ArrowLeft')
    const right = has('ArrowRight')
    const fwd = has('ArrowUp')
    const back = has('ArrowDown')
    const grow = has('Equal') || has('NumpadAdd')
    const shrink = has('Minus') || has('NumpadSubtract')
    if (!left && !right && !fwd && !back && !grow && !shrink) {
      holdTime.current = 0
      return
    }
    holdTime.current += dt
    // Шаг растёт, пока держишь: тонкая подводка — тычком, дальний перенос — удержанием.
    const rate = Math.max(0.4, chassis.radius * 0.06) * Math.min(4, 1 + holdTime.current * 1.5) * fine
    const d = rate * dt
    moveItem(item, (right ? d : 0) - (left ? d : 0), shift ? (fwd ? d : 0) - (back ? d : 0) : 0, shift ? 0 : (back ? d : 0) - (fwd ? d : 0))
    if (grow) resizeItem(s, item, Math.exp(0.8 * dt * fine))
    if (shrink) resizeItem(s, item, Math.exp(-0.8 * dt * fine))
    dirty.current = true
  }

  /** Расставить метки: дула — точки с лучом вперёд, подвесы — ракеты, сопла — диски. */
  function place(s: RigState): void {
    let mi = 0
    let ri = 0
    let bi = 0
    const dot = Math.max(0.12, chassis.radius * 0.022)
    s.items.forEach((item, i) => {
      const pick = i === selected
      for (const [x, y, z] of itemPoints(item)) {
        if (item.kind === 'pylon') {
          const m = missiles.current[ri++]
          if (!m) continue
          m.visible = true
          m.position.set(x, y, z)
          m.scale.setScalar(s.missileScale * (pick ? 1.15 : 1))
          continue
        }
        const m = markers.current[mi++]
        if (!m) continue
        m.visible = true
        m.position.set(x, y, z)
        if (item.kind === 'nozzle') {
          m.geometry = _disc
          m.scale.setScalar(item.radius)
          m.material = pick ? _mat.pickDisc : _mat.nozzle
        } else {
          m.geometry = _sphere
          m.scale.setScalar(dot * (pick ? 1.8 : 1))
          m.material = pick ? _mat.pick : _mat.laser
          const b = beams.current[bi++]
          if (b) {
            b.visible = true
            b.position.set(x, y, z)
            b.scale.set(dot * 4, dot * 4, chassis.radius * 2.5)
          }
        }
      }
    })
    for (; mi < markers.current.length; mi++) markers.current[mi]!.visible = false
    for (; ri < missiles.current.length; ri++) missiles.current[ri]!.visible = false
    for (; bi < beams.current.length; bi++) beams.current[bi]!.visible = false
  }

  const slots = Array.from({ length: 24 }, (_, i) => i)
  return (
    <>
      <mesh ref={ship} geometry={chassisGeometry(chassis.id)} material={hullMaterialFor(chassis.id)} />
      {slots.map((i) => (
        <mesh key={`m${i}`} ref={(m) => { if (m) markers.current[i] = m }} geometry={_sphere} material={_mat.laser} visible={false} renderOrder={2} />
      ))}
      {slots.map((i) => (
        <mesh key={`r${i}`} ref={(m) => { if (m) missiles.current[i] = m }} geometry={missile} material={missileMat} visible={false} />
      ))}
      {slots.map((i) => (
        <mesh key={`b${i}`} ref={(m) => { if (m) beams.current[i] = m }} geometry={beamGeom} material={_mat.beam} visible={false} />
      ))}
      <gridHelper args={[chassis.radius * 6, 24, 0x123247, 0x0a1d2b]} position={[0, -chassis.radius * 0.6, 0]} />
    </>
  )
}

/** Облёт мышью: тянуть — вращение вокруг корпуса, колесо — дальность. */
function useOrbit(radius: number) {
  const { camera, gl } = useThree()
  const view = useRef({ yaw: 0.7, pitch: 0.45, dist: radius * 3.2 })

  useEffect(() => {
    view.current.dist = radius * 3.2
  }, [radius])

  useEffect(() => {
    const el = gl.domElement
    let dragging = false
    let lx = 0
    let ly = 0
    const down = (e: PointerEvent) => {
      dragging = true
      lx = e.clientX
      ly = e.clientY
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      view.current.yaw -= (e.clientX - lx) * 0.008
      view.current.pitch = Math.max(-1.5, Math.min(1.5, view.current.pitch + (e.clientY - ly) * 0.008))
      lx = e.clientX
      ly = e.clientY
    }
    const up = () => {
      dragging = false
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      view.current.dist = Math.max(radius * 0.4, Math.min(radius * 20, view.current.dist * Math.exp(e.deltaY * 0.001)))
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [gl, radius])

  useFrame(() => {
    const { yaw, pitch, dist } = view.current
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist)
    camera.lookAt(0, 0, 0)
  })
}
