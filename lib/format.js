/**
 * Number / time formatting helpers.
 *
 * The formatting rules mirror the PowerShell desktop widget
 * (workbuddy-dashboard-widget) so the in-app panel and the desktop widget show
 * the same strings for the same numbers.
 */

/** Coerce anything to a finite number, defaulting to 0. */
export function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Integer with thousands separators: 12960516 -> "12,960,516". */
export function fmtInt(value) {
  return Math.round(num(value)).toLocaleString('en-US')
}

function trim1(x) {
  const s = x.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/**
 * Compact magnitude: 1234 -> "1.2K", 1000000 -> "1M", 12960516 -> "13M".
 * Integer magnitudes keep no trailing ".0".
 */
export function fmtCompact(value) {
  const n = num(value)
  const abs = Math.abs(n)
  if (abs >= 1e12) return trim1(n / 1e12) + 'T'
  if (abs >= 1e9) return trim1(n / 1e9) + 'B'
  if (abs >= 1e6) return trim1(n / 1e6) + 'M'
  if (abs >= 1e3) return trim1(n / 1e3) + 'K'
  return String(Math.round(n))
}

/** 1234 -> "1,234" for small values, compact above 1e5. */
export function fmtCount(value) {
  const n = num(value)
  return Math.abs(n) >= 1e5 ? fmtCompact(n) : fmtInt(n)
}

/** Milliseconds: 850 -> "850ms", 1234 -> "1.2s", 95000 -> "1m35s". */
export function fmtSec(ms) {
  const n = num(ms)
  if (n <= 0) return '0ms'
  if (n < 1000) return Math.round(n) + 'ms'
  if (n < 60000) return trim1(n / 1000) + 's'
  const minutes = Math.floor(n / 60000)
  const seconds = Math.round((n % 60000) / 1000)
  if (seconds === 60) return fmtSec(minutes * 60000 + 60000)
  return minutes + 'm' + String(seconds).padStart(2, '0') + 's'
}

/** 12.34 -> "12.3/s" style one-decimal number without a unit. */
export function fmt1(value) {
  return trim1(num(value))
}

/** 0.9231 -> "92.3%"; pass already-percent values (12.3 -> "12.3%"). */
export function fmtPct(value) {
  return trim1(num(value)) + '%'
}

/** CNY money: 1.5 -> "¥1.50". */
export function fmtMoney(value) {
  return '¥' + num(value).toFixed(2)
}

/** USD money: 0.21 -> "$0.21". */
export function fmtUsd(value) {
  return '$' + num(value).toFixed(2)
}

/**
 * "2026-10-18 21:20:49" or "2026-10-18T21:20:49" -> "21:20:49".
 * Anything unparsable is returned trimmed to 8 chars or as "".
 */
export function fmtClock(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const match = /(\d{2}):(\d{2}):(\d{2})/.exec(text)
  return match ? match[0] : text.slice(0, 8)
}

/** Percentage of a whole, safe against zero totals. */
export function pctOf(part, whole) {
  const w = num(whole)
  return w > 0 ? (num(part) / w) * 100 : 0
}

/** Epoch seconds -> "HH:mm" in local time. */
export function fmtHourMinute(epochSeconds) {
  const date = new Date(num(epochSeconds) * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
}

/** Date -> "HH:mm:ss" in the viewer's local time zone. */
export function fmtTimeOfDay(date) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return ''
  return String(value.getHours()).padStart(2, '0') + ':' +
    String(value.getMinutes()).padStart(2, '0') + ':' +
    String(value.getSeconds()).padStart(2, '0')
}

