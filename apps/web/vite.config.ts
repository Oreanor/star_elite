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
 * Версия для титула. ПАТЧ-разряд — номер сборки, что растёт САМ: число коммитов сверх якоря
 * (`versionAnchor`). Пуш несёт новые коммиты — версия поднимается на каждый пуш.
 * `major.minor` живут в package.json и бампятся руками на заметную фичу/веху.
 *
 * Пойманное: на проде стояло вечное 0.0.1. Vercel клонирует репозиторий МЕЛКО (последние
 * коммиты), `rev-list --count` давал единицы, и патч зажимался в базовый. Поэтому число
 * коммитов добываем по очереди: полная история → догрузить её (`fetch --unshallow`) →
 * спросить GitHub (у Vercel есть владелец и имя репо в окружении). Не вышло ничем — базовая
 * версия с коротким хешем коммита: хотя бы видно, какая сборка на проде.
 */
const run = (cmd: string): string =>
  execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).toString().trim()

function localCommitCount(): number | null {
  try {
    if (run('git rev-parse --is-shallow-repository') === 'true') {
      try {
        run('git fetch --unshallow --quiet')
      } catch {
        return null
      }
    }
    const n = Number(run('git rev-list --count HEAD'))
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** Число коммитов до `sha` по GitHub API: страница по одному коммиту, номер последней — счёт. */
async function githubCommitCount(): Promise<number | null> {
  const owner = process.env.VERCEL_GIT_REPO_OWNER
  const repo = process.env.VERCEL_GIT_REPO_SLUG
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  if (!owner || !repo || !sha) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?sha=${sha}&per_page=1`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'elite-build' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const last = /[?&]page=(\d+)>; rel="last"/.exec(res.headers.get('link') ?? '')
    return last ? Number(last[1]) : 1
  } catch {
    return null
  }
}

function shortSha(): string {
  const env = process.env.VERCEL_GIT_COMMIT_SHA
  if (env) return env.slice(0, 7)
  try {
    return run('git rev-parse --short HEAD')
  } catch {
    return ''
  }
}

async function appVersion(): Promise<string> {
  const [major = '0', minor = '0', basePatch = '0'] = pkg.version.split('.')
  if (pkg.versionAnchor == null) return pkg.version
  const commits = localCommitCount() ?? (await githubCommitCount())
  if (commits == null) {
    const sha = shortSha()
    return sha ? `${pkg.version}+${sha}` : pkg.version
  }
  // Зажим снизу базовым: версия никогда не «уедет назад».
  const patch = Math.max(Number(basePatch), Number(basePatch) + commits - pkg.versionAnchor)
  return `${major}.${minor}.${patch}`
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

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), rigSave()],
  server: { port: 5173 },
  // Env читаем из КОРНЯ монорепо, а не из папки пакета: ключ модели один на весь
  // проект (его же подхватит будущий apps/server), и хранится в одном `.env.local`.
  envDir: '../../',
  define: {
    __APP_VERSION__: JSON.stringify(await appVersion()),
  },
}))
