import { beforeAll, describe, expect, it, vi } from 'vitest'
import { COMMODITIES, joinPhrases, phrase } from '@elite/sim'

// Модуль языка читает выбор из браузера при загрузке — подставляем русский до импорта.
let phraseText: typeof import('./phraseText').phraseText
beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'ru', setItem: () => {} })
  vi.stubGlobal('navigator', { language: 'ru' })
  ;({ phraseText } = await import('./phraseText'))
})

describe('фраза домена → слова', () => {
  // Пойманный баг: домен отдавал готовые русские строки, и игрок на английском читал
  // «ПОКАЖИ ДЕНЬГИ.». Теперь домен отдаёт код и числа, а слова и имена — из словарей.
  it('подставляет числа и имя товара из словаря, цепочку сшивает разделителем', () => {
    const line = joinPhrases([
      phrase('dealGot', { commodity: COMMODITIES.FOOD.id, units: 3 }),
      phrase('dealCharged', { credits: 120 }),
    ])!
    expect(phraseText(line)).toBe(`Получено: ${COMMODITIES.FOOD.name} ×3 · Списано: 120 кр`)
  })

  it('реплика без параметров — ровно строка словаря', () => {
    expect(phraseText(phrase('showMoney'))).toBe('ПОКАЖИ ДЕНЬГИ.')
  })
})
