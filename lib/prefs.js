/**
 * Presentation preferences.
 *
 * The floating panel is a browser view, but its knobs (which cards, which
 * panels, opacity, refresh interval, snap) belong to the user, not to a single
 * browser profile: they are edited from the panel's settings view, stored next
 * to the plugin, and served back through `GET /workbuddy/api/prefs`.
 *
 * Storage is a tiny JSON file; writes are atomic (write + rename) so a crash
 * mid-save cannot leave a truncated file behind. Every read is normalised, so a
 * hand-edited or foreign file degrades to the configured defaults instead of
 * breaking the panel.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { normalizeRange } from './gateway.js'
import { DEFAULT_CARDS, KPI_IDS, normalizeIds, PANEL_IDS } from './snapshot.js'

/** Preference keys the panel may change. Anything else in a file is ignored. */
export const PREFS_KEYS = ['cards', 'panels', 'opacity', 'refreshMs', 'range', 'snap', 'snapDistance']

/** Snap threshold bounds, in CSS pixels. */
export const SNAP_MIN = 0
export const SNAP_MAX = 80
export const SNAP_DEFAULT = 24

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/** Folder used when the plugin config does not point somewhere else. */
export function defaultPrefsDir() {
  const base = process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(base, 'dsh-workbuddy-dashboard')
}

/** Absolute path of the prefs file (`config.prefsPath` may override the dir). */
export function resolvePrefsFile(config = {}) {
  const custom = String(config.prefsPath || '').trim()
  if (!custom) return join(defaultPrefsDir(), 'prefs.json')
  if (custom === ':memory:' || custom === 'off') return ''
  // A directory-looking value becomes the folder, anything else the file.
  return /[\\/]$/.test(custom) ? join(custom, 'prefs.json') : custom
}

/** Defaults derived from the plugin config (what the profile says). */
export function defaultsFromConfig(config = {}) {
  return {
    cards: normalizeIds(config.cards, KPI_IDS, [...DEFAULT_CARDS]),
    panels: normalizeIds(config.panels, PANEL_IDS, [...PANEL_IDS]),
    opacity: clamp(config.opacity, 0.5, 1, 0.94),
    refreshMs: clamp(config.refreshMs, 3000, 300000, 10000),
    range: normalizeRange(config.range),
    snap: true,
    snapDistance: SNAP_DEFAULT,
  }
}

/** Coerce anything into a complete, valid preference object. */
export function normalizePrefs(raw, defaults = defaultsFromConfig()) {
  const input = raw && typeof raw === 'object' ? raw : {}
  return {
    cards: normalizeIds(input.cards, KPI_IDS, defaults.cards),
    panels: normalizeIds(input.panels, PANEL_IDS, defaults.panels),
    opacity: clamp(input.opacity, 0.5, 1, defaults.opacity),
    refreshMs: clamp(input.refreshMs, 3000, 300000, defaults.refreshMs),
    range: input.range === undefined ? defaults.range : normalizeRange(input.range),
    snap: input.snap === undefined ? defaults.snap : input.snap !== false,
    snapDistance: clamp(input.snapDistance, SNAP_MIN, SNAP_MAX, defaults.snapDistance),
  }
}

/**
 * Keep only the keys a client is allowed to set, leaving the rest untouched.
 * The result is normalized later; unknown keys and wrong types are dropped.
 */
export function sanitizePatch(body) {
  const input = body && typeof body === 'object' ? body : {}
  const patch = {}
  for (const key of PREFS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue
    const value = input[key]
    if (key === 'cards' || key === 'panels') {
      if (Array.isArray(value)) patch[key] = value.map((item) => String(item))
      else if (typeof value === 'string') patch[key] = value
    } else if (key === 'snap') {
      if (typeof value === 'boolean') patch.snap = value
    } else if (key === 'range') {
      if (typeof value === 'string') patch.range = value
    } else if (typeof value === 'number' || typeof value === 'string') {
      patch[key] = Number(value)
    }
  }
  return patch
}

/** Read prefs from disk; missing or broken files fall back to the defaults. */
export function loadPrefs(file, defaults = defaultsFromConfig()) {
  if (!file) return { prefs: normalizePrefs({}, defaults), stored: false }
  try {
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    return { prefs: normalizePrefs(parsed, defaults), stored: true }
  } catch {
    return { prefs: normalizePrefs({}, defaults), stored: false }
  }
}

/** Write prefs atomically. Returns true when the file was replaced. */
export function savePrefs(file, prefs) {
  if (!file) return false
  const body = JSON.stringify(normalizePrefs(prefs), null, 2) + '\n'
  const temp = file + '.tmp-' + process.pid
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temp, body, 'utf8')
    renameSync(temp, file)
    return true
  } catch {
    try {
      unlinkSync(temp)
    } catch {
      /* nothing to clean up */
    }
    return false
  }
}

/** Merge a client patch into the current prefs. */
export function mergePrefs(current, patch, defaults = defaultsFromConfig()) {
  return normalizePrefs(Object.assign({}, current, sanitizePatch(patch)), defaults)
}

/**
 * Add metrics that arrived in a later version to an existing selection, once.
 *
 * A saved selection is the user's own choice, so a new metric is not simply
 * forced back in: it is appended the first time the panel sees an older file,
 * and a marker next to the file remembers that the offer was already made. If
 * the user then removes the card, it stays removed.
 */
const MIGRATIONS = [{ id: 'credit-used-card', card: 'credit_used' }]

function readMigrations(file) {
  try {
    const parsed = JSON.parse(readFileSync(file + '.migrations', 'utf8'))
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : []
  } catch {
    return []
  }
}

export function applyMigrations(file, prefs, stored) {
  if (!file || !stored) return prefs
  const markerFile = file + '.migrations'
  const applied = readMigrations(file)
  let next = prefs
  let changed = false
  for (const migration of MIGRATIONS) {
    if (applied.includes(migration.id)) continue
    if (!next.cards.includes(migration.card)) {
      next = Object.assign({}, next, { cards: [...next.cards, migration.card] })
      changed = true
    }
    applied.push(migration.id)
    changed = true
  }
  if (!changed) return next
  if (next !== prefs) savePrefs(file, next)
  try {
    writeFileSync(markerFile, JSON.stringify(applied, null, 2) + '\n', 'utf8')
  } catch {
    /* the marker is an optimisation: a failed write only re-offers the card */
  }
  return next
}
