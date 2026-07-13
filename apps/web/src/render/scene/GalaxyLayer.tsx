import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import { clamp, generateGalaxy } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { GALAXY_LAYER } from '../config'
import { galaxyRadar } from './galaxyRadar'

/**
 * Галактика как дальний край зума миелофона. Когда борт вырос до звёздного масштаба,
 * вокруг ЕГО звезды проявляются все 2500 систем — те же, что на карте, но в мире. «Твоя»
 * звезда сидит в НАЧАЛЕ координат (там же реальное светило), поэтому в миг подмены точка
 * ложится ровно на диск: звезда-в-звезду, без шва.
 *
 * Звёзды — не пиксельные точки, а ШАРЫ с настоящей перспективой: ближняя раздувается в
 * мячик, дальняя оседает. По ним и летишь «от мячика к мячику». Экранный размер = радиус
 * (в св.годах) × масштаб слоя / дальность — то есть угловой, а не привязанный к дальности
 * пикселем. Зажат в [MIN_PIXELS, MAX_PIXELS], чтобы дальний не пропал, а ближний не залил кадр.
 *
 * Масштаб слоя = LY_TO_M / рост, но НЕ ниже LOCK_SCALE: выше него слой замирает. Без этого
 * галактика сжимается с ростом бесконечно и к десяткам млрд× съёживается в облачко перед
 * носом; с фиксацией она встаёт стабильным полем, крупнее корабля, по которому летишь.
 *
 * Пока борт мал (обычная игра) — слой СПИТ: геометрия из 2500 систем не строится, точки
 * погашены. Просыпается только на росте.
 */
const vertex = /* glsl */ `
attribute float size; // РАДИУС звезды в световых годах (не пиксели)

uniform float uRadius;     // сфера зажигания, метры кадра
uniform float uEdge;
uniform float uLayerScale; // метров кадра в одном св.году (LY_TO_M / effScale)
uniform float uProj;       // H_framebuffer / tan(fov/2): радиус кадра → пиксели
uniform float uMinPx;
uniform float uMaxPx;

varying vec3 vColor;
varying float vT;

void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = length(mv.xyz); // экранное расстояние — по нему сфера решает, зажечь ли
  vT = clamp((uRadius - dist) / uEdge, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;

  // Диаметр шара в пикселях по перспективе: rRender(м) = size(св.г)×масштаб_слоя.
  // Близкая звезда раздувается, дальняя оседает; зажато, чтоб не пропасть и не залить кадр.
  float rRender = size * uLayerScale;
  float px = uProj * rRender / max(dist, 1.0);

  // Автоплей-вспышка на входе в сферу: точка кратко раздувается. Пик у vT≈0.2.
  float flare = smoothstep(0.0, 0.2, vT) * (1.0 - smoothstep(0.2, 0.6, vT));
  gl_PointSize = clamp(px, uMinPx, uMaxPx) * (1.0 + 0.6 * flare);
}
`

const fragment = /* glsl */ `
uniform float uOpacity;

varying vec3 vColor;
varying float vT;

void main() {
  vec2 pc = gl_PointCoord - vec2(0.5);
  float r = length(pc) * 2.0; // 0 в центре → 1 у края
  if (r > 1.0) discard;

  // Псевдосфера: ярче в центре, темнее к краю — точка читается объёмным мячиком, а не диском.
  float sphere = sqrt(max(0.0, 1.0 - r * r));

  // Проявление по входу в сферу + вспышка к белому: звезда ЗАГОРАЕТСЯ, а не выскакивает.
  float fade = smoothstep(0.0, 1.0, vT);
  float flare = smoothstep(0.0, 0.2, vT) * (1.0 - smoothstep(0.2, 0.6, vT));

  vec3 col = vColor * (0.45 + 0.55 * sphere) + vec3(0.9 * flare);
  float edge = 1.0 - smoothstep(0.82, 1.0, r);   // мягкий край, иначе мячик пикселит
  float alpha = edge * clamp(fade + 0.6 * flare, 0.0, 1.0) * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`

const _colour = new Color()
const DEG2RAD = Math.PI / 180

/** Радиус звезды в световых годах: карлик мельче, гигант крупнее. Раздут против физики
 *  намеренно — настоящая звезда (7e8 м) между св.годами была бы невидимой точкой. */
function lyRadius(radiusUnits: number): number {
  const { STAR_LY_MIN, STAR_LY_MAX } = GALAXY_LAYER
  return STAR_LY_MIN + Math.sqrt(clamp(radiusUnits / 2400, 0, 1)) * (STAR_LY_MAX - STAR_LY_MIN)
}

export function GalaxyLayer() {
  const session = useSession()
  const ref = useRef<Points>(null)

  // Слой спит, пока борт не дорос: 2500 систем не генерим зря. Просыпается один раз.
  const [awake, setAwake] = useState(false)
  // Якорь галактики — позиция корабля в миг пробуждения, в ИСТИННЫХ координатах
  // (`pos + originOffset`). Плавающее начало координат периодически пересаживает мир на
  // четыре километра; храни якорь в локальных — и галактика «прилипла бы» к кораблю,
  // уезжая с каждой пересадкой. В истинных она стоит намертво, сквозь неё можно лететь.
  const anchorTrue = useRef(new Vector3())

  // Буферы звёзд держим и здесь — их читает локатор (galaxyRadar), рисуя те же звёзды.
  const starData = useRef<{ positions: Float32Array; colors: Float32Array; count: number } | null>(null)

  const geometry = useMemo(() => {
    if (!awake) return null
    const world = session.world
    const galaxy = generateGalaxy(world.galaxySeed)
    const origin = galaxy[world.systemIndex] ?? galaxy[0]!
    const n = galaxy.length
    const positions = new Float32Array(n * 3)
    const colors = new Float32Array(n * 3)
    const sizes = new Float32Array(n)

    for (let i = 0; i < n; i++) {
      const s = galaxy[i]!
      // Локальные координаты относительно СВОЕЙ звезды — она в начале (ляжет на якорь),
      // соседи расходятся от неё. Диск кладём горизонтально: ly(x,y) → мир(x,z), толщина по Y.
      positions[i * 3] = s.x - origin.x
      positions[i * 3 + 1] = s.z - origin.z
      positions[i * 3 + 2] = s.y - origin.y
      _colour.setHex(s.star.color)
      colors[i * 3] = _colour.r
      colors[i * 3 + 1] = _colour.g
      colors[i * 3 + 2] = _colour.b
      sizes[i] = lyRadius(s.star.radius)
    }

    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setAttribute('color', new BufferAttribute(colors, 3))
    g.setAttribute('size', new BufferAttribute(sizes, 1))
    // Те же буферы отдаём локатору: он рисует те же звёзды в той же системе координат.
    starData.current = { positions, colors, count: n }
    return g
    // Пересобираем при смене системы (world.epoch): своя звезда — другая точка отсчёта.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awake, session, session.world.epoch])

  // Старую геометрию (прошлая система) освобождаем: буфер на 2500×7 float живёт в GPU.
  useEffect(() => () => geometry?.dispose(), [geometry])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uOpacity: { value: 0 },
          uRadius: { value: GALAXY_LAYER.SPHERE_RADIUS_M },
          uEdge: { value: GALAXY_LAYER.SPHERE_EDGE_M },
          uLayerScale: { value: 1 },
          uProj: { value: 1000 },
          uMinPx: { value: GALAXY_LAYER.MIN_PIXELS },
          uMaxPx: { value: GALAXY_LAYER.MAX_PIXELS },
        },
        transparent: true,
        // Фон: глубину не трогаем — слой это дальний холст, корабль рисуется поверх.
        depthTest: false,
        depthWrite: false,
        vertexColors: true,
        blending: NormalBlending,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    const world = session.world
    const scale = world.player.state.scale
    if (!awake) {
      galaxyRadar().active = false
      if (scale >= GALAXY_LAYER.WAKE_SCALE) {
        // Фиксируем якорь ЗДЕСЬ и в истинных координатах — вокруг него развернём галактику.
        anchorTrue.current.copy(world.player.state.pos).add(world.originOffset)
        setAwake(true)
      }
      return
    }
    const points = ref.current
    if (!points) return

    // Слой стоит на якоре в истинном мире; локальную позицию берём вычитанием сдвига
    // начала координат — тогда пересадки floating-origin его не двигают, а летя, ты
    // проходишь СКВОЗЬ него (галактика не «прилипает» к носу и не уезжает с камерой).
    points.position.copy(anchorTrue.current).sub(world.originOffset)

    // Приближаем галактику собственным масштабом, но не мельче LOCK_SCALE: выше него слой
    // замирает стабильным полем, иначе к десяткам млрд× он съёжится в облачко перед носом.
    const effScale = Math.min(scale, GALAXY_LAYER.LOCK_SCALE)
    const layerScale = GALAXY_LAYER.LY_TO_M / effScale
    points.scale.setScalar(layerScale)
    material.uniforms.uLayerScale!.value = layerScale

    // Перевод радиуса шара (метры кадра) в пиксели: H_framebuffer / tan(fov/2). Обновляем
    // каждый кадр — окно и поле зрения могут меняться (ресайз, зум камеры).
    const cam = state.camera as PerspectiveCamera
    material.uniforms.uProj!.value = state.gl.domElement.height / Math.tan((cam.fov * DEG2RAD) / 2)

    // Проявление: от FADE_IN_START к FADE_IN_END. Ниже — прозрачно (система ещё на виду).
    const t = clamp(
      (scale - GALAXY_LAYER.FADE_IN_START) / (GALAXY_LAYER.FADE_IN_END - GALAXY_LAYER.FADE_IN_START),
      0,
      1,
    )
    material.uniforms.uOpacity!.value = t
    points.visible = t > 0

    // Публикуем состояние для локатора: те же звёзды, тот же якорь и масштаб этого кадра.
    const gr = galaxyRadar()
    gr.active = t > 0 && starData.current !== null
    gr.anchor.copy(points.position)
    gr.layerScale = layerScale
    if (starData.current) {
      gr.positions = starData.current.positions
      gr.colors = starData.current.colors
      gr.count = starData.current.count
    }
  })

  if (!geometry) return null
  return (
    <points
      ref={ref}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-1}
      visible={false}
    />
  )
}
