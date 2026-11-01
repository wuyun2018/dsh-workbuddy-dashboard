/**
 * Snapshot building: gateway payloads -> the single JSON document the panel and
 * the agent tools consume.
 *
 * Everything here is a pure function of its inputs so it can be unit tested
 * without a network or a browser.
 */

import {
  fmtClock,
  fmtCompact,
  fmtCount,
  fmtHourMinute,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSec,
  fmtTimeOfDay,
  fmtUsd,
  fmt1,
  num,
  pctOf,
} from './format.js'

/** KPI card ids supported by the panel, in catalogue order. */
export const KPI_IDS = [
  'tokens',
  'requests',
  'speed',
  'cache',
  'cost',
  'success',
  'prompt_tokens',
  'completion_tokens',
  'reasoning_tokens',
  'cached_tokens',
  'ttft',
  'elapsed',
  'peak_throughput',
  'reasoning_ratio',
  'errors',
  'credit',
  'cost_usd',
  'accounts_ready',
]

/** Cards shown when the plugin has no explicit configuration. */
export const DEFAULT_CARDS = ['tokens', 'requests', 'speed', 'cache', 'cost', 'success']

/** Panels that can be switched on or off. */
export const PANEL_IDS = ['trend', 'recent', 'accounts', 'scheduler']

/** Panels shown by default. */
export const DEFAULT_PANELS = [...PANEL_IDS]

function windowOf(analytics) {
  const summary = analytics && analytics.summary
  const window = summary && summary.window
  return window && typeof window === 'object' ? window : {}
}

function successPct(window) {
  const requests = num(window.requests)
  if (requests <= 0) return 100
  return Math.max(0, 100 - pctOf(window.errors, requests))
}

function peakSpeed(recent) {
  let peak = 0
  for (const row of Array.isArray(recent) ? recent : []) {
    const value = num(row && row.tokens_per_sec)
    if (value > peak) peak = value
  }
  return peak
}

function creditRemain(accounts) {
  let remain = 0
  let size = 0
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const credits = account && account.credits
    if (!credits || typeof credits !== 'object') continue
    remain += num(credits.remain)
    size += num(credits.size)
  }
  return { remain, size }
}

/**
 * Card catalogue. Each entry renders one KPI tile:
 *   value = the big number, sub = the small unit/hint line.
 */
export const KPI_CATALOG = {
  tokens: {
    label: 'Tokens',
    render: (ctx) => ({ value: fmtCompact(ctx.window.total_tokens), sub: fmtInt(ctx.window.total_tokens) + ' tokens' }),
  },
  requests: {
    label: '请求数',
    render: (ctx) => ({ value: fmtInt(ctx.window.requests), sub: '错误 ' + fmtCount(ctx.window.errors) }),
  },
  speed: {
    label: '生成速度',
    render: (ctx) => ({ value: fmt1(ctx.window.speed_avg), sub: 'tokens/s' }),
  },
  cache: {
    label: '缓存命中',
    render: (ctx) => ({ value: fmtPct(ctx.window.cache_hit_pct), sub: '命中 ' + fmtCompact(ctx.window.cached_tokens) }),
  },
  cost: {
    label: '花费',
    render: (ctx) => ({ value: fmtMoney(ctx.window.cost_cny), sub: '人民币' }),
  },
  success: {
    label: '成功率',
    render: (ctx) => ({ value: fmtPct(ctx.successPct), sub: '请求 ' + fmtInt(ctx.window.requests) }),
  },
  prompt_tokens: {
    label: '提问',
    render: (ctx) => ({ value: fmtCompact(ctx.window.prompt_tokens), sub: 'prompt tokens' }),
  },
  completion_tokens: {
    label: '回答',
    render: (ctx) => ({ value: fmtCompact(ctx.window.completion_tokens), sub: 'completion tokens' }),
  },
  reasoning_tokens: {
    label: '思考',
    render: (ctx) => ({ value: fmtCompact(ctx.window.reasoning_tokens), sub: 'reasoning tokens' }),
  },
  cached_tokens: {
    label: '命中 Tokens',
    render: (ctx) => ({ value: fmtCompact(ctx.window.cached_tokens), sub: fmtPct(ctx.window.cache_hit_pct) }),
  },
  ttft: {
    label: '首字延迟',
    render: (ctx) => ({ value: fmtSec(ctx.window.ttft_ms_avg), sub: 'ttft 平均' }),
  },
  elapsed: {
    label: '总耗时',
    render: (ctx) => ({ value: fmtSec(ctx.window.elapsed_ms_avg), sub: 'elapsed 平均' }),
  },
  peak_throughput: {
    label: '峰值吞吐',
    render: (ctx) => ({ value: fmt1(ctx.peakSpeed), sub: 'tokens/s' }),
  },
  reasoning_ratio: {
    label: '思考占比',
    render: (ctx) => ({ value: fmtPct(ctx.reasoningRatio), sub: '占回答 tokens' }),
  },
  errors: {
    label: '错误数',
    render: (ctx) => ({ value: fmtCount(ctx.window.errors), sub: '失败请求' }),
  },
  credit: {
    label: '剩余额度',
    render: (ctx) => ({ value: fmtCompact(ctx.credit.remain), sub: '共 ' + fmtCompact(ctx.credit.size) }),
  },
  cost_usd: {
    label: '花费 USD',
    render: (ctx) => ({ value: fmtUsd(ctx.costUsd), sub: '按网关汇率' }),
  },
  accounts_ready: {
    label: '就绪账号',
    render: (ctx) => ({
      value: fmtInt(ctx.health.accountsReady) + '/' + fmtInt(ctx.health.accounts),
      sub: 'realm ' + (ctx.health.realm || '-'),
    }),
  },
}

/** Keep only known, de-duplicated ids; empty/invalid input falls back. */
export function normalizeIds(input, allowed, fallback) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : null
  if (!list) return [...fallback]
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const id = String(raw ?? '').trim()
    if (!id || !allowed.includes(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Map finished dashboard rows to the compact shape the panel renders. */
export function trimRecent(rows, limit = 6) {
  const list = Array.isArray(rows) ? rows : []
  return list.slice(0, Math.max(0, limit)).map((row) => {
    const failed = row && typeof row.outcome === 'string' && row.outcome !== 'completed'
    return {
      clock: fmtClock(row && (row.iso || row.at)),
      model: String((row && row.model) || 'unknown'),
      outcome: String((row && row.outcome) || 'unknown'),
      failed,
      tokens: num(row && row.total_tokens),
      tokensText: fmtCompact(row && row.total_tokens),
      elapsedText: fmtSec(row && row.elapsed_ms),
      speedText: row && row.tokens_per_sec ? fmt1(row.tokens_per_sec) + '/s' : '-',
      realm: String((row && row.realm) || ''),
      stream: Boolean(row && row.stream),
    }
  })
}

/** Map gateway accounts to a display list: ready ones first, then by credits. */
export function trimAccounts(accounts, limit = 6) {
  const list = Array.isArray(accounts) ? accounts.filter((a) => a && a.uid) : []
  const mapped = list.map((account) => {
    const credits = account.credits && typeof account.credits === 'object' ? account.credits : {}
    const remain = num(credits.remain)
    const size = num(credits.size)
    return {
      nickname: String(account.nickname || account.uid).slice(0, 24),
      realm: String(account.realm || ''),
      enabled: account.enabled !== false,
      cooldown: Boolean(account.inCooldown),
      ready: account.enabled !== false && !account.inCooldown,
      remain,
      size,
      remainText: fmtCompact(remain),
      sizeText: fmtCompact(size),
      usedPct: size > 0 ? pctOf(size - remain, size) : 0,
    }
  })
  mapped.sort((a, b) => Number(b.ready) - Number(a.ready) || b.remain - a.remain)
  return mapped.slice(0, Math.max(0, limit))
}

/** Reduce the timeseries payload to a compact point list (≤ 60 points). */
export function trimSeries(series, limit = 60) {
  const points = Array.isArray(series && series.series) ? series.series : []
  const cleaned = points
    .map((point) => ({ at: num(point && point.at), tokens: num(point && point.total_tokens), requests: num(point && point.requests) }))
    .filter((point) => point.at > 0)
    .sort((a, b) => a.at - b.at)
  const capped = cleaned.length > limit ? cleaned.slice(cleaned.length - limit) : cleaned
  let max = 0
  let total = 0
  for (const point of capped) {
    if (point.tokens > max) max = point.tokens
    total += point.tokens
  }
  return {
    points: capped.map((point) => ({ at: point.at, tokens: point.tokens, requests: point.requests, label: fmtHourMinute(point.at) })),
    max,
    total,
    bucketSeconds: num(series && series.bucket_seconds),
    empty: capped.length === 0,
  }
}

/** Map the scheduler payload to a display shape. */
export function trimScheduler(scheduler) {
  const data = scheduler && typeof scheduler === 'object' ? scheduler : {}
  const running = data.enabled === true
  return {
    enabled: running,
    mode: String(data.mode || ''),
    modeText: String(data.mode_cn || data.mode_intl || data.mode || (running ? '' : '未运行')),
    last: fmtClock(data.last_run_time),
    next: fmtClock(data.next_run_time),
    message: String(data.msg || ''),
  }
}

/**
 * Build the snapshot document.
 *
 * @param {object} input
 * @param {object} [input.health]   /health payload
 * @param {object} [input.analytics] /usage/analytics payload
 * @param {object} [input.series]   /usage/timeseries payload
 * @param {object} [input.recent]   /usage/recent payload
 * @param {object} [input.accountsPayload] /accounts payload
 * @param {object} [input.scheduler] /scheduler payload
 * @param {string} [input.range]    statistics range
 * @param {string[]} [input.cards]  KPI card ids
 * @param {string[]} [input.panels] panel ids
 * @param {string|null} [input.error] failure message when the gateway is unreachable
 * @param {number} [input.now]      epoch ms
 */
export function buildSnapshot(input = {}) {
  const now = num(input.now) || Date.now()
  const healthPayload = input.health && typeof input.health === 'object' ? input.health : {}
  const analytics = input.analytics && typeof input.analytics === 'object' ? input.analytics : {}
  const window = windowOf(analytics)
  const accounts = Array.isArray(input.accountsPayload && input.accountsPayload.accounts)
    ? input.accountsPayload.accounts
    : []
  const recentRows = Array.isArray(input.recent && input.recent.rows) ? input.recent.rows : []
  const cards = normalizeIds(input.cards, KPI_IDS, DEFAULT_CARDS)
  const panels = normalizeIds(input.panels, PANEL_IDS, DEFAULT_PANELS)
  const error = typeof input.error === 'string' && input.error ? input.error : null
  const credit = creditRemain(accounts)
  const usdCny = num(analytics.usd_cny) || 7.2
  const health = {
    ok: healthPayload.ok === true && !error,
    realm: String(healthPayload.realm || ''),
    accounts: num(healthPayload.accounts),
    accountsReady: num(healthPayload.accounts_ready),
    apiKeyRequired: healthPayload.api_key_required === true,
    cryptoOk: healthPayload.crypto_ok !== false,
  }
  const ctx = {
    window,
    analytics,
    health,
    accounts,
    recent: recentRows,
    credit,
    peakSpeed: peakSpeed(recentRows),
    successPct: successPct(window),
    reasoningRatio: pctOf(window.reasoning_tokens, window.completion_tokens),
    costUsd: num(window.cost_cny) / usdCny,
    usdCny,
  }

  const kpis = cards.map((id) => {
    const entry = KPI_CATALOG[id]
    const rendered = entry.render(ctx)
    return { id, label: entry.label, value: rendered.value, sub: rendered.sub }
  })

  return {
    ok: !error,
    error,
    at: new Date(now).toISOString(),
    atClock: fmtTimeOfDay(now),
    range: String(input.range || 'today'),
    rangeLabel: String(input.rangeLabel || ''),
    realm: health.realm,
    health,
    window: {
      requests: num(window.requests),
      errors: num(window.errors),
      totalTokens: num(window.total_tokens),
      totalTokensText: fmtCompact(window.total_tokens),
      costCny: num(window.cost_cny),
      costText: fmtMoney(window.cost_cny),
      cacheHitPct: num(window.cache_hit_pct),
      speedAvg: num(window.speed_avg),
      usdCny,
    },
    kpis,
    trend: trimSeries(input.series),
    recent: trimRecent(recentRows, num(input.recentLimit) || 6),
    accounts: trimAccounts(accounts, 6),
    scheduler: trimScheduler(input.scheduler),
    cards,
    panels,
    version: String(input.version || ''),
  }
}

/** One-line summary used by the `workbuddy_status` tool. */
export function summarize(snapshot) {
  if (!snapshot) return 'WorkBuddy: 无数据'
  const parts = []
  const window = snapshot.window || {}
  parts.push('区间 ' + (snapshot.rangeLabel || snapshot.range || 'today'))
  parts.push('请求 ' + fmtInt(window.requests))
  parts.push('tokens ' + (window.totalTokensText || '0'))
  parts.push('花费 ' + (window.costText || '¥0.00'))
  parts.push('网关 ' + (snapshot.health && snapshot.health.realm ? snapshot.health.realm : '-') +
    ' 就绪 ' + fmtInt(snapshot.health && snapshot.health.accountsReady) + '/' + fmtInt(snapshot.health && snapshot.health.accounts))
  return parts.join(' · ')
}

/** Multi-line text block for the `workbuddy_status` tool. */
export function renderStatusText(snapshot) {
  if (!snapshot) return 'WorkBuddy 网关没有返回数据。'
  const lines = []
  lines.push('WorkBuddy 数据看板 · ' + (snapshot.rangeLabel || snapshot.range) + ' · ' + (snapshot.atClock || ''))
  if (snapshot.error) lines.push('离线：' + snapshot.error)
  lines.push('')
  for (const kpi of snapshot.kpis || []) lines.push('- ' + kpi.label + ': ' + kpi.value + ' (' + kpi.sub + ')')
  const trend = snapshot.trend || { points: [] }
  if (trend.points && trend.points.length) {
    lines.push('')
    lines.push('趋势：' + trend.points.length + ' 个桶，峰值 ' + fmtCompact(trend.max) + ' tokens/桶')
  }
  const scheduler = snapshot.scheduler || {}
  if (scheduler.enabled || scheduler.modeText) {
    lines.push('')
    lines.push('排程：' + (scheduler.modeText || '-') + ' · 上次 ' + (scheduler.last || '-') + ' · 下次 ' + (scheduler.next || '-'))
  }
  return lines.join('\n')
}
