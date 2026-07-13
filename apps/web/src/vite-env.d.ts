/// <reference types="vite/client" />

/**
 * Типы env-переменных сборки. Vite подставляет их на этапе бандла (`import.meta.env`).
 * Обе — опциональны: без них игра идёт офлайн (localStorage), см. `app/net/supabase.ts`.
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_DATABASE_URL?: string
  readonly VITE_FIREBASE_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Версия приложения из package.json, вшитая на сборке (`define` в vite.config.ts). */
declare const __APP_VERSION__: string
