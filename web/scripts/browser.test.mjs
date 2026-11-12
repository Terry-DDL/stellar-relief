import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chromium } from 'playwright-core'

const evidence = JSON.parse(readFileSync(new URL('../src/evidence.json', import.meta.url)))
const dist = new URL('../dist/', import.meta.url)
const mime = { html: 'text/html', js: 'application/javascript', css: 'text/css' }
const probePath = '/__test__/network'
let probeHits = 0
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html'
  if (request.method === 'GET' && `/${path}` === probePath) {
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end(String(++probeHits))
    return
  }
  if (path === 'favicon.ico') {
    response.writeHead(204).end()
    return
  }
  if (!/^(index\.html|sw\.js|assets\/[\w.-]+)$/.test(path)) {
    response.writeHead(404).end()
    return
  }
  let file
  try {
    file = readFileSync(new URL(path, dist))
  } catch {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, {
    'Content-Type': mime[path.split('.').at(-1)],
    'Cache-Control': 'no-store',
  }).end(file)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  const requests = []
  let offline = false
  let phase = 'initial online visit'
  const requestPhases = new WeakMap()
  const optionalOfflineUrls = new Set(['/favicon.ico', '/sw.js'].map((path) => origin + path))
  const probeUrl = origin + probePath
  const disconnected = 'net::ERR_INTERNET_DISCONNECTED'
  function checkFailure(source, url, reason, when = { offline, phase }) {
    const disconnectedRequest = source === 'console'
      ? reason === `Failed to load resource: ${disconnected}`
      : source === 'request GET' && reason === disconnected
    const optional = optionalOfflineUrls.has(url) || (url === probeUrl && when.phase === 'offline network probe')
    const expected = when.offline && disconnectedRequest && optional
    const diagnostic = `[${when.phase}] ${source}: ${url || '(URL unavailable)'} · ${reason}`
    console.log(`${expected ? 'EXPECTED' : 'UNEXPECTED'} ${diagnostic}`)
    if (!expected) errors.push(diagnostic)
  }

  page.on('pageerror', (error) => errors.push(`[${phase}] JavaScript: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // Playwright filters favicon requests from page network events.
    checkFailure('console', message.location().url, message.text())
  })
  page.on('request', (request) => {
    requests.push(request.url())
    requestPhases.set(request, { offline, phase })
  })
  page.on('requestfailed', (request) => {
    checkFailure(`request ${request.method()}`, request.url(), request.failure()?.errorText, requestPhases.get(request))
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      errors.push(`[${requestPhases.get(response.request())?.phase ?? phase}] HTTP ${response.status()}: ${response.url()}`)
    }
  })
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const visible = (text) => page.getByText(text, { exact: true }).first().waitFor()
  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor()
  const initial = await page.goto(origin)
  assert.ok(initial?.ok() && !initial.fromServiceWorker(), 'Initial visit must load from the server')
  const assets = await page.locator('script[src], link[rel="stylesheet"]').evaluateAll((elements) =>
    elements.map((element) => element.src ?? element.href))
  assert.ok(assets.length >= 2, 'Production HTML must reference its script and stylesheet')
  async function reloadOffline() {
    const assetResponses = assets.map((url) => page.waitForResponse(url))
    const responses = await Promise.all([page.reload(), ...assetResponses])
    for (const response of responses) {
      assert.ok(response?.ok() && response.fromServiceWorker(),
        `[${phase}] Expected a successful service worker response for ${response?.url() ?? 'the document'}`)
    }
  }

  await heading('Ship with confidence.')
  await heading('NGO secures funding')
  const funding = page.getByRole('link', { name: 'View funding transaction' })
  assert.equal(await funding.getAttribute('href'), evidence.transactions.fund.url)
  assert.equal(await nav.getByRole('link', { name: 'Guided Demo' }).getAttribute('aria-current'), 'page')
  await nav.getByRole('link', { name: 'Agency', exact: true }).click()
  await heading('Agency overview')
  await visible('Batch 001 · Settled (recorded)')
  for (const link of [evidence.contractUrl, evidence.transactions.fund.url, evidence.transactions.settle.url]) {
    assert.ok(await page.locator(`a[href="${link}"]`).count(), `Missing explorer link ${link}`)
  }

  await button('Start historical replay').click()
  for (let play = 0; play < 2; play++) {
    await heading('Agency locks funding')
    for (let index = 0; index < 5; index++) await button('Next step').click()
    await heading('Stellar settles both payments')
    await visible('Replay status · Settled')
    await button('Restart replay').click()
  }
  console.log('PASS agency evidence and two complete replay runs')

  await nav.getByRole('link', { name: 'Supplier' }).click()
  await heading('Supplier workspace')
  await heading('Supplier payment assurance')
  await heading('Live Testnet verification')
  await page.getByText(/Settlement requires the assigned verifier to confirm delivery/).waitFor()
  assert.ok(await page.getByText(evidence.roles.wholesaler, { exact: true }).isVisible())
  assert.ok(await page.getByText(evidence.roles.verifier, { exact: true }).isVisible())
  await page.getByLabel('Quantity delivered').fill('3')
  await button('Record demo delivery').click()
  await visible('Supplier recorded 3 kits. Awaiting shop confirmation.')

  await nav.getByRole('link', { name: 'Local Shop' }).click()
  await heading('Voucher redemption')
  const voucher = page.getByLabel('Voucher code')
  await voucher.fill('OTHER-SHOP')
  await button('Record redemption').click()
  await visible('Unknown voucher for this batch and shop.')
  await voucher.fill('BR-1-01')
  await button('Record redemption').click()
  await visible('Confirm the shop receipt before redeeming a voucher.')
  const quantity = page.getByLabel('Quantity received')
  await quantity.fill('2')
  await button('Confirm demo receipt').click()
  await visible('Received quantity must match the supplier record.')
  await quantity.fill('3')
  await button('Confirm demo receipt').click()
  await visible('Shop confirmed 3 kits.')
  await page.getByText(/App cached for offline reopening/).waitFor()
  phase = 'first offline reload'
  offline = true
  await context.setOffline(true)
  await reloadOffline()
  await heading('Voucher redemption')
  await visible('Browser offline')
  await visible('Shop confirmed 3 kits.')
  await voucher.fill(' br-1-01 ')
  await button('Record redemption').click()
  await visible('BR-1-01 recorded on this browser.')
  await visible('Pending sync')
  phase = 'offline persistence reload'
  await reloadOffline()
  await visible('1 of 3 redeemed')
  await voucher.fill('BR-1-01')
  await button('Record redemption').click()
  await visible('BR-1-01 was already redeemed on this browser.')
  assert.equal(await button('Simulate reconciliation').isEnabled(), false)

  phase = 'offline navigation'
  for (const [role, title] of [
    ['Agency', 'Agency overview'],
    ['Supplier', 'Supplier workspace'],
    ['Verification', 'Verification & settlement'],
    ['Local Shop', 'Voucher redemption'],
  ]) {
    await nav.getByRole('link', { name: role, exact: true }).click()
    await heading(title)
    if (role === 'Verification') assert.equal(await button('Verify on Stellar Testnet').isEnabled(), false)
  }
  await visible('1 of 3 redeemed')

  phase = 'offline network probe'
  const reachedServerOffline = await page.evaluate(async (path) => {
    try {
      await fetch(path, { cache: 'no-store' })
      return true
    } catch {
      return false
    }
  }, probePath)
  assert.equal(reachedServerOffline, false, 'The uncached network probe must fail while offline')
  assert.equal(probeHits, 0, 'The offline probe must not reach the server')

  await context.setOffline(false)
  offline = false
  phase = 'online recovery'
  await visible('Browser online')
  const serverReply = await page.evaluate(async (path) => {
    const response = await fetch(path, { cache: 'no-store' })
    return { status: response.status, body: await response.text() }
  }, probePath)
  assert.deepEqual(serverReply, { status: 200, body: '1' })
  assert.equal(probeHits, 1, 'The online probe must reach the real HTTP server')
  await visible('Pending sync')
  await button('Simulate reconciliation').click()
  await visible('Reconciled (demo)')
  await page.reload()
  await visible('Reconciled (demo)')
  console.log('PASS offline shell and assets, voucher persistence and duplicate refusal, role navigation, and real HTTP recovery')

  await nav.getByRole('link', { name: 'Verification' }).click()
  await heading('Verification & settlement')
  await heading('USDC balance snapshots')
  assert.match(await page.getByRole('row', { name: /^Supplier/ }).innerText(), /0 USDC\s+0 USDC\s+7 USDC/)
  assert.match(await page.getByRole('row', { name: /^Local Shop/ }).innerText(), /0 USDC\s+0 USDC\s+3 USDC/)
  await visible('Duplicate settlement rejected')
  await visible('Supplier · Recorded delivery of 3 kits')
  await visible('Local Shop · Confirmed receipt of 3 kits')
  await visible('Local Shop · Redeemed BR-1-01')
  const rpc = 'https://soroban-testnet.stellar.org'
  await context.route(rpc + '/', async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    const { id } = route.request().postDataJSON()
    await route.fulfill({ headers, json: { jsonrpc: '2.0', id, error: { code: -32603, message: 'Fixture RPC failure' } } })
  })
  await button('Verify on Stellar Testnet').click()
  await page.getByText(/Verification unavailable/).waitFor()
  assert.equal(await page.getByText(/Live state matches/).count(), 0)
  await nav.getByRole('link', { name: 'Local Shop' }).click()
  await button('Reset demo').click()
  await visible('0 of 3 redeemed')
  await visible('Browser online')
  await visible('Batch 001 · Settled (recorded)')

  await nav.getByRole('link', { name: 'Guided Demo' }).click()
  await heading('NGO secures funding')
  assert.ok(await button('Previous step').isDisabled())
  await button('Next step').click()
  await heading('Supplier verifies before dispatch')
  await button('Verify on Stellar Testnet').click()
  await page.getByText(/Verification unavailable/).waitFor()
  await button('Previous step').click()
  await heading('NGO secures funding')
  await button('Next step').click()
  await button('Next step').click()
  await heading('Goods delivered & vouchers redeemed')
  await page.getByLabel('Quantity delivered').fill('3')
  await button('Record demo delivery').click()
  await page.getByLabel('Quantity received').fill('2')
  await button('Confirm demo receipt').click()
  await visible('Received quantity must match the supplier record.')
  await page.getByLabel('Quantity received').fill('3')
  await button('Confirm demo receipt').click()
  await button('Use sample voucher').click()
  await button('Record redemption').click()
  await visible('BR-1-01 recorded on this browser.')
  await button('Use sample voucher').click()
  await button('Record redemption').click()
  await visible('BR-1-01 was already redeemed on this browser.')
  await button('Next step').click()
  await heading('Settlement verified')
  const settlement = page.getByRole('link', { name: 'View settlement transaction' })
  assert.equal(await settlement.getAttribute('href'), evidence.transactions.settle.url)
  await button('Restart walkthrough').click()
  await heading('NGO secures funding')
  console.log('PASS default Guided Demo, four steps, live check, receipt and voucher safeguards, settlement link')

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const role of ['Guided Demo', 'Agency', 'Supplier', 'Local Shop', 'Verification']) {
      await nav.getByRole('link', { name: role, exact: true }).click()
      await nav.locator('a[aria-current=page]').getByText(role, { exact: true }).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${role} overflows at ${width}px`)
    }
  }
  assert.deepEqual(errors, [])
  assert.ok(requests.every((url) => url.startsWith(origin + '/') || url === rpc + '/'), 'The UI made an unexpected external request')
  console.log('PASS verification balances, reset, all five views at 320/390/1440px, no browser errors or external requests')
} finally {
  await browser?.close()
  server.close()
}
