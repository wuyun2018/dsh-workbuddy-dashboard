/**
 * dsh-workbuddy-dashboard — floating panel (browser side).
 *
 * Rendered inside a shadow root so the DSH web UI styles cannot leak in or out.
 * Data comes exclusively from the plugin's own loopback routes:
 *   GET  /workbuddy/api/snapshot?range=<id>
 *   GET  /workbuddy/api/config
 *   GET  /workbuddy/api/prefs
 *   PUT  /workbuddy/api/prefs
 *
 * The panel can be dragged anywhere, snaps to the nearest viewport edge when it
 * gets close (like dsh-whale-widget's snap zones), and carries a settings view
 * for cards, panels, opacity, refresh interval and snapping. Preferences are
 * stored by the host plugin, so every browser window shares them.
 *
 * No framework, no build step, no external assets.
 */
(function () {
  'use strict'

  if (window.__WB_PANEL_LOADED__) return
  window.__WB_PANEL_LOADED__ = true

  var boot = window.__WB_DASH__ || {}
  var BASE = boot.base || '/workbuddy'
  var STORE_KEY = 'wb-dash:v1'
  var REFRESH_CHOICES = [
    { ms: 3000, label: '3 秒' },
    { ms: 5000, label: '5 秒' },
    { ms: 10000, label: '10 秒' },
    { ms: 30000, label: '30 秒' },
    { ms: 60000, label: '60 秒' }
  ]
  var RANGE_FALLBACK = [
    { id: 'today', label: '今日' },
    { id: 'd3', label: '近 3 天' },
    { id: 'week', label: '本周' },
    { id: 'month', label: '本月' },
    { id: 'd30', label: '近 30 天' },
    { id: 'all', label: '全部' }
  ]

  function loadStore() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY)
      var parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return {}
    }
  }

  function saveStore() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state.store))
    } catch (error) {
      /* private mode: ignore */
    }
  }

  function clampNum(value, min, max, fallback) {
    var number = Number(value)
    if (!isFinite(number)) return fallback
    return Math.min(max, Math.max(min, number))
  }

  var state = {
    store: loadStore(),
    data: null,
    error: null,
    busy: false,
    timer: null,
    open: true,
    collapsed: false,
    settings: false,
    saving: false,
    prefs: {
      cards: Array.isArray(boot.cards) ? boot.cards.slice() : [],
      panels: Array.isArray(boot.panels) ? boot.panels.slice() : [],
      opacity: clampNum(boot.opacity, 0.5, 1, 0.94),
      refreshMs: clampNum(boot.refreshMs, 3000, 300000, 10000),
      range: boot.range || 'today',
      snap: boot.snap !== false,
      snapDistance: clampNum(boot.snapDistance, 0, 80, 24)
    },
    catalog: { kpis: [], panels: [], ranges: RANGE_FALLBACK },
    dock: null
  }
  state.open = state.store.closed === true ? false : boot.open !== false
  state.collapsed = state.store.collapsed === true
  if (state.store.range) state.prefs.range = state.store.range
  if (state.store.dock && typeof state.store.dock === 'object') state.dock = state.store.dock
  if (!state.prefs.cards.length) state.prefs.cards = ['tokens', 'requests', 'speed', 'cache', 'cost', 'success', 'credit_used']
  if (!state.prefs.panels.length) state.prefs.panels = ['trend', 'recent', 'accounts', 'scheduler']

  /* ---------------------------------------------------------------- helpers */

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function fmtCompact(value) {
    var n = Number(value)
    if (!isFinite(n)) n = 0
    var abs = Math.abs(n)
    function trim(x) {
      var s = x.toFixed(1)
      return s.slice(-2) === '.0' ? s.slice(0, -2) : s
    }
    if (abs >= 1e12) return trim(n / 1e12) + 'T'
    if (abs >= 1e9) return trim(n / 1e9) + 'B'
    if (abs >= 1e6) return trim(n / 1e6) + 'M'
    if (abs >= 1e3) return trim(n / 1e3) + 'K'
    return String(Math.round(n))
  }

  function panelShown(id) {
    return state.prefs.panels.indexOf(id) !== -1
  }

  /* ------------------------------------------------------------------ theme */

  // The panel paints itself with the host design tokens (`--dsw-alias-*`, set by
  // dsh-client-ui-theme on <body>) so it follows the app appearance instead of
  // carrying a palette of its own. Custom properties inherit through the shadow
  // boundary, but we resolve them to concrete values so the fallbacks also work
  // when the page has no DSH tokens (standalone harness, tests).
  var THEME_SLOTS = ['bg', 'bg2', 'fg', 'fg2', 'fg3', 'line', 'lineSoft', 'accent', 'data', 'ok', 'warn', 'bad']
  var THEME_TOKENS = {
    bg: '--dsw-alias-bg-base',
    bg2: '--dsw-alias-bg-layer-1',
    fg: '--dsw-alias-label-primary',
    fg2: '--dsw-alias-label-secondary',
    fg3: '--dsw-alias-label-tertiary',
    line: '--dsw-alias-border-l2',
    lineSoft: '--dsw-alias-border-l1',
    accent: '--dsw-alias-brand-primary',
    // In the dark theme `brand-primary` is plain white, so charts borrow the
    // host link colour instead of painting everything in greyscale.
    data: '--dsw-alias-link',
    ok: '--dsw-alias-state-success-primary',
    warn: '--dsw-alias-state-warn-primary',
    bad: '--dsw-alias-state-error-primary',
  }
  var THEME_FALLBACK = {
    dark: {
      bg: '#151517', bg2: '#232324', fg: '#f9fafb', fg2: '#cfd3d6', fg3: '#adb2b8',
      line: '#ffffff1f', lineSoft: '#ffffff0f', accent: '#f9fafb', data: '#7aaaff',
      ok: '#22c55e', warn: '#f59e0b', bad: '#f25a5a',
    },
    light: {
      bg: '#ffffff', bg2: '#f4f5f7', fg: '#1b1d21', fg2: '#4b5058', fg3: '#71767d',
      line: '#00000014', lineSoft: '#0000000f', accent: '#3b82f6', data: '#3b82f6',
      ok: '#16a34a', warn: '#d97706', bad: '#dc2626',
    },
  }
  var colorProbe = null

  function parseColor(value) {
    if (!value) return null
    try {
      if (!colorProbe) colorProbe = document.createElement('canvas').getContext('2d')
      colorProbe.fillStyle = '#000000'
      colorProbe.fillStyle = value
      var text = String(colorProbe.fillStyle)
      if (text.charAt(0) === '#') {
        if (text.length !== 7) return null
        return { r: parseInt(text.slice(1, 3), 16), g: parseInt(text.slice(3, 5), 16), b: parseInt(text.slice(5, 7), 16), a: 1 }
      }
      var parts = text.replace(/^rgba?\(|\)$/g, '').split(',')
      return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]), a: parts.length > 3 ? Number(parts[3]) : 1 }
    } catch (error) {
      return null
    }
  }

  function rgbTriple(value) {
    var parsed = parseColor(value)
    return parsed ? parsed.r + ',' + parsed.g + ',' + parsed.b : '255,255,255'
  }

  function tokenValue(name) {
    try {
      var bodyStyle = document.body ? getComputedStyle(document.body) : null
      var rootStyle = getComputedStyle(document.documentElement)
      var value = bodyStyle ? String(bodyStyle.getPropertyValue(name) || '').trim() : ''
      if (!value) value = String(rootStyle.getPropertyValue(name) || '').trim()
      return value
    } catch (error) {
      return ''
    }
  }

  function prefersDark() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    } catch (error) {
      return true
    }
  }

  function resolveTheme() {
    var raw = {}
    var missing = 0
    THEME_SLOTS.forEach(function (slot) {
      var value = tokenValue(THEME_TOKENS[slot])
      if (!value) missing += 1
      raw[slot] = value
    })
    // Judge the appearance from the host background itself: DSH tokens already
    // resolve per appearance, which is more reliable than the OS preference.
    var bgColor = parseColor(raw.bg)
    var dark = bgColor
      ? (0.2126 * bgColor.r + 0.7152 * bgColor.g + 0.0722 * bgColor.b) / 255 < 0.5
      : prefersDark()
    var fallback = THEME_FALLBACK[dark ? 'dark' : 'light']
    var palette = { dark: dark, usesTokens: missing < THEME_SLOTS.length }
    THEME_SLOTS.forEach(function (slot) {
      var parsed = parseColor(raw[slot])
      palette[slot] = parsed ? raw[slot] : fallback[slot]
      palette[slot + 'Rgb'] = parsed
        ? parsed.r + ',' + parsed.g + ',' + parsed.b
        : rgbTriple(fallback[slot])
    })
    palette.font = tokenValue('--dsw-font-family') || '"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif'
    return palette
  }

  function applyTheme() {
    var palette = resolveTheme()
    state.theme = palette
    THEME_SLOTS.forEach(function (slot) {
      host.style.setProperty('--wb-' + slot, palette[slot])
      host.style.setProperty('--wb-' + slot + '-rgb', palette[slot + 'Rgb'])
    })
    host.style.setProperty('--wb-font', palette.font)
    host.setAttribute('data-wb-appearance', palette.dark ? 'dark' : 'light')
  }

  function watchTheme() {
    var scheduled = false
    function schedule() {
      if (scheduled) return
      scheduled = true
      var run = function () {
        scheduled = false
        try {
          applyTheme()
        } catch (error) {
          /* a theme probe failure must never break the panel */
        }
      }
      if (window.requestAnimationFrame) window.requestAnimationFrame(run)
      else setTimeout(run, 16)
    }
    try {
      var observer = new MutationObserver(schedule)
      var options = { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style', 'data-theme'] }
      observer.observe(document.documentElement, options)
      if (document.body) observer.observe(document.body, options)
    } catch (error) {
      /* MutationObserver is optional */
    }
    try {
      if (window.matchMedia) {
        var media = window.matchMedia('(prefers-color-scheme: dark)')
        if (media.addEventListener) media.addEventListener('change', schedule)
        else if (media.addListener) media.addListener(schedule)
      }
    } catch (error) {
      /* matchMedia listener is optional */
    }
  }

  /* ------------------------------------------------------------------- view */

  var host = document.createElement('div')
  host.setAttribute('data-wb-dash', 'root')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;'
  var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
  applyTheme()
  watchTheme()

  var style = document.createElement('style')
  style.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:var(--wb-font,"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif)}',
    '.wb-win{position:absolute;width:344px;pointer-events:auto;border-radius:14px;display:flex;flex-direction:column;',
    'max-height:calc(100vh - 36px);',
    'background:linear-gradient(160deg,rgba(var(--wb-bg-rgb),var(--wb-bg-a)),rgba(var(--wb-bg2-rgb),var(--wb-bg-a)));',
    'border:1px solid var(--wb-line);box-shadow:0 18px 44px rgba(0,0,0,0.34),0 0 0 1px rgba(var(--wb-fg-rgb),0.04) inset;',
    'color:var(--wb-fg);backdrop-filter:blur(14px) saturate(1.1);-webkit-backdrop-filter:blur(14px) saturate(1.1);',
    'overflow:hidden;transition:opacity .2s ease;font-size:12px;line-height:1.35}',
    '.wb-win.is-dragging{transition:none}',
    '.wb-win.is-snapped{border-color:rgba(var(--wb-fg-rgb),0.42);box-shadow:0 18px 44px rgba(0,0,0,0.34),0 0 0 1px rgba(var(--wb-fg-rgb),0.22) inset}',
    '.wb-win.settings .wb-content{display:none}',
    '.wb-win.settings .wb-settings{display:block}',
    '.wb-head{display:flex;align-items:center;gap:6px;padding:9px 10px 8px;cursor:move;flex:0 0 auto;',
    'background:linear-gradient(180deg,rgba(var(--wb-fg-rgb),0.07),rgba(var(--wb-fg-rgb),0));',
    'border-bottom:1px solid var(--wb-line-soft)}',
    '.wb-dot{width:8px;height:8px;border-radius:50%;background:var(--wb-ok);box-shadow:0 0 8px rgba(var(--wb-ok-rgb),0.8);flex:0 0 auto}',
    '.wb-dot.off{background:var(--wb-bad);box-shadow:0 0 8px rgba(var(--wb-bad-rgb),0.8)}',
    '.wb-title{font-size:12.5px;font-weight:600;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}',
    '.wb-spacer{flex:1 1 auto}',
    '.wb-btn{pointer-events:auto;border:1px solid var(--wb-line);background:rgba(var(--wb-fg-rgb),0.06);',
    'color:var(--wb-fg2);border-radius:7px;padding:3px 7px;font-size:11px;cursor:pointer;line-height:1.2}',
    '.wb-btn:hover{background:rgba(var(--wb-fg-rgb),0.13)}',
    '.wb-btn.on{background:rgba(var(--wb-accent-rgb),0.20);border-color:rgba(var(--wb-accent-rgb),0.55);color:var(--wb-fg)}',
    '.wb-win.settings .wb-head-tool{display:none}',
    '.wb-head .wb-btn{padding:3px 5px;font-size:10.5px;flex:0 0 auto}',
    '.wb-body{padding:10px;overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0;scrollbar-width:thin}',
    '.wb-win.collapsed .wb-body{display:none}',
    '.wb-content{display:block}',
    '.wb-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}',
    '.wb-kpi{background:rgba(var(--wb-fg-rgb),0.05);border:1px solid var(--wb-line-soft);border-radius:9px;padding:7px 8px;min-width:0}',
    '.wb-kpi-label{font-size:10px;color:var(--wb-fg3);letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wb-kpi-value{font-size:16px;font-weight:650;color:var(--wb-fg);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wb-kpi-sub{font-size:9.5px;color:var(--wb-fg3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // A lone card in the last row would leave two holes; let it use the width.
    '.wb-kpi.wide{grid-column:span 3;display:flex;align-items:baseline;gap:8px}',
    '.wb-kpi.wide .wb-kpi-label{flex:0 0 auto;margin:0}',
    '.wb-kpi.wide .wb-kpi-value{flex:0 0 auto;margin:0;font-size:15px}',
    '.wb-kpi.wide .wb-kpi-sub{flex:1 1 auto;margin:0;text-align:right;font-size:10px}',
    '.wb-sec{margin-top:9px}',
    '.wb-sec-head{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--wb-fg3);letter-spacing:.4px;margin-bottom:4px}',
    '.wb-sec-head b{color:var(--wb-fg2);font-weight:600;font-size:11px}',
    '.wb-trend{background:rgba(var(--wb-fg-rgb),0.035);border:1px solid var(--wb-line-soft);border-radius:9px;padding:6px 6px 2px}',
    '.wb-trend svg{display:block;width:100%;height:56px}',
    '.wb-trend-axis{display:flex;justify-content:space-between;color:var(--wb-fg3);font-size:9.5px;padding:0 1px 2px}',
    '.wb-row{display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px dashed var(--wb-line-soft)}',
    '.wb-row:last-child{border-bottom:0}',
    '.wb-row .t{color:var(--wb-fg3);font-variant-numeric:tabular-nums;font-size:10.5px;flex:0 0 48px}',
    '.wb-row .m{flex:1 1 auto;color:var(--wb-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wb-row .v{color:var(--wb-fg2);font-variant-numeric:tabular-nums;font-size:10.5px}',
    '.wb-row .bad{color:var(--wb-bad)}',
    '.wb-acc{display:flex;align-items:center;gap:6px;padding:2px 0}',
    '.wb-acc .n{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--wb-fg)}',
    '.wb-tag{font-size:9px;padding:1px 5px;border-radius:6px;background:rgba(var(--wb-fg-rgb),0.09);color:var(--wb-fg2)}',
    '.wb-tag.ok{background:rgba(var(--wb-ok-rgb),0.16);color:var(--wb-ok)}',
    '.wb-tag.cool{background:rgba(var(--wb-warn-rgb),0.16);color:var(--wb-warn)}',
    '.wb-tag.off{background:rgba(var(--wb-bad-rgb),0.16);color:var(--wb-bad)}',
    '.wb-foot{display:flex;align-items:center;gap:6px;padding:6px 10px 8px;font-size:9.5px;color:var(--wb-fg3);border-top:1px solid var(--wb-line-soft);flex:0 0 auto}',
    '.wb-pill{position:absolute;right:18px;bottom:18px;pointer-events:auto;width:42px;height:42px;border-radius:50%;',
    'border:1px solid var(--wb-line);background:linear-gradient(150deg,rgba(var(--wb-bg2-rgb),0.98),rgba(var(--wb-bg-rgb),0.98));color:var(--wb-fg);',
    'font-size:11px;font-weight:700;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,0.38);display:none}',
    '.wb-pill.show{display:block}',
    '.wb-select{pointer-events:auto;background:var(--wb-bg2);color:var(--wb-fg);border:1px solid var(--wb-line);',
    'border-radius:7px;padding:2px 4px;font-size:10.5px}',
    '.wb-empty{color:var(--wb-fg3);font-size:10.5px;padding:4px 0}',
    '.wb-note{color:var(--wb-fg3);font-size:10px;line-height:1.45;margin:0 0 3px;display:-webkit-box;',
    '-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}',
    '.wb-settings{display:none}',
    '.wb-set-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
    '.wb-set-head .wb-title{font-size:12px}',
    '.wb-set-sec{margin-top:10px}',
    '.wb-set-sec:first-of-type{margin-top:0}',
    '.wb-set-title{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--wb-fg2);margin-bottom:4px}',
    '.wb-set-title span{font-size:9.5px;color:var(--wb-fg3);font-weight:400}',
    '.wb-chips{display:flex;flex-wrap:wrap;gap:5px}',
    '.wb-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:7px;cursor:pointer;',
    'border:1px solid var(--wb-line-soft);background:rgba(var(--wb-fg-rgb),0.045);color:var(--wb-fg2);font-size:10.5px;user-select:none}',
    '.wb-chip:hover{background:rgba(var(--wb-fg-rgb),0.10)}',
    '.wb-chip.on{background:rgba(var(--wb-accent-rgb),0.20);border-color:rgba(var(--wb-accent-rgb),0.5);color:var(--wb-fg)}',
    '.wb-chip input{margin:0;accent-color:var(--wb-data);width:11px;height:11px}',
    '.wb-field{display:flex;align-items:center;gap:8px;margin:5px 0;color:var(--wb-fg2);font-size:10.5px}',
    '.wb-field label{flex:0 0 62px;color:var(--wb-fg3)}',
    '.wb-field input[type=range]{flex:1 1 auto;accent-color:var(--wb-data);height:14px}',
    '.wb-field .val{flex:0 0 46px;text-align:right;color:var(--wb-fg);font-variant-numeric:tabular-nums}',
    '.wb-actions{display:flex;gap:6px;margin-top:12px;padding-top:8px;border-top:1px solid var(--wb-line-soft)}',
    '.wb-actions .wb-btn{padding:4px 9px}',
    '.wb-actions .grow{flex:1 1 auto}',
    '.wb-docks{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;max-width:150px}',
    '.wb-docks .wb-btn{padding:3px 4px;font-size:10px}',
    '.wb-hint{color:var(--wb-fg3);font-size:9.5px;margin-top:3px}'
  ].join('')

  var win = el('div', 'wb-win')
  win.style.setProperty('--wb-bg-a', String(clampNum(state.prefs.opacity, 0.5, 1, 0.94)))

  var head = el('div', 'wb-head')
  var dot = el('span', 'wb-dot')
  var title = el('span', 'wb-title', 'WorkBuddy')
  var spacer = el('span', 'wb-spacer')
  var rangeSelect = document.createElement('select')
  rangeSelect.className = 'wb-select wb-head-tool'
  rangeSelect.title = '统计区间'
  var btnRefresh = el('button', 'wb-btn wb-head-tool', '⟳')
  btnRefresh.title = '立即刷新'
  var btnSettings = el('button', 'wb-btn', '⚙')
  btnSettings.title = '设置'
  var btnCollapse = el('button', 'wb-btn', '—')
  btnCollapse.title = '折叠'
  var btnClose = el('button', 'wb-btn', '✕')
  btnClose.title = '关闭（浮标可重新打开）'
  head.appendChild(dot)
  head.appendChild(title)
  head.appendChild(spacer)
  head.appendChild(rangeSelect)
  head.appendChild(btnRefresh)
  head.appendChild(btnSettings)
  head.appendChild(btnCollapse)
  head.appendChild(btnClose)

  var body = el('div', 'wb-body')
  var content = el('div', 'wb-content')
  var kpiGrid = el('div', 'wb-kpis')
  var trendSec = el('div', 'wb-sec')
  var recentSec = el('div', 'wb-sec')
  var accountsSec = el('div', 'wb-sec')
  var schedulerSec = el('div', 'wb-sec')
  content.appendChild(kpiGrid)
  content.appendChild(trendSec)
  content.appendChild(recentSec)
  content.appendChild(accountsSec)
  content.appendChild(schedulerSec)

  var settingsView = el('div', 'wb-settings')
  body.appendChild(content)
  body.appendChild(settingsView)

  var foot = el('div', 'wb-foot')
  var footText = el('span', '', '正在读取…')
  foot.appendChild(footText)

  win.appendChild(head)
  win.appendChild(body)
  win.appendChild(foot)

  var pill = el('button', 'wb-pill', 'WB')
  pill.title = '打开 WorkBuddy 数据看板'

  shadow.appendChild(style)
  shadow.appendChild(win)
  shadow.appendChild(pill)

  /* --------------------------------------------------------------- geometry */

  function viewportSize() {
    return {
      w: Math.max(1, window.innerWidth),
      h: Math.max(1, window.innerHeight)
    }
  }

  function winRect() {
    var rect = win.getBoundingClientRect()
    return { w: rect.width, h: rect.height, left: rect.left, top: rect.top }
  }

  function clampLeft(left, width) {
    var vp = viewportSize()
    return Math.max(0, Math.min(left, Math.max(0, vp.w - width)))
  }

  function clampTop(top, height) {
    var vp = viewportSize()
    return Math.max(0, Math.min(top, Math.max(0, vp.h - height)))
  }

  function markSnapped() {
    win.classList.toggle('is-snapped', Boolean(state.dock && (state.dock.h || state.dock.v)))
  }

  /** Write an absolute position and remember it (plus the docked edges). */
  function placeAt(left, top, dock, { persist = true } = {}) {
    var rect = winRect()
    var x = clampLeft(Math.round(left), rect.w)
    var y = clampTop(Math.round(top), rect.h)
    win.style.left = x + 'px'
    win.style.top = y + 'px'
    win.style.right = 'auto'
    win.style.bottom = 'auto'
    if (dock !== undefined) state.dock = dock
    markSnapped()
    if (persist) {
      state.store.pos = { left: x, top: y }
      state.store.dock = state.dock
      saveStore()
    }
    return { left: x, top: y }
  }

  function applyGeometry() {
    var pos = state.store.pos
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      placeAt(pos.left, pos.top, state.store.dock || null, { persist: false })
    } else {
      // Floating default: 18px inset from the bottom-right corner. It is *not*
      // docked, so the snapped styling and the "当前位置" hint stay honest until
      // the user actually drags the panel onto an edge.
      win.style.right = '18px'
      win.style.bottom = '18px'
      win.style.left = 'auto'
      win.style.top = 'auto'
      state.dock = null
      markSnapped()
    }
    if (state.collapsed) win.classList.add('collapsed')
    else win.classList.remove('collapsed')
    btnCollapse.textContent = state.collapsed ? '+' : '—'
    win.style.display = state.open ? 'flex' : 'none'
    pill.classList.toggle('show', !state.open)
  }

  /** Snap the upcoming position to an edge when it is inside the threshold. */
  function snapPosition(left, top) {
    var rect = winRect()
    var vp = viewportSize()
    var dock = { h: null, v: null }
    if (state.prefs.snap === false) {
      state.dock = null
      markSnapped()
      return { left: left, top: top }
    }
    var distance = clampNum(state.prefs.snapDistance, 0, 80, 24)
    var maxLeft = Math.max(0, vp.w - rect.w)
    var maxTop = Math.max(0, vp.h - rect.h)
    if (left <= distance) {
      left = 0
      dock.h = 'left'
    } else if (maxLeft - left <= distance) {
      left = maxLeft
      dock.h = 'right'
    }
    if (top <= distance) {
      top = 0
      dock.v = 'top'
    } else if (maxTop - top <= distance) {
      top = maxTop
      dock.v = 'bottom'
    }
    state.dock = dock
    return { left: left, top: top }
  }

  /** Keep the docked edges attached when the window is resized. */
  function reapplyDock() {
    if (!state.dock) {
      markSnapped()
      return
    }
    var rect = winRect()
    var vp = viewportSize()
    var pos = state.store.pos || { left: rect.left, top: rect.top }
    var left = pos.left
    var top = pos.top
    if (state.dock.h === 'left') left = 0
    else if (state.dock.h === 'right') left = vp.w - rect.w
    if (state.dock.v === 'top') top = 0
    else if (state.dock.v === 'bottom') top = vp.h - rect.h
    placeAt(left, top, state.dock)
  }

  function dockTo(position) {
    var rect = winRect()
    var vp = viewportSize()
    var left = rect.left
    var top = rect.top
    var dock = { h: null, v: null }
    if (position === 'left-top') { left = 0; top = 0; dock = { h: 'left', v: 'top' } }
    else if (position === 'right-top') { left = vp.w - rect.w; top = 0; dock = { h: 'right', v: 'top' } }
    else if (position === 'left-bottom') { left = 0; top = vp.h - rect.h; dock = { h: 'left', v: 'bottom' } }
    else if (position === 'right-bottom') { left = vp.w - rect.w; top = vp.h - rect.h; dock = { h: 'right', v: 'bottom' } }
    else { left = (vp.w - rect.w) / 2; top = (vp.h - rect.h) / 2; dock = { h: null, v: null } }
    placeAt(left, top, dock)
  }

  var drag = null

  head.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return
    var target = event.target
    if (target && (target.tagName === 'SELECT' || target.tagName === 'BUTTON')) return
    var rect = win.getBoundingClientRect()
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false }
    win.classList.add('is-dragging')
    try {
      head.setPointerCapture(event.pointerId)
    } catch (error) {
      /* ignore */
    }
    event.preventDefault()
  })

  head.addEventListener('pointermove', function (event) {
    if (!drag) return
    var rect = winRect()
    var left = clampLeft(event.clientX - drag.dx, rect.w)
    var top = clampTop(event.clientY - drag.dy, rect.h)
    win.style.left = Math.round(left) + 'px'
    win.style.top = Math.round(top) + 'px'
    win.style.right = 'auto'
    win.style.bottom = 'auto'
    drag.moved = true
  })

  head.addEventListener('pointerup', function (event) {
    if (!drag) return
    var moved = drag.moved
    drag = null
    win.classList.remove('is-dragging')
    try {
      head.releasePointerCapture(event.pointerId)
    } catch (error) {
      /* ignore */
    }
    if (!moved) return
    var rect = winRect()
    var snapped = snapPosition(rect.left, rect.top)
    placeAt(snapped.left, snapped.top, state.dock)
  })

  var resizeQueued = false
  window.addEventListener('resize', function () {
    if (resizeQueued) return
    resizeQueued = true
    window.requestAnimationFrame(function () {
      resizeQueued = false
      reapplyDock()
    })
  })

  /* -------------------------------------------------------------- behaviour */

  function setOpen(open) {
    state.open = open
    state.store.closed = !open
    saveStore()
    applyGeometry()
  }

  btnClose.addEventListener('click', function () {
    setOpen(false)
  })
  pill.addEventListener('click', function () {
    setOpen(true)
  })
  btnCollapse.addEventListener('click', function () {
    state.collapsed = !state.collapsed
    state.store.collapsed = state.collapsed
    saveStore()
    applyGeometry()
    if (!state.collapsed) reapplyDock()
  })
  btnRefresh.addEventListener('click', function () {
    void fetchSnapshot(true)
  })
  rangeSelect.addEventListener('change', function () {
    state.prefs.range = rangeSelect.value
    state.store.range = state.prefs.range
    saveStore()
    queueSave()
    void fetchSnapshot(true)
  })

  function toggleSettings(force) {
    state.settings = typeof force === 'boolean' ? force : !state.settings
    win.classList.toggle('settings', state.settings)
    btnSettings.classList.toggle('on', state.settings)
    btnSettings.textContent = state.settings ? '←' : '⚙'
    btnSettings.title = state.settings ? '返回看板' : '设置'
    if (state.settings) {
      renderSettings()
      // The settings view can be taller than the data view; keep it on screen.
      window.setTimeout(function () {
        var rect = winRect()
        placeAt(rect.left, rect.top)
        reapplyDock()
      }, 30)
    }
  }

  btnSettings.addEventListener('click', function () {
    toggleSettings()
  })

  /* --------------------------------------------------------------- settings */

  function normalizePrefs(raw) {
    var input = raw && typeof raw === 'object' ? raw : {}
    var next = {
      cards: Array.isArray(input.cards) ? input.cards.map(String) : state.prefs.cards,
      panels: Array.isArray(input.panels) ? input.panels.map(String) : state.prefs.panels,
      opacity: clampNum(input.opacity, 0.5, 1, state.prefs.opacity),
      refreshMs: clampNum(input.refreshMs, 3000, 300000, state.prefs.refreshMs),
      range: typeof input.range === 'string' && input.range ? input.range : state.prefs.range,
      snap: input.snap === undefined ? state.prefs.snap : input.snap !== false,
      snapDistance: clampNum(input.snapDistance, 0, 80, state.prefs.snapDistance)
    }
    return next
  }

  function applyVisualPrefs() {
    win.style.setProperty('--wb-bg-a', String(clampNum(state.prefs.opacity, 0.5, 1, 0.94)))
    restartPolling()
    renderRanges()
    markSnapped()
  }

  var saveTimer = null

  function queueSave() {
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(function () {
      saveTimer = null
      void pushPrefs()
    }, 400)
  }

  function pushPrefs() {
    if (state.saving) {
      queueSave()
      return Promise.resolve()
    }
    state.saving = true
    var payload = JSON.stringify(state.prefs)
    return fetch(BASE + '/api/prefs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      body: payload
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then(function (result) {
        if (result && result.prefs) state.prefs = normalizePrefs(result.prefs)
        if (result && result.defaults) state.defaults = result.defaults
        if (result && result.catalog) state.catalog = buildCatalog(result.catalog)
        applyVisualPrefs()
        renderSettings()
        return fetchSnapshot(true, true)
      })
      .catch(function (error) {
        footText.textContent = '设置保存失败: ' + ((error && error.message) || String(error))
        footText.style.color = 'var(--wb-bad)'
      })
      .then(function () {
        state.saving = false
      })
  }

  function buildCatalog(raw) {
    var input = raw && typeof raw === 'object' ? raw : {}
    return {
      kpis: Array.isArray(input.kpis) ? input.kpis : [],
      panels: Array.isArray(input.panels) ? input.panels : [],
      ranges: Array.isArray(input.ranges) && input.ranges.length ? input.ranges : RANGE_FALLBACK
    }
  }

  function chip(id, label, checked, onToggle) {
    var wrap = el('label', 'wb-chip' + (checked ? ' on' : ''))
    var input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = checked
    input.setAttribute('data-id', id)
    input.addEventListener('change', function () {
      onToggle(input.checked)
      wrap.classList.toggle('on', input.checked)
    })
    wrap.appendChild(input)
    wrap.appendChild(el('span', '', label))
    return wrap
  }

  function renderSettings() {
    settingsView.innerHTML = ''

    var headRow = el('div', 'wb-set-head')
    var back = el('button', 'wb-btn', '← 返回')
    back.addEventListener('click', function () {
      toggleSettings(false)
    })
    headRow.appendChild(back)
    headRow.appendChild(el('span', 'wb-title', '看板设置'))
    settingsView.appendChild(headRow)

    var cardsSec = el('div', 'wb-set-sec')
    var cardsTitle = el('div', 'wb-set-title', 'KPI 卡片')
    cardsTitle.appendChild(el('span', '', '共 ' + state.catalog.kpis.length + ' 项 · 点选即生效'))
    cardsSec.appendChild(cardsTitle)
    var cardChips = el('div', 'wb-chips')
    for (var i = 0; i < state.catalog.kpis.length; i += 1) {
      (function (entry) {
        var checked = state.prefs.cards.indexOf(entry.id) !== -1
        cardChips.appendChild(chip(entry.id, entry.label, checked, function (on) {
          togglePrefEntry('cards', entry.id, on)
        }))
      })(state.catalog.kpis[i])
    }
    cardsSec.appendChild(cardChips)
    settingsView.appendChild(cardsSec)

    var panelSec = el('div', 'wb-set-sec')
    var panelTitle = el('div', 'wb-set-title', '面板')
    panelTitle.appendChild(el('span', '', '趋势 / 最近请求 / 账号 / 排程'))
    panelSec.appendChild(panelTitle)
    var panelChips = el('div', 'wb-chips')
    for (var j = 0; j < state.catalog.panels.length; j += 1) {
      (function (entry) {
        var checked = state.prefs.panels.indexOf(entry.id) !== -1
        panelChips.appendChild(chip(entry.id, entry.label, checked, function (on) {
          togglePrefEntry('panels', entry.id, on)
        }))
      })(state.catalog.panels[j])
    }
    panelSec.appendChild(panelChips)
    settingsView.appendChild(panelSec)

    var lookSec = el('div', 'wb-set-sec')
    var lookTitle = el('div', 'wb-set-title', '外观')
    // The palette is borrowed from the host UI, so say so instead of hinting a
    // colour picker that does not exist.
    lookTitle.appendChild(
      el('span', '', '主题跟随界面 · ' + (state.theme && state.theme.dark ? '深色' : '浅色'))
    )
    lookSec.appendChild(lookTitle)
    var opacityField = el('div', 'wb-field')
    opacityField.appendChild(el('label', '', '不透明度'))
    var opacityInput = document.createElement('input')
    opacityInput.type = 'range'
    opacityInput.min = '50'
    opacityInput.max = '100'
    opacityInput.step = '1'
    opacityInput.value = String(Math.round(state.prefs.opacity * 100))
    var opacityValue = el('span', 'val', Math.round(state.prefs.opacity * 100) + '%')
    opacityInput.addEventListener('input', function () {
      var value = clampNum(opacityInput.value, 50, 100, 94) / 100
      state.prefs.opacity = value
      opacityValue.textContent = Math.round(value * 100) + '%'
      win.style.setProperty('--wb-bg-a', String(value))
      queueSave()
    })
    opacityField.appendChild(opacityInput)
    opacityField.appendChild(opacityValue)
    lookSec.appendChild(opacityField)
    settingsView.appendChild(lookSec)

    var dataSec = el('div', 'wb-set-sec')
    dataSec.appendChild(el('div', 'wb-set-title', '刷新'))
    var refreshField = el('div', 'wb-field')
    refreshField.appendChild(el('label', '', '间隔'))
    var refreshSelect = document.createElement('select')
    refreshSelect.className = 'wb-select'
    for (var k = 0; k < REFRESH_CHOICES.length; k += 1) {
      var choice = REFRESH_CHOICES[k]
      var option = document.createElement('option')
      option.value = String(choice.ms)
      option.textContent = choice.label
      if (Math.abs(choice.ms - state.prefs.refreshMs) < 1) option.selected = true
      refreshSelect.appendChild(option)
    }
    refreshSelect.addEventListener('change', function () {
      state.prefs.refreshMs = clampNum(refreshSelect.value, 3000, 300000, 10000)
      restartPolling()
      queueSave()
    })
    refreshField.appendChild(refreshSelect)
    dataSec.appendChild(refreshField)
    dataSec.appendChild(el('div', 'wb-hint', '后台自动刷新，页面隐藏时暂停'))
    settingsView.appendChild(dataSec)

    var snapSec = el('div', 'wb-set-sec')
    snapSec.appendChild(el('div', 'wb-set-title', '贴边吸附'))
    var snapChips = el('div', 'wb-chips')
    snapChips.appendChild(chip('snap', '拖到边缘自动贴靠', state.prefs.snap, function (on) {
      state.prefs.snap = on
      if (on) {
        var rect = winRect()
        var snapped = snapPosition(rect.left, rect.top)
        placeAt(snapped.left, snapped.top, state.dock)
      } else {
        state.dock = null
        markSnapped()
      }
      renderSettings()
      queueSave()
    }))
    snapSec.appendChild(snapChips)

    var distanceField = el('div', 'wb-field')
    distanceField.appendChild(el('label', '', '吸附距离'))
    var distanceInput = document.createElement('input')
    distanceInput.type = 'range'
    distanceInput.min = '0'
    distanceInput.max = '80'
    distanceInput.step = '2'
    distanceInput.value = String(Math.round(state.prefs.snapDistance))
    distanceInput.disabled = !state.prefs.snap
    var distanceValue = el('span', 'val', Math.round(state.prefs.snapDistance) + ' px')
    distanceInput.addEventListener('input', function () {
      state.prefs.snapDistance = clampNum(distanceInput.value, 0, 80, 24)
      distanceValue.textContent = Math.round(state.prefs.snapDistance) + ' px'
      queueSave()
    })
    distanceField.appendChild(distanceInput)
    distanceField.appendChild(distanceValue)
    snapSec.appendChild(distanceField)

    var docks = el('div', 'wb-docks')
    var dockDefs = [
      { id: 'left-top', label: '左上' },
      { id: 'right-top', label: '右上' },
      { id: 'center', label: '居中' },
      { id: 'left-bottom', label: '左下' },
      { id: 'right-bottom', label: '右下' }
    ]
    var dockedLabel = state.dock
      ? (state.dock.h || '-') + '/' + (state.dock.v || '-')
      : '自由'
    for (var d = 0; d < dockDefs.length; d += 1) {
      (function (def) {
        var button = el('button', 'wb-btn', def.label)
        button.addEventListener('click', function () {
          dockTo(def.id)
          queueSave()
          renderSettings()
        })
        docks.appendChild(button)
      })(dockDefs[d])
    }
    snapSec.appendChild(docks)
    snapSec.appendChild(el('div', 'wb-hint', '当前位置：' + dockedLabel))
    settingsView.appendChild(snapSec)

    var actions = el('div', 'wb-actions')
    var resetBtn = el('button', 'wb-btn', '恢复默认')
    resetBtn.addEventListener('click', function () {
      var base = state.defaults && typeof state.defaults === 'object' ? state.defaults : {}
      var defaults = normalizePrefs({
        cards: base.cards || ['tokens', 'requests', 'speed', 'cache', 'cost', 'success', 'credit_used'],
        panels: base.panels || ['trend', 'recent', 'accounts', 'scheduler'],
        opacity: typeof base.opacity === 'number' ? base.opacity : 0.94,
        refreshMs: typeof base.refreshMs === 'number' ? base.refreshMs : 10000,
        range: base.range || 'today',
        snap: typeof base.snap === 'boolean' ? base.snap : true,
        snapDistance: typeof base.snapDistance === 'number' ? base.snapDistance : 24
      })
      state.prefs = defaults
      state.store.range = defaults.range
      saveStore()
      applyVisualPrefs()
      renderSettings()
      queueSave()
    })
    actions.appendChild(resetBtn)
    actions.appendChild(el('span', 'grow'))
    var doneBtn = el('button', 'wb-btn on', '完成')
    doneBtn.addEventListener('click', function () {
      void pushPrefs().then(function () {
        toggleSettings(false)
      })
    })
    actions.appendChild(doneBtn)
    settingsView.appendChild(actions)
  }

  function togglePrefEntry(key, id, on) {
    var list = state.prefs[key].slice()
    var index = list.indexOf(id)
    if (on && index === -1) list.push(id)
    if (!on && index !== -1) list.splice(index, 1)
    state.prefs[key] = list
    if (key === 'panels') render()
    queueSave()
  }

  /* ----------------------------------------------------------------- render */

  function renderRanges() {
    rangeSelect.innerHTML = ''
    var ranges = state.catalog.ranges
    for (var i = 0; i < ranges.length; i += 1) {
      var item = ranges[i]
      var option = document.createElement('option')
      option.value = item.id
      option.textContent = item.label
      if (item.id === state.prefs.range) option.selected = true
      rangeSelect.appendChild(option)
    }
  }

  function renderKpis(data) {
    kpiGrid.innerHTML = ''
    var kpis = (data && data.kpis) || []
    if (!kpis.length) {
      kpiGrid.appendChild(el('div', 'wb-empty', '没有可显示的卡片'))
      return
    }
    for (var i = 0; i < kpis.length; i += 1) {
      var kpi = kpis[i]
      var last = i === kpis.length - 1 && kpis.length % 3 === 1
      var card = el('div', last ? 'wb-kpi wide' : 'wb-kpi')
      card.appendChild(el('div', 'wb-kpi-label', kpi.label))
      card.appendChild(el('div', 'wb-kpi-value', kpi.value))
      card.appendChild(el('div', 'wb-kpi-sub', kpi.sub))
      kpiGrid.appendChild(card)
    }
  }

  function renderTrend(data) {
    trendSec.innerHTML = ''
    if (!panelShown('trend')) return
    var trend = (data && data.trend) || { points: [] }
    var headRow = el('div', 'wb-sec-head')
    headRow.appendChild(el('b', '', 'Token 时序'))
    headRow.appendChild(el('span', '', trend.points && trend.points.length
      ? '峰值 ' + fmtCompact(trend.max) + ' / 桶'
      : ''))
    trendSec.appendChild(headRow)

    var box = el('div', 'wb-trend')
    var points = trend.points || []
    if (!points.length) {
      box.appendChild(el('div', 'wb-empty', '暂无时序数据'))
      trendSec.appendChild(box)
      return
    }
    var width = 320
    var height = 56
    var max = Math.max(1, trend.max || 0)
    var step = points.length > 1 ? width / (points.length - 1) : width
    var line = []
    for (var i = 0; i < points.length; i += 1) {
      var x = points.length > 1 ? i * step : width / 2
      var y = height - 4 - (Number(points[i].tokens) / max) * (height - 10)
      line.push((i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1))
    }
    var svgNs = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(svgNs, 'svg')
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height)
    svg.setAttribute('preserveAspectRatio', 'none')
    if (points.length > 1) {
      var area = document.createElementNS(svgNs, 'path')
      area.setAttribute('d', line.join(' ') + ' L' + width.toFixed(1) + ' ' + height + ' L0 ' + height + ' Z')
      area.setAttribute('fill', 'var(--wb-data)')
      area.setAttribute('fill-opacity', '0.18')
      svg.appendChild(area)
    }
    var stroke = document.createElementNS(svgNs, 'path')
    stroke.setAttribute('d', points.length > 1 ? line.join(' ') : '')
    stroke.setAttribute('fill', 'none')
    stroke.setAttribute('stroke', 'var(--wb-data)')
    stroke.setAttribute('stroke-width', '1.6')
    stroke.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(stroke)
    if (points.length === 1) {
      var dotNode = document.createElementNS(svgNs, 'circle')
      dotNode.setAttribute('cx', String(width / 2))
      dotNode.setAttribute('cy', line[0].split(' ')[1])
      dotNode.setAttribute('r', '2.6')
      dotNode.setAttribute('fill', 'var(--wb-data)')
      svg.appendChild(dotNode)
    }
    box.appendChild(svg)
    var axis = el('div', 'wb-trend-axis')
    axis.appendChild(el('span', '', points[0].label || ''))
    axis.appendChild(el('span', '', points.length > 1 ? (points[points.length - 1].label || '') : ''))
    box.appendChild(axis)
    if (points.length < 2) box.appendChild(el('div', 'wb-empty', '当前区间仅 1 个数据桶，扩大区间可看走势'))
    trendSec.appendChild(box)
  }

  function renderRecent(data) {
    recentSec.innerHTML = ''
    if (!panelShown('recent')) return
    var rows = (data && data.recent) || []
    var headRow = el('div', 'wb-sec-head')
    headRow.appendChild(el('b', '', '最近请求'))
    headRow.appendChild(el('span', '', rows.length ? '最新 ' + rows.length + ' 条' : ''))
    recentSec.appendChild(headRow)
    if (!rows.length) {
      recentSec.appendChild(el('div', 'wb-empty', '暂无请求'))
      return
    }
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i]
      var line = el('div', 'wb-row')
      line.appendChild(el('span', 't', row.clock || '--:--:--'))
      line.appendChild(el('span', 'm', row.model || 'unknown'))
      line.appendChild(el('span', 'v' + (row.failed ? ' bad' : ''), (row.failed ? '✗ ' : '') + row.tokensText + ' · ' + row.elapsedText))
      recentSec.appendChild(line)
    }
  }

  function renderAccounts(data) {
    accountsSec.innerHTML = ''
    if (!panelShown('accounts')) return
    var accounts = (data && data.accounts) || []
    var headRow = el('div', 'wb-sec-head')
    headRow.appendChild(el('b', '', '账号'))
    if (data && data.health) {
      headRow.appendChild(el('span', '', '就绪 ' + (data.health.accountsReady || 0) + '/' + (data.health.accounts || 0)))
    }
    accountsSec.appendChild(headRow)
    if (!accounts.length) {
      accountsSec.appendChild(el('div', 'wb-empty', '没有账号数据'))
      return
    }
    for (var i = 0; i < accounts.length; i += 1) {
      var account = accounts[i]
      var line = el('div', 'wb-acc')
      line.appendChild(el('span', 'n', account.nickname))
      var tagClass = account.ready ? 'wb-tag ok' : account.cooldown ? 'wb-tag cool' : 'wb-tag off'
      line.appendChild(el('span', tagClass, account.ready ? '就绪' : account.cooldown ? '冷却' : '停用'))
      line.appendChild(el('span', 'v', account.remainText + '/' + account.sizeText))
      accountsSec.appendChild(line)
    }
  }

  function renderScheduler(data) {
    schedulerSec.innerHTML = ''
    if (!panelShown('scheduler')) return
    var scheduler = (data && data.scheduler) || {}
    if (!scheduler.enabled && !scheduler.modeText && !scheduler.message) return
    var headRow = el('div', 'wb-sec-head')
    headRow.appendChild(el('b', '', '排程'))
    headRow.appendChild(el('span', scheduler.enabled ? 'wb-tag ok' : 'wb-tag off', scheduler.enabled ? '运行中' : '未运行'))
    schedulerSec.appendChild(headRow)
    var modeText = scheduler.modeText || ''
    if (modeText) {
      var note = el('div', 'wb-note', modeText)
      note.title = modeText
      schedulerSec.appendChild(note)
    }
    var detail = el('div', 'wb-row')
    detail.appendChild(el('span', 't', '下次'))
    detail.appendChild(el('span', 'm', scheduler.next || scheduler.message || '-'))
    detail.appendChild(el('span', 'v', scheduler.last ? '上次 ' + scheduler.last : ''))
    schedulerSec.appendChild(detail)
  }

  function render() {
    var data = state.data
    var offline = !data || data.ok === false
    dot.classList.toggle('off', offline)
    title.textContent = 'WorkBuddy'
    renderKpis(data)
    renderTrend(data)
    renderRecent(data)
    renderAccounts(data)
    renderScheduler(data)
    var parts = []
    if (state.error) parts.push('连接失败: ' + state.error)
    else if (data && data.error) parts.push(data.error)
    else parts.push('更新 ' + ((data && data.atClock) || '--:--:--'))
    if (data && data.window) {
      parts.push('请求 ' + (data.window.requests || 0))
      parts.push('tokens ' + (data.window.totalTokensText || '0'))
      parts.push(data.window.costText || '')
    }
    if (state.settings) footText.textContent = '设置会自动保存 · 点 ✓ 完成'
    else footText.textContent = parts.filter(Boolean).join(' · ')
    footText.style.color = state.error || (data && data.error) ? 'var(--wb-bad)' : 'var(--wb-fg3)'
  }

  /* ------------------------------------------------------------------ fetch */

  function fetchSnapshot(force, quiet) {
    if (state.busy && !force) return Promise.resolve()
    state.busy = true
    if (!quiet) footText.textContent = '正在刷新…'
    var url = BASE + '/api/snapshot?range=' + encodeURIComponent(state.prefs.range) + (force ? '&force=1' : '')
    return fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then(function (data) {
        state.data = data
        state.error = null
      })
      .catch(function (error) {
        state.error = (error && error.message) || String(error)
      })
      .then(function () {
        state.busy = false
        render()
      })
  }

  function loadConfig() {
    return fetch(BASE + '/api/config', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (response) {
        return response.ok ? response.json() : null
      })
      .then(function (config) {
        if (!config) return
        if (config.catalog) state.catalog = buildCatalog(config.catalog)
        if (config.defaults) state.defaults = config.defaults
        if (config.prefs) state.prefs = normalizePrefs(config.prefs)
        if (state.store.range) state.prefs.range = state.store.range
        applyVisualPrefs()
        renderSettings()
      })
      .catch(function () {
        /* keep fallbacks */
      })
  }

  function restartPolling() {
    if (state.timer) window.clearInterval(state.timer)
    state.timer = window.setInterval(function () {
      if (document.hidden) return
      void fetchSnapshot(false, true)
    }, clampNum(state.prefs.refreshMs, 3000, 300000, 10000))
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) void fetchSnapshot(false, true)
  })

  /* ------------------------------------------------------------------- boot */

  function mount() {
    if (!document.body) {
      window.setTimeout(mount, 50)
      return
    }
    document.body.appendChild(host)
    renderRanges()
    applyGeometry()
    render()
    void loadConfig().then(function () {
      return fetchSnapshot(false)
    })
    restartPolling()
  }

  mount()
})()
