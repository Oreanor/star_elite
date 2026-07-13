import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Версия — из package.json пакета, единственный источник правды. Бампишь номер
// (`npm version patch|minor|major` в apps/web) — и титул подхватывает его на сборке,
// без правки JSX. Разряд по semver: patch — правки и твики, minor — заметная фича,
// major — веха. `__APP_VERSION__` подставляется как строковый литерал (см. vite-env.d.ts).
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as {
  version: string
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  // Env читаем из КОРНЯ монорепо, а не из папки пакета: ключ модели один на весь
  // проект (его же подхватит будущий apps/server), и хранится в одном `.env.local`.
  envDir: '../../',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
