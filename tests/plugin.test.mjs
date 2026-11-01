import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { apply, Config, normalizeConfig } from '../lib/index.js'
import { DEFAULT_CARDS, KPI_IDS } from '../lib/snapshot.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureCache = new Map()

/**
 * Build the config for one test. `prefsPath: ':memory:'` keeps tests away from
 * the real `%LOCALAPPDATA%/dsh-workbuddy-dashboard/prefs.json`, which would
 * otherwise make assertions depend on whatever was saved last.
 */
function testConfig(overrides = {}) {
  return Object.assign({ baseUrl: 'http://gw.test:8788', prefsPath: ':memory:' }, overrides)
}

async function fixture(name) {
  if (!fixtureCache.has(name)) {
    fixtureCache.set(name, JSON.parse(await readFile(join(here, 'fixtures', name), 'utf8')))
  }
  return fixtureCache.get(name)
}

function response(status, body) {
  const text = JSON.stringify(body)
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    json: async () => body,
  }
}

/** Fake cordis context capturing routes, listeners, tools and effects. */
function createFakeCtx() {
  const routes = new Map()
  const listeners = new Map()
  const tools = []
  const disposers = []
  const logs = []
  const taps = []

  const ctx = {
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    on(event, handler) {
      listeners.set(event, handler)
    },
    logger(scope) {
      return {
        info: (message) => logs.push({ level: 'info', scope, message }),
        warn: (message) => logs.push({ level: 'warn', scope, message }),
        error: (message) => logs.push({ level: 'error', scope, message }),
      }
    },
    webServer: {
      register(spec) {
        routes.set(spec.path, spec)
        return () => routes.delete(spec.path)
      },
      tapIndex(transform) {
        taps.push(transform)
        return () => {}
      },
    },
    tools: {
      register(definition) {
        tools.push(definition)
      },
    },
  }

  return { ctx, routes, listeners, tools, disposers, logs, taps }
}

function fakeRequest(path, { query = '', headers = {} } = {}) {
  return {
    url: path + query,
    headers: { host: '127.0.0.1:3080', ...headers },
  }
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value
    },
    end(body) {
      this.body = body === undefined ? '' : String(body)
    },
    json() {
      return JSON.parse(this.body)
    },
  }
}

async function call(route, path, options) {
  const res = fakeResponse()
  await route.handler(fakeRequest(path, options), res)
  return res
}

/** Request stub with a JSON body, enough for the prefs PUT handler. */
function bodyRequest(method, path, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = path
  req.headers = { host: '127.0.0.1:3080', 'content-type': 'application/json' }
  req.destroy = () => {}
  const text = body === undefined ? '' : JSON.stringify(body)
  process.nextTick(() => {
    if (text) req.emit('data', Buffer.from(text, 'utf8'))
    req.emit('end')
  })
  return req
}

async function callWithBody(route, path, method, body) {
  const res = fakeResponse()
  await route.handler(bodyRequest(method, path, body), res)
  return res
}

/** Install a fetch stub backed by the fixtures and return the call log. */
async function installGatewayStub(overrides = {}) {
  const calls = []
  const handlers = {
    '/health': async () => response(200, await fixture('health.json')),
    '/panel/login': async () => response(200, { ok: true, token: 'panel-token-1', using_default_password: false }),
    '/usage/analytics': async () => response(200, await fixture('analytics.json')),
    '/usage/timeseries': async () => response(200, await fixture('timeseries.json')),
    '/usage/recent': async () => response(200, await fixture('recent.json')),
    '/accounts': async () => response(200, await fixture('accounts.json')),
    '/scheduler': async () => response(200, await fixture('scheduler.json')),
    ...overrides,
  }
  const stub = async (url, options = {}) => {
    const text = String(url)
    const path = text.replace(/^http:\/\/gw\.test:\d+/, '')
    const base = path.split('?')[0]
    const entry = { url: text, path, base, method: (options.method || 'GET').toUpperCase(), headers: options.headers || {} }
    calls.push(entry)
    const handler = handlers[base]
    if (!handler) throw new Error('unexpected request: ' + text)
    return handler(entry, calls)
  }
  globalThis.fetch = stub
  return calls
}

function restoreFetch() {
  delete globalThis.fetch
}

test('normalizeConfig applies defaults and validates ids', () => {
  const defaults = normalizeConfig()
  assert.equal(defaults.baseUrl, 'http://127.0.0.1:8788')
  assert.equal(defaults.range, 'today')
  assert.equal(defaults.refreshMs, 10000)
  assert.deepEqual(defaults.cards, DEFAULT_CARDS)
  assert.deepEqual(defaults.panels, ['trend', 'recent', 'accounts', 'scheduler'])
  assert.equal(defaults.showPanel, true)
  assert.equal(defaults.opacity, 0.94)

  const custom = normalizeConfig({
    baseUrl: 'http://127.0.0.1:9999/',
    range: 'week',
    refreshMs: 10,
    cards: ['cost', 'nope', 'cost'],
    panels: [],
    showPanel: false,
    trustedHosts: 'dsh.local',
  })
  assert.equal(custom.baseUrl, 'http://127.0.0.1:9999')
  assert.equal(custom.range, 'week')
  assert.equal(custom.refreshMs, 3000, 'refreshMs is clamped to the minimum')
  assert.deepEqual(custom.cards, ['cost'])
  assert.deepEqual(custom.panels, [])
  assert.equal(custom.showPanel, false)
  assert.deepEqual(custom.trustedHosts, ['dsh.local'])
})

test('Config schema is present when schemastery resolves', () => {
  // In a plain node process @deepseek-ai/schemastery is unresolvable, so the
  // plugin must still load; inside DSH the schema exists.
  if (Config === undefined) {
    assert.ok(true)
    return
  }
  assert.equal(typeof Config, 'function')
})

test('plugin registers routes, tools and the index injection', async () => {
  const calls = await installGatewayStub()
  const { ctx, routes, listeners, tools, disposers } = createFakeCtx()
  const app = apply(ctx, testConfig())
  try {
    await app.getSnapshot('today', { force: true })

    assert.deepEqual([...routes.keys()].sort(), [
      '/workbuddy/api/config',
      '/workbuddy/api/health',
      '/workbuddy/api/prefs',
      '/workbuddy/api/snapshot',
      '/workbuddy/panel.js',
    ])

    const table = []
    const inject = listeners.get('webserver/index-inject')
    assert.equal(typeof inject, 'function')
    inject(table)
    assert.equal(table.length, 1)
    assert.equal(table[0].kind, 'script')
    assert.equal(table[0].placement, 'body')
    assert.match(table[0].text, /wb-dash-panel-boot/)
    assert.match(table[0].text, /\/panel\.js\?v=/)

    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'workbuddy_accounts',
      'workbuddy_recent',
      'workbuddy_status',
    ])

    // dsh-tools compiles `parameters` as an author-side property map (one value
    // schema per argument) and rejects a raw JSON Schema object at the root.
    for (const tool of tools) {
      assert.equal(Object.hasOwn(tool.parameters || {}, 'type'), false, tool.name + ' uses a property map')
      assert.equal(Object.hasOwn(tool.parameters || {}, 'properties'), false, tool.name + ' has no nested properties')
      for (const [key, schema] of Object.entries(tool.parameters || {})) {
        assert.equal(typeof schema.type, 'string', tool.name + '.' + key + ' declares a type')
        for (const banned of ['minimum', 'maximum', 'additionalProperties']) {
          assert.equal(Object.hasOwn(schema, banned), false, tool.name + '.' + key + ' must not use ' + banned)
        }
      }
    }

    // one login, then the six data endpoints
    assert.equal(calls.filter((call) => call.base === '/panel/login').length, 1)
    assert.equal(calls.filter((call) => call.base === '/usage/analytics').length, 1)
    const firstAuth = calls.find((call) => call.base !== '/health')
    assert.equal(firstAuth.base, '/panel/login', 'login happens before authenticated reads')
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('snapshot route serves the dashboard document', async () => {
  await installGatewayStub()
  const { ctx, routes, disposers } = createFakeCtx()
  const app = apply(ctx, testConfig())
  try {
    await app.getSnapshot('today', { force: true })
    const res = await call(routes.get('/workbuddy/api/snapshot'), '/workbuddy/api/snapshot', { query: '?range=today' })
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'], /application\/json/)
    assert.equal(res.headers['cache-control'], 'no-store')
    const body = res.json()
    assert.equal(body.ok, true)
    assert.equal(body.range, 'today')
    assert.equal(body.kpis.length, DEFAULT_CARDS.length)
    assert.equal(body.health.realm, 'cn')
    assert.equal(body.recent.length, 6)
    assert.ok(body.trend.points.length >= 1)
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('prefs route stores the view and rebuilds the snapshot', async () => {
  await installGatewayStub()
  const { ctx, routes, disposers } = createFakeCtx()
  // :memory: keeps the test away from the real %LOCALAPPDATA% file.
  const app = apply(ctx, testConfig())
  try {
    const initial = await call(routes.get('/workbuddy/api/prefs'), '/workbuddy/api/prefs')
    assert.equal(initial.statusCode, 200)
    const first = initial.json()
    assert.deepEqual(first.prefs.cards, DEFAULT_CARDS)
    assert.deepEqual(first.prefs.panels, ['trend', 'recent', 'accounts', 'scheduler'])
    assert.equal(first.prefs.snap, true)
    assert.equal(first.prefs.anchor, 'header', 'the panel anchors in the conversation header by default')
    assert.equal(first.catalog.kpis.length, KPI_IDS.length)
    assert.equal(first.catalog.panels.length, 4)

    const updated = await callWithBody(routes.get('/workbuddy/api/prefs'), '/workbuddy/api/prefs', 'PUT', {
      cards: ['cost', 'errors'],
      panels: ['recent'],
      opacity: 0.7,
      refreshMs: 30000,
      range: 'week',
      snap: false,
      snapDistance: 200,
      anchor: 'float',
      nope: 'ignored',
    })
    assert.equal(updated.statusCode, 200)
    const saved = updated.json()
    assert.deepEqual(saved.prefs.cards, ['cost', 'errors'])
    assert.deepEqual(saved.prefs.panels, ['recent'])
    assert.equal(saved.prefs.opacity, 0.7)
    assert.equal(saved.prefs.refreshMs, 30000)
    assert.equal(saved.prefs.range, 'week')
    assert.equal(saved.prefs.snap, false)
    assert.equal(saved.prefs.snapDistance, 80, 'snap distance is clamped to 80')
    assert.equal(saved.prefs.anchor, 'float', 'the anchor switch is stored')
    assert.equal(Object.hasOwn(saved.prefs, 'nope'), false)

    // The next snapshot renders exactly the saved cards/panels.
    const snapshot = await call(routes.get('/workbuddy/api/snapshot'), '/workbuddy/api/snapshot', { query: '?force=1' })
    const body = snapshot.json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.kpis.map((kpi) => kpi.id), ['cost', 'errors'])
    assert.deepEqual(body.panels, ['recent'])

    const config = await call(routes.get('/workbuddy/api/config'), '/workbuddy/api/config')
    assert.deepEqual(config.json().cards, ['cost', 'errors'])
    assert.equal(config.json().opacity, 0.7)
    assert.equal(config.json().anchor, 'float')

    // Re-reading keeps the corner positions that the settings chips send.
    for (const anchor of ['bottom-left', 'bottom-right', 'header']) {
      const moved = await callWithBody(routes.get('/workbuddy/api/prefs'), '/workbuddy/api/prefs', 'PUT', { anchor })
      assert.equal(moved.statusCode, 200)
      assert.equal(moved.json().prefs.anchor, anchor, `the ${anchor} position round-trips`)
      const reread = await call(routes.get('/workbuddy/api/prefs'), '/workbuddy/api/prefs')
      assert.equal(reread.json().prefs.anchor, anchor, `the ${anchor} position survives a reload`)
    }

    const rejected = await callWithBody(routes.get('/workbuddy/api/prefs'), '/workbuddy/api/prefs', 'DELETE', {})
    assert.equal(rejected.statusCode, 405)
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('config route publishes the UI contract', async () => {
  await installGatewayStub()
  const { ctx, routes, disposers } = createFakeCtx()
  const app = apply(ctx, testConfig({ cards: ['tokens'], panels: ['recent'] }))
  try {
    const res = await call(routes.get('/workbuddy/api/config'), '/workbuddy/api/config')
    const body = res.json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.cards, ['tokens'])
    assert.deepEqual(body.panels, ['recent'])
    assert.equal(body.ranges.length, 6)
    assert.ok(body.version)
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('panel.js route serves the browser bundle', async () => {
  await installGatewayStub()
  const { ctx, routes, disposers } = createFakeCtx()
  const app = apply(ctx, testConfig())
  try {
    const res = await call(routes.get('/workbuddy/panel.js'), '/workbuddy/panel.js')
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'], /text\/javascript/)
    assert.match(res.body, /__WB_PANEL_LOADED__/)
    assert.match(res.body, /wb-dash:v1/)
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('routes reject non-loopback, cross-site and cross-origin callers', async () => {
  await installGatewayStub()
  const { ctx, routes, disposers } = createFakeCtx()
  const app = apply(ctx, testConfig())
  try {
    const route = routes.get('/workbuddy/api/snapshot')
    const evil = await call(route, '/workbuddy/api/snapshot', { headers: { host: 'evil.example.com' } })
    assert.equal(evil.statusCode, 403)
    assert.match(evil.json().error, /untrusted host/)

    const crossSite = await call(route, '/workbuddy/api/snapshot', { headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(crossSite.statusCode, 403)

    const crossOrigin = await call(route, '/workbuddy/api/snapshot', { headers: { origin: 'http://evil.test' } })
    assert.equal(crossOrigin.statusCode, 403)

    const ok = await call(route, '/workbuddy/api/snapshot', { headers: { origin: 'http://127.0.0.1:3080' } })
    assert.equal(ok.statusCode, 200)
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('a rejected panel token triggers exactly one re-login', async () => {
  let rejected = 0
  const calls = await installGatewayStub({
    '/usage/analytics': async () => {
      if (rejected === 0) {
        rejected += 1
        return response(401, { ok: false, error: 'unauthorized' })
      }
      return response(200, await fixture('analytics.json'))
    },
  })
  const { ctx, disposers } = createFakeCtx()
  const app = apply(ctx, testConfig())
  try {
    const snapshot = await app.getSnapshot('today', { force: true })
    assert.equal(snapshot.ok, true)
    assert.equal(snapshot.window.requests, 133, 'the retried analytics payload is used')
    const logins = calls.filter((call) => call.base === '/panel/login')
    assert.equal(logins.length, 2, 'initial login + one re-login')
    const analyticsCalls = calls.filter((call) => call.base === '/usage/analytics')
    assert.equal(analyticsCalls.length, 2)
    assert.equal(analyticsCalls[0].headers['X-Panel-Token'], 'panel-token-1')
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('gateway outage yields an offline snapshot instead of throwing', async () => {
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:8788')
  }
  const { ctx, routes, disposers } = createFakeCtx()
  const app = apply(ctx, testConfig())
  try {
    const snapshot = await app.getSnapshot('today', { force: true })
    assert.equal(snapshot.ok, false)
    assert.match(snapshot.error, /ECONNREFUSED/)
    assert.equal(snapshot.kpis.length, DEFAULT_CARDS.length)

    const res = await call(routes.get('/workbuddy/api/snapshot'), '/workbuddy/api/snapshot')
    assert.equal(res.statusCode, 200)
    assert.equal(res.json().ok, false)

    const health = await call(routes.get('/workbuddy/api/health'), '/workbuddy/api/health')
    const healthBody = health.json()
    assert.equal(healthBody.ok, false)
    assert.match(healthBody.error, /ECONNREFUSED/)
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('status tool renders a readable report', async () => {
  await installGatewayStub()
  const { ctx, tools, disposers } = createFakeCtx()
  apply(ctx, testConfig())
  try {
    const status = tools.find((tool) => tool.name === 'workbuddy_status')
    const text = await status.execute({ range: 'today' })
    assert.match(text, /WorkBuddy 数据看板/)
    assert.match(text, /Tokens/)
    assert.match(text, /请求/)

    const recent = tools.find((tool) => tool.name === 'workbuddy_recent')
    const recentText = await recent.execute({ limit: 3 })
    assert.match(recentText, /最近 3 条请求/)

    const accounts = tools.find((tool) => tool.name === 'workbuddy_accounts')
    const accountsText = await accounts.execute({ limit: 2 })
    assert.match(accountsText, /账号 2 个/)
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('tapIndex fallback injects the panel exactly once', async () => {
  await installGatewayStub()
  const { ctx, taps, disposers } = createFakeCtx()
  apply(ctx, testConfig())
  try {
    assert.equal(taps.length, 1)
    const html = '<html><body><div id="app"></div></body></html>'
    const first = taps[0](html)
    assert.match(first, /wb-dash-panel-boot/)
    assert.ok(first.indexOf('</body>') > first.indexOf('wb-dash-panel-boot'))
    const second = taps[0](first)
    assert.equal(second, first, 'injection is idempotent')
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})

test('showPanel=false disables injection but keeps the routes', async () => {
  await installGatewayStub()
  const { ctx, routes, listeners, taps, disposers } = createFakeCtx()
  apply(ctx, testConfig({ showPanel: false }))
  try {
    assert.equal(listeners.has('webserver/index-inject'), false)
    assert.equal(taps.length, 0)
    assert.ok(routes.has('/workbuddy/api/snapshot'))
  } finally {
    for (const dispose of disposers) dispose()
    restoreFetch()
  }
})
