import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, Color, IcosahedronGeometry, InstancedMesh, Object3D, Quaternion, ShaderMaterial, Vector3 } from 'three'
import { PHYSICS, aimDirection, chargeBallCenter, chargeBallRadius, renderPos, renderTime, type ShipEntity, type World } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { GIANT_RENDER_CAP, LASER_SCHOOL_GLOW } from '../config'
import { shownShipQuat } from '../shownPose'

/**
 * ШАР РАЗБИВАЮЩЕГО ЛАЗЕРА — светящаяся сфера: белое ядро, сиреневая кромка, по поверхности
 * бегут голубые волны, край размыт и тает в мягком ореоле. Все шары — один `InstancedMesh`. Видимый радиус не меньше доли дистанции
 * до камеры: шар, улетевший к планете за сотни тысяч км, остаётся видной искрой, а не
 * исчезает субпикселем на полпути.
 *
 * Тот же шар, пока его ЗАРЯЖАЮТ: висит перед носом и растёт с набором — выстрел выглядит
 * как отрыв этого шара, а не появление нового. Готовый дрожит, отменённый схлопывается.
 */

const MAX_PULSES = 16
/** Минимальный видимый радиус — доля дистанции до камеры (≈ полградуса в поперечнике). */
const MIN_ANGULAR = 0.004

const geometry = new IcosahedronGeometry(1, 3)

/** Ореол — оболочка во столько раз шире шара: свечение тает за краем, а не обрывается. */
const HALO_GROW = 1.45
/** Голубые волны, бегущие по шару. */
const WAVE_COLOR = 0x5ab8ff

const INSTANCED_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uGrow;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    vObj = position;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * uGrow, 1.0);
    vV = -mv.xyz;
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

let materialCache: ShaderMaterial | null = null
function pulseMaterial(): ShaderMaterial {
  materialCache ??= new ShaderMaterial({
    uniforms: {
      uRim: { value: new Color(LASER_SCHOOL_GLOW.shatter) },
      uWave: { value: new Color(WAVE_COLOR) },
      uTime: { value: 0 },
      uGrow: { value: 1 },
    },
    vertexShader: INSTANCED_VERTEX,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uRim;
      uniform vec3 uWave;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vObj;
      void main() {
        #include <logdepthbuf_fragment>
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(1.0 - facing, 1.6);
        // Поверхность дрожит: бегущие волны по шару — энергия, а не стеклянный мяч.
        float ripple = 0.75 + 0.25 * sin(vObj.y * 9.0 + uTime * 14.0) * sin(vObj.x * 7.0 - uTime * 11.0);
        // Голубые волны: два фронта под углом бегут по сфере навстречу друг другу —
        // узкие гребни (степень), чтобы читались волнами, а не общей подсветкой.
        float w1 = pow(0.5 + 0.5 * sin(dot(vObj, vec3(0.8, 0.5, 0.3)) * 11.0 - uTime * 7.0), 8.0);
        float w2 = pow(0.5 + 0.5 * sin(dot(vObj, vec3(-0.3, 0.7, -0.6)) * 8.0 + uTime * 5.0), 8.0);
        vec3 col = vec3(1.0) * pow(facing, 3.0) * 1.2 + uRim * rim * 1.6 * ripple + uWave * (w1 + w2) * 1.1;
        // Край размыт: к силуэту свечение тает, а не обрывается резкой кромкой.
        col *= smoothstep(0.0, 0.25, facing);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  return materialCache
}

let haloCache: ShaderMaterial | null = null
/**
 * Ореол шара: та же сфера, раздутая в `HALO_GROW`. Яркость — от проекции на экран: внутри
 * диска шара ровная, за его краем гаснет к краю оболочки. Так у шара мягкий светящийся край.
 */
function haloMaterial(): ShaderMaterial {
  haloCache ??= new ShaderMaterial({
    uniforms: {
      uRim: { value: new Color(LASER_SCHOOL_GLOW.shatter) },
      uWave: { value: new Color(WAVE_COLOR) },
      uTime: { value: 0 },
      uGrow: { value: HALO_GROW },
    },
    vertexShader: INSTANCED_VERTEX,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uRim;
      uniform vec3 uWave;
      uniform float uTime;
      uniform float uGrow;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vObj;
      void main() {
        #include <logdepthbuf_fragment>
        float facing = abs(dot(normalize(vN), normalize(vV)));
        // Доля радиуса оболочки на экране: 0 в центре, 1 на её силуэте.
        float p = sqrt(max(0.0, 1.0 - facing * facing));
        float inner = 1.0 / uGrow;
        float x = clamp((p - inner) / (1.0 - inner), 0.0, 1.0);
        float glow = p < inner ? 0.15 + 0.25 * smoothstep(inner * 0.8, inner, p) : 0.4 * pow(1.0 - x, 2.5);
        // Ореол дышит голубым вместе с волнами.
        float breathe = 0.85 + 0.15 * sin(uTime * 6.0);
        vec3 col = mix(uRim, uWave, 0.55) * glow * breathe;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  return haloCache
}

const _dummy = new Object3D()
const _cam = new Vector3()
const _shipAt = new Vector3()
const _shipQ = new Quaternion()
const _aim = new Vector3()

/**
 * Шар заряда корабля в матрицу `_dummy`. false — шара нет. Свой корпус на экране зажат
 * потолком (`GIANT_RENDER_CAP`) — и шар с ним тем же множителем, иначе гигант держал бы
 * перед носом шар больше себя.
 */
function placeCharge(world: World, ship: ShipEntity, now: number, clock: number): boolean {
  const r = chargeBallRadius(ship, now)
  if (r <= 0) return false
  const own = ship === world.player
  const scale = ship.state.scale
  const shown = own ? Math.min(scale, GIANT_RENDER_CAP) / scale : 1
  renderPos(world, ship.state, _shipAt)
  shownShipQuat(world, ship, _shipQ)
  aimDirection(_shipQ, 0, _aim)
  // Готовый шар дрожит: энергия на пределе.
  const ready = ship.pulseCharge?.level === 1 && ship.pulseCharge.cancelledAt === null
  const rr = r * shown * (ready ? 1 + 0.05 * Math.sin(clock * 37) : 1)
  chargeBallCenter(_shipAt, _aim, ship.spec.hull.radius * scale * shown, r * shown, _dummy.position)
  _dummy.scale.setScalar(rr)
  _dummy.updateMatrix()
  return true
}

/** Шар между тактами: такт ушёл вперёд на долю шага — откатываем по скорости. */
function shownPulse(world: World, pos: Vector3, vel: Vector3, out: Vector3): Vector3 {
  return out.copy(pos).addScaledVector(vel, -(1 - world.renderAlpha) * PHYSICS.FIXED_DT)
}

export function Pulses() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const haloRef = useRef<InstancedMesh>(null)
  const material = useMemo(pulseMaterial, [])
  const halo = useMemo(haloMaterial, [])

  useFrame(({ camera, clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const world = session.world
    material.uniforms.uTime!.value = clock.elapsedTime
    halo.uniforms.uTime!.value = clock.elapsedTime
    camera.getWorldPosition(_cam)
    let n = 0
    for (const p of world.pulses) {
      if (n >= MAX_PULSES) break
      shownPulse(world, p.pos, p.vel, _dummy.position)
      const r = Math.max(p.radius, _dummy.position.distanceTo(_cam) * MIN_ANGULAR)
      _dummy.scale.setScalar(r)
      _dummy.updateMatrix()
      mesh.setMatrixAt(n++, _dummy.matrix)
    }
    const now = renderTime(world)
    if (n < MAX_PULSES && world.player.pulseCharge && placeCharge(world, world.player, now, clock.elapsedTime)) {
      mesh.setMatrixAt(n++, _dummy.matrix)
    }
    for (const ship of world.ships) {
      if (n >= MAX_PULSES) break
      if (ship.pulseCharge && placeCharge(world, ship, now, clock.elapsedTime)) mesh.setMatrixAt(n++, _dummy.matrix)
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    // Ореол — те же матрицы: копия массива, без пересборки.
    const haloMesh = haloRef.current
    if (haloMesh) {
      haloMesh.instanceMatrix.array.set(mesh.instanceMatrix.array)
      haloMesh.count = n
      haloMesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      <instancedMesh ref={haloRef} args={[geometry, halo, MAX_PULSES]} frustumCulled={false} />
      <instancedMesh ref={ref} args={[geometry, material, MAX_PULSES]} frustumCulled={false} />
    </>
  )
}

