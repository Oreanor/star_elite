import { useEffect, useState } from 'react'
import {
  DEFAULT_PERSONA,
  PLAYABLE_SPECIES,
  PROFESSIONS,
  isLegalProfile,
  type PilotProfile,
  type Profession,
} from '@elite/sim'
import { PORTRAIT_GRID, portraitStyle, type Emotion } from '../portrait'
import { professionName, speciesName } from '../i18n/dataNames'
import { t, useLang } from '../i18n'

/**
 * Экран создания пилота. Корабль у всех дефолтный — выбирают ТОЛЬКО видимое: имя,
 * вид и лицо. Числа и тона характера сюда НЕ вынесены намеренно: собеседнику-модели
 * статы игрока не передаются (граница «камень/песок»), в физику игрока они пока не
 * заведены, а поведение при передаче штурвала боту задаётся модуляцией автобоя, не
 * анкетой при рождении. Пустой набор ручек честнее мёртвых: выбираем лишь то, что
 * и вправду видно и значимо. Остальная персона остаётся на нейтральном дефолте.
 *
 * Экран — чистая форма: собирает `PilotProfile` и отдаёт через `onSubmit`; применяет
 * его к миру и пишет в сейв слой app (Shell). Валидатор — доменный (`isLegalProfile`),
 * тот же, что потом стережёт профиль на сервере.
 */

/** Сколько всего лиц на листе вида: сетка 6×6 = 36. */
const FACES = PORTRAIT_GRID * PORTRAIT_GRID

export function CharacterCreation({ onSubmit }: { onSubmit: (profile: PilotProfile) => void }) {
  useLang() // подписка: смена языка перерисует экран
  const [name, setName] = useState('')
  const [species, setSpecies] = useState<string>(PLAYABLE_SPECIES[0]!)
  const [face, setFace] = useState(0)
  // Профессия — как ты представляешься миру. Путешественник по умолчанию: самый мирный,
  // «просто странствую». Пока это лейбл: задаёт род занятий и тон, что видят собеседники.
  const [profession, setProfession] = useState<Profession>('traveler')

  // Живой штрих: новое лицо на полсекунды радуется или грустит (рандом), потом в нейтраль.
  // Изредка — боль (пятый лист), для неожиданности. Реагирует и на смену вида, и на перебор
  // лица — как будто знакомишься с новым человеком.
  const [reaction, setReaction] = useState<Emotion>('neutral')
  useEffect(() => {
    const r = Math.random()
    setReaction(r < 0.15 ? 'pain' : r < 0.575 ? 'joy' : 'sadness')
    const timer = setTimeout(() => setReaction('neutral'), 500)
    return () => clearTimeout(timer)
  }, [species, face])

  // Остальная персона — нейтральный дефолт: игрок её не крутит (нечему проявиться),
  // но у борта она должна быть законной. Переопределяем вид, лицо и профессию.
  const profile: PilotProfile = {
    name: name.trim(),
    persona: { ...DEFAULT_PERSONA, species, portrait: face, profession },
  }
  const ready = isLegalProfile(profile)

  const cycleFace = (d: number) => setFace((f) => (((f + d) % FACES) + FACES) % FACES)

  return (
    <div
      className="absolute inset-0 overflow-y-auto bg-black bg-cover bg-center font-mono text-[#7fd6ff]"
      style={{ backgroundImage: 'url(/bg.png)' }}
    >
      <div className="absolute inset-0 bg-black/60" />

      <div className="relative flex min-h-full items-center justify-center px-4 py-8">
        <div
          className="flex w-full max-w-[36rem] flex-col gap-7 rounded-2xl border p-8 backdrop-blur-md"
          style={{ borderColor: 'rgba(63,115,145,0.7)', background: 'rgba(20,44,74,0.42)' }}
        >
          <h1 className="text-center text-xl tracking-[0.4em]">{t('create.title')}</h1>

          {/* Лицо: крупное превью и перебор стрелками по 36 вариантам вида. */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="h-36 w-36 border"
              style={{ ...portraitStyle(species, face, reaction), borderColor: '#3f7391' }}
            />
            <div className="flex items-center gap-4">
              <Nudge onClick={() => cycleFace(-1)}>◀</Nudge>
              <span className="text-xs tracking-[0.3em] text-[#3f7391]">{t('create.portrait')}</span>
              <Nudge onClick={() => cycleFace(1)}>▶</Nudge>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-[0.3em] text-[#3f7391]">{t('create.name')}</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create.name.placeholder')}
              maxLength={24}
              className="border bg-transparent px-3 py-2 text-sm tracking-widest outline-none"
              style={{ borderColor: '#3f7391', color: '#7fd6ff' }}
            />
          </label>

          <Field label={t('create.species')}>
            {PLAYABLE_SPECIES.map((s) => (
              <Chip key={s} active={species === s} onClick={() => setSpecies(s)}>
                {speciesName(s)}
              </Chip>
            ))}
          </Field>

          <Field label={t('create.profession')}>
            {PROFESSIONS.map((p) => (
              <Chip key={p} active={profession === p} onClick={() => setProfession(p)}>
                {professionName(p)}
              </Chip>
            ))}
          </Field>

          <button
            type="button"
            disabled={!ready}
            onClick={() => ready && onSubmit(profile)}
            className="mt-1 self-center border border-[#7fd6ff] bg-[#142c4a]/[0.38] px-10 py-3 text-base tracking-[0.3em]
                       text-[#7fd6ff] transition-colors hover:bg-[#7fd6ff] hover:text-black
                       disabled:cursor-not-allowed disabled:border-[#3f7391] disabled:bg-transparent disabled:text-[#3f7391]"
          >
            {t('create.launch')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Подпись слева, ряд вариантов с переносом. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs tracking-[0.3em] text-[#3f7391]">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** Кнопка-выбор: активный вариант залит, прочие — контур. Как `Toggle` в меню. */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer border px-4 py-1.5 text-sm tracking-[0.15em] transition-colors ${
        active ? 'border-[#7fd6ff] bg-[#7fd6ff] text-black' : 'border-[#3f7391] text-[#7fd6ff] hover:border-[#7fd6ff]'
      }`}
    >
      {children}
    </button>
  )
}

/** Маленькая шаговая кнопка (стрелки перебора лица). */
function Nudge({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 w-8 shrink-0 cursor-pointer border border-[#3f7391] text-sm leading-none text-[#7fd6ff]
                 transition-colors hover:border-[#7fd6ff] hover:bg-[#7fd6ff]/10"
    >
      {children}
    </button>
  )
}
