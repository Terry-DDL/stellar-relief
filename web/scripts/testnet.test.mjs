import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { contractInstanceKey, verifyTestnet } from '../src/testnet.ts'

const evidence = JSON.parse(readFileSync(new URL('../src/evidence.json', import.meta.url)))
// Fixture encoded with Stellar CLI LedgerEntryData from the recorded settled fields.
const xdr = readFileSync(new URL('./fixtures/settled-instance.xdr', import.meta.url), 'utf8').trim()
const key = 'AAAABgAAAAGdkG1QbdGA7JFSgYzxqrBPPMCyQSEJfPcgTH3Gi6XOnwAAABQAAAAB'
const passphrase = 'Test SDF Network ; September 2015'
const ledger = 5688200
const instance = { key, xdr, liveUntilLedgerSeq: ledger + 1 }

function rpc({ network = passphrase, entries = [instance], methods = [] } = {}) {
  return async (url, init) => {
    const body = JSON.parse(init.body)
    assert.equal(url, 'https://soroban-testnet.stellar.org')
    assert.equal(init.method, 'POST')
    assert.equal(init.cache, 'no-store')
    methods.push(body.method)
    assert.ok(['getNetwork', 'getLedgerEntries'].includes(body.method))
    if (body.method === 'getLedgerEntries') assert.deepEqual(body.params, { keys: [key] })
    const result = body.method === 'getNetwork' ? { passphrase: network } : { latestLedger: ledger, entries }
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  }
}

test('reads a Stellar CLI-compatible instance and compares all recorded fields', async () => {
  const methods = []
  assert.equal(contractInstanceKey(evidence.contractId), key)
  assert.deepEqual(await verifyTestnet(evidence, rpc({ methods })), { ledger, status: 'Settled', mismatches: [] })
  assert.deepEqual(methods, ['getNetwork', 'getLedgerEntries'])
})

test('reports a live mismatch separately from historical evidence', async () => {
  const expected = structuredClone(evidence)
  expected.batch.amounts.shop++
  expected.asset.sac = expected.contractId
  const bytes = Buffer.from(xdr, 'base64')
  const offset = bytes.indexOf('Settled')
  assert.ok(offset > 4)
  bytes.writeUInt32BE(6, offset - 4)
  bytes.write('Funded\0', offset)
  const live = { ...instance, xdr: bytes.toString('base64') }
  assert.deepEqual(await verifyTestnet(expected, rpc({ entries: [live] })), {
    ledger, status: 'Funded', mismatches: ['USDC asset contract', 'batch status', 'shop amount'],
  })
})

test('RPC failure, wrong network, expired state and malformed XDR cannot return success', async () => {
  await assert.rejects(verifyTestnet(evidence, async () => { throw new TypeError('Failed to fetch') }), /could not be reached/)
  await assert.rejects(verifyTestnet(evidence, async () => new Response('', { status: 503 })), /HTTP 503/)
  await assert.rejects(verifyTestnet(evidence, rpc({ network: 'Public Global Stellar Network ; September 2015' })), /did not identify/)
  await assert.rejects(verifyTestnet(evidence, rpc({ entries: [] })), /unavailable/)
  await assert.rejects(verifyTestnet(evidence, rpc({ entries: [{ ...instance, liveUntilLedgerSeq: 0 }] })), /currently live/)
  await assert.rejects(verifyTestnet(evidence, rpc({ entries: [{ ...instance, xdr: 'AA==' }] })), /malformed/)
})
