import type { ReactNode } from 'react'
import { DIM, ModalTitle } from './chrome'

/**
 * Карточка предмета в модалке — ОДНА форма на продажу из отсека и на покупку оборудования:
 * название на всю ширину, под ним с отступом строки «ПОДПИСЬ: значение». Два окна одного
 * и того же модуля не должны выглядеть по-разному.
 */
export function ItemSheet({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <>
      <ModalTitle>{title}</ModalTitle>
      {/* Отступ от заголовка: строки — сведения О нём, а не вровень с ним. */}
      <div className="space-y-1 pl-4 text-sm">{children}</div>
    </>
  )
}

/** Строка характеристики: «ПОДПИСЬ: значение», подпись приглушена. */
export function StatLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span style={{ color: DIM }}>{label}: </span>
      {children}
    </div>
  )
}
