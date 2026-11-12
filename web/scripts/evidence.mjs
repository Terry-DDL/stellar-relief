import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const runId = 'f141f179b1d94e349421b48e0bfbafe6'
const original = new URL(`../../target/testnet-e2e-usdc/${runId}/report.md`, import.meta.url)
const published = new URL('../../docs/testnet-evidence.md', import.meta.url)
const source = process.argv.includes('--original') ? original : published
const report = readFileSync(source, 'utf8')
const read = (pattern, group = 1) => {
  const match = report.match(pattern)
  assert.ok(match, `Missing report evidence for ${pattern}`)
  return match[group]
}
const code = '\x60'
const contractPattern = new RegExp(`^- Business Contract ID: \\[${code}(C[A-Z2-7]{55})${code}\\]\\(([^)]+)\\)`, 'm')
const contractId = read(contractPattern)
const contractUrl = read(contractPattern, 2)
const assetPattern = new RegExp(`^- Asset: ${code}(USDC):(G[A-Z2-7]{55})${code} / SAC ${code}(C[A-Z2-7]{55})${code}$`, 'm')
const network = read(/^- Network: (Stellar Testnet) \(/m)
assert.match(report, /Test SDF Network ; September 2015/)
assert.equal(read(new RegExp(`^- Run ID: ${code}([a-f0-9]{32})${code}$`, 'm')), runId)

function batchAt(phase) {
  return JSON.parse(read(new RegExp(`${code}get_batch${code} — ${phase}\\s+${code.repeat(3)}json\\n([\\s\\S]+?)\\n${code.repeat(3)}`)))
}
const funded = batchAt('funded')
const settled = batchAt('settled')
assert.equal(batchAt('before_funding'), null)
assert.equal(funded.status, 'Funded')
assert.equal(settled.status, 'Settled')
assert.deepEqual({ ...funded, status: 'Settled' }, settled)
assert.equal(Number(read(new RegExp(`^- Batch ID: ${code}(\\d+)${code}$`, 'm'))), settled.id)
assert.equal(settled.quantity, 3)

const roles = Object.fromEntries(['agency', 'wholesaler', 'shop', 'verifier'].map((role) => {
  const account = read(new RegExp(`^- ${role}: ${code}(G[A-Z2-7]{55})${code}$`, 'm'))
  assert.equal(settled[role], account)
  return [role, account]
}))
const transactions = Object.fromEntries(['upload', 'deploy', 'fund', 'settle'].map((stage) => {
  const pattern = new RegExp(`^- ${stage} transaction: \\[${code}([a-f0-9]{64})${code}\\]\\(([^)]+)\\) — submitted and RPC SUCCESS, ledger (\\d+)\\.$`, 'm')
  const hash = read(pattern)
  const url = read(pattern, 2)
  assert.equal(url, `https://stellar.expert/explorer/testnet/tx/${hash}`)
  return [stage, { hash, url, ledger: Number(read(pattern, 3)), status: 'SUCCESS' }]
}))
assert.equal(contractUrl, `https://stellar.expert/explorer/testnet/contract/${contractId}`)
assert.ok(transactions.upload.ledger < transactions.deploy.ledger)
assert.ok(transactions.deploy.ledger < transactions.fund.ledger)
assert.ok(transactions.fund.ledger < transactions.settle.ledger)

const amounts = {
  total: Number(settled.total_amount),
  wholesaler: Number(settled.wholesaler_amount),
  shop: Number(settled.shop_amount),
}
const unitsPerToken = 10_000_000
assert.ok(Object.values(amounts).every((amount) => Number.isSafeInteger(amount) && amount > 0))
assert.equal(amounts.total, amounts.wholesaler + amounts.shop)
assert.ok(report.includes(`Settlement: ${amounts.total / unitsPerToken} USDC → ${amounts.wholesaler / unitsPerToken} USDC (wholesaler) + ${amounts.shop / unitsPerToken} USDC (shop)`))

const snapshots = Object.fromEntries(['before_funding', 'funded', 'settled'].map((phase) => {
  const pattern = new RegExp(`^\\| ${phase} \\| ([0-9,]+) \\| ([0-9,]+) \\| ([0-9,]+) \\| ([0-9,]+) \\|$`, 'm')
  return [phase, Object.fromEntries(['agency', 'escrow', 'wholesaler', 'shop'].map((role, index) => [
    role, Number(read(pattern, index + 1).replaceAll(',', '')),
  ]))]
}))
assert.deepEqual(snapshots, {
  before_funding: { agency: amounts.total, escrow: 0, wholesaler: 0, shop: 0 },
  funded: { agency: 0, escrow: amounts.total, wholesaler: 0, shop: 0 },
  settled: { agency: 0, escrow: 0, wholesaler: amounts.wholesaler, shop: amounts.shop },
})
assert.ok(report.includes('Batch and balance reads and negative checks were simulations; no transaction submitted for these.'))
const negativeChecks = Object.fromEntries([
  ['authorization', 'Error(Auth, InvalidAction)'],
  ['quantity', 'Error(Contract, #2)'],
  ['duplicate', 'Error(Contract, #5)'],
].map(([check, error]) => {
  const block = read(new RegExp(`\\*\\*${check}: PASS\\*\\*\\s+${code.repeat(3)}text\\n([\\s\\S]+?)\\n${code.repeat(3)}`))
  assert.ok(block.includes(error), `Mismatched ${check} result`)
  return [check, { result: 'PASS', error }]
}))

const wasmHash = read(new RegExp(`^- WASM Hash: ${code}([a-f0-9]{64})${code}$`, 'm'))
const evidence = {
  runId, network, contractId, contractUrl, wasmHash,
  asset: { code: read(assetPattern), issuer: read(assetPattern, 2), sac: read(assetPattern, 3), unitsPerToken },
  batch: { id: settled.id, quantity: settled.quantity, status: settled.status, amounts },
  roles, transactions, snapshots, negativeChecks,
}
const output = new URL('../src/evidence.json', import.meta.url)
const json = JSON.stringify(evidence, null, 2) + '\n'
if (process.argv.includes('--write')) writeFileSync(output, json)
else assert.equal(readFileSync(output, 'utf8'), json, 'The public evidence does not match the original E2E report')
console.log(`Verified USDC evidence against ${fileURLToPath(source)}.`)
