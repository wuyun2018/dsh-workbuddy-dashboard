/**
 * dsh-workbuddy-dashboard — floating panel (browser side).
 *
 * Rendered inside a shadow root so the DSH web UI styles cannot leak in or out.
 * Data comes exclusively from the plugin's own loopback routes:
 *   GET /workbuddy/api/snapshot?range=<id>
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

  var state = {
    store: loadStore(),
    range: '',
    data: null,
    error: null,
    busy: false,
    timer: null,
    ranges: RANGE_FALLBACK,
    refreshMs: Number(boot.refreshMs) > 0 ? Number(boot.refreshMs) : 10000,
    open: true,
    collapsed: false
  }
  state.range = state.store.range || boot.range || 'today'
  state.open = state.store.closed === true ? false : boot.open !== false
  state.collapsed = state.store.collapsed === true

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

  /* ------------------------------------------------------------------- view */

  var host = document.createElement('div')
  host.setAttribute('data-wb-dash', 'root')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;'
  var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host

  var style = document.createElement('style')
  style.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif}',
    '.wb-win{position:absolute;width:344px;pointer-events:auto;border-radius:14px;display:flex;flex-direction:column;',
    'max-height:calc(100vh - 36px);',
    'background:linear-gradient(160deg,rgba(18,26,38,var(--wb-bg-a)),rgba(11,17,26,var(--wb-bg-a)));',
    'border:1px solid rgba(120,170,255,0.22);box-shadow:0 18px 48px rgba(0,0,0,0.45),0 0 0 1px rgba(255,255,255,0.03) inset;',
    'color:#eef4ff;backdrop-filter:blur(14px) saturate(1.15);-webkit-backdrop-filter:blur(14px) saturate(1.15);',
    'overflow:hidden;transition:opacity .2s ease;font-size:12px;line-height:1.35}',
    '.wb-win.is-dragging{transition:none}',
    '.wb-head{display:flex;align-items:center;gap:8px;padding:9px 10px 8px;cursor:move;flex:0 0 auto;',
    'background:linear-gradient(180deg,rgba(90,150,255,0.16),rgba(90,150,255,0.02));',
    'border-bottom:1px solid rgba(120,170,255,0.14)}',
    '.wb-dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 8px rgba(74,222,128,0.85);flex:0 0 auto}',
    '.wb-dot.off{background:#f87171;box-shadow:0 0 8px rgba(248,113,113,0.85)}',
    '.wb-title{font-size:12.5px;font-weight:600;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wb-sub{font-size:10.5px;color:#9fb4d0;margin-left:2px}',
    '.wb-spacer{flex:1 1 auto}',
    '.wb-btn{pointer-events:auto;border:1px solid rgba(150,190,255,0.2);background:rgba(120,170,255,0.10);',
    'color:#dce8ff;border-radius:7px;padding:3px 7px;font-size:11px;cursor:pointer;line-height:1.2}',
    '.wb-btn:hover{background:rgba(120,170,255,0.22)}',
    '.wb-body{padding:10px;overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0;scrollbar-width:thin}',
    '.wb-win.collapsed .wb-body{display:none}',
    '.wb-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}',
    '.wb-kpi{background:rgba(120,170,255,0.075);border:1px solid rgba(140,180,255,0.12);border-radius:9px;padding:7px 8px;min-width:0}',
    '.wb-kpi-label{font-size:10px;color:#9fb4d0;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wb-kpi-value{font-size:16px;font-weight:650;color:#ffffff;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wb-kpi-sub{font-size:9.5px;color:#8fa6c2;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wb-sec{margin-top:9px}',
    '.wb-sec-head{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#9fb4d0;letter-spacing:.4px;margin-bottom:4px}',
    '.wb-sec-head b{color:#cfe0ff;font-weight:600;font-size:11px}',
    '.wb-trend{background:rgba(10,16,26,0.55);border:1px solid rgba(140,180,255,0.12);border-radius:9px;padding:6px 6px 2px}',
    '.wb-trend svg{display:block;width:100%;height:56px}',
    '.wb-trend-axis{display:flex;justify-content:space-between;color:#8199b8;font-size:9.5px;padding:0 1px 2px}',
    '.wb-row{display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px dashed rgba(140,180,255,0.08)}',
    '.wb-row:last-child{border-bottom:0}',
    '.wb-row .t{color:#9fb4d0;font-variant-numeric:tabular-nums;font-size:10.5px;flex:0 0 48px}',
    '.wb-row .m{flex:1 1 auto;color:#e6efff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wb-row .v{color:#bcd0ea;font-variant-numeric:tabular-nums;font-size:10.5px}',
    '.wb-row .bad{color:#fca5a5}',
    '.wb-acc{display:flex;align-items:center;gap:6px;padding:2px 0}',
    '.wb-acc .n{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e6efff}',
    '.wb-tag{font-size:9px;padding:1px 5px;border-radius:6px;background:rgba(120,170,255,0.16);color:#b9d0f0}',
    '.wb-tag.ok{background:rgba(74,222,128,0.18);color:#86efac}',
    '.wb-tag.cool{background:rgba(251,191,36,0.18);color:#fcd34d}',
    '.wb-tag.off{background:rgba(248,113,113,0.18);color:#fca5a5}',
    '.wb-foot{display:flex;align-items:center;gap:6px;padding:6px 10px 8px;font-size:9.5px;color:#8199b8;border-top:1px solid rgba(120,170,255,0.1);flex:0 0 auto}',
    '.wb-pill{position:absolute;right:18px;bottom:18px;pointer-events:auto;width:42px;height:42px;border-radius:50%;',
    'border:1px solid rgba(140,190,255,0.35);background:linear-gradient(150deg,#1b2c44,#101a28);color:#cfe2ff;',
    'font-size:11px;font-weight:700;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,0.45);display:none}',
    '.wb-pill.show{display:block}',
    '.wb-select{pointer-events:auto;background:rgba(12,20,32,0.9);color:#dce8ff;border:1px solid rgba(150,190,255,0.24);',
    'border-radius:7px;padding:2px 5px;font-size:11px}',
    '.wb-empty{color:#8fa6c2;font-size:10.5px;padding:4px 0}',
    '.wb-note{color:#93aac6;font-size:10px;line-height:1.45;margin:0 0 3px;display:-webkit-box;',
    '-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}'
  ].join('')

  var win = el('div', 'wb-win')
  win.style.setProperty('--wb-bg-a', String(Math.max(0.5, Math.min(1, Number(boot.opacity) || 0.94))))

  var head = el('div', 'wb-head')
  var dot = el('span', 'wb-dot')
  var title = el('span', 'wb-title', 'WorkBuddy')
  var sub = el('span', 'wb-sub', '')
  var spacer = el('span', 'wb-spacer')
  var rangeSelect = document.createElement('select')
  rangeSelect.className = 'wb-select'
  rangeSelect.title = '统计区间'
  var btnRefresh = el('button', 'wb-btn', '⟳')
  btnRefresh.title = '立即刷新'
  var btnCollapse = el('button', 'wb-btn', '—')
  btnCollapse.title = '折叠'
  var btnClose = el('button', 'wb-btn', '✕')
  btnClose.title = '关闭（浮标可重新打开）'
  head.appendChild(dot)
  head.appendChild(title)
  head.appendChild(sub)
  head.appendChild(spacer)
  head.appendChild(rangeSelect)
  head.appendChild(btnRefresh)
  head.appendChild(btnCollapse)
  head.appendChild(btnClose)

  var body = el('div', 'wb-body')
  var kpiGrid = el('div', 'wb-kpis')
  var trendSec = el('div', 'wb-sec')
  var recentSec = el('div', 'wb-sec')
  var accountsSec = el('div', 'wb-sec')
  var schedulerSec = el('div', 'wb-sec')
  body.appendChild(kpiGrid)
  body.appendChild(trendSec)
  body.appendChild(recentSec)
  body.appendChild(accountsSec)
  body.appendChild(schedulerSec)

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

  function applyGeometry() {
    var pos = state.store.pos
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      win.style.left = Math.round(pos.left) + 'px'
      win.style.top = Math.round(pos.top) + 'px'
      win.style.right = 'auto'
      win.style.bottom = 'auto'
    } else {
      win.style.right = '18px'
      win.style.bottom = '18px'
      win.style.left = 'auto'
      win.style.top = 'auto'
    }
    if (state.collapsed) win.classList.add('collapsed')
    else win.classList.remove('collapsed')
    btnCollapse.textContent = state.collapsed ? '+' : '—'
    win.style.display = state.open ? 'flex' : 'none'
    pill.classList.toggle('show', !state.open)
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
    var rect = win.getBoundingClientRect()
    var left = Math.min(Math.max(0, event.clientX - drag.dx), Math.max(0, window.innerWidth - rect.width))
    var top = Math.min(Math.max(0, event.clientY - drag.dy), Math.max(0, window.innerHeight - 40))
    win.style.left = Math.round(left) + 'px'
    win.style.top = Math.round(top) + 'px'
    win.style.right = 'auto'
    win.style.bottom = 'auto'
    drag.moved = true
  })

  head.addEventListener('pointerup', function (event) {
    if (!drag) return
    if (drag.moved) {
      var rect = win.getBoundingClientRect()
      state.store.pos = { left: rect.left, top: rect.top }
      saveStore()
    }
    drag = null
    win.classList.remove('is-dragging')
    try {
      head.releasePointerCapture(event.pointerId)
    } catch (error) {
      /* ignore */
    }
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
  })
  btnRefresh.addEventListener('click', function () {
    void fetchSnapshot(true)
  })
  rangeSelect.addEventListener('change', function () {
    state.range = rangeSelect.value
    state.store.range = state.range
    saveStore()
    void fetchSnapshot(true)
  })

  /* ----------------------------------------------------------------- render */

  function renderRanges() {
    rangeSelect.innerHTML = ''
    for (var i = 0; i < state.ranges.length; i += 1) {
      var item = state.ranges[i]
      var option = document.createElement('option')
      option.value = item.id
      option.textContent = item.label
      if (item.id === state.range) option.selected = true
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
      var card = el('div', 'wb-kpi')
      card.appendChild(el('div', 'wb-kpi-label', kpi.label))
      card.appendChild(el('div', 'wb-kpi-value', kpi.value))
      card.appendChild(el('div', 'wb-kpi-sub', kpi.sub))
      kpiGrid.appendChild(card)
    }
  }

  function renderTrend(data) {
    trendSec.innerHTML = ''
    if (data && data.panels && data.panels.indexOf('trend') === -1) return
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
      area.setAttribute('fill', 'rgba(96,165,250,0.20)')
      svg.appendChild(area)
    }
    var stroke = document.createElementNS(svgNs, 'path')
    stroke.setAttribute('d', points.length > 1 ? line.join(' ') : '')
    stroke.setAttribute('fill', 'none')
    stroke.setAttribute('stroke', '#60a5fa')
    stroke.setAttribute('stroke-width', '1.6')
    stroke.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(stroke)
    if (points.length === 1) {
      var dot = document.createElementNS(svgNs, 'circle')
      dot.setAttribute('cx', String(width / 2))
      dot.setAttribute('cy', line[0].split(' ')[1])
      dot.setAttribute('r', '2.6')
      dot.setAttribute('fill', '#60a5fa')
      svg.appendChild(dot)
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
    if (data && data.panels && data.panels.indexOf('recent') === -1) return
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
    if (data && data.panels && data.panels.indexOf('accounts') === -1) return
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
    if (data && data.panels && data.panels.indexOf('scheduler') === -1) return
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
    if (data && data.rangeLabel) sub.textContent = '· ' + data.rangeLabel
    else sub.textContent = ''
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
    footText.textContent = parts.filter(Boolean).join(' · ')
    footText.style.color = state.error || (data && data.error) ? '#fca5a5' : '#8199b8'
  }

  /* ------------------------------------------------------------------ fetch */

  function fetchSnapshot(force, quiet) {
    if (state.busy && !force) return Promise.resolve()
    state.busy = true
    if (!quiet) footText.textContent = '正在刷新…'
    var url = BASE + '/api/snapshot?range=' + encodeURIComponent(state.range) + (force ? '&force=1' : '')
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
        if (Array.isArray(config.ranges) && config.ranges.length) state.ranges = config.ranges
        if (!state.store.range && config.range) state.range = config.range
        if (config.refreshMs) state.refreshMs = Math.max(3000, Number(config.refreshMs) || state.refreshMs)
        renderRanges()
      })
      .catch(function () {
        /* keep fallbacks */
      })
  }

  function startPolling() {
    if (state.timer) window.clearInterval(state.timer)
    state.timer = window.setInterval(function () {
      if (document.hidden) return
      void fetchSnapshot(false, true)
    }, state.refreshMs)
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) void fetchSnapshot(false, true)
    })
  }

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
      renderRanges()
      return fetchSnapshot(false)
    })
    startPolling()
  }

  mount()
})()
