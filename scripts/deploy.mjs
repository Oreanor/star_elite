// Собирает клиент на этой машине и выкладывает его на домашний сервер.
//
// Игра — статика: Caddy отдаёт её из `/srv/star_elite/current` по пути `/star_elite/`.
// Каждая выкладка ложится рядом отдельной папкой `releases/<время>-<коммит>`, и только
// потом симлинк `current` переставляется на неё одним `mv -T` (rename атомарен): игрок,
// грузящий страницу в этот момент, видит либо старую сборку целиком, либо новую, но не
// смесь. Перезапускать ничего не надо — Caddy читает файлы с диска на каждый запрос.
//
// Сборка — здесь, не на сервере: на сервере нет ни исходников, ни node_modules, и не нужно.
// Настройки — в `.env.deploy` (в git не попадает): DEPLOY_HOST, DEPLOY_DIR, DEPLOY_BASE_PATH.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const host = process.env.DEPLOY_HOST
const dir = process.env.DEPLOY_DIR || '/srv/star_elite'
const base = `/${(process.env.DEPLOY_BASE_PATH ?? '/star_elite').replace(/^\/+|\/+$/g, '')}/`
// Сколько прошлых сборок держать для отката руками (`ln -sfn releases/<…> current`).
const KEEP = 3

const step = (message) => console.log(`[deploy] ${message}`)

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npm', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${argv[0] ?? ''} failed (${result.status ?? result.signal})`)
  return result.stdout
}

const read = (command, argv) => run(command, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const quote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'"

/** tar локальной папки → ssh: архив идёт потоком, без временного файла на диске. */
function upload(from, remote) {
  return new Promise((resolve, reject) => {
    // Папка — через cwd, а не `-C`: tar из Git для Windows читает `C:\…` как `хост:путь`.
    const tar = spawn('tar', ['-cf', '-', '.'], { cwd: from, stdio: ['ignore', 'pipe', 'inherit'] })
    const ssh = spawn('ssh', ['-o', 'BatchMode=yes', host, `bash -c ${quote(remote)}`], { stdio: ['pipe', 'inherit', 'inherit'] })
    tar.stdout.pipe(ssh.stdin)
    let left = 2
    const done = (name) => (code) => {
      if (code !== 0) reject(new Error(`${name} failed (${code})`))
      else if (--left === 0) resolve()
    }
    tar.on('error', reject).on('close', done('tar'))
    ssh.on('error', reject).on('close', done('ssh'))
  })
}

async function deploy() {
  if (!host || host.startsWith('-')) throw new Error('set DEPLOY_HOST=user@host in .env.deploy')
  if (!dir.startsWith('/') || dir.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('DEPLOY_DIR must be an absolute path on the server')
  }
  if (read('git', ['status', '--porcelain']) && !args.has('--dirty')) {
    throw new Error('uncommitted changes: commit them (or pass --dirty to deploy the working tree as is)')
  }
  const commit = read('git', ['rev-parse', '--short', 'HEAD'])
  if (!args.has('--no-push')) run('git', ['push'])

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'star-elite-deploy-'))
  try {
    step(`building ${commit} for ${base}`)
    run('npm', ['run', 'build', '-w', '@elite/web', '--', `--base=${base}`, `--outDir=${out}`, '--emptyOutDir'])
    if (!fs.existsSync(path.join(out, 'index.html'))) throw new Error('build produced no index.html')

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
    const release = `${stamp}-${commit}`
    const remote = [
      'set -eu',
      `root=${quote(dir)}`,
      'test -w "$root" || { echo "[deploy] $root is missing or not writable: run scripts/server-setup.sh once" >&2; exit 1; }',
      `rel="$root/releases/${release}"`,
      'mkdir -p "$rel"',
      'tar -xf - -C "$rel"',
      'chmod -R a+rX "$rel"',
      // Новый симлинк рядом, затем rename поверх старого: атомарная подмена `current`.
      `ln -sfn "releases/${release}" "$root/.current.new"`,
      'mv -T "$root/.current.new" "$root/current"',
      `ls -1d "$root"/releases/*/ | head -n -${KEEP + 1} | xargs -r rm -rf --`,
      `code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1${base})`,
      `[ "$code" = 200 ] || { echo "[deploy] caddy answered $code at ${base}" >&2; exit 1; }`,
    ].join('\n')
    step(`uploading to ${host}:${dir}/releases/${release}`)
    await upload(out, remote)
    step(`${commit} is live at ${base}`)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
}

try {
  await deploy()
} catch (error) {
  console.error(`[deploy] ${error.message}`)
  process.exitCode = 1
}
