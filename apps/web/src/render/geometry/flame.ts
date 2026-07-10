import { BufferAttribute, BufferGeometry, Color } from 'three'

/**
 * Струя из сопла: конус остриём назад, покрашенный по длине.
 *
 * Геометрия единичная — база радиусом 1 в z = 0, остриё в z = 1. Настоящие
 * размеры задаёт масштаб инстанса, поэтому на все сопла всех кораблей нужен
 * ровно один буфер.
 *
 * Материал аддитивный, значит тёмный конец конуса просто ничего не добавляет
 * к фону и растворяется сам. Прозрачность рисовать не нужно — она получается
 * из цвета, и это дешевле.
 */

const _color = new Color()

export function flameGeometry(segments: number, base: number, tip: number): BufferGeometry {
  const positions = new Float32Array(segments * 9)
  const colors = new Float32Array(segments * 9)

  const baseColor = new Color(base)
  const tipColor = new Color(tip)

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const p = i * 9

    positions.set(
      [Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0, 0, 0, 1],
      p,
    )

    // Две вершины базы — яркие, остриё — тёмное. Плоский шейдинг не нужен:
    // конус не освещается, он светится.
    for (let v = 0; v < 3; v++) {
      _color.copy(v === 2 ? tipColor : baseColor)
      colors[p + v * 3] = _color.r
      colors[p + v * 3 + 1] = _color.g
      colors[p + v * 3 + 2] = _color.b
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}
