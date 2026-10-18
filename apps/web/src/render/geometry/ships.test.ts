import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three'
import { expect, it, vi } from 'vitest'
import { chassisGeometry, glbMaterial, preloadHull, subscribeHulls } from './ships'

const pending = vi.hoisted(() => new Map<string, (gltf: { scene: Object3D }) => void>())
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(url: string, ready: (gltf: { scene: Object3D }) => void) {
      pending.set(url, ready)
    }
  },
}))

it('уведомляет открытое превью после загрузки корпуса и публикует готовые геометрию и материал', () => {
  // После F5 превью уже смонтировано с заглушкой: ожидание другого рендера оставляло ромб навсегда.
  const placeholder = chassisGeometry('orion')
  const material = new MeshStandardMaterial()
  const scene = new Group()
  scene.add(new Mesh(new BoxGeometry(2, 3, 4), material))
  const notified = vi.fn(() => {
    expect(chassisGeometry('orion')).not.toBe(placeholder)
    expect(glbMaterial('orion')).toBe(material)
    expect(chassisGeometry('orion').boundingSphere!.radius).toBeGreaterThan(0)
  })
  const unsubscribe = subscribeHulls(notified)
  preloadHull('orion')
  expect(notified).not.toHaveBeenCalled()
  pending.get('/models/ships/orion.glb')!({ scene })
  expect(notified).toHaveBeenCalledTimes(1)
  expect(chassisGeometry('orion')).toBe(chassisGeometry('orion'))
  unsubscribe()
  preloadHull('perseus')
  pending.get('/models/ships/perseus.glb')!({ scene })
  expect(notified).toHaveBeenCalledTimes(1)
})
