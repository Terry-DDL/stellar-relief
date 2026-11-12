import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chromium } from 'playwright-core'

const evidence = JSON.parse(readFileSync(new URL('../src/evidence.json', import.meta.url)))
const dist = new URL('../dist/', import.meta.url)
const mime = { html: 'text/html', js: 'application/javascript', css: 'text/css' }
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html'
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
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', (request) => requests.push(request.url()))
  const nav = page.getByRole('navigation', { name: 'Role views' })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const visible = (text) => page.getByText(text, { exact: true }).first().waitFor()
  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor()
  await page.goto(origin)
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
  await heading('Locked funding')
  await heading('Received payment')
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
  await context.setOffline(true)
  await page.reload()
  await heading('Voucher redemption')
  await visible('Browser offline')
  await visible('Shop confirmed 3 kits.')
  await voucher.fill(' br-1-01 ')
  await button('Record redemption').click()
  await visible('BR-1-01 recorded on this browser.')
  await visible('Pending sync')
  await page.reload()
  await visible('1 of 3 redeemed')
  await voucher.fill('BR-1-01')
  await button('Record redemption').click()
  await visible('BR-1-01 was already redeemed on this browser.')
  assert.equal(await button('Simulate reconciliation').isEnabled(), false)
  await context.setOffline(false)
  await visible('Browser online')
  await visible('Pending sync')
  await button('Simulate reconciliation').click()
  await visible('Reconciled (demo)')
  await page.reload()
  await visible('Reconciled (demo)')
  console.log('PASS delivery, voucher validation, duplicate refusal, persistence, and reconciliation')

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

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const role of ['Agency', 'Supplier', 'Local Shop', 'Verification']) {
      await nav.getByRole('link', { name: role, exact: true }).click()
      await nav.locator('a[aria-current=page]').getByText(role, { exact: true }).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${role} overflows at ${width}px`)
    }
  }
  assert.deepEqual(errors, [])
  assert.ok(requests.every((url) => url.startsWith(origin + '/') || url === rpc + '/'), 'The UI made an unexpected external request')
  console.log('PASS verification balances, reset, all four layouts at 320/390/1440px, no browser errors or external requests')
} finally {
  await browser?.close()
  server.close()
}
