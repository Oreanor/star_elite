import { AdditiveBlending, ShaderMaterial } from 'three'
import { SHARD_EMBER } from '../config'

/**
 * НАКАЛ ОСКОЛКА базы: мягкий светящийся ореол-билборд вокруг куска, остывающий от бело-жёлтого
 * к соломенному. Тёмный обломок в огненном коме тонул, а в пустоте был почти не виден; с
 * накалом разлёт читается брызгами раскалённого металла. Жар (1 → 0) — инстансным атрибутом.
 */

let cache: ShaderMaterial | null = null

export function shardEmberMaterial(): ShaderMaterial {
  cache ??= new ShaderMaterial({
    uniforms: { uGlow: { value: SHARD_EMBER.GLOW } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float instanceHeat;
      varying vec2 vUv;
      varying float vHeat;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vHeat = instanceHeat;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uGlow;
      varying vec2 vUv;
      varying float vHeat;
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vUv);
        if (r > 1.0) discard;
        // Плотная сердцевина и мягкий ореол: светится кусок, а не круглая наклейка.
        float glow = exp(-r * r * 9.0) * 1.4 + pow(1.0 - r, 3.0) * 0.5;
        // Бело-жёлтый накал, без оранжевого: рыжий ореол спорил с бело-голубым светом ядра и
        // огнём клубов. Остывая, кусок желтеет до соломенного и гаснет, не краснея.
        vec3 white = vec3(1.0, 0.98, 0.9);
        vec3 yellow = vec3(1.0, 0.9, 0.6);
        vec3 straw = vec3(0.85, 0.68, 0.38);
        vec3 col = vHeat > 0.5 ? mix(yellow, white, (vHeat - 0.5) * 2.0) : mix(straw, yellow, vHeat * 2.0);
        gl_FragColor = vec4(col * glow * vHeat * uGlow, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  return cache
}
