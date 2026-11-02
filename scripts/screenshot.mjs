/**
 * Dev utility: screenshot a page through the DevTools protocol.
 *
 *   node scripts/screenshot.mjs <url> <out.png> [--wait 6000] [--size 1440x900] [--scale 1]
 *
 * Chromium's `--screenshot` mode hangs on pages that keep a WebSocket open
 * (the harness UI does), so this drives a headless Edge over CDP instead and
 * captures after a fixed settle delay. Nothing here ships with the plugin at
 * runtime; it is only used to produce documentation images.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const url = args[0]
const outPath = args[1]
if (!url || !outPath) {
  console.error('usage: node scripts/screenshot.mjs <url> <out.png> [--wait ms] [--size WxH] [--scale n]')
  process.exit(2)
}

function flag(name, fallback) {
  const index = args.indexOf('--' + name)
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback
}

const waitMs = Number(flag('wait', '6000'))
const [width, height] = flag('size', '1440x900').split('x').map(Number)
const scale = Number(flag('scale', '1'))
const port = 9333 + Math.floor(Math.random() * 200)
// Any Chromium build will do; `EDGE_PATH` wins, otherwise the usual install spots.
const browserPath = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
].filter(Boolean).find((candidate) => existsSync(candidate))
if (!browserPath) {
  console.error('no Chromium-based browser found; set EDGE_PATH to its executable')
  process.exit(2)
}
const profile = await mkdtemp(join(tmpdir(), 'wb-cdp-'))

const child = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--window-size=' + width + ',' + height,
  '--force-device-scale-factor=' + scale,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function endpoint(path, init) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + path, init)
      if (response.ok) return response
    } catch {
      /* browser still starting */
    }
    await sleep(150)
  }
  throw new Error('devtools endpoint ' + path + ' never became ready')
}

try {
  await endpoint('/json/version')
  const created = await endpoint('/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  const target = await created.json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.method + ': ' + JSON.stringify(message.error)))
      else resolve(message.result)
    }
  })

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: false,
  })
  await send('Page.navigate', { url })
  await sleep(waitMs)

  const evalFile = flag('eval-file', '')
  const expression = evalFile ? await readFile(evalFile, 'utf8') : flag('eval', '')
  if (expression) {
    await send('Runtime.enable')
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) {
      console.log('eval ✗ ' + (result.exceptionDetails.exception
        ? result.exceptionDetails.exception.description || result.exceptionDetails.exception.value
        : result.exceptionDetails.text))
    } else {
      console.log('eval → ' + JSON.stringify(result.result && result.result.value))
    }
    await sleep(1200)
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(outPath, Buffer.from(shot.data, 'base64'))
  console.log('saved ' + outPath)
  socket.close()
} finally {
  child.kill()
}
