import type { PlayerSave } from '@elite/sim'
import { supabase } from './supabase'

/**
 * Аккаунт и серверный сейв поверх Supabase. Аутентификацию НЕ пишем сами — это
 * Supabase Auth (email+password): хеш, TLS, сессия, обновление токена — на их стороне.
 * Здесь только тонкая обёртка: вход/выход и чтение/запись СВОЕЙ строки в `saves`.
 *
 * Все функции зовутся лишь в онлайн-режиме (`online === true`); клиент тогда не null.
 * RLS на сервере — вторая линия: даже подделав запрос, чужую строку не достать.
 */

function client() {
  if (!supabase) throw new Error('Supabase не настроен: сеть выключена')
  return supabase
}

export interface AuthResult {
  ok: boolean
  /** Человекочитаемая причина отказа (для формы). null — успех. */
  error: string | null
}

/** Регистрация. Если проект требует подтверждения почты — сессии сразу может не быть. */
export async function signUp(email: string, password: string): Promise<AuthResult> {
  const { error } = await client().auth.signUp({ email, password })
  return { ok: !error, error: error?.message ?? null }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { error } = await client().auth.signInWithPassword({ email, password })
  return { ok: !error, error: error?.message ?? null }
}

export async function signOut(): Promise<void> {
  await client().auth.signOut()
}

/** id текущего пользователя или null (не залогинен). */
export async function currentUserId(): Promise<string | null> {
  const { data } = await client().auth.getUser()
  return data.user?.id ?? null
}

/** e-mail текущего пользователя — для подписи в интерфейсе. */
export async function currentEmail(): Promise<string | null> {
  const { data } = await client().auth.getUser()
  return data.user?.email ?? null
}

/**
 * Подписка на вход/выход. Возвращает отписку. Первым событием Supabase отдаёт текущее
 * состояние сессии (восстановленной из хранилища), так что начальный id прилетит сам.
 */
export function onAuthChange(cb: (userId: string | null) => void): () => void {
  const { data } = client().auth.onAuthStateChange((_event, session) => cb(session?.user?.id ?? null))
  return () => data.subscription.unsubscribe()
}

/**
 * Сейв игрока с сервера — своя строка (RLS сам ограничит выборку своим `user_id`).
 * Нет строки или чужой версии формата — как будто сейва нет (новичок), а не падение.
 */
export async function loadServerSave(): Promise<PlayerSave | null> {
  const { data, error } = await client().from('saves').select('save').maybeSingle()
  if (error) throw error
  const save = data?.save as PlayerSave | undefined
  return save && save.version === 1 ? save : null
}

/** Записать сейв: upsert по `user_id` (RLS проверит, что это ТЫ). */
export async function writeServerSave(save: PlayerSave): Promise<void> {
  const uid = await currentUserId()
  if (!uid) throw new Error('Нет сессии — серверный сейв невозможен')
  const { error } = await client().from('saves').upsert({ user_id: uid, save })
  if (error) throw error
}
