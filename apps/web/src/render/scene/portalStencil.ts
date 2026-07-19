import {
  AdditiveBlending,
  AlwaysDepth,
  AlwaysStencilFunc,
  CircleGeometry,
  Color,
  DoubleSide,
  EqualStencilFunc,
  Group,
  KeepStencilOp,
  Mesh,
  MeshBasicMaterial,
  ReplaceStencilOp,
  Scene,
  ShaderMaterial,
  TorusGeometry,
  type Camera,
  type WebGLRenderer,
} from 'three'
import type { World } from '@elite/sim'
import { portalOpen } from '../../app/control/jumpPortal'
import { jumpPortal } from '../../app/control/jumpPortal'
import { WARP_PORTAL } from '../config'
import {
  destPortalScene,
  syncDestCamera,
} from './jumpPortalWorld'

/**
 * Stencil-портал: овал кольца — маска; в ней вторая сцена; обод — неон.
 * Без RT-текстуры «картинкой в дырке».
 */

let maskScene: Scene | null = null
let depthScene: Scene | null = null
let ringScene: Scene | null = null
let haloScene: Scene | null = null
let maskMesh: Mesh | null = null
let depthMesh: Mesh | null = null
let ringGroup: Group | null = null
let haloGroup: Group | null = null
let ringMaterial: ShaderMaterial | null = null
let haloMaterial: ShaderMaterial | null = null
let diffuseGlowMaterial: ShaderMaterial | null = null

function ensure(): void {
  if (maskScene) return

  maskScene = new Scene()
  maskMesh = new Mesh(
    new CircleGeometry(1, 64),
    new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: AlwaysStencilFunc,
      stencilFail: KeepStencilOp,
      // Если кольцо закрыто кораблём или другим телом, портал не имеет права
      // записать stencil сквозь него и заменить ближнюю геометрию дальней сценой.
      stencilZFail: KeepStencilOp,
      stencilZPass: ReplaceStencilOp,
    }),
  )
  maskScene.add(maskMesh)

  depthScene = new Scene()
  depthMesh = new Mesh(
    new CircleGeometry(1, 64),
    new ShaderMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: false,
      depthFunc: AlwaysDepth,
      side: DoubleSide,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: EqualStencilFunc,
      stencilFail: KeepStencilOp,
      stencilZFail: KeepStencilOp,
      stencilZPass: KeepStencilOp,
      vertexShader: `
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        void main() {
          gl_FragColor = vec4(0.0);
          gl_FragDepth = 1.0;
        }
      `,
    }),
  )
  depthScene.add(depthMesh)

  ringScene = new Scene()
  ringGroup = new Group()
  ringMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(0x66e0ff).multiplyScalar(WARP_PORTAL.BLOOM_GAIN) },
      uMorph: { value: WARP_PORTAL.MORPH_AMPLITUDE },
      uOpacity: { value: 0.84 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime;
      uniform float uMorph;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // Две несинхронные гармоники изгибают саму центральную линию тора. Мир за
        // кольцом и его UV остаются неподвижны — это морфинг плазменного шнура.
        float broad = sin(uv.x * 31.4159 - uTime * 1.65);
        float fine = sin(uv.x * 81.6814 + uTime * 2.35 + sin(uv.y * 6.2832));
        float depthWave = sin(uv.x * 50.2655 + uTime * 1.2);
        vec3 radial = normalize(vec3(position.xy, 0.0));
        vec3 morphed = position + radial * uMorph * (broad + fine * 0.42);
        morphed.z += uMorph * 0.32 * depthWave;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(morphed, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        float slow = sin(vUv.x * 50.2655 - uTime * 2.1);
        float fine = sin(vUv.x * 119.3805 + vUv.y * 9.0 + uTime * 3.4);
        float plasma = 0.78 + slow * 0.12 + fine * 0.10;
        // Не выбеливаем ядро до пластика: повышенная cyan-яркость даёт плотный bloom,
        // а небольшая пульсация остаётся внутри самого шнура.
        vec3 color = uColor * (0.72 + plasma * 0.55);
        gl_FragColor = vec4(color, plasma * uOpacity);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  })
  // Мелкие сегменты не превращаются в огромные клинья, когда камера проходит почти
  // вплотную ребром. Свечение даёт bloom от яркого ядра, а не второй широкий тор.
  const core = new Mesh(new TorusGeometry(1, WARP_PORTAL.TUBE, 14, 96), ringMaterial)
  ringGroup.add(core)
  ringScene.add(ringGroup)

  // Destination-проход закономерно перерисовывает внутреннюю половину основного тора.
  // Узкий второй проход возвращает только слабую плазменную засветку поверх стыка: маска
  // перестаёт выглядеть круглым резаком, но физическое ядро по-прежнему честно закрывается
  // кораблём и прочей геометрией на первом depth-tested проходе.
  haloScene = new Scene()
  haloGroup = new Group()
  haloMaterial = ringMaterial.clone()
  // Halo рисуется после destination-сцены, поэтому в depth уже лежит ближайшая
  // геометрия обеих сторон портала. Не отключаем тест: иначе свет проходит сквозь корабль.
  haloMaterial.depthTest = true
  haloMaterial.uniforms.uColor!.value = new Color(WARP_PORTAL.OUTER_GLOW_COLOR)
    .multiplyScalar(WARP_PORTAL.OUTER_GLOW_GAIN)
  haloMaterial.uniforms.uOpacity!.value = WARP_PORTAL.OUTER_GLOW_OPACITY
  // Отдельная узкая труба лежит снаружи ядра и частично входит в него. Так свет
  // выглядит интенсивнее по внешнему краю, но не превращается в широкий туман.
  const halo = new Mesh(
    new TorusGeometry(
      1 + WARP_PORTAL.OUTER_GLOW_OFFSET,
      WARP_PORTAL.OUTER_GLOW_TUBE,
      14,
      96,
    ),
    haloMaterial,
  )
  haloGroup.add(halo)

  diffuseGlowMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMorph: { value: WARP_PORTAL.MORPH_AMPLITUDE },
      uColor: {
        value: new Color(WARP_PORTAL.DIFFUSE_GLOW_COLOR)
          .multiplyScalar(WARP_PORTAL.DIFFUSE_GLOW_GAIN),
      },
      uOpacity: { value: WARP_PORTAL.DIFFUSE_GLOW_OPACITY },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime;
      uniform float uMorph;
      varying float vFacing;
      void main() {
        float broad = sin(uv.x * 31.4159 - uTime * 1.65);
        float fine = sin(uv.x * 81.6814 + uTime * 2.35 + sin(uv.y * 6.2832));
        float depthWave = sin(uv.x * 50.2655 + uTime * 1.2);
        vec3 radial = normalize(vec3(position.xy, 0.0));
        vec3 morphed = position + radial * uMorph * (broad + fine * 0.42);
        morphed.z += uMorph * 0.32 * depthWave;
        vec4 viewPos = modelViewMatrix * vec4(morphed, 1.0);
        vec3 viewNormal = normalize(normalMatrix * normal);
        vFacing = abs(dot(viewNormal, normalize(-viewPos.xyz)));
        gl_Position = projectionMatrix * viewPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vFacing;
      void main() {
        #include <logdepthbuf_fragment>
        // Тор широкий, но его силуэт полностью прозрачен. Свет мягко набирается к
        // центральной линии обода, поэтому это рассеяние, а не ещё одно толстое кольцо.
        float haze = smoothstep(0.0, 0.72, vFacing);
        haze *= haze;
        float alpha = haze * uOpacity;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  })
  const diffuseGlow = new Mesh(
    new TorusGeometry(1, WARP_PORTAL.DIFFUSE_GLOW_TUBE, 20, 96),
    diffuseGlowMaterial,
  )
  haloGroup.add(diffuseGlow)
  haloScene.add(haloGroup)
}

function place(obj: Mesh | Group, radius: number): void {
  const p = jumpPortal()
  obj.position.copy(p.ringPos)
  obj.quaternion.copy(p.ringQuat)
  obj.scale.setScalar(radius)
}

/** Дорисовать портал в текущий target после основного RenderPass. */
export function renderJumpPortalOverlay(
  renderer: WebGLRenderer,
  camera: Camera,
  _world: World,
): void {
  if (!portalOpen()) return

  ensure()
  const r = jumpPortal().ringRadius
  // Маска заканчивается у внутренней кромки тора. Поэтому целевой мир не может
  // перерисовать неоновую трубу, уже проверенную по глубине исходной сцены.
  // Круг destination-маски заходит под центр тора. Морфинг сдвигает шнур наружу,
  // поэтому маска по номинальной внутренней кромке открывала щели с текущим миром.
  // TUBE чуть больше максимальной суммы волн — тор гарантированно закрывает этот нахлёст.
  const aperture = r
  // Stencil совпадает с физической плоскостью. Сдвинутая назад маска позволяла объектам
  // текущего мира между ней и кольцом выедать в destination-сцене свои силуэты.
  place(maskMesh!, aperture)
  place(depthMesh!, aperture)
  place(ringGroup!, r)
  place(haloGroup!, r)

  ringMaterial!.uniforms.uTime!.value = _world.time
  haloMaterial!.uniforms.uTime!.value = _world.time
  diffuseGlowMaterial!.uniforms.uTime!.value = _world.time

  const destCam = syncDestCamera(camera)
  const dest = destPortalScene()
  const st = renderer.state
  const prevAutoClear = renderer.autoClear
  const prevLocalClipping = renderer.localClippingEnabled
  renderer.autoClear = false
  renderer.localClippingEnabled = true
  try {
    // 1) stencil = 1 в видимой части овала. Stencil-настройки принадлежат материалу:
    // renderer.setMaterial иначе затёр бы ручные значения перед самым draw call.
    st.buffers.stencil.setMask(0xff)
    st.buffers.stencil.setClear(0)
    renderer.clear(false, false, true)
    renderer.render(maskScene!, camera)

    // 2) Обод рисуется пока depth ещё принадлежит исходному миру: корабль и тела
    // честно закрывают его. После подмены глубины сравнивать две камеры уже нельзя.
    st.buffers.stencil.setTest(false)
    renderer.render(ringScene!, camera)

    // 3) внутри маски записываем ДАЛЬНЮЮ глубину. Обычный круг на плоскости портала
    // записывал бы глубину самого кольца и затем отбрасывал почти всю целевую сцену.
    renderer.render(depthScene!, camera)

    // 4) Вторая комната целиком под stencil. Блокировка обязательна: материалы сцены
    // по умолчанию имеют stencilWrite=false и без lock молча выключают тест.
    st.buffers.stencil.setTest(true)
    st.buffers.stencil.setMask(0x00)
    st.buffers.stencil.setFunc(EqualStencilFunc, 1, 0xff)
    st.buffers.stencil.setOp(KeepStencilOp, KeepStencilOp, KeepStencilOp)
    st.buffers.stencil.setLocked(true)
    renderer.render(dest, destCam)
    st.buffers.stencil.setLocked(false)

    // 5) Свет плазмы заходит поверх внутренней кромки destination-маски. Это именно
    // additive halo, не второе твёрдое кольцо; общий bloom обработает его следом.
    st.buffers.stencil.setTest(false)
    renderer.render(haloScene!, camera)
  } finally {
    st.buffers.stencil.setLocked(false)
    st.buffers.stencil.setTest(false)
    st.buffers.stencil.setMask(0xff)
    st.buffers.color.setMask(true)
    st.buffers.depth.setMask(true)
    renderer.localClippingEnabled = prevLocalClipping
    renderer.autoClear = prevAutoClear
  }
}
