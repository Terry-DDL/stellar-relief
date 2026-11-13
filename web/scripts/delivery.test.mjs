import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import historical from '../src/evidence.json' with { type: 'json' }
import { approvalPayload, recordPayload, verifyDelivery } from '../src/delivery-evidence.ts'
import { checkSettlementEnvelope, inspectBundle, verifyOrderOnTestnet } from '../src/delivery-ledger.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contractInstanceKey } from '../src/testnet.ts'

function publicAddress(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const versioned = Buffer.concat([Buffer.from([48]), bytes])
  let crc = 0
  for (const byte of versioned) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff
  }
  const bits = Array.from(Buffer.concat([versioned, Buffer.from([crc & 255, crc >>> 8])]), (n) => n.toString(2).padStart(8, '0')).join('')
  return bits.match(/.{5}/g).map((chunk) => alphabet[parseInt(chunk, 2)]).join('')
}

const supplier = generateKeyPairSync('ed25519')
const shop = generateKeyPairSync('ed25519')
const verifier = generateKeyPairSync('ed25519')
const order = {
  contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  batchId: 1, quantity: 3, verifier: publicAddress(verifier.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
  supplier: publicAddress(supplier.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
  shop: publicAddress(shop.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
}
function signed(record, key) {
  return { ...record, signature: sign(null, recordPayload(order, record), key).toString('base64') }
}
const delivery = signed({ kind: 'delivery', id: '01'.repeat(16), deliveryId: null, signer: order.supplier, quantity: 3 }, supplier.privateKey)
const receipt = signed({ kind: 'receipt', id: '02'.repeat(16), deliveryId: delivery.id, signer: order.shop, quantity: 3 }, shop.privateKey)
const settlementHash = '22'.repeat(32)
const digest = await verifyDelivery(order, delivery, receipt)
const approval = sign(null, approvalPayload(order, digest, settlementHash), verifier.privateKey).toString('base64')
const bundle = { order, agency: historical.roles.agency, amount: 10, delivery, receipt, fundHash: '11'.repeat(32), settlementHash, approval }

test('independent signatures verify and commit to the exact linked pair', async () => {
  const digest = await inspectBundle(bundle)
  assert.match(digest, /^[0-9a-f]{64}$/)
  assert.equal(digest, await verifyDelivery(order, delivery, receipt))
  assert.equal(await inspectBundle({ ...bundle, receipt: null, settlementHash: null, approval: null }), null)
  await assert.rejects(inspectBundle({ ...bundle, settlementHash: null }), /Invalid or historical order/)
  await assert.rejects(inspectBundle({ ...bundle, settlementHash: '33'.repeat(32) }), /verifier approval signature/)
  await assert.rejects(inspectBundle({ ...bundle, approval: receipt.signature }), /verifier approval signature/)
})

test('missing, mismatched, tampered or replayed evidence fails verification', async () => {
  await assert.rejects(inspectBundle({ ...bundle, delivery: null }), /Invalid or historical order/)
  await assert.rejects(verifyDelivery(order, { ...delivery, signature: '' }, receipt), /signature/)
  await assert.rejects(verifyDelivery(order, delivery, { ...receipt, signature: delivery.signature }), /signature/)
  await assert.rejects(verifyDelivery(order, delivery, { ...receipt, quantity: 2 }), /quantity/)
  await assert.rejects(verifyDelivery(order, delivery, { ...receipt, deliveryId: '03'.repeat(16) }), /evidence ID/)
  await assert.rejects(verifyDelivery(order, delivery, { ...receipt, id: delivery.id }), /evidence ID/)
  await assert.rejects(verifyDelivery({ ...order, contractId: historical.contractId }, delivery, receipt), /signature/)
})

const stellar = (args, input) => execFileSync('stellar', args, { input, encoding: 'utf8' }).trim()
const encode = (type, value) => stellar(['xdr', 'encode', '--type', type], JSON.stringify(value))
function envelope(source, name, args, memo, cond) {
  return stellar(['tx', 'encode'], JSON.stringify({ tx: { signatures: [], tx: {
    source_account: source, fee: 100, seq_num: '1', memo, cond, ext: 'v0',
    operations: [{ source_account: null, body: { invoke_host_function: {
      host_function: { invoke_contract: { contract_address: order.contractId, function_name: name, args } }, auth: [],
    } } }],
  } } }))
}

test('receipt lookup distinguishes funded, failed, unknown and confirmed settlement', async () => {
  const digest = await inspectBundle(bundle)
  const fundedTx = envelope(bundle.agency, 'fund_batch', [{ u32: 1 }, { u32: 3 },
    ...[order.supplier, order.shop, order.verifier].map((address) => ({ address })),
    { i128: '70000000' }, { i128: '30000000' }], 'none', 'none')
  const condition = { time: { min_time: '0', max_time: '2000000000' } }
  const settledTx = envelope(order.verifier, 'settle_batch', [{ u32: 1 }, { u32: 3 }], 'none', condition)
  assert.doesNotThrow(() => checkSettlementEnvelope(settledTx, order))
  assert.throws(() => checkSettlementEnvelope(settledTx, { ...order, verifier: bundle.agency }), /designated verifier/)

  const xdr = readFileSync(new URL('./fixtures/settled-instance.xdr', import.meta.url), 'utf8').trim()
  const instance = JSON.parse(stellar(['xdr', 'decode', '--type', 'LedgerEntryData', '--input', 'single-base64'], xdr))
  instance.contract_data.contract = order.contractId
  const fields = instance.contract_data.val.contract_instance.storage.find(({ key }) => key.vec[0].symbol === 'Batch').val.map
  for (const field of fields) {
    if (field.key.symbol === 'wholesaler') field.val.address = order.supplier
    if (field.key.symbol === 'shop') field.val.address = order.shop
    if (field.key.symbol === 'verifier') field.val.address = order.verifier
  }
  const mock = (status, liveStatus, settlementEnvelope = settledTx, fundingEnvelope = fundedTx) => {
    fields.find(({ key }) => key.symbol === 'status').val.vec[0].symbol = liveStatus
    const instanceXdr = encode('LedgerEntryData', instance)
    return async (_url, { body }) => {
      const { method, params } = JSON.parse(body)
      const result = method === 'getNetwork' ? { passphrase: 'Test SDF Network ; September 2015' }
        : method === 'getLedgerEntries' ? { latestLedger: 50, entries: [{ key: contractInstanceKey(order.contractId), xdr: instanceXdr, liveUntilLedgerSeq: 100 }] }
        : params.hash === bundle.fundHash ? { txHash: bundle.fundHash, status: 'SUCCESS', ledger: 40, envelopeXdr: fundingEnvelope }
        : { txHash: bundle.settlementHash, status, ledger: 48, envelopeXdr: settlementEnvelope }
      return Response.json({ id: method, result })
    }
  }
  assert.deepEqual(await verifyOrderOnTestnet(bundle, digest, mock('SUCCESS', 'Settled')), { status: 'Settled', funding: true, settlement: 'SUCCESS', ledger: 48 })
  assert.equal((await verifyOrderOnTestnet(bundle, digest, mock('FAILED', 'Funded'))).settlement, 'FAILED')
  assert.equal((await verifyOrderOnTestnet(bundle, digest, mock('NOT_FOUND', 'Funded'))).settlement, 'NOT_FOUND')
  await assert.rejects(verifyOrderOnTestnet(bundle, digest, mock('SUCCESS', 'Funded')), /disagree/)
  await assert.rejects(verifyOrderOnTestnet(bundle, digest, mock('SUCCESS', 'Settled', settledTx, settledTx)), /Funding transaction is not/)
  await assert.rejects(verifyOrderOnTestnet(bundle, digest, mock('SUCCESS', 'Settled', fundedTx)), /designated verifier/)
})

test('local CLI bridge signs with distinct disposable Stellar keys', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relief-key-test-'))
  try {
    const env = { ...process.env, XDG_CONFIG_HOME: directory }
    const cli = (...args) => execFileSync('stellar', args, { env, cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    const parties = { ...order }
    for (const role of ['supplier', 'shop', 'verifier']) {
      cli('keys', 'generate', role)
      parties[role] = cli('keys', 'address', role)
    }
    const bridge = (command, payload) => JSON.parse(execFileSync(process.execPath, [
      '--disable-warning=ExperimentalWarning', '--experimental-strip-types',
      fileURLToPath(new URL('./delivery-signing.mjs', import.meta.url)), command,
    ], { env, cwd: directory, input: JSON.stringify({ order: parties, ...payload }), encoding: 'utf8' }))
    const delivery = bridge('sign', { kind: 'delivery', alias: 'supplier' })
    const receipt = bridge('sign', { kind: 'receipt', alias: 'shop', delivery })
    const digest = await verifyDelivery(parties, delivery, receipt)
    const approval = bridge('sign', { kind: 'approval', alias: 'verifier', digest, txHash: settlementHash, delivery, receipt })
    assert.equal(bridge('verify-approval', { digest, txHash: settlementHash, approval }), true)
    assert.equal(await inspectBundle({ ...bundle, order: parties, delivery, receipt, approval }), digest)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
