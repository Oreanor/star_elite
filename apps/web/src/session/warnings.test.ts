import { describe, expect, it } from 'vitest'
import { activeWarning, clearWarnings, pushWarning } from './warnings'

describe('плашки-предупреждения', () => {
  // Пойманный баг: у причала мир стоит, и время плашки стоит с ним. Жёлтая, загоревшаяся
  // перед заходом, после вылета дожигала остаток жизни и мелькала перед «доброго пути».
  it('стыковка гасит плашки полёта, и после неё они не всплывают', () => {
    pushWarning('crash', 10, { repeat: 0 })
    expect(activeWarning(10.1)?.code).toBe('crash')
    clearWarnings()
    expect(activeWarning(10.1)).toBeNull()
    pushWarning('bonVoyage', 10.2)
    expect(activeWarning(10.3)?.code).toBe('bonVoyage')
  })
})
