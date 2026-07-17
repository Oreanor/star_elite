import { useEffect, useState } from 'react'
import {
  DEFAULT_PERSONA,
  PLAYABLE_SPECIES,
  PROFESSIONS,
  isLegalProfile,
  makePilotName,
  makeRng,
  type PilotProfile,
  type Profession,
  type World,
} from '@elite/sim'
import { PORTRAIT_GRID, portraitStyle, type Emotion } from '../portrait'
import { professionName, properName, speciesName } from '../i18n/dataNames'
import { GLASS_PANEL, screenBackground } from '../station/backdrop'
import { ACCENT, Button, DIM } from '../station/chrome'
import { t, useLang } from '../i18n'

/** Сколько всего лиц на листе вида: сетка 6×6 = 36. */
const FACES = PORTRAIT_GRID * PORTRAIT_GRID

/** Вложенное поле ввода — не кнопка: тёмная «канавка» внутри стекла. */
const INPUT_FIELD = {
  borderColor: 'rgba(124,196,255,0.22)',
  background: 'rgba(0,6,14,0.58)',
  color: ACCENT,
  boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.42)',
} as const

/**
 * Селект той же «канавки», но со СВОИМ шевроном: нативную стрелку убираем (`appearance:none`)
 * и рисуем свою фоновым SVG. Нативная жмётся в самый край — своя отодвинута от него на 0.9rem.
 * Цвет шеврона — акцент (#7fd6ff), совпадает с текстом поля.
 */
const SELECT_FIELD = {
  borderColor: 'rgba(124,196,255,0.22)',
  backgroundColor: 'rgba(0,6,14,0.58)',
  color: ACCENT,
  boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.42)',
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237fd6ff' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.9rem center',
} as const

function randomPilotName(species: string): string {
  const rng = makeRng((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0)
  return makePilotName(rng, species)
}

export function CharacterCreation({
  world,
  onSubmit,
}: {
  world: World
  onSubmit: (profile: PilotProfile) => void
}) {
  useLang() // подписка на язык: имена профессий в селекте меняются при переключении
  const [species, setSpecies] = useState<string>(PLAYABLE_SPECIES[0]!)
  const [face, setFace] = useState(0)
  const [name, setName] = useState(() => randomPilotName(PLAYABLE_SPECIES[0]!))
  const [profession, setProfession] = useState<Profession>('traveler')

  const [reaction, setReaction] = useState<Emotion>('neutral')
  useEffect(() => {
    const r = Math.random()
    setReaction(r < 0.15 ? 'pain' : r < 0.575 ? 'joy' : 'sadness')
    const timer = setTimeout(() => setReaction('neutral'), 500)
    return () => clearTimeout(timer)
  }, [species, face])

  useEffect(() => {
    setName(randomPilotName(species))
  }, [species])

  const profile: PilotProfile = {
    name: name.trim(),
    persona: { ...DEFAULT_PERSONA, species, portrait: face, profession },
  }
  const ready = isLegalProfile(profile)

  const cycleFace = (d: number) => {
    setFace((f) => (((f + d) % FACES) + FACES) % FACES)
    setName(randomPilotName(species))
  }


  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-4 font-mono"
      style={{ background: screenBackground(world, true), color: ACCENT }}
    >
      <div
        className="w-full max-w-[38rem] rounded-2xl border p-8 backdrop-blur-md"
        style={{ ...GLASS_PANEL, color: ACCENT }}
      >
        <div className="flex flex-col gap-6">
          <h1 className="text-center text-xl tracking-[0.4em]">{t('create.title')}</h1>
          <p className="text-center text-xs tracking-widest" style={{ color: DIM }}>
            {t('create.startAt', {
              station: properName(world.bodies.find((b) => b.kind === 'station')?.name ?? '—'),
              system: properName(world.systemName),
            })}
          </p>

          <Field label={t('create.species')}>
            {PLAYABLE_SPECIES.map((s) => (
              <Choice key={s} active={species === s} onClick={() => setSpecies(s)}>
                {speciesName(s)}
              </Choice>
            ))}
          </Field>

          <div className="flex items-center justify-center gap-4">
            <Nudge onClick={() => cycleFace(-1)}>◀</Nudge>
            <div
              className="h-36 w-36 shrink-0 border"
              style={{ ...portraitStyle(species, face, reaction), borderColor: DIM }}
            />
            <Nudge onClick={() => cycleFace(1)}>▶</Nudge>
          </div>

          <label className="mx-auto flex w-full max-w-md flex-col gap-1.5">
            <span className="text-center text-xs tracking-[0.3em]" style={{ color: DIM }}>
              {t('create.name')}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder={t('create.name.placeholder')}
              maxLength={24}
              className="border px-3 py-2.5 text-center text-sm tracking-widest outline-none transition-colors focus:border-[#7fd6ff]"
              style={INPUT_FIELD}
            />
          </label>

          <div className="flex flex-col items-center gap-3">
            <span className="text-xs tracking-[0.3em]" style={{ color: DIM }}>
              {t('create.profession')}
            </span>
            {/* Профессия — один селект из пяти (включая Путешественника). */}
            <select
              value={profession}
              onChange={(e) => setProfession(e.target.value as Profession)}
              className="w-full max-w-md border px-3 py-2.5 text-center text-sm tracking-widest outline-none transition-colors focus:border-[#7fd6ff]"
              style={SELECT_FIELD}
            >
              {PROFESSIONS.map((p) => (
                <option key={p} value={p} style={{ background: '#04101d', color: ACCENT }}>
                  {professionName(p)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-center">
            <Button disabled={!ready} onClick={() => onSubmit(profile)}>
              {t('create.start')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs tracking-[0.3em]" style={{ color: DIM }}>
        {label}
      </span>
      <div className="flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  )
}

/** Как вкладки консоли: активная залита, неактивная — контур. */
function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 cursor-pointer border px-5 py-2 text-xs uppercase tracking-[0.25em] transition-colors hover:bg-[#7fd6ff] hover:text-black"
      style={{
        borderColor: active ? ACCENT : DIM,
        backgroundColor: active ? ACCENT : 'transparent',
        color: active ? '#000' : DIM,
      }}
    >
      {children}
    </button>
  )
}

/** Стрелки портрета — те же кнопки, что в chrome `Button`, только квадратные. */
function Nudge({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center border text-base leading-none tracking-[0.2em]
                 transition-colors hover:bg-[#7fd6ff] hover:text-black"
      style={{ borderColor: ACCENT, color: ACCENT }}
    >
      {children}
    </button>
  )
}
