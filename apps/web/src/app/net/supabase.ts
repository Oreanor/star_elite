import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Клиент Supabase — единственная точка входа в сеть. Он и авторизация (Auth), и
 * серверные сейвы (Postgres + RLS), и присутствие (Realtime). Своего сервера у нас нет.
 *
 * ОНЛАЙН включается ТОЛЬКО когда заданы обе env-переменные (`.env.local`). Нет ключей —
 * `supabase` === null и `online` === false: игра идёт офлайн (localStorage-сейв), не падая.
 * Так master-ветка и запуск без проекта Supabase остаются рабочими, а сеть «загорается»
 * сама, стоит вписать ключи. anon-ключ публичен намеренно — доступ стережёт RLS, не тайна ключа.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

/** Настроена ли сеть. Где ветвится «онлайн против офлайн» — спрашиваем это, а не env. */
export const online: boolean = supabase !== null
