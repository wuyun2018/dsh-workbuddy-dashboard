/**
 * Live smoke test against a running WorkBuddy gateway.
 *
 *   node --test tests/live.test.mjs
 *
 * Skipped automatically when no gateway answers on the configured URL, so the
 * suite stays green on machines without one. Override with
 *   WB_GATEWAY_URL=http://127.0.0.1:8788 WB_GATEWAY_PASSWORD=admin
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createGatewayClient } from '../lib/gateway.js'
import { buildSnapshot, KPI_IDS, PANEL_IDS } from '../lib/snapshot.js'

const baseUrl = process.env.WB_GATEWAY_URL || 'http://127.0.0.1:8788'
const password = process.env.WB_GATEWAY_PASSWORD || 'admin'

async function probe() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const response = await fetch(baseUrl + '/health', { signal: controller.signal })
    clearTimeout(timer)
    return response.ok
  } catch {
    return false
  }
}

const reachable = await probe()
const skip = reachable ? false : 'gateway not reachable at ' + baseUrl

test('live: health and login round-trip', { skip }, async () => {
  const client = createGatewayClient({ baseUrl, password })
  const health = await client.health()
  assert.equal(health.ok, true)
  assert.equal(typeof health.realm, 'string')
  const token = await client.login()
  assert.equal(token.length, 32)
  assert.equal(client.stats.logins, 1)
})

test('live: analytics and timeseries agree on shape', { skip }, async () => {
  const client = createGatewayClient({ baseUrl, password })
  const analytics = await client.analytics('today')
  assert.ok(analytics.window && analytics.summary, 'analytics carries window + summary')
  assert.equal(typeof analytics.summary.window.requests, 'number')

  const series = await client.timeseries('today')
  assert.ok(Array.isArray(series.series))
  assert.ok([60, 3600, 86400].includes(series.bucket_seconds))
  for (let i = 1; i < series.series.length; i += 1) {
    assert.ok(series.series[i].at >= series.series[i - 1].at, 'series is time ordered')
  }
})

test('live: recent, accounts and scheduler respond', { skip }, async () => {
  const client = createGatewayClient({ baseUrl, password })
  const recent = await client.recent({ limit: 5 })
  assert.ok(Array.isArray(recent.rows))
  for (const row of recent.rows) assert.match(row.iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)

  const accounts = await client.accounts()
  assert.ok(Array.isArray(accounts.accounts))
  for (const account of accounts.accounts) assert.equal(typeof account.uid, 'string')

  const scheduler = await client.scheduler()
  assert.equal(typeof scheduler.enabled, 'boolean')
})

test('live: buildSnapshot produces a complete dashboard document', { skip }, async () => {
  const client = createGatewayClient({ baseUrl, password })
  const [health, analytics, series, recent, accounts, scheduler] = await Promise.all([
    client.health(),
    client.analytics('today'),
    client.timeseries('today'),
    client.recent({ limit: 8 }),
    client.accounts(),
    client.scheduler(),
  ])
  const snapshot = buildSnapshot({
    range: 'today',
    health,
    analytics,
    series,
    recent,
    accounts,
    scheduler,
    cards: ['tokens', 'requests', 'speed', 'cache', 'cost', 'success'],
    panels: PANEL_IDS,
  })
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.error, null)
  assert.equal(snapshot.kpis.length, 6)
  for (const kpi of snapshot.kpis) assert.ok(KPI_IDS.includes(kpi.id))
  assert.equal(snapshot.panels.length, PANEL_IDS.length)
  assert.ok(snapshot.trend.points.length >= 0)
  assert.ok(snapshot.recent.length <= 8)
})

test('live: no sensitive row fields leak into the snapshot', { skip }, async () => {
  const client = createGatewayClient({ baseUrl, password })
  const recent = await client.recent({ limit: 8 })
  const snapshot = buildSnapshot({ range: 'today', recent, panels: PANEL_IDS })
  const text = JSON.stringify(snapshot)
  for (const field of ['msgs_sha', 'system_sha', 'prefix_sha', 'key_name', 'cost_policy', 'cost_source']) {
    assert.equal(text.includes(field), false, 'snapshot must not carry ' + field)
  }
})
