import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const evidence = JSON.parse(readFileSync(new URL('../src/evidence.json', import.meta.url)))
const origin = 'http://stellar-relief.test'
const dist = new URL('../dist/', import.meta.url)
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  const requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', (request) => requests.push(request.url()))
  // Serve the production output inside Playwright, without binding a port.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    if (url.origin !== origin || !/^(index\.html|assets\/[\w.-]+)$/.test(file)) {
      await route.abort()
      return
    }
    await route.fulfill({ path: fileURLToPath(new URL(file, dist)) })
  })
  const nav = page.getByRole('navigation', { name: 'Role views' })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const visible = (text) => page.getByText(text, { exact: true }).first().waitFor()
  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor()
  await page.goto(origin)
  await heading('Agency overview')
  await visible('Batch 001 · Settled')
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
  await button('Record demo delivery').click()
  await visible('Delivered · recorded on this browser')

  await nav.getByRole('link', { name: 'Local Shop' }).click()
  await heading('Voucher redemption')
  const voucher = page.getByLabel('Voucher code')
  await voucher.fill('OTHER-SHOP')
  await button('Record redemption').click()
  await visible('Unknown voucher for this batch and shop.')
  await voucher.fill(' br-1-01 ')
  await button('Record redemption').click()
  await visible('BR-1-01 recorded on this browser.')
  await visible('Pending sync')
  await page.reload()
  await visible('1 of 3 redeemed')
  await voucher.fill('BR-1-01')
  await button('Record redemption').click()
  await visible('BR-1-01 was already redeemed on this browser.')
  assert.equal(await button('Reconcile records').isEnabled(), false)
  await button('Simulate online').click()
  await button('Reconcile records').click()
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
  await nav.getByRole('link', { name: 'Local Shop' }).click()
  await button('Reset demo').click()
  await visible('0 of 3 redeemed')
  await visible('Offline')
  await visible('Batch 001 · Settled')

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const role of ['Agency', 'Supplier', 'Local Shop', 'Verification']) {
      await nav.getByRole('link', { name: role, exact: true }).click()
      await nav.locator('a[aria-current=page]').getByText(role, { exact: true }).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${role} overflows at ${width}px`)
    }
  }
  assert.deepEqual(errors, [])
  assert.ok(requests.every((url) => url.startsWith(origin + '/')), 'The UI made an unexpected external request')
  console.log('PASS verification balances, reset, all four layouts at 320/390/1440px, no browser errors or external requests')
} finally {
  await browser?.close()
}
