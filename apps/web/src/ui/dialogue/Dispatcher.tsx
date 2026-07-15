import { dispatcherBriefing, dispatcherPersona, stationInterlocutor, type World } from '@elite/sim'
import { ACCENT, Button, DIM, PilotPortrait } from '../station/chrome'
import { economyName, governmentName, properName, speciesName } from '../i18n/dataNames'
import { t, useLang, type Key } from '../i18n'

/**
 * Связь с ДИСПЕТЧЕРОМ станции. В отличие от разговора с бортом (`Dialogue`), здесь не торг и
 * не механика, а СПРАВКА: диспетчер всезнающ по своей системе (факты из домена —
 * `dispatcherBriefing`), но говорит своим тоном (персона от станции). Мир под окном стоит
 * (курсор отпущен), поэтому данные не «плывут» за время разговора.
 */

const GREETING_KEY: Record<string, Key> = {
  brave: 'dispatcher.greet.brave',
  cowardly: 'dispatcher.greet.cowardly',
  greedy: 'dispatcher.greet.greedy',
  honorable: 'dispatcher.greet.honorable',
  hotheaded: 'dispatcher.greet.hotheaded',
  calculating: 'dispatcher.greet.calculating',
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
  useLang()
  const station = stationInterlocutor(world)
  if (!station) {
    return (
      <Frame>
        <p className="text-sm" style={{ color: DIM }}>
          {t('dispatcher.lost')}
        </p>
        <div className="mt-4">
          <Button onClick={onClose}>{t('dispatcher.off')}</Button>
        </div>
      </Frame>
    )
  }

  const persona = dispatcherPersona(world, station)
  const brief = dispatcherBriefing(world)
  const s = brief.settlement
  const greetKey: Key = GREETING_KEY[persona.disposition] ?? 'dispatcher.greet.honorable'

  return (
    <Frame>
      <div className="flex items-start gap-4">
        <PilotPortrait species={persona.species} face={faceOf(station.name)} size={96} />
        <div className="min-w-0">
          <div className="text-lg tracking-[0.25em]" style={{ color: ACCENT }}>
            {t('dispatcher.title', { station: properName(station.name).toUpperCase() })}
          </div>
          <div className="text-xs tracking-widest" style={{ color: DIM }}>
            {speciesName(persona.species).toUpperCase()}
          </div>
          <p className="mt-2 text-sm" style={{ color: '#cfe8ff' }}>
            {t(greetKey)}
          </p>
        </div>
      </div>

      <Section title={t('dispatcher.section.locale')}>
        <Row k={t('dispatcher.gov')} v={governmentName(s.government)} />
        <Row k={t('dispatcher.economy')} v={economyName(s.economy)} />
        <Row k={t('dispatcher.tech')} v={String(s.techLevel)} />
        <Row
          k={t('dispatcher.population')}
          v={t('station.popUnit', { n: Math.round(s.population * 10) / 10 })}
        />
        <Row k={t('dispatcher.dock')} v={brief.dockOccupant ?? t('dispatcher.dockFree')} />
      </Section>

      <Section title={t('dispatcher.section.system')}>
        {brief.nearestPopulated && (
          <p className="mb-2 text-sm" style={{ color: '#9fdcff' }}>
            {t('dispatcher.nearest', {
              name: properName(brief.nearestPopulated.name),
              distance: brief.nearestPopulated.distanceKm,
            })}
          </p>
        )}
        <div className="flex flex-col gap-1 text-sm">
          {brief.bodies.map((b) => (
            <div key={b.id} className="flex justify-between gap-4">
              <span style={{ color: b.populated ? ACCENT : DIM }}>
                {properName(b.name)}{' '}
                <span style={{ color: DIM }}>
                  · {t(`locator.kind.${b.kind}` as Key)}
                  {b.populated ? t('dispatcher.inhabited') : ''}
                </span>
              </span>
              <span style={{ color: DIM }}>
                {b.distanceKm} {t('unit.km')}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <div className="mt-5">
        <Button onClick={onClose}>{t('dispatcher.off')}</Button>
      </div>
    </Frame>
  )
}
