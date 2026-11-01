/**
 * Minimal WorkBuddy gateway client.
 *
 * Only the panel endpoints this plugin actually needs are implemented:
 *   GET  /health                       (no auth)
 *   POST /panel/login                  -> X-Panel-Token
 *   GET  /usage/analytics?realm=all&...
 *   GET  /usage/timeseries?realm=all&...&bucket=<seconds>
 *   GET  /usage/recent?realm=all&limit=<n>
 *   GET  /accounts?realm=all
 *   GET  /scheduler
 *
 * The gateway rotates the panel token when the gateway restarts; a 401/403 is
 * answered by a single transparent re-login, so callers never see token churn.
 */

/** Statistics ranges supported by the dashboard. */
export const RANGES = ['today', 'd3', 'week', 'month', 'd30', 'all']

/** Human labels for the ranges (used by the panel and the tools). */
export const RANGE_LABELS = {
  today: '今日',
  d3: '近 3 天',
  week: '本周',
  month: '本月',
  d30: '近 30 天',
  all: '全部',
}

const DAY = 86400

/** Normalize a user supplied range name, falling back to "today". */
export function normalizeRange(range) {
  const value = String(range ?? '').trim().toLowerCase()
  return RANGES.includes(value) ? value : 'today'
}

/**
 * Build the query string (without leading "?") for one range.
 * today/week/month are gateway presets; d3/d30/all use an explicit window.
 */
export function rangeQuery(range, nowSeconds = Math.floor(Date.now() / 1000)) {
  const value = normalizeRange(range)
  if (value === 'today' || value === 'week' || value === 'month') return 'range=' + value
  const days = value === 'd3' ? 3 : value === 'd30' ? 30 : 3650
  const until = Math.floor(nowSeconds)
  const since = until - days * DAY
  return 'range=custom&since=' + since + '&until=' + until
}

/** Bucket seconds for the timeseries request; keeps the curve compact. */
export function bucketFor(range) {
  const value = normalizeRange(range)
  if (value === 'month' || value === 'd30' || value === 'all') return DAY
  return 3600
}

/** Error carrying the HTTP status (when there is one). */
export class GatewayError extends Error {
  constructor(message, { status = 0, path = '' } = {}) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
    this.path = path
  }
}

function joinUrl(baseUrl, path) {
  return String(baseUrl).replace(/\/+$/, '') + path
}

/**
 * Create a gateway client.
 * @param {object} [options]
 * @param {string} [options.baseUrl] gateway origin, e.g. http://127.0.0.1:8788
 * @param {string} [options.password] panel password
 * @param {number} [options.timeoutMs] per-request timeout
 * @param {Function} [options.fetchImpl] fetch implementation (tests)
 * @param {object} [options.logger] logger with warn/info
 */
export function createGatewayClient(options = {}) {
  const baseUrl = String(options.baseUrl || 'http://127.0.0.1:8788').trim()
  const password = String(options.password ?? 'admin')
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12000
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const logger = options.logger || null

  const state = {
    token: '',
    tokenAt: 0,
    logins: 0,
    requests: 0,
    lastError: null,
    loginPromise: null,
  }

  if (typeof fetchImpl !== 'function') {
    throw new GatewayError('global fetch is unavailable; Node 18+ is required')
  }

  function warn(message) {
    if (logger && typeof logger.warn === 'function') logger.warn(message)
  }

  async function readJson(response, path) {
    const text = await response.text()
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new GatewayError('invalid JSON from ' + path + ': ' + error.message, { path })
    }
  }

  /** Perform one authenticated request, re-logging in once on 401/403. */
  async function request(path, { allowRetry = true } = {}) {
    // Log in before the first authenticated call so a cold start sends one
    // login instead of six rejected requests (the gateway rate limits logins).
    if (!state.token) await login()
    const headers = { accept: 'application/json' }
    if (state.token) headers['X-Panel-Token'] = state.token
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const sentAt = Date.now()
    let response
    try {
      state.requests += 1
      response = await fetchImpl(joinUrl(baseUrl, path), { headers, signal: controller.signal })
    } catch (error) {
      clearTimeout(timer)
      const message = error && error.name === 'AbortError'
        ? 'gateway request timed out after ' + timeoutMs + 'ms: ' + path
        : 'gateway request failed: ' + path + ': ' + (error && error.message ? error.message : String(error))
      state.lastError = message
      throw new GatewayError(message, { path })
    }
    clearTimeout(timer)

    if (response.status === 401 || response.status === 403) {
      if (!allowRetry) {
        const message = 'panel auth rejected (' + response.status + ') for ' + path
        state.lastError = message
        throw new GatewayError(message, { status: response.status, path })
      }
      // A concurrent request may already have refreshed the token while this
      // one was in flight; reuse it instead of burning another login.
      if (!(state.token && state.tokenAt > sentAt)) {
        warn('panel token rejected for ' + path + '; re-authenticating')
        await login({ force: true })
      }
      return request(path, { allowRetry: false })
    }

    if (!response.ok) {
      const message = 'HTTP ' + response.status + ' for ' + path
      state.lastError = message
      throw new GatewayError(message, { status: response.status, path })
    }

    const body = await readJson(response, path)
    state.lastError = null
    return body
  }

  /** POST /panel/login and keep the token. Concurrent callers share one login. */
  async function login({ force = false } = {}) {
    if (!force && state.token) return state.token
    if (state.loginPromise) return state.loginPromise

    state.loginPromise = (async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let response
      try {
        response = await fetchImpl(joinUrl(baseUrl, '/panel/login'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ password }),
          signal: controller.signal,
        })
      } catch (error) {
        clearTimeout(timer)
        const message = error && error.name === 'AbortError'
          ? 'panel login timed out after ' + timeoutMs + 'ms'
          : 'panel login failed: ' + (error && error.message ? error.message : String(error))
        state.lastError = message
        throw new GatewayError(message, { path: '/panel/login' })
      }
      clearTimeout(timer)

      if (!response.ok) {
        const message = 'panel login rejected (HTTP ' + response.status + ')'
        state.lastError = message
        throw new GatewayError(message, { status: response.status, path: '/panel/login' })
      }

      const body = await readJson(response, '/panel/login')
      const token = typeof body.token === 'string' ? body.token : ''
      if (!token) {
        const message = 'panel login returned no token'
        state.lastError = message
        throw new GatewayError(message, { path: '/panel/login' })
      }
      state.token = token
      state.tokenAt = Date.now()
      state.logins += 1
      if (body.using_default_password) {
        warn('gateway still uses the default panel password; set a strong one in the gateway UI')
      }
      return token
    })()

    try {
      return await state.loginPromise
    } finally {
      state.loginPromise = null
    }
  }

  async function health() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(joinUrl(baseUrl, '/health'), {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new GatewayError('HTTP ' + response.status + ' for /health', { status: response.status, path: '/health' })
      return await readJson(response, '/health')
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    get baseUrl() {
      return baseUrl
    },
    get stats() {
      return { requests: state.requests, logins: state.logins, lastError: state.lastError, hasToken: Boolean(state.token) }
    },
    login,
    health,
    analytics: (range) => request('/usage/analytics?realm=all&' + rangeQuery(range)),
    timeseries: (range) => request('/usage/timeseries?realm=all&' + rangeQuery(range) + '&bucket=' + bucketFor(range)),
    recent: (limit = 8) => request('/usage/recent?realm=all&limit=' + Math.max(1, Math.min(50, Math.round(Number(limit) || 8)))),
    accounts: () => request('/accounts?realm=all'),
    scheduler: () => request('/scheduler'),
  }
}
