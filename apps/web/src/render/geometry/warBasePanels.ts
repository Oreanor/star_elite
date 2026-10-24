import { BufferAttribute, DoubleSide, MeshStandardMaterial, SphereGeometry, Vector3, type BufferGeometry, type Texture } from 'three'
import { makeRng } from '@elite/sim'

/**
 * ЛИСТ СОРВАННОЙ ОБШИВКИ военной базы: кусок её же сферы-корпуса, а не плоская плашка —
 * гнутый, с рваными краями, и карта на нём та же, что на корпусе (UV — участок equirect-
 * развёртки сферы). Оттого лист читается куском этой самой базы, а не случайным мусором.
 *
 * Габарит ~1 по ширине, центр — в середине листа: внешний `scale` задаёт настоящий размер.
 */

/** Несколько форм — разные участки сферы и разный рваный край. */
export const PANEL_VARIANTS = 3
/** Угловой размер листа на единичной сфере, рад: изгиб заметен, но это ещё не скорлупа. */
const SPAN = 0.8

const _v = new Vector3()
const _mid = new Vector3()

function panel(variant: number): BufferGeometry {
  const rng = makeRng(0x9a7e1 + variant * 131)
  const phiStart = rng() * Math.PI * 2
  const thetaStart = Math.PI / 2 - SPAN / 2 + (rng() - 0.5) * 0.6
  const seg = 6
  const g = new SphereGeometry(1, seg, seg, phiStart, SPAN, thetaStart, SPAN)
  const pos = g.getAttribute('position') as BufferAttribute
  const uv = g.getAttribute('uv') as BufferAttribute
  // Середина листа на сфере — её вычитаем, чтобы лист крутился вокруг себя, а не центра базы.
  const phiMid = phiStart + SPAN / 2
  const thetaMid = thetaStart + SPAN / 2
  _mid.set(-Math.cos(phiMid) * Math.sin(thetaMid), Math.cos(thetaMid), Math.sin(phiMid) * Math.sin(thetaMid))
  for (let iy = 0; iy <= seg; iy++) {
    for (let ix = 0; ix <= seg; ix++) {
      const i = iy * (seg + 1) + ix
      // Карта — участок общей развёртки, как у корпуса, а не вся картинка на один лист.
      uv.setXY(i, (phiStart + (ix / seg) * SPAN) / (Math.PI * 2), 1 - (thetaStart + (iy / seg) * SPAN) / Math.PI)
      _v.fromBufferAttribute(pos, i)
      // Рваный край: крайние вершины втягиваются к середине на случайную долю.
      const edge = ix === 0 || iy === 0 || ix === seg || iy === seg
      if (edge) _v.lerp(_mid, rng() * 0.45)
      _v.sub(_mid).divideScalar(SPAN)
      pos.setXYZ(i, _v.x, _v.y, _v.z)
    }
  }
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

let variants: BufferGeometry[] | null = null
export function warBasePanelGeometry(variant: number): BufferGeometry {
  variants ??= Array.from({ length: PANEL_VARIANTS }, (_, i) => panel(i))
  return variants[variant % PANEL_VARIANTS]!
}

export function panelVariantOf(seed: number): number {
  return ((seed % PANEL_VARIANTS) + PANEL_VARIANTS) % PANEL_VARIANTS
}

/** Матовый металл корпуса; двусторонний — у листа видна и изнанка, он кувыркается. */
const materials = new Map<Texture | null, MeshStandardMaterial>()
export function warBasePanelMaterial(map: Texture | null): MeshStandardMaterial {
  let m = materials.get(map)
  if (!m) {
    m = map
      ? new MeshStandardMaterial({ map, metalness: 0.2, roughness: 0.82, side: DoubleSide })
      : new MeshStandardMaterial({ color: 0x6b7079, metalness: 0.2, roughness: 0.82, side: DoubleSide })
    materials.set(map, m)
  }
  return m
}
