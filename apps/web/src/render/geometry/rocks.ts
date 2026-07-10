import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, Vector3 } from 'three'
import { makeRng } from '@elite/sim'
import { PALETTE } from '../config'

/**
 * Астероиды: икосаэдр, продавленный шумом. Четыре формы на весь пояс —
 * все 260 камней рисуются одним InstancedMesh, поэтому форм должно быть немного,
 * а разнообразие даёт случайный поворот и масштаб.
 *
 * Геометрия единичного радиуса: масштабируется матрицей инстанса.
 */

const _v = new Vector3()
const _color = new Color()

function deformed(seed: number): BufferGeometry {
  // detail=1: 80 граней. Больше не нужно — камень должен быть угловатым.
  const geometry = new IcosahedronGeometry(1, 1).toNonIndexed()
  const rng = makeRng(seed)
  const position = geometry.getAttribute('position') as BufferAttribute

  // Смещаем по направлению от центра, но одинаково для совпадающих вершин,
  // иначе грани разойдутся и появятся щели. Ключ — округлённые координаты.
  const offsets = new Map<string, number>()
  const keyOf = (x: number, y: number, z: number) =>
    `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`

  for (let i = 0; i < position.count; i++) {
    _v.fromBufferAttribute(position, i)
    const key = keyOf(_v.x, _v.y, _v.z)
    let scale = offsets.get(key)
    if (scale === undefined) {
      scale = 0.68 + rng() * 0.5
      offsets.set(key, scale)
    }
    _v.multiplyScalar(scale)
    position.setXYZ(i, _v.x, _v.y, _v.z)
  }

  // Цвет по грани: чуть светлее наверху, темнее в впадинах. Даёт объём без текстур.
  const colors = new Float32Array(position.count * 3)
  const light = new Color(PALETTE.ASTEROID)
  const dark = new Color(PALETTE.ASTEROID_DARK)
  for (let f = 0; f < position.count; f += 3) {
    let height = 0
    for (let v = 0; v < 3; v++) {
      _v.fromBufferAttribute(position, f + v)
      height += _v.length()
    }
    _color.lerpColors(dark, light, Math.min(1, Math.max(0, (height / 3 - 0.68) / 0.5)))
    for (let v = 0; v < 3; v++) {
      colors[(f + v) * 3] = _color.r
      colors[(f + v) * 3 + 1] = _color.g
      colors[(f + v) * 3 + 2] = _color.b
    }
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

let shapes: BufferGeometry[] | null = null

/** Четыре формы, разделяемые всеми астероидами. Создаются один раз. */
export function asteroidShapes(): BufferGeometry[] {
  shapes ??= [0x1111, 0x2222, 0x3333, 0x4444].map(deformed)
  return shapes
}
