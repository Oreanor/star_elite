import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  // Env читаем из КОРНЯ монорепо, а не из папки пакета: ключ модели один на весь
  // проект (его же подхватит будущий apps/server), и хранится в одном `.env.local`.
  envDir: '../../',
})
