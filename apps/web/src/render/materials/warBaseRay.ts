import { AdditiveBlending, Color, ConeGeometry, DoubleSide, ShaderMaterial } from 'three'
import { WARBASE_RAYS } from '../config'

/** Луч света из ядра сносимой базы (`WarBaseRays`): мягкий объёмный конус, ярче по оси. */

/** Конус длины 1 с вершиной в начале координат, раскрывается вдоль +Y; открыт с торца. */
export function rayGeometry(): ConeGeometry {
  const g = new ConeGeometry(1, 1, 24, 1, true)
  g.rotateX(Math.PI)
  g.translate(0, 0.5, 0)
  return g
}

export function rayMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(WARBASE_RAYS.COLOR) } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float instanceGlow;
      varying float vAlong;
      varying float vGlow;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vAlong = position.y;
        vGlow = instanceGlow;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      varying float vAlong;
      varying float vGlow;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        // Ось луча ярче краёв: к силуэту конуса (ребром к глазу) свет тает — объём, а не стенка.
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float body = pow(facing, 1.6);
        // Гаснет к концу; у корня — раскалённо-белый.
        float fall = pow(1.0 - vAlong, 1.3);
        vec3 col = mix(uColor, vec3(1.0), pow(1.0 - vAlong, 6.0));
        gl_FragColor = vec4(col * body * fall * vGlow, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
}
