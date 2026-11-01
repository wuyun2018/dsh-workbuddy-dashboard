/**
 * Local harness: boots the plugin against a real WorkBuddy gateway behind a
 * tiny static server, so the floating panel can be inspected in a browser
 * without installing anything into a DSH profile.
 *
 *   node scripts/harness.mjs [--port 4010] [--gateway http://127.0.0.1:8788] [--password admin]
 *
 * The harness reuses the plugin's real `apply()`: routes are registered through
 * a shim web server and index injection flows through the same
 * `webserver/index-inject` listener DSH fires, so what the browser renders is
 * what the plugin would render inside the harness UI.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const port = Number(argValue('--port', process.env.WB_HARNESS_PORT || 4010))
const demo = process.argv.includes('--demo')
const liveBaseUrl = argValue('--gateway', process.env.WB_GATEWAY_URL || 'http://127.0.0.1:8788')
const password = argValue('--password', process.env.WB_GATEWAY_PASSWORD || 'admin')

/**
 * Demo mode serves the sanitised fixtures captured by
 * `scripts/capture-fixtures.mjs` from a tiny stand-in gateway, so the panel can
 * be screenshotted for documentation without exposing real accounts.
 */
async function startMockGateway(portNumber) {
  const fixtures = {}
  for (const name of ['health', 'analytics', 'timeseries', 'recent', 'accounts', 'scheduler']) {
    fixtures[name] = JSON.parse(await readFile(join(here, '..', 'tests', 'fixtures', name + '.json'), 'utf8'))
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const send = (payload, status = 200) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(payload))
    }
    if (url.pathname === '/panel/login') {
      send({ ok: true, token: 'demo'.repeat(8), using_default_password: true })
      return
    }
    if (url.pathname === '/health') return send(fixtures.health)
    if (url.pathname === '/usage/analytics') return send(fixtures.analytics)
    if (url.pathname === '/usage/timeseries') return send(fixtures.timeseries)
    if (url.pathname === '/usage/recent') return send(fixtures.recent)
    if (url.pathname === '/accounts') return send(fixtures.accounts)
    if (url.pathname === '/scheduler') return send(fixtures.scheduler)
    send({ ok: false, error: 'not found' }, 404)
  })
  await new Promise((resolve) => server.listen(portNumber, '127.0.0.1', resolve))
  return server
}

let baseUrl = liveBaseUrl
if (demo) {
  await startMockGateway(port + 1)
  baseUrl = 'http://127.0.0.1:' + (port + 1)
}

const routes = new Map()
const taps = []
const injections = []

const ctx = {
  effect(fn) {
    return fn()
  },
  on(event, handler) {
    if (event === 'webserver/index-inject') injections.push(handler)
  },
  logger(scope) {
    return {
      info: (message) => console.log('[' + scope + '] ' + message),
      warn: (message) => console.warn('[' + scope + '] ' + message),
      error: (message) => console.error('[' + scope + '] ' + message),
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
    register() {},
  },
}

// Demo runs keep their preferences in memory so screenshot sessions never touch
// the real prefs file a user may be relying on.
const prefsPath = argValue('--prefs', demo ? ':memory:' : '')

apply(ctx, {
  baseUrl,
  password,
  range: argValue('--range', 'today'),
  refreshMs: 5000,
  prefsPath,
})

function renderIndex() {
  const rows = []
  for (const injection of injections) injection(rows)
  const markup = rows.map((row) => (row.kind === 'script' ? '<script>' + row.text + '</script>' : '')).join('')
  const page = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8" />',
    '<title>WorkBuddy dashboard harness</title>',
    '<style>',
    'html,body{margin:0;height:100%;background:#0b1017;color:#e8eefc;font-family:"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif}',
    // The panel borrows the host palette; mirror the DSH dark tokens here so the
    // harness previews the same colours the real app shows.
    'body{--dsw-alias-bg-base:#151517;--dsw-alias-bg-layer-1:#232324;--dsw-alias-bg-layer-2:#2c2c2e;'
      + '--dsw-alias-label-primary:#f9fafb;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-label-tertiary:#adb2b8;'
      + '--dsw-alias-border-l1:#ffffff0f;--dsw-alias-border-l2:#ffffff1f;--dsw-alias-brand-primary:#f9fafb;'
      + '--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;'
      + '--dsw-alias-state-error-primary:#f25a5a;'
      + '--dsw-font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}',
    '.stage{height:100%;display:flex;align-items:center;justify-content:center;padding-top:46px;',
    'background:radial-gradient(1200px 600px at 70% 10%,rgba(56,110,190,0.30),transparent 60%),',
    'radial-gradient(900px 500px at 20% 90%,rgba(120,80,200,0.24),transparent 65%)}',
    // A stand-in for the DSH conversation header, so the panel has a real strip
    // to anchor to instead of falling back to the top of the viewport.
    '.chrome{position:fixed;left:0;right:0;top:0;height:46px;display:flex;align-items:center;gap:16px;padding:0 16px;',
    'border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(12,18,26,0.92);z-index:1}',
    '.tabs{display:flex;gap:16px;font-size:12px;color:#9db1c9;white-space:nowrap}',
    '.tab.on{color:#e8eefc;font-weight:600}',
    '.card{padding:26px 30px;border:1px solid rgba(140,180,255,0.16);border-radius:16px;background:rgba(14,22,34,0.72)}',
    'h1{font-size:15px;margin:0 0 6px;font-weight:600;letter-spacing:.3px}',
    'p{margin:0;color:#8fa6c2;font-size:12px}',
    '</style>',
    '</head>',
    '<body data-ds-dark-theme>',
    '<div class="chrome"><div class="tabs"><span class="tab on">对话</span><span class="tab">上下文</span>',
    '<span class="tab">编队</span></div></div>',
    '<div class="stage"><div class="card"><h1>WorkBuddy 数据看板 · 本地验证页</h1>',
    '<p>屏幕上那块悬浮面板由插件注入（dsh-workbuddy-dashboard），数据来自真实网关。</p></div></div>',
    markup,
    '</body>',
    '</html>',
  ].join('\n')
  const rowless = taps.reduce((html, transform) => transform(html), page)
  return rowless
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1:' + port)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = renderIndex()
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(html)
    return
  }
  const route = routes.get(url.pathname)
  if (route) {
    try {
      await route.handler(req, res)
    } catch (error) {
      res.statusCode = 500
      res.end('harness error: ' + (error && error.message ? error.message : String(error)))
    }
    return
  }
  res.statusCode = 404
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end('not found')
})

server.listen(port, '127.0.0.1', () => {
  console.log('harness listening on http://127.0.0.1:' + port + '/')
  console.log('gateway: ' + baseUrl + ' · routes: ' + [...routes.keys()].join(', '))
  console.log('press Ctrl+C to stop')
})

process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})
