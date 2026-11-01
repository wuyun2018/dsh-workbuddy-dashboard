/**
 * Capture small, anonymised fixtures from a running WorkBuddy gateway.
 *
 * Usage: node scripts/capture-fixtures.mjs [baseUrl] [password]
 *
 * Account names, uids and key identifiers are replaced; only shapes and the
 * numeric fields the plugin reads are kept. Never publish raw captures: the
 * gateway payload contains account identities and cost provenance hashes.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const health = await api('/health')
const analytics = await api('/usage/analytics?realm=all&range=today', token)
const series = await api('/usage/timeseries?realm=all&range=today&bucket=3600', token)
const recent = await api('/usage/recent?realm=all&limit=8', token)
const accounts = await api('/accounts?realm=all', token)
const scheduler = await api('/scheduler', token)

await mkdir(outDir, { recursive: true })

await writeFile(join(outDir, 'health.json'), JSON.stringify({
  ok: health.ok,
  realm: health.realm,
  crypto_ok: health.crypto_ok,
  accounts: health.accounts,
  accounts_ready: health.accounts_ready,
  accounts_by_realm: health.accounts_by_realm,
  accounts_ready_by_realm: health.accounts_ready_by_realm,
  api_key_required: health.api_key_required,
}, null, 2) + '\n', 'utf8')

await writeFile(join(outDir, 'analytics.json'), JSON.stringify({
  window: analytics.window,
  realm: analytics.realm,
  usd_cny: analytics.usd_cny,
  summary: { window: analytics.summary.window, all_time: {} },
  accounts: [],
  models: [],
  keys: [],
}, null, 2) + '\n', 'utf8')

const seriesRows = Array.isArray(series.series) ? series.series.slice(-6) : []
await writeFile(join(outDir, 'timeseries.json'), JSON.stringify({
  ok: true,
  realm: series.realm,
  bucket_seconds: series.bucket_seconds,
  since: series.since,
  until: series.until,
  series: seriesRows.map((row, index) => ({
    at: row.at - (seriesRows.length - 1 - index) * 3600,
    requests: row.requests,
    errors: row.errors,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    reasoning_tokens: row.reasoning_tokens,
    cached_tokens: row.cached_tokens,
    total_tokens: row.total_tokens,
    credit: row.credit,
  })),
  credits: [],
}, null, 2) + '\n', 'utf8')

const recentRows = Array.isArray(recent.rows) ? recent.rows.slice(0, 8) : []
await writeFile(join(outDir, 'recent.json'), JSON.stringify({
  total: recent.total,
  page: 1,
  limit: recent.limit,
  total_pages: recent.total_pages,
  usd_cny: recent.usd_cny,
  rows: recentRows.map((row, index) => ({
    at: row.at,
    iso: row.iso,
    model: row.model,
    stream: row.stream,
    outcome: row.outcome,
    elapsed_ms: row.elapsed_ms,
    ttft_ms: row.ttft_ms,
    gen_ms: row.gen_ms,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    reasoning_tokens: row.reasoning_tokens,
    cached_tokens: row.cached_tokens,
    total_tokens: row.total_tokens,
    credit: row.credit,
    account: 'acct-' + ((index % 3) + 1),
    realm: row.realm,
    cost_cny: row.cost_cny,
    tokens_per_sec: row.tokens_per_sec,
    cache_hit_pct: row.cache_hit_pct,
    n_msgs: row.n_msgs,
  })),
}, null, 2) + '\n', 'utf8')

const accountRows = Array.isArray(accounts.accounts) ? accounts.accounts : []
await writeFile(join(outDir, 'accounts.json'), JSON.stringify({
  usable: accounts.usable,
  accounts: accountRows.map((account, index) => ({
    uid: 'acct-' + (index + 1),
    nickname: 'demo-' + (account.realm || 'cn') + '-' + (index + 1),
    realm: account.realm,
    enabled: account.enabled,
    inCooldown: account.inCooldown,
    credits: account.credits
      ? { remain: account.credits.remain, size: account.credits.size, used: account.credits.used }
      : null,
  })),
}, null, 2) + '\n', 'utf8')

await writeFile(join(outDir, 'scheduler.json'), JSON.stringify({
  enabled: scheduler.enabled,
  mode: scheduler.mode,
  mode_cn: scheduler.mode_cn,
  mode_intl: scheduler.mode_intl,
  last_run_time: scheduler.last_run_time,
  next_run_time: scheduler.next_run_time,
  msg: scheduler.msg,
}, null, 2) + '\n', 'utf8')

console.log('fixtures written to ' + outDir)
console.log('accounts=' + accountRows.length + ' recent=' + recentRows.length + ' series=' + seriesRows.length)
