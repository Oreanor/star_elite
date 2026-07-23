import {
  AdditiveBlending,
  LinearFilter,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector4,
  type Texture,
} from 'three'
import { EXPLOSION } from '../config'

/**
 * Флипбук взрыва: один аддитивный спрайт-квад, по которому за время жизни пробегает
 * сетка кадров (8×8 = 64 фазы огненного шара из PNG).
 *
 * Своя картинка вместо гранёного шара: раньше взрыв был светящимся икосаэдром — читался
 * как «многогранник», а не как огонь. Флипбук даёт настоящую вспышку с дымом тем же
 * дешёвым инстансингом: кадр выбирается смещением UV в шейдере, ноль аллокаций в кадре.
 *
 * Пока текстура не пришла (или её нет), `uHasMap=false` и шейдер рисует прежний мягкий
 * шар — это не аварийный режим, а честный откат.
 */

const COLS = EXPLOSION.SHEET_COLS
const ROWS = EXPLOSION.SHEET_ROWS
const FRAMES = COLS * ROWS

let material: ShaderMaterial | null = null

export function explosionSheetMaterial(): ShaderMaterial {
  if (material) return material

  const uniforms = {
    uMap: { value: null as Texture | null },
    uHasMap: { value: false },
    uGrid: { value: new Vector4(COLS, ROWS, FRAMES, 0) },
  }

  new TextureLoader().load(
    '/textures/fx/explosion.png',
    (texture) => {
      texture.colorSpace = SRGBColorSpace
      texture.minFilter = LinearFilter
      texture.magFilter = LinearFilter
      texture.generateMipmaps = false
      uniforms.uMap.value = texture
      uniforms.uHasMap.value = true
    },
    undefined,
    () => {},
  )

  material = new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      // Инстансный цвет несёт ТОН и ЗАТУХАНИЕ (rgb) и ФАЗУ 0..1 (в альфе): так каждый
      // взрыв гаснет и листает кадры по отдельности одним материалом.
      attribute vec4 instanceTint;
      varying vec2 vUv;
      varying vec4 vTint;
      void main() {
        vUv = uv;
        vTint = instanceTint;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uMap;
      uniform bool uHasMap;
      uniform vec4 uGrid; // cols, rows, frames, _
      varying vec2 vUv;
      varying vec4 vTint;
      void main() {
        #include <logdepthbuf_fragment>
        if (!uHasMap) {
          // Откат: мягкий круглый шар, как прежний икосаэдр.
          float d = length(vUv - 0.5) * 2.0;
          float glow = pow(max(0.0, 1.0 - d), 1.6);
          gl_FragColor = vec4(vTint.rgb * glow, 1.0);
          return;
        }
        float frame = clamp(vTint.a, 0.0, 0.999) * uGrid.z;
        float idx = floor(frame);
        float col = mod(idx, uGrid.x);
        float row = floor(idx / uGrid.x);
        // Строки листа идут СВЕРХУ вниз, а UV снизу вверх — переворачиваем ряд.
        vec2 cell = vec2(1.0 / uGrid.x, 1.0 / uGrid.y);
        vec2 uv = (vec2(col, uGrid.y - 1.0 - row) + vUv) * cell;
        vec4 tex = texture2D(uMap, uv);
        // Аддитив: цвет спрайта домножаем на тон/затухание взрыва, альфа задаёт форму.
        gl_FragColor = vec4(tex.rgb * vTint.rgb, 1.0) * tex.a;
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  })
  return material
}
