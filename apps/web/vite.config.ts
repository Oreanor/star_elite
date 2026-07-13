import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as {
  version: string
  versionAnchor?: number
}

/**
 * Версия для титула. ПАТЧ-разряд — это номер сборки, что растёт САМ: число коммитов
 * сверх якоря (`versionAnchor`). Пуш всегда несёт новые коммиты, значит и версия
 * поднимается на каждый пуш — ровно на столько, сколько коммитов в нём приехало.
 * `major.minor` живут в package.json и бампятся руками на заметную фичу/веху.
 *
 * Якорь выставлен так, чтобы «сейчас» патч равнялся тому, что записан в version.
 * Нет git (архивная сборка, shallow-клон в CI) — молча отдаём статику из package.json,
 * зажав патч снизу базовым: версия никогда не «уедет назад».
 */
function appVersion(): string {
  const [major = '0', minor = '0', basePatch = '0'] = pkg.version.split('.')
  if (pkg.versionAnchor == null) return pkg.version
  try {
    const commits = Number(
      execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(),
    )
    if (!Number.isFinite(commits)) return pkg.version
    const patch = Math.max(Number(basePatch), Number(basePatch) + commits - pkg.versionAnchor)
    return `${major}.${minor}.${patch}`
  } catch {
    return pkg.version
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  // Env читаем из КОРНЯ монорепо, а не из папки пакета: ключ модели один на весь
  // проект (его же подхватит будущий apps/server), и хранится в одном `.env.local`.
  envDir: '../../',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
})
