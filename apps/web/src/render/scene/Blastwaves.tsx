import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Object3D,
  ShaderMaterial,
  type InstancedBufferAttribute,
} from 'three'
import { WARBASE, renderTime } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { PALETTE } from '../config'
import { worldShrink } from '../worldShrink'

/**
 * СФЕРИЧЕСКАЯ ВОЛНА сноса: прозрачный пузырь со светящимся краем, резко вжухающий из точки
 * взрыва и тающий быстрее огня. Настоящая сфера, а не круг-билборд: светится её КРАЙ (угол к
 * глазу), середина почти пуста — так виден объём ударного фронта, и сквозь него — огонь.
 * Прежде плоский круг с тонкой кромкой терялся под комом клубов. Рисуется поверх них
 * (`renderOrder`): волна — самое быстрое в кадре, её нельзя заслонять.
 *
 * Волн в кадре единицы (снос базы — редкое событие), но пул фиксирован и живёт с монтажа:
 * в кадре меняются только матрицы и фаза, ни одной аллокации.
 */

/** Больше и не надо: две базы, снесённые разом, — уже небывалый случай. */
const MAX_WAVES = 4
/** Цвет фронта в первый миг — бело-голубой жар сжатого газа; к концу — в огонь. */
const FRONT_HOT = 0xd8ecff

const _dummy = new Object3D()

/**
 * Единичная сфера: радиус задаётся масштабом инстанса. Геометрия — на компонент, а не на
 * модуль, и это не оплошность: она несёт поинстансную фазу волны, а сцен бывает две (своя
 * и мир за кольцом портала). Общая геометрия смешала бы фазы двух миров.
 */
function waveGeometry(): IcosahedronGeometry {
  return new IcosahedronGeometry(1, 4)
}

let materialCache: ShaderMaterial | null = null
function waveMaterial(): ShaderMaterial {
  materialCache ??= createWaveMaterial()
  return materialCache
}

function createWaveMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uHot: { value: new Color(FRONT_HOT) }, uCool: { value: new Color(PALETTE.EXPLOSION) } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      // Фаза 0..1 у каждой волны своя — оттого они могут идти внахлёст, не сливаясь.
      attribute float instancePhase;
      varying vec3 vN;
      varying vec3 vV;
      varying float vPhase;
      void main() {
        vPhase = instancePhase;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uHot;
      uniform vec3 uCool;
      varying vec3 vN;
      varying vec3 vV;
      varying float vPhase;
      void main() {
        #include <logdepthbuf_fragment>
        float facing = abs(dot(normalize(vN), normalize(vV)));
        // Светится КРАЙ пузыря: фронт виден ребром, середина почти пуста. Край тем тоньше,
        // чем волна старше — фронт раскатывается и истончается.
        float rim = pow(1.0 - facing, mix(2.0, 4.5, vPhase));
        float glow = rim * 1.6 + 0.05;
        // Тает к концу, а не обрывается; в первый миг — ярче всего.
        float fade = pow(1.0 - vPhase, 1.2);
        vec3 col = mix(uHot, uCool, smoothstep(0.2, 0.85, vPhase));
        gl_FragColor = vec4(col * glow * fade, 1.0);
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

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const now = renderTime(session.world)
    // Волна сооружения ужата с ним (закон зума): у гиганта база — точка, и волна по ней.
    const shrink = worldShrink(session.world.player.state.scale)
    let count = 0

    for (const wave of session.world.blastwaves) {
      if (shrink <= 0) break
      if (count >= MAX_WAVES) break
      const age = (now - wave.born) / WARBASE.WAVE_LIFE
      // Ещё не «пухнуло» (волна ждёт конца каскада) или уже прошла.
      if (age < 0 || age > 1) continue

      // Вжух: почти весь путь — в первую треть жизни, дальше фронт выдыхается и тает.
      const radius = wave.radius * shrink * (1 - (1 - age) ** 4)
      _dummy.position.copy(wave.pos)
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
    <instancedMesh ref={ref} args={[geometry, material, MAX_WAVES]} frustumCulled={false} renderOrder={3}>
      <instancedBufferAttribute attach="geometry-attributes-instancePhase" args={[phases, 1]} />
    </instancedMesh>
  )
}
