import type { IUniform, Texture } from 'three'

/**
 * Zoom-blur: несколько сэмплов к центру кадра. На зуме миелофона идёт ПЕРЕД ripple.
 */
export const ZoomBlurShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    strength: { value: 0 },
    amount: { value: 0.028 },
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
varying vec2 vUv;

void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  if (strength < 0.01) {
    gl_FragColor = color;
    return;
  }

  vec2 dir = vUv - vec2(0.5);
  float w = 1.0;
  for (int i = 1; i <= 5; i++) {
    float t = float(i) / 5.0;
    vec2 off = dir * (amount * strength * t);
    color += texture2D(tDiffuse, vUv - off);
    w += 1.0;
  }
  gl_FragColor = color / w;
}
`,
}

export type ZoomBlurUniforms = {
  tDiffuse: IUniform<Texture | null>
  strength: IUniform<number>
  amount: IUniform<number>
}
