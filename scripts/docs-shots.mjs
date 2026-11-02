/**
 * Dev utility: regenerate the five documentation screenshots from the demo
 * harness.
 *
 *   node scripts/docs-shots.mjs [--port 4010] [--out docs]
 *
 * The harness serves the synthetic fixtures from `tests/fixtures/`, so nothing
 * that appears in the published PNGs comes from a live gateway. Preferences are
 * fetched-and-merged in memory (`:memory:` in demo mode), which lets this script
 * switch the anchor between shots without touching anyone's real prefs file.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

function flag(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const port = Number(flag('port', '4010'))
const outDir = resolve(root, flag('out', 'docs'))
const base = 'http://127.0.0.1:' + port

const ALL_CARDS = [
  'tokens', 'requests', 'speed', 'cache', 'cost', 'success',
  'credit_used', 'prompt', 'completion', 'reasoning', 'cached_tokens',
]
const ALL_PANELS = ['trend', 'recent', 'accounts', 'scheduler']

const BASE_PREFS = {
  cards: ALL_CARDS.slice(0, 7),
  panels: ALL_PANELS,
  opacity: 0.94,
  refreshMs: 10000,
  range: 'today',
  snap: true,
  snapDistance: 24,
  anchor: 'header',
}

/** @type {{file: string, prefs: object, probe?: string, note: string}[]} */
const SHOTS = [
  {
    file: 'preview-in-dsh.png',
    prefs: { ...BASE_PREFS },
    note: 'collapsed card strip in the conversation header',
  },
  {
    file: 'preview-expanded.png',
    prefs: { ...BASE_PREFS },
    probe: 'probe-expand.js',
    note: 'panel expanded under the header',
  },
  {
    file: 'preview-settings.png',
    prefs: { ...BASE_PREFS },
    probe: 'probe-settings-open.js',
    note: 'settings view',
  },
  {
    file: 'preview-bottom-left.png',
    prefs: { ...BASE_PREFS, anchor: 'bottom-left' },
    note: 'card strip at the bottom-left of the conversation',
  },
  {
    file: 'preview-bottom-right.png',
    prefs: { ...BASE_PREFS, anchor: 'bottom-right' },
    note: 'card strip at the bottom-right of the conversation',
  },
]

function run(command, args, options) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options })
  return once(child, 'exit').then(([code]) => code)
}

async function putPrefs(patch) {
  const response = await fetch(base + '/workbuddy/api/prefs', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error('prefs PUT failed: HTTP ' + response.status)
  return response.json()
}

const harness = spawn(
  process.execPath,
  [join(here, 'harness.mjs'), '--demo', '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
)
let harnessLog = ''
harness.stdout.on('data', (chunk) => { harnessLog += String(chunk) })
harness.stderr.on('data', (chunk) => { harnessLog += String(chunk) })

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + '/workbuddy/api/config')
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 200))
  }
  throw new Error('harness did not start:\n' + harnessLog)
}

let failures = 0
try {
  await waitForServer(15000)
  for (const shot of SHOTS) {
    await putPrefs(shot.prefs)
    const args = [
      join(here, 'screenshot.mjs'),
      base + '/',
      join(outDir, shot.file),
      '--wait', '4200',
      '--size', '1440x900',
    ]
    if (shot.probe) args.push('--eval-file', join(here, '..', 'dev', 'probes', shot.probe))
    const code = await run(process.execPath, args)
    if (code !== 0) failures += 1
    console.log((code === 0 ? 'ok   ' : 'FAIL ') + shot.file + ' — ' + shot.note)
  }
} finally {
  harness.kill()
}

console.log(failures === 0 ? 'screenshots written to ' + outDir : failures + ' shot(s) failed')
process.exit(failures === 0 ? 0 : 1)
