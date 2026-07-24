import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { InstancedMesh, MeshBasicMaterial, Object3D, SphereGeometry } from 'three'
import { groupPoints, rigEditor, type RigGroup } from '../../app/control/rigEditor'
import { useSession } from '../../app/GameContext'

/**
 * Маркеры оснастки и панель координат для единого редактора (клавиша K, логика —
 * `app/control/rigEditor`). Шарики в связанных осях корабля (`pos + quat·offset`), без
 * depth-теста (точка часто в теле корпуса). Три класса маркеров:
 *   красноватый — дула, голубой — сопла, жёлтый — АКТИВНАЯ группа (любого рода).
 * Размер маркера дула — от габарита рамы, сопла — от его радиуса (толщины факела).
 *
 * Панель — узел DOM руками, как у `Probe`: компонент внутри `<Canvas>`, разметка React
 * там не отрисовалась бы, а инструменту разработчика чёткость важнее пиксельной сетки HUD.
 */

/** Шесть точек оснастки максимум на класс маркера; запас, чтобы буфер не переполнить. */
const MAX_MARKS = 6

const markGeometry = /* @__PURE__ */ new SphereGeometry(1, 12, 8)
const gunMaterial = /* @__PURE__ */ new MeshBasicMaterial({ color: 0xff5a3a, depthTest: false, transparent: true, opacity: 0.5 })
const nozzleMaterial = /* @__PURE__ */ new MeshBasicMaterial({ color: 0x39c0ff, depthTest: false, transparent: true, opacity: 0.45 })
const liveMaterial = /* @__PURE__ */ new MeshBasicMaterial({ color: 0xffd400, depthTest: false, transparent: true, opacity: 0.9 })

const _dummy = /* @__PURE__ */ new Object3D()

export function RigEditorMarks() {
  const session = useSession()
  const gun = useRef<InstancedMesh>(null)
  const nozzle = useRef<InstancedMesh>(null)
  const live = useRef<InstancedMesh>(null)
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = document.createElement('div')
    el.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:50;display:none;white-space:pre;' +
      'font:12px/1.3 monospace;color:#ffd400;text-shadow:0 0 2px #000;pointer-events:none'
    document.body.appendChild(el)
    panel.current = el
    return () => {
      el.remove()
      panel.current = null
    }
  }, [])

  useFrame(() => {
    const gunMesh = gun.current
    const nozzleMesh = nozzle.current
    const liveMesh = live.current
    const el = panel.current
    if (!gunMesh || !nozzleMesh || !liveMesh) return

    const editor = rigEditor()
    if (!editor.active) {
      gunMesh.count = 0
      nozzleMesh.count = 0
      liveMesh.count = 0
      if (el) el.style.display = 'none'
      return
    }

    const player = session.world.player
    // Дуло — точка, размер от рамы; сопло — своего радиуса. Оба в текущем размере корпуса,
    // как и меш (тот растёт своим оверрайдом синхронно — числа групп уже масштабированы).
    const gunSize = Math.max(0.25, player.loadout.chassis.radius * 0.04 * editor.sizeMul)
    let gunCount = 0
    let nozzleCount = 0
    let liveCount = 0

    editor.groups.forEach((group, groupIndex) => {
      const active = groupIndex === editor.index
      const size = group.slot === 'gun' ? gunSize : group.radius
      const mesh = active ? liveMesh : group.slot === 'gun' ? gunMesh : nozzleMesh

      for (const p of groupPoints(group)) {
        const slot = active ? liveCount : group.slot === 'gun' ? gunCount : nozzleCount
        if (slot >= MAX_MARKS) continue
        _dummy.position.set(p.x, p.y, p.z).applyQuaternion(player.state.quat).add(player.state.pos)
        _dummy.quaternion.copy(player.state.quat)
        _dummy.scale.setScalar(size * (active ? 1.25 : 1))
        _dummy.updateMatrix()
        mesh.setMatrixAt(slot, _dummy.matrix)
        if (active) liveCount++
        else if (group.slot === 'gun') gunCount++
        else nozzleCount++
      }
    })

    gunMesh.count = gunCount
    nozzleMesh.count = nozzleCount
    liveMesh.count = liveCount
    gunMesh.instanceMatrix.needsUpdate = true
    nozzleMesh.instanceMatrix.needsUpdate = true
    liveMesh.instanceMatrix.needsUpdate = true

    if (el) {
      el.style.display = 'block'
      el.textContent = panelText(editor.chassisName, editor.sizeMul, editor.groups, editor.index)
    }
  })

  return (
    <>
      <instancedMesh ref={gun} args={[markGeometry, gunMaterial, MAX_MARKS]} renderOrder={999} frustumCulled={false} />
      <instancedMesh ref={nozzle} args={[markGeometry, nozzleMaterial, MAX_MARKS]} renderOrder={999} frustumCulled={false} />
      <instancedMesh ref={live} args={[markGeometry, liveMaterial, MAX_MARKS]} renderOrder={999} frustumCulled={false} />
    </>
  )
}

function col(v: number): string {
  return v.toFixed(2).padStart(7)
}

function panelText(chassisName: string, sizeMul: number, groups: readonly RigGroup[], index: number): string {
  const rows = groups.map((g, i) => {
    const mark = i === index ? '>' : ' '
    const x = g.kind === 'pair' ? `±${g.x.toFixed(2)}`.padStart(7) : col(g.x)
    const r = g.slot === 'nozzle' ? `  r${g.radius.toFixed(2)}` : ''
    return `${mark} ${g.label.padEnd(16)}${x}${col(g.y)}${col(g.z)}${r}`
  })
  return [
    `ОСНАСТКА · ${chassisName} · ×${sizeMul.toFixed(2)}`,
    ...rows,
    'Shift+←→ размах · Shift+↑↓ выше/ниже · Ctrl+↑↓ вперёд/назад',
    '−/= радиус сопла · 6/7 размер корабля · ←→↑↓ облёт',
    'Enter — следующая · 0 — следующий корабль · K — в консоль и выход',
  ].join('\n')
}
