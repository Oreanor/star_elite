import { dispatcherBriefing, dispatcherPersona, stationInterlocutor, type BriefingBody, type World } from '@elite/sim'
import { ACCENT, Button, DIM, PilotPortrait } from '../station/chrome'
import { economyName, governmentName, properName, speciesName } from '../i18n/dataNames'

/**
 * Связь с ДИСПЕТЧЕРОМ станции. В отличие от разговора с бортом (`Dialogue`), здесь не торг и
 * не механика, а СПРАВКА: диспетчер всезнающ по своей системе (факты из домена —
 * `dispatcherBriefing`), но говорит своим тоном (персона от станции). Мир под окном стоит
 * (курсор отпущен), поэтому данные не «плывут» за время разговора.
 *
 * Строки русские напрямую, как в `Dialogue`: канал связи в этой игре не мультиязычный.
 */

/** Приветствие по нраву: ЗНАНИЕ у всех полное, разнится лишь тон. */
const GREETING: Record<string, string> = {
  brave: 'Диспетчер на связи. Говори прямо, пилот — не тяни.',
  cowardly: 'Э-э… диспетчер слушает. Только без глупостей, ладно?',
  greedy: 'Диспетчер. Чего надо? Время — деньги, так что живее.',
  honorable: 'Диспетчерская, добрый борт. Чем могу помочь?',
  hotheaded: 'Ну наконец-то! Диспетчер на связи. Выкладывай, чего застрял.',
  calculating: 'Диспетчер. Слушаю внимательно — по делу, будь добр.',
}

const KIND_LABEL: Record<BriefingBody['kind'], string> = {
  star: 'звезда',
  planet: 'планета',
  moon: 'луна',
  station: 'станция',
  blackhole: 'чёрная дыра',
}

/** Стабильное лицо диспетчера от имени станции: у одной станции — постоянное (0..35 = 6×6). */
function faceOf(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 36
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: 'radial-gradient(ellipse at center, rgba(12,34,60,0.72), rgba(0,3,8,0.94))' }}
    >
      <div
        className="max-h-[calc(100vh-4rem)] w-[calc(100vw-4rem)] max-w-2xl overflow-y-auto rounded-2xl border p-7 font-mono"
        style={{
          borderColor: 'rgba(124,196,255,0.3)',
          background: 'linear-gradient(150deg, rgba(40,95,150,0.18), rgba(8,22,42,0.5))',
          color: ACCENT,
        }}
      >
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h2 className="text-sm tracking-[0.3em]" style={{ color: ACCENT }}>
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span style={{ color: DIM }}>{k}</span>
      <span>{v}</span>
    </div>
  )
}

export function Dispatcher({ world, onClose }: { world: World; onClose: () => void }) {
  const station = stationInterlocutor(world)
  if (!station) {
    // Захват станции пропал (прыжок/смена цели) — показываем обрыв, а не пустоту.
    return (
      <Frame>
        <p className="text-sm" style={{ color: DIM }}>
          Связь прервана.
        </p>
        <div className="mt-4">
          <Button onClick={onClose}>ОТБОЙ</Button>
        </div>
      </Frame>
    )
  }

  const persona = dispatcherPersona(world, station)
  const brief = dispatcherBriefing(world)
  const s = brief.settlement

  return (
    <Frame>
      <div className="flex items-start gap-4">
        <PilotPortrait species={persona.species} face={faceOf(station.name)} size={96} />
        <div className="min-w-0">
          <div className="text-lg tracking-[0.25em]" style={{ color: ACCENT }}>
            ДИСПЕТЧЕР · {properName(station.name).toUpperCase()}
          </div>
          <div className="text-xs tracking-widest" style={{ color: DIM }}>
            {speciesName(persona.species).toUpperCase()}
          </div>
          <p className="mt-2 text-sm" style={{ color: '#cfe8ff' }}>
            {GREETING[persona.disposition] ?? GREETING.honorable}
          </p>
        </div>
      </div>

      <Section title="ОКРУГА">
        <Row k="Строй" v={governmentName(s.government)} />
        <Row k="Экономика" v={economyName(s.economy)} />
        <Row k="Тех-уровень" v={String(s.techLevel)} />
        <Row k="Население" v={`${Math.round(s.population * 10) / 10} млн`} />
        <Row k="У причала" v={brief.dockOccupant ?? 'свободно'} />
      </Section>

      <Section title="СИСТЕМА">
        {brief.nearestPopulated && (
          <p className="mb-2 text-sm" style={{ color: '#9fdcff' }}>
            Ближайший обитаемый мир — {properName(brief.nearestPopulated.name)}, {brief.nearestPopulated.distanceKm} км.
            Туда и держи.
          </p>
        )}
        <div className="flex flex-col gap-1 text-sm">
          {brief.bodies.map((b) => (
            <div key={b.id} className="flex justify-between gap-4">
              <span style={{ color: b.populated ? ACCENT : DIM }}>
                {properName(b.name)}{' '}
                <span style={{ color: DIM }}>
                  · {KIND_LABEL[b.kind]}
                  {b.populated ? ' · обитаема' : ''}
                </span>
              </span>
              <span style={{ color: DIM }}>{b.distanceKm} км</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="mt-5">
        <Button onClick={onClose}>ОТБОЙ</Button>
      </div>
    </Frame>
  )
}
