import type { ReactNode } from 'react'
import type { Relationship } from '@elite/sim'
import { t, type Key } from '../i18n'
import { stanceColor } from '../theme'
import { DIM } from './chrome'

/**
 * Кто это: портрет, имя, род занятий, корабль и отношение к тебе.
 *
 * ОДИН блок на шапку разговора и карточки вкладки «Люди». Прежде их рисовали врозь, и один
 * и тот же пилот выглядел двумя разными людьми: в разговоре корабль был, в карточке у бога
 * — нет, отношение — то цветной строкой, то серой. Теперь читаются как одно и то же.
 */

const STANCE_KEY: Record<Relationship, Key> = {
  friendly: 'dialogue.stance.friendly',
  neutral: 'dialogue.stance.neutral',
  hostile: 'dialogue.stance.hostile',
}

/**
 * Отношение — не ещё одной серой строкой, а мельче, жирнее и своим цветом (без рамки).
 * Среди погашенных строк паспорта это единственное, что надо считать с одного взгляда.
 */
export function StanceTag({ stance }: { stance: Relationship }) {
  const color = stanceColor(stance)
  return (
    <span className="text-[0.65rem] font-bold tracking-[0.2em]" style={{ color }}>
      {t(STANCE_KEY[stance])}
    </span>
  )
}

export function PilotIdentity({
  portrait,
  name,
  role,
  craft,
  stance,
  children,
}: {
  portrait: ReactNode
  name: string
  /** Род занятий — уже на языке интерфейса. */
  role?: string
  /** Корабль — имя корпуса. У бога это его ладья, а не пустота. */
  craft?: string
  /** Нет — строки нет вовсе (это ты сам: «нейтрален к себе» — шум). */
  stance?: Relationship
  /** Что ниже паспорта: где он, кнопка связи. */
  children?: ReactNode
}) {
  return (
    // Колонка текста — ровно по высоте портрета: имя вровень с его верхним краем, хвост
    // (кнопка связи) — с нижним. Строки сжаты по интерлиньяжу, иначе текст перерастал
    // аватар и карточка теряла ровный край.
    <div className="flex min-w-0 items-stretch gap-4">
      {portrait}
      <div className="flex min-w-0 flex-col justify-between text-left">
        <div className="min-w-0">
          {/* Имя — как пишется, не капсом: это человек, а не заголовок. Чуть крупнее и жирнее строк ниже. */}
          <div className="truncate text-lg font-semibold leading-6">{name}</div>
          {role ? (
            <div className="truncate text-xs leading-4 tracking-widest" style={{ color: DIM }}>
              {role.toUpperCase()}
            </div>
          ) : null}
          {craft ? (
            <div className="truncate text-xs leading-4 tracking-widest" style={{ color: DIM }}>
              {/* Корабль — именем собственным, в кавычках: «ПЕГАС», а не род занятий. */}
            «{craft.toUpperCase()}»
            </div>
          ) : null}
          {stance ? (
            <div className="mt-1 leading-4">
              <StanceTag stance={stance} />
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  )
}
