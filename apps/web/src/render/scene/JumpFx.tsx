import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, DoubleSide, Group, Mesh, ShaderMaterial } from 'three'
import { jumpTo, useSession } from '../../app/GameContext'
import {
  ARRIVE_DUR,
  departComplete,
  endJump,
  flareAlpha,
  flareScale,
  holdOrLaunch,
  jumpFx,
  ringScaleNow,
} from '../../app/control/jumpFx'
import { properName } from '../../ui/i18n/dataNames'

/**
 * Постановщик кино прыжка. Живёт ВНЕ пересобираемой сцены (иначе подмена мира снесла
 * бы его на середине), поэтому двигает таймер сам и в момент полного затемнения меняет
 * мир. Домен не пустил — молча выходим: кино не должно застрять на чёрном экране.
 */
export function JumpDirector() {
  const session = useSession()
  useFrame((_, dt) => {
    const fx = jumpFx()
    if (!fx.phase) return
    fx.t += dt

    if (departComplete()) {
      if (jumpTo(session, fx.index, fx.arrival)) {
        fx.name = properName(session.world.systemName)
        fx.phase = 'arrive'
        fx.t = 0
      } else {
        // Домен внезапно не пустил (почти невозможно — прыжок проверен на нажатии H).
        // Не рвём чёрным обратно в старую систему: мягко высветляем её, как прибытие
        // без титра — экран не мигнёт из полной черноты в кадр за один кадр.
        fx.phase = 'arrive'
        fx.t = 0
        fx.name = ''
      }
    } else if (fx.phase === 'arrive' && fx.t >= ARRIVE_DUR) {
      endJump()
    }
  })
  return null
}

/**
 * Удержание корабля на зарядке и импульс срыва. Монтируется СРАЗУ после Simulation
 * (до кораблей и камеры), чтобы гасить смещение, посчитанное шагом мира, ещё до того,
 * как его прочтут отрисовка корабля и камера — иначе корабль дёргался бы туда-обратно.
 */
export function JumpHold() {
  const session = useSession()
  useFrame(() => holdOrLaunch(session.world))
  return null
}

/**
 * Плёнка внутри кольца: не пустая дыра, а полупрозрачная светящаяся мембрана.
 * Радиальный голубовато-белый градиент, чей центр медленно плавает, а внутри бегут
 * мягкие пульсации, — так «окно» прыжка живёт, а не висит статичной картинкой.
 * Аддитивная и без записи глубины — светится поверх струй. Логарифмическую глубину
 * (буфер сцены — логарифмический) шейдер обязан считать сам: иначе кольцо в 50 м
 * сравнивается с планетой в тысячах км по НЕ той формуле и уходит ей за спину.
 */
function makeMembrane(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.38 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vUv - 0.5;
        // Ядро градиента ОТЦЕНТРОВАНО — совпадает с центром блика и кольца.
        float r = length(p) * 2.0;
        float core = smoothstep(1.0, 0.0, r);
        // Плавает только рябь, не центр: окно «дышит», но светит из середины.
        vec2 drift = 0.12 * vec2(sin(uTime * 0.7), cos(uTime * 0.9));
        float ripple = 0.5 + 0.5 * sin(length(p - drift) * 9.0 - uTime * 2.5);
        float glow = core * (0.55 + 0.45 * ripple);
        float edge = smoothstep(1.0, 0.7, r);
        vec3 col = mix(vec3(0.45, 0.72, 1.0), vec3(0.9, 0.96, 1.0), core);
        gl_FragColor = vec4(col, glow * edge * uOpacity);
      }
    `,
  })
}

/**
 * Крестообразный белый блик — вспышка в миг, когда корабль проваливается в дыру.
 * Чистый крест из двух лучей с ярким ядром; крупнее кольца, аддитивный. Масштаб и
 * яркость гасит кадр, так что здесь только форма.
 */
function makeFlare(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uAlpha: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 d = vUv - 0.5;
        float ax = abs(d.x) * 2.0;
        float ay = abs(d.y) * 2.0;
        // Два тонких луча, гаснущих к концам, и яркое ядро в перекрестье.
        float h = smoothstep(0.05, 0.0, ay) * (1.0 - ax);
        float v = smoothstep(0.05, 0.0, ax) * (1.0 - ay);
        float core = smoothstep(0.22, 0.0, length(d) * 2.0);
        float c = clamp(max(h, v) + core * 0.8, 0.0, 1.0);
        gl_FragColor = vec4(vec3(1.0), c * uAlpha);
      }
    `,
  })
}

/** Блик крупнее кольца: половина стороны плоскости — столько радиусов кольца. */
const FLARE_SIZE = 1.6

/**
 * Голубое кольцо, вспыхивающее перед носом на отправлении: светящийся обод, живая
 * мембрана внутри и крестовый блик в миг исчезновения корабля. Висит в мире (поза снята
 * на старте), корабль влетает в него сам; раскрывается по мере подлёта, держится и
 * схлопывается. Живёт в СТАРОЙ сцене: подмена мира уносит его вместе с ней.
 */
export function JumpRing() {
  const group = useRef<Group>(null)
  const ring = useRef<Group>(null)
  const flare = useRef<Mesh>(null)
  const session = useSession()
  const membrane = useMemo(makeMembrane, [])
  const flareMat = useMemo(makeFlare, [])
  useFrame(() => {
    const g = group.current
    if (!g) return
    const fx = jumpFx()
    if (fx.phase !== 'depart') {
      g.visible = false
      return
    }
    g.visible = true
    g.position.copy(fx.ringPos)
    g.quaternion.copy(fx.ringQuat)
    // Время мира: анимация замрёт вместе с симуляцией, как и всё остальное.
    membrane.uniforms.uTime!.value = session.world.time

    // Кольцо и блик масштабируются порознь: обод/мембрана — по раскрытию, блик — по вспышке.
    if (ring.current) ring.current.scale.setScalar(Math.max(1e-3, ringScaleNow() * fx.ringRadius))
    if (flare.current) {
      const fs = flareScale()
      flare.current.visible = fs > 1e-3
      flare.current.scale.setScalar(Math.max(1e-3, fs * fx.ringRadius * FLARE_SIZE))
      flareMat.uniforms.uAlpha!.value = flareAlpha()
    }
  })
  return (
    <group ref={group} visible={false}>
      <group ref={ring}>
        {/* Только мембрана, без обода: диск радиуса 1, масштаб задаёт группа. Плоскость
            поперёк курса (нормаль по Z), корабль (нос −Z) проваливается сквозь неё. */}
        <mesh material={membrane}>
          <circleGeometry args={[1, 48]} />
        </mesh>
      </group>
      {/* Крестовый блик — своя плоскость 2×2 (полусторона 1), в той же плоскости кольца. */}
      <mesh ref={flare} material={flareMat} visible={false}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </group>
  )
}
