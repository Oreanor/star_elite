import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
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
// Кривая входа в сферу: vT = 0 у внешней границы (только коснулся сферы) → 1 глубоко
// внутри. По ней и проявление, и ВСПЫШКА зажигания — звезда не появляется, а загорается.
const vertex = /* glsl */ `
attribute float size;

uniform float uRadius;
uniform float uEdge;

varying vec3 vColor;
varying float vT;

void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = length(mv.xyz); // экранное расстояние — по нему сфера решает, зажечь ли
  vT = clamp((uRadius - dist) / uEdge, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;

  // Автоплей-вспышка на входе: точка кратко раздувается, потом оседает. Пик у vT≈0.2.
  float flare = smoothstep(0.0, 0.2, vT) * (1.0 - smoothstep(0.2, 0.6, vT));
  // Размер — в ПИКСЕЛЯХ, без ослабления по дальности: масштаб слоя гуляет на 10+ порядков,
  // и любая привязка к -mv.z дала бы то исчезающие, то во весь экран точки.
  gl_PointSize = size * (1.0 + 1.4 * flare);
}
`

const fragment = /* glsl */ `
uniform float uOpacity;

varying vec3 vColor;
varying float vT;

void main() {
  // Круг с мягким краем — точка в пару пикселей без него мерцает.
  float d = length(gl_PointCoord - vec2(0.5));
  float round = 1.0 - smoothstep(0.34, 0.5, d);

  // Проявление по входу в сферу + вспышка к белому: звезда ЗАГОРАЕТСЯ, а не выскакивает.
  // vT=0 (вне сферы) → всё в ноль; растёшь — vT ползёт к 1, звезда вспыхивает и оседает.
  float fade = smoothstep(0.0, 1.0, vT);
  float flare = smoothstep(0.0, 0.2, vT) * (1.0 - smoothstep(0.2, 0.6, vT));

  vec3 col = vColor + vec3(0.9 * flare);           // вспышка выбеливает, затем спадает
  float alpha = round * clamp(fade + 0.6 * flare, 0.0, 1.0) * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
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
  // Якорь галактики — позиция корабля в МИГ пробуждения, зафиксированная в мире. Слой
  // расцветает вокруг этой точки (а не вокруг далёкой звезды: до неё ~а.е., комок звёзд
  // туда бы не попал в сферу). Точка неподвижна — сквозь галактику можно лететь к соседу.
  const anchor = useRef(new Vector3())

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
      if (scale >= GALAXY_LAYER.WAKE_SCALE) {
        // Фиксируем якорь ЗДЕСЬ, где корабль сейчас, — вокруг этой точки развернём галактику.
        anchor.current.copy(session.world.player.state.pos)
        setAwake(true)
      }
      return
    }
    const points = ref.current
    if (!points) return

    // Слой стоит на якоре в мире (не следует за кораблём): летя, ты движешься сквозь него.
    points.position.copy(anchor.current)
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
