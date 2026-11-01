/**
 * Dev utility: dump the host theme the panel should adopt.
 *
 *   node scripts/screenshot.mjs <dsh-url> <tmp.png> --eval-file scripts/probe-theme.js
 *
 * Prints the resolved DSH design tokens (they are defined on <body> and inherit
 * into the panel's shadow root) plus the panel's own `--wb-*` variables and the
 * colours it actually paints, so a theme change can be verified without
 * eyeballing a screenshot.
 */
(() => {
  const names = [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-border-l1',
    '--dsw-alias-border-l2',
    '--dsw-alias-brand-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-warn-primary',
    '--dsw-alias-state-error-primary',
    '--dsw-font-family',
  ]
  const bodyStyle = getComputedStyle(document.body)
  const rootStyle = getComputedStyle(document.documentElement)
  const tokens = {}
  for (const name of names) {
    tokens[name] = (bodyStyle.getPropertyValue(name) || rootStyle.getPropertyValue(name) || '').trim()
  }

  const host = document.querySelector('[data-wb-dash="root"]')
  const panel = host && host.shadowRoot
  const win = panel && panel.querySelector('.wb-win')
  const card = panel && panel.querySelector('.wb-kpi')
  const pick = (node, props) => {
    if (!node) return null
    const s = getComputedStyle(node)
    const out = {}
    for (const prop of props) out[prop] = s[prop]
    return out
  }
  const vars = {}
  if (host) {
    for (const name of ['--wb-bg', '--wb-bg-rgb', '--wb-fg', '--wb-fg2', '--wb-fg3', '--wb-line', '--wb-accent', '--wb-ok', '--wb-font']) {
      vars[name] = host.style.getPropertyValue(name).trim()
    }
  }

  return {
    dark: document.body.hasAttribute('data-ds-dark-theme'),
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    appearance: host ? host.getAttribute('data-wb-appearance') : null,
    tokens,
    panel: {
      present: Boolean(panel),
      hostVars: host ? vars : null,
      win: pick(win, ['backgroundColor', 'backgroundImage', 'color', 'borderTopColor', 'fontFamily', 'opacity']),
      card: pick(card, ['backgroundColor', 'color', 'borderTopColor']),
      kpiCount: panel ? panel.querySelectorAll('.wb-kpi').length : 0,
      kpiLabels: panel ? Array.from(panel.querySelectorAll('.wb-kpi .wb-kpi-label')).map((n) => n.textContent) : [],
      windowOpacity: win ? getComputedStyle(win).opacity : null,
    },
  }
})()
