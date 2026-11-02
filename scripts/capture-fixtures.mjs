/**
 * Capture a fresh fixture set from a running WorkBuddy gateway.
 *
 *   node scripts/capture-fixtures.mjs [baseUrl] [password]
 *
 * Nothing captured here is published as-is: the raw responses describe a real
 * account (balances, request counts, the operator's own cron job names), so they
 * go straight through `scripts/fixtures-sanitize.mjs`, which keeps the shapes and
 * field names and replaces every number with a synthetic one. Never publish raw
 * captures, and never add a field to a fixture without adding it to the
 * sanitizer first.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sanitizeCaptures, serializeFixture } from './fixtures-sanitize.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'tests', 'fixtures')
const baseUrl = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/+$/, '')
const password = process.argv[3] || 'admin'

async function api(path, token) {
  const headers = { accept: 'application/json' }
  if (token) headers['X-Panel-Token'] = token
  const response = await fetch(baseUrl + path, { headers })
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + path)
  return response.json()
}

const login = await (await fetch(baseUrl + '/panel/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password }),
})).json()
const token = login.token

const raw = {
  health: await api('/health'),
  analytics: await api('/usage/analytics?realm=all&range=today', token),
  series: await api('/usage/timeseries?realm=all&range=today&bucket=3600', token),
  recent: await api('/usage/recent?realm=all&limit=8', token),
  accounts: await api('/accounts?realm=all', token),
  scheduler: await api('/scheduler', token),
}

const sanitized = sanitizeCaptures(raw)

await mkdir(outDir, { recursive: true })
for (const [name, value] of Object.entries(sanitized)) {
  await writeFile(join(outDir, name + '.json'), serializeFixture(value), 'utf8')
}

console.log('fixtures written to ' + outDir)
console.log(
  'accounts=' + sanitized.accounts.accounts.length +
  ' recent=' + sanitized.recent.rows.length +
  ' series=' + sanitized.timeseries.series.length,
)
