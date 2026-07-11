/// <reference types="vite/client" />

/**
 * Типы env-переменных сборки. Vite подставляет их на этапе бандла (`import.meta.env`).
 * Обе — опциональны: без них игра идёт офлайн (localStorage), см. `app/net/supabase.ts`.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
