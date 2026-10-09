import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import {
  livingContacts,
  type StarSystem,
  type World,
} from '@elite/sim'
import { UI } from '../theme'
import { positionOf } from './GalaxyScene'

const _screen = new Vector3()

/**
 * Люди на карте галактики: системы знакомых (последнее известное место) и других игроков в
 * сети — свои метки и подписи. Меняется вместе с тем, кого и как показываем, а не с самой картой.
 */

/** Система с живыми знакомыми и их имена — для меток на карте галактики. */
export interface ContactSystem {
  index: number
  names: string[]
  pos: Vector3
}

/** Система с онлайн-игроками и их имена — для меток на карте галактики. */
export interface PlayerSystem {
  index: number
  names: string[]
  pos: Vector3
}

/** Тон знакомого на карте — тот же фиолетовый, что и на карте системы: одна метка на обе. */
export const CONTACT_MAP = '#b98bff'

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

/** Сгруппировать живых знакомых по системам: одна метка на систему, имена — под ней. */
export function contactSystemsOf(world: World, systems: readonly StarSystem[]): ContactSystem[] {
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
export function ContactStars({ systems }: { systems: ContactSystem[] }) {
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
          position={[s.pos.x, s.pos.y, s.pos.z]}
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
export function ContactLabels({
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
export const PLAYER_MAP = UI.PLAYER

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

/** Сгруппировать онлайн-игроков по системам: одна метка на систему, имена под ней. */
export function playerSystemsOf(
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
export function PlayerStars({ systems }: { systems: PlayerSystem[] }) {
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
          position={[s.pos.x, s.pos.y, s.pos.z]}
          raycast={() => null}
        />
      ))}
    </>
  )
}

/** Подписи имён игроков у их меток. DOM поверх канваса, двигается кадром (не React). */
export function PlayerLabels({
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
