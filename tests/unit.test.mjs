import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  bucketFor,
  normalizeRange,
  rangeQuery,
  RANGES,
} from '../lib/gateway.js'
import { guardRequest, hostNameOf, parseTrustedHosts } from '../lib/guard.js'
import {
  buildSnapshot,
  DEFAULT_CARDS,
  KPI_IDS,
  normalizeIds,
  PANEL_IDS,
  trimAccounts,
  trimRecent,
  trimSeries,
} from '../lib/snapshot.js'
import {
  fmtCompact,
  fmtClock,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSec,
  pctOf,
} from '../lib/format.js'

const here = dirname(fileURLToPath(import.meta.url))

async function fixture(name) {
  return JSON.parse(await readFile(join(here, 'fixtures', name), 'utf8'))
}

/* ------------------------------------------------------------------ format */

test('fmtCompact matches the desktop widget magnitudes', () => {
  assert.equal(fmtCompact(0), '0')
  assert.equal(fmtCompact(999), '999')
  assert.equal(fmtCompact(1234), '1.2K')
  assert.equal(fmtCompact(1000000), '1M')
  assert.equal(fmtCompact(12960516), '13M')
  assert.equal(fmtCompact(1500000000), '1.5B')
  assert.equal(fmtCompact('nope'), '0')
})

test('fmtSec renders ms, seconds and minutes', () => {
  assert.equal(fmtSec(0), '0ms')
  assert.equal(fmtSec(850), '850ms')
  assert.equal(fmtSec(1234), '1.2s')
  assert.equal(fmtSec(59999), '60s')
  assert.equal(fmtSec(95000), '1m35s')
  assert.equal(fmtSec(60000), '1m00s')
})

test('number, money, percent and clock formatting', () => {
  assert.equal(fmtInt(12960516), '12,960,516')
  assert.equal(fmtMoney(1.371226), '¥1.37')
  assert.equal(fmtPct(96.1), '96.1%')
  assert.equal(fmtClock('2026-11-01T08:49:04'), '08:49:04')
  assert.equal(fmtClock('2026-11-01 08:49:04'), '08:49:04')
  assert.equal(fmtClock(''), '')
  assert.equal(pctOf(1, 4), 25)
  assert.equal(pctOf(1, 0), 0)
})

/* ----------------------------------------------------------------- gateway */

test('range query strings cover presets and explicit windows', () => {
  assert.equal(normalizeRange('TODAY'), 'today')
  assert.equal(normalizeRange('bogus'), 'today')
  assert.equal(rangeQuery('today'), 'range=today')
  assert.equal(rangeQuery('week'), 'range=week')
  assert.equal(rangeQuery('month'), 'range=month')
  const now = 1_800_000_000
  assert.equal(rangeQuery('d3', now), 'range=custom&since=' + (now - 3 * 86400) + '&until=' + now)
  assert.equal(rangeQuery('d30', now), 'range=custom&since=' + (now - 30 * 86400) + '&until=' + now)
  assert.ok(rangeQuery('all', now).includes('range=custom'))
  assert.equal(bucketFor('today'), 3600)
  assert.equal(bucketFor('month'), 86400)
  assert.deepEqual(RANGES, ['today', 'd3', 'week', 'month', 'd30', 'all'])
})

/* ------------------------------------------------------------------- guard */

test('request guard only trusts loopback and explicit hosts', () => {
  assert.deepEqual(parseTrustedHosts('a.local, b.local;c.local'), ['a.local', 'b.local', 'c.local'])
  assert.equal(hostNameOf('127.0.0.1:3080'), '127.0.0.1')
  assert.equal(hostNameOf('[::1]:3080'), '[::1]')

  assert.equal(guardRequest({ headers: { host: '127.0.0.1:3080' } }).ok, true)
  assert.equal(guardRequest({ headers: { host: 'localhost:3080' } }).ok, true)
  assert.equal(guardRequest({ headers: {} }).ok, false)
  assert.equal(guardRequest({ headers: { host: 'evil.example.com' } }).ok, false)
  assert.equal(
    guardRequest({ headers: { host: 'evil.example.com' } }, { trustedHosts: ['evil.example.com'] }).ok,
    true,
  )

  const crossSite = guardRequest({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossSite.ok, false)
  assert.match(crossSite.reason, /cross-site/)

  const crossOrigin = guardRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://evil.test' } })
  assert.equal(crossOrigin.ok, false)

  assert.equal(
    guardRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }).ok,
    true,
  )
})

/* ---------------------------------------------------------------- snapshot */

test('normalizeIds keeps known ids, drops duplicates and unknown ids', () => {
  assert.deepEqual(normalizeIds(undefined, KPI_IDS, DEFAULT_CARDS), DEFAULT_CARDS)
  assert.deepEqual(normalizeIds(['tokens', 'bogus', 'tokens'], KPI_IDS, DEFAULT_CARDS), ['tokens'])
  assert.deepEqual(normalizeIds('cost,requests', KPI_IDS, DEFAULT_CARDS), ['cost', 'requests'])
  assert.deepEqual(normalizeIds([], KPI_IDS, DEFAULT_CARDS), [])
  assert.deepEqual(normalizeIds(['trend'], PANEL_IDS, PANEL_IDS), ['trend'])
})

test('trimSeries sorts, caps and summarises points', () => {
  const series = {
    bucket_seconds: 3600,
    series: [
      { at: 300, total_tokens: 10, requests: 1 },
      { at: 100, total_tokens: 5, requests: 1 },
      { at: 200, total_tokens: 20, requests: 2 },
      { at: 400, total_tokens: 1, requests: 1 },
    ],
  }
  const trimmed = trimSeries(series, 3)
  assert.deepEqual(trimmed.points.map((p) => p.at), [200, 300, 400])
  assert.equal(trimmed.max, 20)
  assert.equal(trimmed.total, 31)
  assert.equal(trimmed.empty, false)
  assert.equal(trimSeries({}).empty, true)
})

test('trimRecent maps rows and flags failures', () => {
  const rows = [
    { iso: '2026-11-01T08:49:04', model: 'm1', outcome: 'completed', total_tokens: 1294, elapsed_ms: 2128, tokens_per_sec: 326.71, stream: true },
    { iso: '2026-11-01T08:48:00', model: 'm2', outcome: 'failed', total_tokens: 0, elapsed_ms: 300 },
  ]
  const trimmed = trimRecent(rows)
  assert.equal(trimmed.length, 2)
  assert.equal(trimmed[0].clock, '08:49:04')
  assert.equal(trimmed[0].tokensText, '1.3K')
  assert.equal(trimmed[0].elapsedText, '2.1s')
  assert.equal(trimmed[0].speedText, '326.7/s')
  assert.equal(trimmed[1].failed, true)
  assert.equal(trimmed[1].speedText, '-')
})

test('trimAccounts sorts ready accounts first, then by credits', () => {
  const accounts = [
    { uid: 'b', nickname: 'cool', realm: 'cn', enabled: true, inCooldown: true, credits: { remain: 900, size: 1000 } },
    { uid: 'a', nickname: 'ready', realm: 'cn', enabled: true, inCooldown: false, credits: { remain: 10, size: 100 } },
    { uid: 'c', nickname: 'off', realm: 'intl', enabled: false, inCooldown: false, credits: { remain: 500, size: 500 } },
    { nickname: 'no-uid' },
  ]
  const trimmed = trimAccounts(accounts)
  assert.deepEqual(trimmed.map((a) => a.nickname), ['ready', 'cool', 'off'])
  assert.equal(trimmed[0].ready, true)
  assert.equal(trimmed[1].cooldown, true)
  assert.equal(trimmed[0].usedPct, 90)
})

test('buildSnapshot assembles the dashboard document from fixtures', async () => {
  const [health, analytics, series, recent, accounts, scheduler] = await Promise.all([
    fixture('health.json'),
    fixture('analytics.json'),
    fixture('timeseries.json'),
    fixture('recent.json'),
    fixture('accounts.json'),
    fixture('scheduler.json'),
  ])
  const snapshot = buildSnapshot({
    health,
    analytics,
    series,
    recent,
    accountsPayload: accounts,
    scheduler,
    range: 'today',
    rangeLabel: '今日',
    now: Date.parse('2026-11-01T08:50:00'),
    version: '0.1.0',
  })

  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.error, null)
  assert.equal(snapshot.atClock, '08:50:00')
  assert.equal(snapshot.health.realm, 'cn')
  assert.equal(snapshot.health.accounts, 7)
  assert.equal(snapshot.health.accountsReady, 4)
  assert.deepEqual(snapshot.kpis.map((k) => k.id), DEFAULT_CARDS)
  const tokens = snapshot.kpis.find((k) => k.id === 'tokens')
  assert.equal(tokens.value, '17M')
  assert.equal(tokens.sub, '16,962,732 tokens')
  const requests = snapshot.kpis.find((k) => k.id === 'requests')
  assert.equal(requests.value, '133')
  assert.equal(snapshot.window.costText, '¥1.37')
  assert.equal(snapshot.trend.points.length, 2)
  assert.equal(snapshot.recent.length, 6)
  assert.equal(snapshot.accounts.length, 6)
  assert.equal(snapshot.cards.length, 6)
  assert.deepEqual(snapshot.panels, PANEL_IDS)
})

test('buildSnapshot degrades gracefully when the gateway is down', () => {
  const snapshot = buildSnapshot({ error: 'connect ECONNREFUSED 127.0.0.1:8788', range: 'd3' })
  assert.equal(snapshot.ok, false)
  assert.match(snapshot.error, /ECONNREFUSED/)
  assert.equal(snapshot.kpis.length, DEFAULT_CARDS.length)
  assert.equal(snapshot.kpis[0].value, '0')
  assert.deepEqual(snapshot.recent, [])
  assert.equal(snapshot.trend.empty, true)
  assert.equal(snapshot.health.ok, false)
})

test('buildSnapshot honours custom card and panel selections', async () => {
  const analytics = await fixture('analytics.json')
  const snapshot = buildSnapshot({
    analytics,
    cards: ['cost', 'cache', 'accounts_ready', 'nope'],
    panels: ['trend'],
  })
  assert.deepEqual(snapshot.kpis.map((k) => k.id), ['cost', 'cache', 'accounts_ready'])
  assert.deepEqual(snapshot.panels, ['trend'])
  assert.equal(snapshot.kpis[2].value, '0/0')
})
