import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

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

/**
 * Запись оснастки из редактора (`/rig.html`, кнопка «СОХРАНИТЬ В ИГРУ») в `rig.json` пакета sim.
 * Только dev-сервер (`apply: 'serve'`): в собранной игре такого пути нет вовсе. Файл —
 * данные (точки дул и подвесов, сопла, размер ракет), его читают `chassis.ts` и `ships.ts`;
 * после записи Vite перезагрузит страницы сам, и правка видна в игре сразу.
 */
function rigSave(): Plugin {
  const file = fileURLToPath(new URL('../../packages/sim/src/config/rig.json', import.meta.url))
  return {
    name: 'rig-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__rig/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
        })
        req.on('end', () => {
          try {
            const { chassisId, entry } = JSON.parse(body) as { chassisId: unknown; entry: unknown }
            if (typeof chassisId !== 'string' || !/^[a-z0-9_]+$/.test(chassisId) || typeof entry !== 'object' || entry === null) {
              throw new Error('ждали {chassisId, entry}')
            }
            const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
            data[chassisId] = entry
            const sorted = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]))
            // Числовые массивы — в строку: иначе каждая координата легла бы своей строкой.
            const text = JSON.stringify(sorted, null, 2).replace(
              /\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g,
              (_, inner: string) => `[${inner.split(/,\s+/).join(', ')}]`,
            )
            writeFileSync(file, text + '\n')
            res.end('ok')
          } catch (e) {
            res.statusCode = 400
            res.end(String(e))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), rigSave()],
  server: { port: 5173 },
  // Env читаем из КОРНЯ монорепо, а не из папки пакета: ключ модели один на весь
  // проект (его же подхватит будущий apps/server), и хранится в одном `.env.local`.
  envDir: '../../',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
})
