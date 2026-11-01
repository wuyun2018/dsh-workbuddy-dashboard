/**
 * dsh-workbuddy-dashboard — host plugin.
 *
 * Responsibilities:
 *   1. Poll the local WorkBuddy gateway panel API (analytics, timeseries,
 *      recent requests, accounts, scheduler) and keep a small cache.
 *   2. Publish that cache on loopback-only HTTP routes:
 *        GET /workbuddy/api/snapshot?range=today   full dashboard document
 *        GET /workbuddy/api/health                 lightweight probe
 *        GET /workbuddy/api/config                 card/panel ids for the UI
 *        GET /workbuddy/panel.js                   the floating panel script
 *   3. Inject the floating panel into the web UI (index-inject row + tapIndex
 *      fallback) so no browser tab and no rebuild is needed.
 *   4. Register agent tools so the model can answer "how much did I spend"
 *      questions without a browser too.
 *
 * The plugin has no build step and no runtime dependencies beyond Node 20+,
 * `@deepseek-ai/schemastery` (optional, for the settings form) and
 * `@deepseek-ai/dsh-tools` (optional, for tool definition sugar). Both are
 * imported defensively so the module also loads in a plain `node` process for
 * tests.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createGatewayClient, normalizeRange, RANGES, RANGE_LABELS } from './gateway.js'
import { guardRequest, parseTrustedHosts } from './guard.js'
import {
  defaultsFromConfig,
  loadPrefs,
  mergePrefs,
  resolvePrefsFile,
  savePrefs,
} from './prefs.js'
import {
  buildSnapshot,
  DEFAULT_CARDS,
  DEFAULT_PANELS,
  KPI_CATALOG,
  KPI_IDS,
  normalizeIds,
  PANEL_CATALOG,
  PANEL_IDS,
  renderStatusText,
  summarize,
  trimAccounts,
  trimRecent,
} from './snapshot.js'
import { fmtInt } from './format.js'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const panelFile = join(here, '..', 'assets', 'panel.js')

let version = '0.0.0'
try {
  version = String(require('../package.json').version || version)
} catch {
  /* keep the fallback */
}

/** cordis inject list: the plugin needs the web server and the tool registry. */
export const inject = ['webServer', 'tools']

export const name = 'dsh-workbuddy-dashboard'

const schemastery = await import('@deepseek-ai/schemastery')
  .then((mod) => mod.default ?? mod)
  .catch(() => null)

const dshTools = await import('@deepseek-ai/dsh-tools').catch(() => null)
const defineTool = typeof dshTools?.defineTool === 'function' ? dshTools.defineTool : (definition) => definition

/**
 * Plugin configuration. When schemastery is available DSH renders this as a
 * settings form; otherwise the same defaults are applied by normalizeConfig().
 */
export const Config = schemastery && typeof schemastery.object === 'function'
  ? schemastery.object({
      baseUrl: schemastery
        .string()
        .default('http://127.0.0.1:8788')
        .description('WorkBuddy 网关地址（本机面板 API）'),
      password: schemastery
        .string()
        .default('admin')
        .description('网关面板密码，仅保存在本机 profile 配置里'),
      range: schemastery
        .string()
        .default('today')
        .description('默认统计区间：' + RANGES.join(' / ')),
      refreshMs: schemastery
        .number()
        .default(10000)
        .min(3000)
        .max(300000)
        .description('看板与网关的刷新间隔（毫秒）'),
      cards: schemastery
        .array(schemastery.string())
        .default([...DEFAULT_CARDS])
        .description('显示的 KPI 卡片 id：' + KPI_IDS.join(', ')),
      panels: schemastery
        .array(schemastery.string())
        .default([...DEFAULT_PANELS])
        .description('显示的面板 id：' + PANEL_IDS.join(', ')),
      showPanel: schemastery
        .boolean()
        .default(true)
        .description('把悬浮看板注入 Web UI（关闭后只用工具查询）'),
      panelOpen: schemastery
        .boolean()
        .default(true)
        .description('页面载入时默认展开悬浮看板'),
      opacity: schemastery
        .number()
        .default(0.94)
        .min(0.5)
        .max(1)
        .description('悬浮看板整体不透明度'),
      trustedHosts: schemastery
        .string()
        .default('')
        .description('额外允许访问看板路由的 Host（逗号分隔，默认仅回环）'),
      prefsPath: schemastery
        .string()
        .default('')
        .description('面板偏好文件路径（留空 = %LOCALAPPDATA%\\dsh-workbuddy-dashboard\\prefs.json；:memory: = 不落盘）'),
    })
  : undefined

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/** Apply defaults and validate a raw config object. */
export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const baseUrl = String(input.baseUrl || 'http://127.0.0.1:8788').trim().replace(/\/+$/, '')
  return {
    baseUrl,
    password: String(input.password ?? 'admin'),
    range: normalizeRange(input.range),
    refreshMs: clamp(input.refreshMs, 3000, 300000, 10000),
    cards: normalizeIds(input.cards, KPI_IDS, DEFAULT_CARDS),
    panels: normalizeIds(input.panels, PANEL_IDS, DEFAULT_PANELS),
    showPanel: input.showPanel !== false,
    panelOpen: input.panelOpen !== false,
    opacity: clamp(input.opacity, 0.5, 1, 0.94),
    trustedHosts: parseTrustedHosts(input.trustedHosts),
    prefsPath: String(input.prefsPath || '').trim(),
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.statusCode = status
  res.setHeader('content-type', contentType)
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

function queryOf(req) {
  const url = String((req && req.url) || '')
  const index = url.indexOf('?')
  return new URLSearchParams(index === -1 ? '' : url.slice(index + 1))
}

const MAX_BODY_BYTES = 64 * 1024

/** Read a small JSON request body (settings updates are the only writer). */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    const timer = setTimeout(() => {
      reject(new Error('request body timeout'))
      if (typeof req.destroy === 'function') req.destroy()
    }, 5000)
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        clearTimeout(timer)
        reject(new Error('request body too large'))
        if (typeof req.destroy === 'function') req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      clearTimeout(timer)
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/** Build the inline bootstrap script that pulls in the panel bundle. */
function buildBootScript(cfg, prefs) {
  const view = prefs || defaultsFromConfig(cfg)
  const payload = {
    base: '/workbuddy',
    refreshMs: view.refreshMs,
    range: view.range,
    cards: view.cards,
    panels: view.panels,
    open: cfg.panelOpen,
    opacity: view.opacity,
    snap: view.snap,
    snapDistance: view.snapDistance,
    version,
  }
  return [
    '/* wb-dash-panel-boot */',
    '(function(){try{',
    'var c=' + JSON.stringify(payload) + ';',
    'window.__WB_DASH__=Object.assign({},c,window.__WB_DASH__||{});',
    "if(!window.__WB_PANEL_LOADED__){var s=document.createElement('script');",
    's.src=c.base+"/panel.js?v=' + encodeURIComponent(version) + '";s.async=true;',
    "s.onerror=function(){window.__WB_PANEL_ERROR__=true};",
    'document.body.appendChild(s);}',
    '}catch(e){}})();',
  ].join('')
}

/**
 * Apply the plugin.
 * @param {object} ctx cordis context
 * @param {object} [rawConfig] plugin configuration
 */
export function apply(ctx, rawConfig = {}) {
  const cfg = normalizeConfig(rawConfig)
  const logger = typeof ctx.logger === 'function' ? ctx.logger('workbuddy-dashboard')
    : ctx.logger && typeof ctx.logger === 'object' ? ctx.logger
    : console

  const gateway = createGatewayClient({ baseUrl: cfg.baseUrl, password: cfg.password, logger })
  const prefsFile = resolvePrefsFile(cfg)
  const prefsDefaults = defaultsFromConfig(cfg)
  const loaded = loadPrefs(prefsFile, prefsDefaults)
  const state = {
    cache: null,
    inflight: null,
    timer: null,
    lastSuccessAt: 0,
    lastError: null,
    panelSource: null,
    prefsFile,
    prefs: loaded.prefs,
    prefsStored: loaded.stored,
  }

  /** Catalogues the settings view needs (ids + labels). */
  function catalog() {
    return {
      kpis: KPI_IDS.map((id) => ({ id, label: KPI_CATALOG[id].label })),
      panels: PANEL_IDS.map((id) => ({ id, label: PANEL_CATALOG[id].label })),
      ranges: RANGES.map((id) => ({ id, label: RANGE_LABELS[id] || id })),
    }
  }

  function noteError(error) {
    state.lastError = error && error.message ? error.message : String(error)
    return state.lastError
  }

  async function collect(range) {
    const settled = await Promise.allSettled([
      gateway.health(),
      gateway.analytics(range),
      gateway.timeseries(range),
      gateway.recent(8),
      gateway.accounts(),
      gateway.scheduler(),
    ])
    const values = settled.map((item) => (item.status === 'fulfilled' ? item.value : undefined))
    const failures = settled
      .map((item, index) => (item.status === 'rejected' ? { index, error: item.reason } : null))
      .filter(Boolean)

    const [health, analytics, series, recent, accountsPayload, scheduler] = values
    const healthy = Boolean(health && health.ok !== false)
    let error = null
    if (!healthy) {
      const first = failures[0]
      error = first && first.error && first.error.message ? first.error.message : '网关不可达'
    } else if (failures.length) {
      const first = failures[0]
      error = '部分数据获取失败: ' + (first.error && first.error.message ? first.error.message : String(first.error))
    }

    if (error) noteError(error)
    else state.lastError = null

    return buildSnapshot({
      health,
      analytics,
      series,
      recent,
      accountsPayload,
      scheduler,
      range,
      rangeLabel: RANGE_LABELS[range] || range,
      cards: state.prefs.cards,
      panels: state.prefs.panels,
      error,
      version,
    })
  }

  /** Cached snapshot, refreshed at most once per refreshMs. */
  async function getSnapshot(range, { force = false } = {}) {
    const wanted = normalizeRange(range || cfg.range)
    const fresh = state.cache && state.cache.range === wanted && Date.now() - state.cache.at < cfg.refreshMs
    if (!force && fresh) return state.cache.snapshot
    if (state.inflight && state.inflight.range === wanted) return state.inflight.promise

    const promise = collect(wanted)
      .then((snapshot) => {
        state.cache = { range: wanted, at: Date.now(), snapshot }
        if (snapshot.ok) state.lastSuccessAt = Date.now()
        return snapshot
      })
      .catch((error) => {
        noteError(error)
        return buildSnapshot({
          error: state.lastError,
          range: wanted,
          rangeLabel: RANGE_LABELS[wanted] || wanted,
          cards: state.prefs.cards,
          panels: state.prefs.panels,
          version,
        })
      })
      .finally(() => {
        state.inflight = null
      })

    state.inflight = { range: wanted, promise }
    return promise
  }

  function guard(req, res) {
    const verdict = guardRequest(req, { trustedHosts: cfg.trustedHosts })
    if (!verdict.ok) {
      sendJson(res, 403, { ok: false, error: verdict.reason })
      return false
    }
    return true
  }

  async function panelScript() {
    if (!state.panelSource) state.panelSource = await readFile(panelFile, 'utf8')
    return state.panelSource
  }

  const routes = []
  function route(spec) {
    if (!ctx.webServer || typeof ctx.webServer.register !== 'function') return
    const disposer = ctx.webServer.register(spec)
    routes.push(spec.path)
    return disposer
  }

  const effect = typeof ctx.effect === 'function' ? ctx.effect.bind(ctx) : (fn) => fn()

  effect(() => route({
    kind: 'exact',
    path: '/workbuddy/api/snapshot',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      try {
        const query = queryOf(req)
        const range = query.get('range') || state.prefs.range
        const force = query.get('force') === '1'
        const snapshot = await getSnapshot(range, { force })
        sendJson(res, 200, snapshot)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: noteError(error) })
      }
    },
  }))

  effect(() => route({
    kind: 'exact',
    path: '/workbuddy/api/health',
    handler: (req, res) => {
      if (!guard(req, res)) return
      sendJson(res, 200, {
        ok: !state.lastError,
        error: state.lastError,
        at: new Date().toISOString(),
        lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
        gateway: gateway.baseUrl,
        version,
        stats: gateway.stats,
      })
    },
  }))

  effect(() => route({
    kind: 'exact',
    path: '/workbuddy/api/config',
    handler: (req, res) => {
      if (!guard(req, res)) return
      sendJson(res, 200, {
        ok: true,
        version,
        range: state.prefs.range,
        refreshMs: state.prefs.refreshMs,
        cards: state.prefs.cards,
        panels: state.prefs.panels,
        panelOpen: cfg.panelOpen,
        opacity: state.prefs.opacity,
        snap: state.prefs.snap,
        snapDistance: state.prefs.snapDistance,
        prefs: state.prefs,
        defaults: prefsDefaults,
        stored: state.prefsStored,
        catalog: catalog(),
        ranges: catalog().ranges,
      })
    },
  }))

  /**
   * Presentation preferences. GET returns the effective view; PUT merges a
   * patch (cards/panels/opacity/refreshMs/range/snap/snapDistance), persists it
   * and drops the snapshot cache so the next render reflects the new cards.
   */
  effect(() => route({
    kind: 'exact',
    path: '/workbuddy/api/prefs',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      const method = String((req && req.method) || 'GET').toUpperCase()
      if (method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          prefs: state.prefs,
          defaults: prefsDefaults,
          stored: state.prefsStored,
          catalog: catalog(),
        })
        return
      }
      if (method !== 'PUT' && method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const next = mergePrefs(state.prefs, body, prefsDefaults)
        const stored = savePrefs(state.prefsFile, next)
        state.prefs = next
        state.prefsStored = state.prefsStored || stored
        state.cache = null
        sendJson(res, 200, {
          ok: true,
          prefs: next,
          defaults: prefsDefaults,
          stored,
          catalog: catalog(),
        })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: noteError(error) })
      }
    },
  }))

  effect(() => route({
    kind: 'exact',
    path: '/workbuddy/panel.js',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      try {
        const source = await panelScript()
        sendText(res, 200, source, 'text/javascript; charset=utf-8')
      } catch (error) {
        sendText(res, 500, '/* panel bundle unavailable: ' + noteError(error) + ' */', 'text/javascript; charset=utf-8')
      }
    },
  }))

  // Floating panel injection: the row path works in the desktop shell too, the
  // tapIndex path covers hosts that render index.html without the row table.
  if (cfg.showPanel) {
    const bootScript = buildBootScript(cfg, state.prefs)
    if (typeof ctx.on === 'function') {
      ctx.on('webserver/index-inject', (table) => {
        if (!table || typeof table.push !== 'function') return
        table.push({ kind: 'script', placement: 'body', text: bootScript })
      })
    }
    if (ctx.webServer && typeof ctx.webServer.tapIndex === 'function') {
      effect(() => ctx.webServer.tapIndex((html) => {
        const page = String(html || '')
        if (page.includes('wb-dash-panel-boot')) return page
        const tag = '<script>' + bootScript + '</script>'
        return page.includes('</body>') ? page.replace('</body>', tag + '</body>') : page + tag
      }))
    }
  }

  // Warm the cache once so the first panel render is not empty.
  void getSnapshot(state.prefs.range, { force: true }).catch((error) => noteError(error))

  // Background refresh keeps the tools and the panel warm even without a UI.
  effect(() => {
    state.timer = setInterval(() => {
      void getSnapshot(state.prefs.range, { force: true }).catch((error) => noteError(error))
    }, cfg.refreshMs)
    if (state.timer && typeof state.timer.unref === 'function') state.timer.unref()
    return () => {
      if (state.timer) clearInterval(state.timer)
      state.timer = null
    }
  })

  const tools = ctx.tools
  if (tools && typeof tools.register === 'function') {
    const rangeParam = {
      type: 'string',
      enum: [...RANGES],
      description: '统计区间，默认使用插件配置（today）',
    }

    // `parameters` is an author-facing property map: each key is one value
    // schema, `required: true` marks an argument as mandatory (dsh-tools
    // compiles it into JSON Schema for the model).
    tools.register(defineTool({
      name: 'workbuddy_status',
      description: '读取本机 WorkBuddy 网关的数据看板摘要：请求数、tokens、花费、缓存命中、速度、账号就绪与排程状态。',
      parameters: {
        range: rangeParam,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute: async (args, exec) => {
        const range = normalizeRange((args && args.range) || cfg.range)
        exec && typeof exec.signal === 'object' && exec.signal?.throwIfAborted?.()
        const snapshot = await getSnapshot(range, { force: true })
        return renderStatusText(snapshot)
      },
    }))

    tools.register(defineTool({
      name: 'workbuddy_recent',
      description: '列出本机 WorkBuddy 网关最近的请求（时间、模型、结果、tokens、耗时、速度）。',
      parameters: {
        limit: { type: 'integer', description: '返回条数，默认 8（1–20）' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute: async (args) => {
        const limit = clamp(args && args.limit, 1, 20, 8)
        const payload = await gateway.recent(limit)
        const rows = trimRecent(payload && payload.rows, limit)
        if (!rows.length) return '最近没有任何请求记录。'
        const lines = ['最近 ' + rows.length + ' 条请求（共 ' + fmtInt(payload && payload.total) + ' 条）：']
        for (const row of rows) {
          lines.push('- ' + row.clock + ' · ' + row.model + ' · ' + (row.failed ? 'FAILED/' + row.outcome : 'ok') +
            ' · ' + row.tokensText + ' tokens · ' + row.elapsedText + ' · ' + row.speedText + (row.stream ? ' · stream' : ''))
        }
        return lines.join('\n')
      },
    }))

    tools.register(defineTool({
      name: 'workbuddy_accounts',
      description: '列出本机 WorkBuddy 网关的账号与剩余额度（就绪优先）。',
      parameters: {
        limit: { type: 'integer', description: '返回条数，默认 8（1–20）' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute: async (args) => {
        const limit = clamp(args && args.limit, 1, 20, 8)
        const payload = await gateway.accounts()
        const accounts = trimAccounts(payload && payload.accounts, limit)
        if (!accounts.length) return '网关没有配置任何账号。'
        const lines = ['账号 ' + accounts.length + ' 个（usable=' + String(payload && payload.usable) + '）：']
        for (const account of accounts) {
          const stateText = account.ready ? '就绪' : account.cooldown ? '冷却' : '停用'
          lines.push('- ' + account.nickname + ' [' + account.realm + '] · ' + stateText +
            ' · 额度 ' + account.remainText + '/' + account.sizeText)
        }
        return lines.join('\n')
      },
    }))
  } else if (logger && typeof logger.warn === 'function') {
    logger.warn('tools service unavailable; workbuddy_* tools were not registered')
  }

  if (logger && typeof logger.info === 'function') {
    logger.info('workbuddy dashboard ' + version + ' → ' + cfg.baseUrl + ' (range=' + cfg.range +
      ', cards=' + cfg.cards.join(',') + ', panels=' + cfg.panels.join(',') + ')')
  }

  return {
    get snapshot() {
      return state.cache ? state.cache.snapshot : null
    },
    getSnapshot,
    describe: () => summarize(state.cache ? state.cache.snapshot : null),
    gateway,
    routes,
  }
}

export default { name, inject, Config, apply }
