import { DoubleSide, Float32BufferAttribute, MeshLambertMaterial, RingGeometry } from 'three'
import { PLANET_RINGS } from '../config'

// Один ресурс для всех гигантов и их витрин. Полосы — цвет вершин, края и щель — маска радиуса.
export const planetRingGeometry = new RingGeometry(
  PLANET_RINGS.INNER, PLANET_RINGS.OUTER, PLANET_RINGS.SEGMENTS, PLANET_RINGS.BANDS,
)
planetRingGeometry.rotateX(-Math.PI / 2)
const positions = planetRingGeometry.getAttribute('position')
const colors = new Float32Array(positions.count * 3)
for (let i = 0; i < positions.count; i++) {
  const radius = Math.hypot(positions.getX(i), positions.getZ(i))
  // Нейтральные полосы: оттенок задаёт материал варианта, геометрия остаётся общей.
  const brightness = 0.8 + 0.13 * Math.sin(radius * 97) + 0.07 * Math.sin(radius * 31)
  colors[i * 3] = brightness
  colors[i * 3 + 1] = brightness
  colors[i * 3 + 2] = brightness
}
planetRingGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3))

const ringMaterial = new MeshLambertMaterial({
  vertexColors: true,
  side: DoubleSide,
  transparent: true,
  depthWrite: false,
  forceSinglePass: true,
})

// Аналитическая тень шара: shadow map на масштабе миллионов метров теряет точность.
// Относительный вектор в радиусах планеты не зависит от плавающего начала координат.
ringMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uRingInner = { value: PLANET_RINGS.INNER }
  shader.uniforms.uRingOuter = { value: PLANET_RINGS.OUTER }
  shader.uniforms.uRingGapInner = { value: PLANET_RINGS.GAP_INNER }
  shader.uniforms.uRingGapOuter = { value: PLANET_RINGS.GAP_OUTER }
  shader.uniforms.uRingEdgeFade = { value: PLANET_RINGS.EDGE_FADE }
  shader.uniforms.uRingLightGain = { value: PLANET_RINGS.LIGHT_GAIN }
  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    '#include <common>\nvarying vec3 vRingOffset;',
  ).replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    vRingOffset = mat3(modelViewMatrix) * position / length(modelViewMatrix[0].xyz);`,
  )
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
    varying vec3 vRingOffset;
    uniform float uRingInner, uRingOuter, uRingGapInner, uRingGapOuter;
    uniform float uRingEdgeFade, uRingLightGain;`,
  ).replace(
    '#include <opaque_fragment>',
    `
    // Маска по радиусу не оставляет зубцов от удаления отдельных треугольников.
    float ringRadius = length(vRingOffset);
    float edgeWidth = max(uRingEdgeFade, fwidth(ringRadius));
    float edge = smoothstep(uRingInner, uRingInner + edgeWidth, ringRadius)
      * (1.0 - smoothstep(uRingOuter - edgeWidth, uRingOuter, ringRadius));
    float gap = smoothstep(uRingGapInner - edgeWidth, uRingGapInner, ringRadius)
      * (1.0 - smoothstep(uRingGapOuter, uRingGapOuter + edgeWidth, ringRadius));
    diffuseColor.a *= edge * (1.0 - gap);
    if (diffuseColor.a < 0.001) discard;
    outgoingLight *= uRingLightGain;
    #if NUM_DIR_LIGHTS > 0
      vec3 toLight = directionalLights[0].direction;
      float along = dot(vRingOffset, toLight);
      float miss = length(cross(vRingOffset, toLight));
      float shadow = (1.0 - smoothstep(0.98, 1.02, miss)) * step(along, 0.0);
      outgoingLight *= 1.0 - 0.82 * shadow;
    #endif
    #include <opaque_fragment>`,
  )
}
ringMaterial.customProgramCacheKey = () => 'planet-rings-soft-edges-v2'

// Материалы выделяются один раз на вариант текстуры, а не на планету или кадр.
const materials = PLANET_RINGS.COLORS.map((color) => {
  const material = ringMaterial.clone()
  material.color.setHex(color)
  // three.clone не переносит шейдерные callbacks.
  material.onBeforeCompile = ringMaterial.onBeforeCompile
  material.customProgramCacheKey = ringMaterial.customProgramCacheKey
  return material
})

export function planetRingMaterial(variant: number): MeshLambertMaterial {
  return materials[variant] ?? materials[0]!
}
