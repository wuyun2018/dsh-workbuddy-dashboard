/**
 * Request guard for the plugin's own HTTP routes.
 *
 * The routes expose live gateway telemetry without DSH authentication, so they
 * must be loopback-only: a hostile page that the user happens to open must not
 * be able to read the dashboard through the browser (DNS rebinding, CSRF and
 * cross-site fetches are all rejected here). Set `trustedHosts` (comma
 * separated) when the harness is intentionally served on a LAN name.
 */

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '[::1]'])

/** Split a comma/semicolon/space separated host list into lower-case names. */
export function parseTrustedHosts(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

/** Strip the port from a Host header, keeping IPv6 brackets. */
export function hostNameOf(hostHeader) {
  const value = String(hostHeader || '').trim().toLowerCase()
  if (!value) return ''
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(0, end + 1)
  }
  const colon = value.lastIndexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

function hostAllowed(hostHeader, trustedHosts) {
  const name = hostNameOf(hostHeader)
  if (!name) return false
  if (LOOPBACK_NAMES.has(name)) return true
  for (const trusted of trustedHosts) {
    const candidate = hostNameOf(trusted)
    if (candidate && (candidate === name || hostNameOf(hostHeader) === candidate)) return true
  }
  return false
}

/**
 * Decide whether a request may reach the plugin's data routes.
 *
 * @param {object} req Node request (only `headers` is used)
 * @param {object} [options]
 * @param {string[]} [options.trustedHosts] extra allowed hosts
 * @returns {{ok: boolean, reason?: string}}
 */
export function guardRequest(req, options = {}) {
  const headers = (req && req.headers) || {}
  const trustedHosts = Array.isArray(options.trustedHosts) ? options.trustedHosts : []

  const site = String(headers['sec-fetch-site'] || '').toLowerCase()
  if (site === 'cross-site') return { ok: false, reason: 'cross-site request rejected' }
  if (site === 'same-site') return { ok: false, reason: 'same-site request rejected' }

  if (!hostAllowed(headers.host, trustedHosts)) {
    return { ok: false, reason: 'untrusted host "' + String(headers.host || '') + '"' }
  }

  const origin = headers.origin
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(String(origin)).host
    } catch {
      return { ok: false, reason: 'malformed origin rejected' }
    }
    if (String(originHost).toLowerCase() !== String(headers.host || '').toLowerCase()) {
      return { ok: false, reason: 'cross-origin request rejected' }
    }
  }

  return { ok: true }
}
