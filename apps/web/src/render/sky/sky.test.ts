import { Texture, TextureLoader } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSky } from './sky'

vi.mock('./nebula', async () => {
  const { Texture: MockTexture } = await import('three')
  return { nebulaTexture: () => new MockTexture() }
})

afterEach(() => vi.restoreAllMocks())

describe('sky texture handoff', () => {
  it('reuses an already loaded texture synchronously instead of showing fallback again', () => {
    const loaded = new Texture()
    let finish: ((texture: Texture) => void) | undefined
    const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((
      _url,
      onLoad,
    ) => {
      finish = onLoad
      return loaded
    })

    const first = loadSky(9, () => {})
    expect(first).not.toBe(loaded)
    finish?.(loaded)
    const second = loadSky(9, () => {})

    expect(second).toBe(loaded)
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
