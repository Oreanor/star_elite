import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three'
import { clamp, generateGalaxy } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { GALAXY_LAYER } from '../config'

/**
 * Галактика как дальний край зума миелофона. Когда борт вырос до звёздного масштаба,
 * вокруг ЕГО звезды проявляются все 2500 систем точками — те же, что на карте, но в
 * мире. «Твоя» звезда сидит в НАЧАЛЕ координат (там же реальное светило), поэтому в миг
 * подмены точка ложится ровно на диск: звезда-в-звезду, без шва.
 *
 * Слой сам приближает галактику: его масштаб = LY_TO_M / рост. Растёшь — световые годы
 * сжимаются в метры кадра, соседи входят в поле. От потолка отвода камеры не зависит.
 *
 * Пока борт мал (обычная игра) — слой СПИТ: геометрия из 2500 систем не строится вовсе,
 * а точки где-то за краем вселенной и погашены. Просыпается только на росте.
 */
const vertex = /* glsl */ `
attribute float size;

varying vec3 vColor;
varying float vDist;

void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Экранное расстояние звезды — по нему сфера отрисовки решает, зажечь ли её.
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
  // Размер — в ПИКСЕЛЯХ, без ослабления по дальности: масштаб слоя гуляет на 10+ порядков,
  // и любая привязка к -mv.z дала бы то исчезающие, то во весь экран точки. Плоское поле
  // звёзд читается как карта — глубину даёт параллакс при движении, а не размер.
  gl_PointSize = size;
}
`

const fragment = /* glsl */ `
uniform float uOpacity;
uniform float uRadius;
uniform float uEdge;

varying vec3 vColor;
varying float vDist;

void main() {
  // Круг с мягким краем — точка в пару пикселей без него мерцает.
  float d = length(gl_PointCoord - vec2(0.5));
  float round = 1.0 - smoothstep(0.34, 0.5, d);

  // Мягкая граница СФЕРЫ ОТРИСОВКИ: у края звезда плавно ЗАГОРАЕТСЯ, а не выскакивает.
  // Растёшь — слой сжимается, экранное расстояние падает, следующий сосед входит в сферу.
  float sphere = 1.0 - smoothstep(uRadius - uEdge, uRadius, vDist);

  float alpha = round * sphere * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`

const _colour = new Color()

/** Размер точки по радиусу класса: карлик — мелкая, голубой гигант — крупнее. */
function pixelSize(radiusUnits: number): number {
  const { MIN_PIXELS, MAX_PIXELS } = GALAXY_LAYER
  return MIN_PIXELS + Math.sqrt(clamp(radiusUnits / 2400, 0, 1)) * (MAX_PIXELS - MIN_PIXELS)
}

export function GalaxyLayer() {
  const session = useSession()
  const ref = useRef<Points>(null)

  // Слой спит, пока борт не дорос: 2500 систем не генерим зря. Просыпается один раз.
  const [awake, setAwake] = useState(false)

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
      // Локальные координаты относительно СВОЕЙ звезды — она в начале, точка ляжет на
      // реальное светило. Диск кладём горизонтально: ly(x,y) → мир(x,z), толщина по Y.
      positions[i * 3] = s.x - origin.x
      positions[i * 3 + 1] = s.z - origin.z
      positions[i * 3 + 2] = s.y - origin.y
      _colour.setHex(s.star.color)
      colors[i * 3] = _colour.r
      colors[i * 3 + 1] = _colour.g
      colors[i * 3 + 2] = _colour.b
      sizes[i] = pixelSize(s.star.radius)
    }

    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setAttribute('color', new BufferAttribute(colors, 3))
    g.setAttribute('size', new BufferAttribute(sizes, 1))
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
        },
        transparent: true,
        // Фон: глубину не трогаем — слой это дальний холст, корабль и тела рисуются
        // поверх. Проще и надёжнее, чем стыковать точки с логарифмическим буфером.
        depthTest: false,
        depthWrite: false,
        vertexColors: true,
        blending: NormalBlending,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const scale = session.world.player.state.scale
    if (!awake) {
      if (scale >= GALAXY_LAYER.WAKE_SCALE) setAwake(true)
      return
    }
    const points = ref.current
    if (!points) return

    // Приближаем галактику собственным масштабом: св.годы → метры кадра, делённые на рост.
    points.scale.setScalar(GALAXY_LAYER.LY_TO_M / scale)

    // Проявление: от FADE_IN_START к FADE_IN_END. Ниже — прозрачно (система ещё на виду).
    const t = clamp(
      (scale - GALAXY_LAYER.FADE_IN_START) / (GALAXY_LAYER.FADE_IN_END - GALAXY_LAYER.FADE_IN_START),
      0,
      1,
    )
    material.uniforms.uOpacity!.value = t
    points.visible = t > 0
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
