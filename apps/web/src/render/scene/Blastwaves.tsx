import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  InstancedMesh,
  Object3D,
  ShaderMaterial,
  type InstancedBufferAttribute,
} from 'three'
import { WARBASE, renderTime } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { PALETTE } from '../config'

/**
 * СФЕРИЧЕСКАЯ ВОЛНА сноса: круг с градиентным краем, расходящийся из точки взрыва.
 *
 * Это «пух» после каскада детонаций — тот удар, что разбрасывает лом. Билборд, всегда
 * лицом к камере: сфера, снятая с любой стороны, и есть круг, а плоское кольцо в мире
 * с ребра исчезало бы. Объём даёт градиент — яркая кромка и почти пустая середина, как
 * у настоящей ударной волны, где светится сжатый фронт, а не весь пузырь.
 *
 * Волн в кадре единицы (снос базы — редкое событие), но пул фиксирован и живёт с монтажа:
 * в кадре меняются только матрицы и фаза, ни одной аллокации.
 */

/** Больше и не надо: две базы, снесённые разом, — уже небывалый случай. */
const MAX_WAVES = 4

const _dummy = new Object3D()

/**
 * Единичный круг: диаметр задаётся масштабом инстанса. Геометрия — на компонент, а не на
 * модуль, и это не оплошность: она несёт поинстансную фазу волны, а сцен бывает две (своя
 * и мир за кольцом портала). Общая геометрия смешала бы фазы двух миров.
 */
function waveGeometry(): CircleGeometry {
  return new CircleGeometry(1, 48)
}

let materialCache: ShaderMaterial | null = null
function waveMaterial(): ShaderMaterial {
  materialCache ??= createWaveMaterial()
  return materialCache
}

function createWaveMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(PALETTE.EXPLOSION) } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      // Фаза 0..1 у каждой волны своя — оттого они могут идти внахлёст, не сливаясь.
      attribute float instancePhase;
      varying vec2 vUv;
      varying float vPhase;
      void main() {
        vUv = uv;
        vPhase = instancePhase;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vPhase;
      void main() {
        #include <logdepthbuf_fragment>
        // r: 0 в центре, 1 у кромки круга.
        float r = length(vUv - 0.5) * 2.0;
        // Светится ФРОНТ — узкая полоса у самого края; к центру всё гаснет. Полоса тем
        // тоньше, чем волна старше: фронт «раскатывается» и истончается, а не расплывается.
        float width = mix(0.42, 0.12, vPhase);
        float front = smoothstep(1.0, 1.0 - width, r) * smoothstep(1.02, 1.0, r);
        // Общее затухание: к концу жизни волна уходит в ничто, а не обрывается.
        float fade = 1.0 - vPhase * vPhase;
        gl_FragColor = vec4(uColor * front * fade, 1.0) * front * fade;
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
}

export function Blastwaves() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const geometry = useMemo(waveGeometry, [])
  const material = waveMaterial()
  // Своя геометрия уходит вместе с компонентом; материал общий — живёт с модулем.
  useEffect(() => () => geometry.dispose(), [geometry])
  // Фаза живёт в инстансном атрибуте: одна отрисовка на все волны кадра.
  const phases = useMemo(() => new Float32Array(MAX_WAVES), [])

  useFrame(({ camera }) => {
    const mesh = ref.current
    if (!mesh) return
    const now = renderTime(session.world)
    let count = 0

    for (const wave of session.world.blastwaves) {
      if (count >= MAX_WAVES) break
      const age = (now - wave.born) / WARBASE.WAVE_LIFE
      // Ещё не «пухнуло» (волна ждёт конца каскада) или уже прошла.
      if (age < 0 || age > 1) continue

      // Радиус растёт с замедлением: фронт бьёт резко, потом выдыхается.
      const radius = wave.radius * Math.sqrt(age)
      _dummy.position.copy(wave.pos)
      _dummy.quaternion.copy(camera.quaternion)
      _dummy.scale.setScalar(Math.max(radius, 1))
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      phases[count] = age
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    const attr = mesh.geometry.getAttribute('instancePhase') as InstancedBufferAttribute | undefined
    if (attr) attr.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[geometry, material, MAX_WAVES]} frustumCulled={false}>
      <instancedBufferAttribute attach="geometry-attributes-instancePhase" args={[phases, 1]} />
    </instancedMesh>
  )
}
