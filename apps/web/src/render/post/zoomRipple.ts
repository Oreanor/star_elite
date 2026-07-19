import type { IUniform, Texture } from 'three'

/**
 * Радиальный ripple на зуме миелофона: кольца от центра. Идёт поверх zoom-blur.
 */
export const ZoomRippleShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    strength: { value: 0 },
    amount: { value: 0.014 },
    freq: { value: 36 },
    speed: { value: 9 },
    fall: { value: 2.2 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float strength;
uniform float amount;
uniform float freq;
uniform float speed;
uniform float fall;
uniform float time;
varying vec2 vUv;

void main() {
  if (strength < 0.01) {
    gl_FragColor = texture2D(tDiffuse, vUv);
    return;
  }

  vec2 c = vUv - vec2(0.5);
  // Лёгкая поправка аспектa: круг, а не эллипс на широком кадре.
  c.x *= 1.6;
  float dist = length(c);
  vec2 dir = dist > 1e-4 ? c / dist : vec2(0.0);

  // Бегущая волна от центра; fall гасит амплитуду к краю.
  float wave = sin(dist * freq - time * speed) * exp(-dist * fall);
  vec2 uv = vUv + dir * (wave * amount * strength);

  gl_FragColor = texture2D(tDiffuse, uv);
}
`,
}

export type ZoomRippleUniforms = {
  tDiffuse: IUniform<Texture | null>
  strength: IUniform<number>
  amount: IUniform<number>
  freq: IUniform<number>
  speed: IUniform<number>
  fall: IUniform<number>
  time: IUniform<number>
}
