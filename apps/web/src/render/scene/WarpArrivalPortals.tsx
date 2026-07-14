import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  DoubleSide,
  Group,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three'
import { WARP } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { WARP_PORTAL } from '../config'

const _quat = new Quaternion()
const _z = new Vector3(0, 0, 1)
const _rel = new Vector3()

function makeHoleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
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
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        if (r > 1.0) discard;
        float edge = smoothstep(1.0, 0.82, r);
        vec2 sp = p * 28.0 + vec2(uTime * 0.04, uTime * 0.03);
        vec2 cell = floor(sp);
        float star = step(0.992, hash(cell));
        vec3 sky = mix(vec3(0.02, 0.05, 0.14), vec3(0.08, 0.16, 0.32), 1.0 - r);
        sky += vec3(0.85, 0.92, 1.0) * star * edge;
        float glow = edge * (0.55 + 0.2 * sin(uTime * 3.0 + r * 8.0));
        gl_FragColor = vec4(sky + vec3(0.15, 0.35, 0.65) * glow * 0.35, edge * uOpacity);
      }
    `,
  })
}

function makeRingMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: WARP_PORTAL.RING_COLOR,
    transparent: true,
    opacity: 0.92,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
}

function PortalInstance({
  pos,
  dir,
  ringRadius,
  born,
  time,
  kind,
  shipPos,
  shipDeparting,
}: {
  pos: Vector3
  dir: Vector3
  ringRadius: number
  born: number
  time: number
  kind: 'arrive' | 'depart'
  shipPos: Vector3 | null
  shipDeparting: boolean
}) {
  const group = useRef<Group>(null)
  const holeMat = useMemo(makeHoleMaterial, [])
  const ringMat = useMemo(makeRingMaterial, [])
  const ringGeo = useMemo(() => new TorusGeometry(1, WARP_PORTAL.TUBE, 8, 32), [])

  useFrame(() => {
    const g = group.current
    if (!g) return
    g.position.copy(pos)
    _quat.setFromUnitVectors(_z, dir)
    g.quaternion.copy(_quat)

    const age = time - born
    const openTime = kind === 'arrive' ? WARP.ARRIVAL.OPEN : WARP.DEPART.OPEN
    const life = kind === 'arrive' ? WARP.ARRIVAL.LIFE : WARP.DEPART.LIFE
    const open = Math.min(1, age / openTime)
    let ease = 1 - (1 - open) ** 3

    let fade = age > life - 0.25 ? Math.max(0, 1 - (age - (life - 0.25)) / 0.25) : 1

    if (kind === 'depart' && shipPos && shipDeparting) {
      _rel.subVectors(shipPos, pos)
      const along = _rel.dot(dir)
      if (along > ringRadius * 0.04) {
        const collapse = Math.max(0, 1 - (along - ringRadius * 0.04) / (ringRadius * 0.35))
        ease *= collapse
        fade *= collapse
      }
    }

    const scale = ringRadius * ease * fade
    g.scale.setScalar(Math.max(scale, 1e-3))

    holeMat.uniforms.uTime!.value = time
    holeMat.uniforms.uOpacity!.value = 0.85 * fade
    ringMat.opacity = 0.75 * fade
  })

  return (
    <group ref={group}>
      <mesh material={holeMat} renderOrder={1}>
        <circleGeometry args={[1, 40]} />
      </mesh>
      <mesh geometry={ringGeo} material={ringMat} renderOrder={2} />
    </group>
  )
}

/** Гиперпорталы: приход и уход — кольцо, «дыра», борт вылетает или влетает. */
export function WarpArrivalPortals() {
  const session = useSession()
  const portals = session.world.warpPortals
  const time = session.world.time
  if (portals.length === 0) return null
  return (
    <>
      {portals.map((p) => {
        const ship = session.world.ships.find((s) => s.id === p.shipId)
        return (
          <PortalInstance
            key={`${p.kind}-${p.shipId}-${p.born}`}
            pos={p.pos}
            dir={p.dir}
            ringRadius={p.ringRadius}
            born={p.born}
            time={time}
            kind={p.kind}
            shipPos={ship?.state.pos ?? null}
            shipDeparting={ship?.warpDeparting ?? false}
          />
        )
      })}
    </>
  )
}
