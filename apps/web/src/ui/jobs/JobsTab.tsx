import type { Contract, World } from '@elite/sim'
import { t, type Key } from '../i18n'
import { properName } from '../i18n/dataNames'
import { ACCENT, DIM } from '../station/chrome'
import { UI } from '../theme'
import { daysLeft, deadlineText, goalText, kindLabel, rewardText } from './jobText'

/**
 * ДЕЛА: что взято, у кого, куда и до какого числа; ниже — недавно закрытые с исходом.
 * Только показ: дела ведёт домен (`stepContracts`), сдаются они сами — на стыковке, по гибели
 * цели, по сносу гнезда. Кнопок «сдать» нет и не нужно.
 */
export function JobsTab({ world }: { world: World }) {
  const active = world.contracts.filter((c) => c.status === 'active')
  const closed = world.contracts.filter((c) => c.status !== 'active').reverse()

  if (world.contracts.length === 0) {
    return (
      <p className="max-w-xl text-sm leading-relaxed" style={{ color: DIM }}>
        {t('jobs.empty')}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto pr-1 font-mono" style={{ color: ACCENT }}>
      {active.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm tracking-title">{t('jobs.active')}</h2>
          <div className="flex flex-col gap-3">
            {active.map((c) => (
              <JobCard key={c.id} c={c} world={world} />
            ))}
          </div>
        </section>
      )}
      {closed.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm tracking-title" style={{ color: DIM }}>
            {t('jobs.closed')}
          </h2>
          <div className="flex flex-col gap-2">
            {closed.map((c) => (
              <JobCard key={c.id} c={c} world={world} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function JobCard({ c, world }: { c: Contract; world: World }) {
  const open = c.status === 'active'
  const left = open ? daysLeft(c, world.calendarTime) : null
  // Горит срок — меньше суток: жёлтым, чтобы не прозевать.
  const urgent = left != null && left < 1
  const endColor = c.status === 'done' ? UI.PRIMARY : UI.DANGER
  return (
    <div className="rounded border px-4 py-3" style={{ borderColor: open ? ACCENT : DIM, opacity: open ? 1 : 0.7 }}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm tracking-label">{kindLabel(c)}</span>
        {open ? (
          <span className="text-2xs tracking-meta" style={{ color: urgent ? UI.WARN : DIM }}>
            {deadlineText(c)}
          </span>
        ) : (
          <span className="text-2xs tracking-meta" style={{ color: endColor }}>
            {c.end ? t(`jobs.end.${c.end}` as Key) : ''}
          </span>
        )}
      </div>
      <div className="mt-1 text-sm">{goalText(c)}</div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-2xs tracking-meta" style={{ color: DIM }}>
        <span>{t('jobs.from', { name: properName(c.giverName), system: properName(c.systemName) })}</span>
        <span>{rewardText(c)}</span>
        {c.paid > 0 && <span>{t('jobs.paid', { paid: c.paid })}</span>}
      </div>
    </div>
  )
}
