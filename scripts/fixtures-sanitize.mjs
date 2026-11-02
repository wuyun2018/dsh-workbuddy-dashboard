/**
 * Turn raw gateway responses into publishable fixtures.
 *
 * The capture itself is real user data: request counts, credit balances, the
 * scheduler's own mode string (which contains whatever the operator named their
 * cron jobs) and the exact times things ran. None of that may leave the machine,
 * so every published fixture is *synthesised* here: shapes and field names come
 * from the live payload, numbers come from the constants below. The result is
 * internally consistent (totals equal the sum of the series, remaining credit
 * equals size minus used) so the panel renders realistically in screenshots.
 * Deliberately carried over from the capture: `realm`, `usd_cny`, `bucket_seconds`
 * and `api_key_required` — shape-level values that identify nobody.
 *
 *   node scripts/fixtures-sanitize.mjs            # rewrite tests/fixtures/*.json
 *   node scripts/fixtures-sanitize.mjs --check    # exit 1 if a fixture is stale
 *
 * `scripts/capture-fixtures.mjs` runs every capture through this module before
 * writing, so re-capturing cannot reintroduce live numbers.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Demo day: 2026-01-15 00:00 in +08:00. Fixed so screenshots stay stable. */
export const BASE_EPOCH = Math.floor(Date.UTC(2026, 0, 14, 16, 0, 0) / 1000)
/** Model id used in fixtures: a placeholder, never taken from a live capture. */
const MODEL = 'deepseek-v4.1-flash'
const USD_CNY = 7.1

const SERIES = [
  { requests: 8, prompt: 812346, completion: 9782, reasoning: 4106, cached: 764288, credit: 3.12 },
  { requests: 34, prompt: 3367542, completion: 32106, reasoning: 14114, cached: 3211004, credit: 9.28 },
]

const ACCOUNTS = [
  { uid: 'acct-1', nickname: 'demo-cn-1', realm: 'cn', enabled: true, size: 1200, used: 0.06 },
  { uid: 'acct-2', nickname: 'demo-intl-2', realm: 'intl', enabled: false, size: 730, used: 90 },
  { uid: 'acct-3', nickname: 'demo-cn-3', realm: 'cn', enabled: true, size: 500, used: 19.5 },
]

const SCHEDULER_TEXT = '整点排程 (每日巡检 09:00/21:00 · Token 保活 22:00)'
const SCHEDULER_INTL = '账号 Token 自动保活与凭证巡检 (每日 22:00 集中巡检)'

const round = (value, digits) => Number(Number(value).toFixed(digits))

/** `2026-01-15T08:14:36` in the gateway's local wall clock. */
function isoLocal(epoch) {
  return new Date((epoch + 8 * 3600) * 1000).toISOString().slice(0, 19)
}

/** `2026-01-15 08:14:36` (gateway scheduler timestamps use a space). */
function stampLocal(epoch) {
  return isoLocal(epoch).replace('T', ' ')
}

export function sanitizeHealth(raw) {
  const byRealm = { cn: 0, intl: 0 }
  for (const account of ACCOUNTS) byRealm[account.realm] += 1
  const readyByRealm = { cn: 0, intl: 0 }
  for (const account of ACCOUNTS) if (account.enabled) readyByRealm[account.realm] += 1
  return {
    ok: true,
    realm: (raw && raw.realm) || 'cn',
    crypto_ok: true,
    accounts: ACCOUNTS.length,
    accounts_ready: ACCOUNTS.filter((account) => account.enabled).length,
    accounts_by_realm: byRealm,
    accounts_ready_by_realm: readyByRealm,
    api_key_required: raw ? Boolean(raw.api_key_required) : true,
  }
}

export function sanitizeAccounts() {
  return {
    usable: ACCOUNTS.filter((account) => account.enabled).length,
    accounts: ACCOUNTS.map((account) => ({
      uid: account.uid,
      nickname: account.nickname,
      realm: account.realm,
      enabled: account.enabled,
      inCooldown: false,
      credits: {
        remain: round(account.size - account.used, 2),
        size: account.size,
        used: account.used,
      },
    })),
  }
}

export function sanitizeScheduler() {
  return {
    enabled: true,
    mode: SCHEDULER_TEXT,
    mode_cn: SCHEDULER_TEXT,
    mode_intl: SCHEDULER_INTL,
    last_run_time: stampLocal(BASE_EPOCH + 8 * 3600 + 876),
    next_run_time: stampLocal(BASE_EPOCH + 9 * 3600),
    msg: '',
  }
}

export function sanitizeTimeseries(raw) {
  const bucketSeconds = (raw && raw.bucket_seconds) || 3600
  return {
    ok: true,
    realm: (raw && raw.realm) || 'all',
    bucket_seconds: bucketSeconds,
    since: BASE_EPOCH,
    until: BASE_EPOCH + 31743,
    series: SERIES.map((row, index) => ({
      at: BASE_EPOCH + index * 8 * bucketSeconds,
      requests: row.requests,
      errors: 0,
      prompt_tokens: row.prompt,
      completion_tokens: row.completion,
      reasoning_tokens: row.reasoning,
      cached_tokens: row.cached,
      total_tokens: row.prompt + row.completion,
      credit: row.credit,
    })),
    credits: [],
  }
}

export function sanitizeAnalytics(raw) {
  const sum = (key) => SERIES.reduce((total, row) => total + row[key], 0)
  const requests = sum('requests')
  const prompt = sum('prompt')
  const completion = sum('completion')
  const windowSummary = {
    requests,
    errors: 0,
    prompt_tokens: prompt,
    completion_tokens: completion,
    reasoning_tokens: sum('reasoning'),
    cached_tokens: sum('cached'),
    total_tokens: prompt + completion,
    credit: round(sum('credit'), 2),
    ttft_sum: 1204 * requests,
    ttft_n: requests,
    speed_sum: round(208.6 * requests, 2),
    speed_n: requests,
    elapsed_sum: 5120 * requests,
    elapsed_n: requests,
    cache_hit_pct: round((sum('cached') / prompt) * 100, 1),
    reasoning_ratio: round((sum('reasoning') / completion) * 100, 1),
    ttft_ms_avg: 1204,
    speed_avg: 208.6,
    elapsed_ms_avg: 5120,
  }
  windowSummary.cost_cny = round(windowSummary.total_tokens * 8.08e-8, 8)
  return {
    window: { since: BASE_EPOCH, until: null },
    realm: (raw && raw.realm) || 'all',
    usd_cny: (raw && raw.usd_cny) || USD_CNY,
    summary: { window: windowSummary, all_time: {} },
    accounts: [],
    models: [],
    keys: [],
  }
}

export function sanitizeRecent(raw) {
  const rows = Array.isArray(raw && raw.rows) ? raw.rows : []
  const lastAt = BASE_EPOCH + 31742
  const total = SERIES.reduce((sum, row) => sum + row.requests, 0)
  const generated = []
  for (let index = 0; index < 8; index += 1) {
    const at = lastAt - index * 431
    const elapsed = 1400 + index * 137
    const ttft = Math.round(elapsed * 0.6)
    const prompt = 18000 + index * 4321
    const completion = 96 + index * 11
    const cached = prompt - 256
    const credit = round((prompt + completion) * 3.85e-7, 4)
    generated.push({
      at,
      iso: isoLocal(at),
      model: MODEL,
      stream: true,
      outcome: 'completed',
      elapsed_ms: elapsed,
      ttft_ms: ttft,
      gen_ms: elapsed - ttft,
      prompt_tokens: prompt,
      completion_tokens: completion,
      reasoning_tokens: 0,
      cached_tokens: cached,
      total_tokens: prompt + completion,
      credit,
      account: index % 2 === 0 ? 'acct-1' : 'acct-3',
      realm: 'cn',
      cost_cny: round(credit * 0.0633, 6),
      tokens_per_sec: round(completion / ((elapsed - ttft) / 1000), 2),
      cache_hit_pct: round((cached / prompt) * 100, 1),
      n_msgs: 12 + index * 7,
    })
  }
  return {
    total,
    page: 1,
    limit: 8,
    total_pages: Math.ceil(total / 8),
    usd_cny: (raw && raw.usd_cny) || USD_CNY,
    rows: generated,
  }
}

/** Apply every sanitizer to a raw capture set. */
export function sanitizeCaptures(capture) {
  return {
    health: sanitizeHealth(capture.health),
    analytics: sanitizeAnalytics(capture.analytics),
    timeseries: sanitizeTimeseries(capture.series || capture.timeseries),
    recent: sanitizeRecent(capture.recent),
    accounts: sanitizeAccounts(capture.accounts),
    scheduler: sanitizeScheduler(capture.scheduler),
  }
}

/** Serialize like the other fixtures: two-space JSON with a trailing newline. */
export function serializeFixture(value) {
  return JSON.stringify(value, null, 2) + '\n'
}

const FILES = ['health', 'analytics', 'timeseries', 'recent', 'accounts', 'scheduler']

async function main() {
  const check = process.argv.includes('--check')
  const dir = join(here, '..', 'tests', 'fixtures')
  const capture = {}
  for (const name of FILES) {
    const raw = JSON.parse(await readFile(join(dir, name + '.json'), 'utf8'))
    capture[name] = raw
  }
  const sanitized = sanitizeCaptures({
    health: capture.health,
    analytics: capture.analytics,
    series: capture.timeseries,
    recent: capture.recent,
    accounts: capture.accounts,
    scheduler: capture.scheduler,
  })
  let stale = 0
  for (const name of FILES) {
    const next = serializeFixture(sanitized[name])
    const path = join(dir, name + '.json')
    const current = await readFile(path, 'utf8')
    if (current === next) continue
    stale += 1
    if (check) {
      console.log('stale: ' + name + '.json')
    } else {
      await writeFile(path, next, 'utf8')
      console.log('rewrote ' + name + '.json')
    }
  }
  if (check) {
    console.log(stale === 0 ? 'fixtures are sanitised' : stale + ' fixture(s) need sanitising')
    process.exit(stale === 0 ? 0 : 1)
  }
  console.log(stale === 0 ? 'fixtures already sanitised' : 'sanitised ' + stale + ' fixture(s)')
}

if (process.argv[1] && process.argv[1].endsWith('fixtures-sanitize.mjs')) {
  await main()
}
