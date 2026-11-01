import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
  ANCHORS,
  applyMigrations,
  loadPrefs,
  mergePrefs,
  normalizePrefs,
  resolvePrefsFile,
  sanitizePatch,
  savePrefs,
  SNAP_MAX,
  SNAP_MIN,
} from '../lib/prefs.js'
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
  // 积分消耗: consumed credits for the window, with the remaining pool as hint.
  const creditUsed = snapshot.kpis.find((k) => k.id === 'credit_used')
  assert.equal(creditUsed.label, '积分消耗')
  assert.equal(creditUsed.value, '21.6')
  assert.equal(creditUsed.sub, '剩 27K')
  assert.equal(snapshot.window.costText, '¥1.37')
  assert.equal(snapshot.trend.points.length, 2)
  assert.equal(snapshot.recent.length, 6)
  assert.equal(snapshot.accounts.length, 6)
  assert.equal(snapshot.cards.length, DEFAULT_CARDS.length)
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

/* ------------------------------------------------------------------- prefs */

test('normalizePrefs clamps values and keeps an explicit empty selection', () => {
  const defaults = {
    cards: ['tokens'],
    panels: ['trend'],
    opacity: 0.94,
    refreshMs: 10000,
    range: 'today',
    snap: true,
    snapDistance: 24,
    anchor: 'header',
  }
  const prefs = normalizePrefs(
    {
      cards: ['cost', 'cost', 'nope', ' cache '],
      panels: [],
      opacity: 3,
      refreshMs: 5,
      range: 'bogus',
      snap: 'yes',
      snapDistance: -9,
      anchor: 'sideways',
    },
    defaults,
  )
  assert.deepEqual(prefs.cards, ['cost', 'cache'], 'duplicates, unknown ids and blanks are dropped')
  assert.deepEqual(prefs.panels, [], 'an explicit empty panel list survives')
  assert.equal(prefs.opacity, 1)
  assert.equal(prefs.refreshMs, 3000)
  assert.equal(prefs.range, 'today')
  assert.equal(prefs.snap, true, 'only `false` disables snapping')
  assert.equal(prefs.snapDistance, SNAP_MIN)
  assert.equal(prefs.anchor, 'header', 'an unknown anchor falls back to the default')

  assert.deepEqual(normalizePrefs({}, defaults), defaults, 'an empty object keeps the defaults')

  for (const anchor of ANCHORS) {
    assert.equal(normalizePrefs({ anchor }, defaults).anchor, anchor, `the ${anchor} position is accepted`)
  }
  assert.deepEqual(
    ANCHORS,
    ['header', 'bottom-left', 'bottom-right', 'float'],
    'every anchored corner and the free float stay configurable',
  )
})

test('sanitizePatch keeps only known keys with acceptable types', () => {
  const patch = sanitizePatch({
    cards: 'tokens,cost',
    panels: ['recent'],
    opacity: '0.7',
    refreshMs: 30000,
    range: 'week',
    snap: false,
    snapDistance: 12,
    anchor: 'float',
    nope: 'ignored',
    panelOpen: false,
  })
  assert.deepEqual(Object.keys(patch).sort(), [
    'anchor',
    'cards',
    'opacity',
    'panels',
    'range',
    'refreshMs',
    'snap',
    'snapDistance',
  ])
  assert.equal(patch.cards, 'tokens,cost')
  assert.equal(patch.opacity, 0.7)
  assert.equal(patch.anchor, 'float')

  assert.deepEqual(sanitizePatch({ snap: 'yes', cards: 5, opacity: {}, panels: 3 }), {}, 'wrong types are dropped')
  assert.deepEqual(sanitizePatch({ anchor: 'diagonal' }), {}, 'an unknown position is dropped')
  assert.deepEqual(sanitizePatch({ anchor: 'bottom-left' }), { anchor: 'bottom-left' }, 'a corner position passes')
})

test('savePrefs writes atomically and loadPrefs tolerates a broken file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wbdash-prefs-'))
  const file = join(dir, 'nested', 'prefs.json')
  const prefs = normalizePrefs({ cards: ['cost'], panels: [], opacity: 0.66, snapDistance: 30 })

  assert.equal(savePrefs(file, prefs), true)
  assert.deepEqual(await readdir(dirname(file)), ['prefs.json'], 'no temp file is left behind')

  const loaded = loadPrefs(file)
  assert.deepEqual(loaded.prefs, prefs)
  assert.equal(loaded.stored, true)

  await writeFile(file, '{ broken json')
  const recovered = loadPrefs(file)
  assert.equal(recovered.stored, false)
  assert.deepEqual(recovered.prefs.cards, DEFAULT_CARDS, 'a corrupt file falls back to the defaults')
})

test('resolvePrefsFile maps the config knobs onto real paths', () => {
  assert.match(resolvePrefsFile({}), /dsh-workbuddy-dashboard[\\/]prefs\.json$/)
  assert.equal(resolvePrefsFile({ prefsPath: ':memory:' }), '')
  assert.equal(resolvePrefsFile({ prefsPath: 'off' }), '')
  assert.match(resolvePrefsFile({ prefsPath: 'C:/data/' }), /prefs\.json$/)
  assert.equal(resolvePrefsFile({ prefsPath: 'C:/data/custom.json' }), 'C:/data/custom.json')
})

test('mergePrefs applies a patch on top of the current selection', () => {
  const current = normalizePrefs({ cards: ['tokens', 'cost'], panels: ['trend'], opacity: 0.9 })
  const merged = mergePrefs(current, { cards: ['errors'], snapDistance: 500 })
  assert.deepEqual(merged.cards, ['errors'])
  assert.deepEqual(merged.panels, ['trend'], 'untouched keys survive the patch')
  assert.equal(merged.opacity, 0.9)
  assert.equal(merged.snapDistance, SNAP_MAX, 'out of range values are clamped, not rejected')
})

test('applyMigrations offers a new card to an older selection exactly once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wbdash-migrate-'))
  const file = join(dir, 'prefs.json')
  const old = normalizePrefs({ cards: ['tokens', 'cost'], panels: [] })
  assert.equal(old.cards.includes('credit_used'), false)
  savePrefs(file, old)

  const loaded = loadPrefs(file)
  const migrated = applyMigrations(file, loaded.prefs, loaded.stored)
  assert.deepEqual(migrated.cards, ['tokens', 'cost', 'credit_used'])

  const persisted = loadPrefs(file)
  assert.deepEqual(persisted.prefs.cards, ['tokens', 'cost', 'credit_used'], 'the migration is saved')

  // Once the user removes the card again, the marker keeps it removed.
  savePrefs(file, normalizePrefs({ cards: ['tokens'], panels: [] }))
  const again = loadPrefs(file)
  const untouched = applyMigrations(file, again.prefs, again.stored)
  assert.deepEqual(untouched.cards, ['tokens'], 'a deliberate removal is respected')

  // A brand new install never triggers the migration path.
  assert.deepEqual(applyMigrations('', normalizePrefs({ carts: [] }), false).cards, DEFAULT_CARDS)
})
