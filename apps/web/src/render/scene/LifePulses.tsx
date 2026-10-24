import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, Color, InstancedMesh, Object3D, PlaneGeometry, ShaderMaterial, Vector3 } from 'three'
import { pulseFade, renderTime } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { LASER_SCHOOL_GLOW } from '../config'
import { chargeFullRadius, placeCharge, shownPulse } from './pulseCharge'

/**
 * ИМПУЛЬС ЖИЗНИ — яркая точка с четырьмя лучами: белое ядро, свечение по радуге, крест тонких
 * лучей, пульсирующих и вращающихся. И заряд перед носом, и летящий импульс — одна
 * и та же звезда-блик: выстрел — её отрыв. Пока заряд копится, к нему со всех сторон бегут
 * тонкие штрихи — энергия втягивается в точку. Билборды всегда лицом к камере (разворот в
 * шейдере); точки — один InstancedMesh, поля штрихов — второй.
 */

const MAX = 16
/** Лучи длиннее ядра во столько раз: квадрат билборда — ядро × REACH. */
const REACH = 9
/**
 * Поле штрихов шире полной точки во столько раз. Ширина и длина штриха заданы в долях поля,
 * так что поле меньше — и штрихи тоньше: при 16 они были жирными и тянулись слишком издалека.
 */
const STREAK_REACH = 6.4
/** Минимальный видимый радиус ядра — доля дистанции до камеры: улетевший не тает в субпиксель. */
const MIN_ANGULAR = 0.003

const geometry = new PlaneGeometry(2, 2)

/** Билборд: центр и масштаб — из матрицы экземпляра, разворот — к камере. */
const BILLBOARD_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying float vLevel;
  void main() {
    vUv = position.xy;
    #ifdef USE_INSTANCING_COLOR
      vLevel = instanceColor.r;
    #else
      vLevel = 1.0;
    #endif
    vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float size = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
    center.xy += position.xy * size;
    gl_Position = projectionMatrix * center;
    #include <logdepthbuf_vertex>
  }
`

/** Тон по радуге во времени, с подмесом изумрудного импульса жизни — общий для точки и штрихов. */
const RAINBOW = /* glsl */ `
  vec3 lifeTint(float t, vec3 base) {
    vec3 rainbow = clamp(abs(mod(fract(t * 0.09) * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return mix(rainbow, base, 0.25);
  }
`

let materialCache: ShaderMaterial | null = null
function sparkMaterial(): ShaderMaterial {
  materialCache ??= new ShaderMaterial({
    uniforms: { uColor: { value: new Color(LASER_SCHOOL_GLOW.seed) }, uTime: { value: 0 } },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uTime;
      varying vec2 vUv;
      ${RAINBOW}
      void main() {
        #include <logdepthbuf_fragment>
        // Лучи вращаются ровно, только от времени: фаза от места в мире дёргала их рывками —
        // заряд едет с кораблём, место меняется каждый кадр.
        float a = uTime * 0.55;
        vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * vUv;
        float r = length(vUv);
        // ПУЛЬС — мягкое дыхание яркости и длины лучей; мерцание — быстрее и мельче поверх.
        float pulse = 0.82 + 0.18 * sin(uTime * 3.2);
        float twinkle = pulse * (0.92 + 0.08 * sin(uTime * 7.3));
        // Ядро: в квадрате оно занимает 1/REACH — тугой гаусс в центре, дышит с пульсом.
        float core = exp(-r * r * 260.0 / pulse);
        float glow = exp(-r * 7.0) * 0.55 * pulse;
        // Поперёк луча — гаусс (мягкий край без излома) плюс широкий слабый ореол.
        float ray = (exp(-p.y * p.y * 1400.0) + 0.3 * exp(-abs(p.y) * 22.0)) * exp(-abs(p.x) * 2.6 / twinkle)
                  + (exp(-p.x * p.x * 1400.0) + 0.3 * exp(-abs(p.x) * 22.0)) * exp(-abs(p.y) * 2.6 / twinkle);
        // Цвет свечения плавно идёт по РАДУГЕ (тон по кругу), ядро остаётся белым.
        vec3 tint = lifeTint(uTime, uColor);
        vec3 col = tint * (glow + ray * 0.9) + vec3(1.0) * (core * 1.6 + ray * 0.35 * pulse);
        // Края квадрата — в ноль: никакой рамки.
        col *= smoothstep(1.0, 0.85, max(abs(vUv.x), abs(vUv.y)));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  return materialCache
}

let streakCache: ShaderMaterial | null = null
/**
 * ВТЯГИВАНИЕ: тонкие радиальные штрихи бегут к центру со всех сторон, пока копится заряд.
 * Сектора по кругу, у каждого свой сдвиг фазы и угол — не строй, а рой. Чем полнее заряд
 * (`vLevel` из цвета экземпляра), тем гуще и ярче; у самого ядра штрихи тают — их «съело».
 */
function streakMaterial(): ShaderMaterial {
  streakCache ??= new ShaderMaterial({
    uniforms: { uColor: { value: new Color(LASER_SCHOOL_GLOW.seed) }, uTime: { value: 0 } },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uTime;
      varying vec2 vUv;
      varying float vLevel;
      ${RAINBOW}
      float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vUv);
        if (r > 1.0 || vLevel <= 0.0) discard;
        const float SECTORS = 28.0;
        float ang = atan(vUv.y, vUv.x) / 6.2831853 + 0.5;
        float sector = floor(ang * SECTORS);
        float h = hash1(sector + 1.0);
        // Штрих сидит у середины сектора со своим сдвигом — рой, а не спицы колеса.
        float mid = (sector + 0.25 + 0.5 * h) / SECTORS;
        float across = abs(ang - mid) * 6.2831853 * r;
        float line = exp(-across * across * 9000.0);
        // Фаза растёт со временем при постоянном r — значит, гребень бежит К ЦЕНТРУ. По КВАДРАТУ
        // радиуса: d(r²)/dt постоянна, dr/dt ∝ 1/r — штрих разгоняется, падая к ядру.
        float phase = fract(r * r * 1.1 + uTime * (3.0 + 2.0 * h) + h * 7.0);
        float dash = smoothstep(0.0, 0.05, phase) * smoothstep(0.36, 0.14, phase);
        // Не все сектора разом: на малом заряде горят немногие, к полному — почти все.
        float on = step(h, 0.25 + 0.75 * vLevel);
        // Тает у края поля и у самого ядра — там его уже «втянуло».
        float fade = smoothstep(1.0, 0.7, r) * smoothstep(0.06, 0.2, r);
        float k = line * dash * on * fade * (0.35 + 0.65 * vLevel);
        gl_FragColor = vec4(lifeTint(uTime, uColor) * k * 0.5, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  return streakCache
}

const _dummy = new Object3D()
const _cam = new Vector3()
const _level = new Color()

export function LifePulses() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const streaksRef = useRef<InstancedMesh>(null)
  const material = useMemo(sparkMaterial, [])
  const streaks = useMemo(streakMaterial, [])

  useFrame(({ camera, clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const world = session.world
    material.uniforms.uTime!.value = clock.elapsedTime
    streaks.uniforms.uTime!.value = clock.elapsedTime
    camera.getWorldPosition(_cam)
    let n = 0
    const now = renderTime(world)
    for (const p of world.pulses) {
      if (n >= MAX) break
      if (p.kind !== 'seed') continue
      shownPulse(world, p.pos, p.vel, _dummy.position)
      // Промахнувшийся тает: видимый размер уходит в ноль за последние секунды.
      const r = Math.max(p.radius, _dummy.position.distanceTo(_cam) * MIN_ANGULAR) * pulseFade(p, now)
      _dummy.scale.setScalar(r * REACH)
      _dummy.updateMatrix()
      mesh.setMatrixAt(n++, _dummy.matrix)
    }
    const field = streaksRef.current
    let m = 0
    for (let i = -1; i < world.ships.length && n < MAX; i++) {
      const ship = i < 0 ? world.player : world.ships[i]!
      const c = ship.pulseCharge
      if (c?.kind !== 'seed' || !placeCharge(world, ship, now, clock.elapsedTime, _dummy)) continue
      _dummy.scale.multiplyScalar(REACH)
      _dummy.updateMatrix()
      mesh.setMatrixAt(n++, _dummy.matrix)
      // Поле втягивания — вокруг того же центра, размером от ПОЛНОГО заряда: тянет с первой
      // секунды. Отменённый заряд втягивать перестаёт сразу.
      if (field && c.cancelledAt === null) {
        _dummy.scale.setScalar(chargeFullRadius(world, ship) * STREAK_REACH)
        _dummy.updateMatrix()
        field.setMatrixAt(m, _dummy.matrix)
        field.setColorAt(m, _level.setRGB(c.level, 0, 0))
        m++
      }
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    if (field) {
      field.count = m
      field.instanceMatrix.needsUpdate = true
      if (field.instanceColor) field.instanceColor.needsUpdate = true
    }
  })

  return (
    <>
      <instancedMesh ref={streaksRef} args={[geometry, streaks, MAX]} frustumCulled={false} />
      <instancedMesh ref={ref} args={[geometry, material, MAX]} frustumCulled={false} />
    </>
  )
}
