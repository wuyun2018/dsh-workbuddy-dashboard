/**
 * Request guard for the plugin's own HTTP routes.
 *
 * The routes expose live gateway telemetry without DSH authentication, so they
 * must be loopback-only: a hostile page that the user happens to open must not
 * be able to read the dashboard through the browser (DNS rebinding, CSRF and
 * cross-site fetches are all rejected here). Set `trustedHosts` (comma
 * separated) when the harness is intentionally served on a LAN name.
 */

/**
 * Host names that identify the local machine itself.
 *
 * `0.0.0.0` and `[::]` are deliberately absent: they are wildcard *bind*
 * addresses, so a request carrying one proves nothing about who sent it. Anyone
 * who really browses to http://0.0.0.0:3080 has to list it in `trustedHosts`.
 */
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost'])
/** Compressed and expanded spellings of the IPv6 loopback address. */
const IPV6_LOOPBACK = new Set(['::1', '0:0:0:0:0:0:0:1'])
/** How a dual-stack socket reports an IPv4 peer. */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i

/** Split a comma/semicolon/space separated host list into lower-case names. */
export function parseTrustedHosts(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Strip the port from a Host header, keeping IPv6 brackets.
 *
 * A bare IPv6 literal (`::1`, `0:0:0:0:0:0:0:1`) carries no port, so every colon
 * belongs to the address and nothing is stripped.
 */
export function hostNameOf(hostHeader) {
  const value = String(hostHeader || '').trim().toLowerCase()
  if (!value) return ''
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(0, end + 1)
  }
  if (value.split(':').length > 2) return value
  const colon = value.indexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

/** A dotted-quad IPv4 literal (names such as `127.0.0.1.evil.com` do not match). */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** True when a host name (port already stripped) names this machine. */
function isLoopbackName(name) {
  if (!name) return false
  if (LOOPBACK_NAMES.has(name)) return true
  if (IPV6_LOOPBACK.has(name)) return true
  if (name.startsWith('[') && name.endsWith(']')) {
    const inner = name.slice(1, -1)
    if (IPV6_LOOPBACK.has(inner)) return true
    const mapped = IPV4_MAPPED.exec(inner)
    return Boolean(mapped && /^127\./.test(mapped[1]))
  }
  if (!IPV4.test(name)) return false
  return /^127\./.test(name)
}

/** True when a socket address belongs to this machine (a local proxy included). */
export function isLoopbackAddress(address) {
  const value = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!value) return false
  if (IPV6_LOOPBACK.has(value)) return true
  const mapped = IPV4_MAPPED.exec(value)
  const ipv4 = mapped ? mapped[1] : value
  if (!IPV4.test(ipv4)) return false
  return /^127\./.test(ipv4)
}

function hostAllowed(hostHeader, trustedHosts) {
  const raw = String(hostHeader || '').trim()
  // A repeated Host header arrives as "a, b" (or with whitespace); never read
  // that as the single trusted name "a".
  if (!raw || /[\s,]/.test(raw)) return false
  const name = hostNameOf(raw)
  if (isLoopbackName(name)) return true
  for (const trusted of trustedHosts) {
    const candidate = hostNameOf(trusted)
    if (candidate && candidate === name) return true
  }
  return false
}

/**
 * Decide whether a request may reach the plugin's data routes.
 *
 * @param {object} req Node request (`headers` and, ideally, `socket`)
 * @param {object} [options]
 * @param {string[]} [options.trustedHosts] extra allowed hosts
 * @param {boolean} [options.allowRemote] permit non-loopback peers (defaults to
 *   `trustedHosts.length > 0`, i.e. LAN access has to be asked for explicitly)
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

  // Host and Origin are client-supplied, so also require the TCP peer to be this
  // machine. Without this, a harness bound to a LAN address (or reached through a
  // reverse proxy) would serve the dashboard to anyone who can route to it.
  const allowRemote = options.allowRemote === undefined
    ? trustedHosts.length > 0
    : Boolean(options.allowRemote)
  const peer = req && req.socket ? String(req.socket.remoteAddress || '') : ''
  if (!allowRemote && peer && !isLoopbackAddress(peer)) {
    return { ok: false, reason: 'non-loopback peer rejected' }
  }

  return { ok: true }
}
