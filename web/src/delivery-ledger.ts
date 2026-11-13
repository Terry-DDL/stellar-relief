import historical from './evidence.json' with { type: 'json' }
import { accountBytes, validateOrder, verifyRecord, verifyDelivery, verifyApproval } from './delivery-evidence.ts'
import type { DeliveryOrder, SignedRecord } from './delivery-evidence.ts'
import { contractInstanceKey, readTestnet, verifyTestnet } from './testnet.ts'

export type DeliveryBundle = {
  order: DeliveryOrder
  agency: string
  amount: 10 | 100
  fundHash: string
  delivery: SignedRecord | null
  receipt: SignedRecord | null
  settlementHash: string | null
  approval: string | null
}

const txHash = /^[0-9a-f]{64}$/
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

export async function inspectBundle(bundle: DeliveryBundle) {
  const { order, agency, amount, fundHash, delivery, receipt, settlementHash, approval } = bundle
  if (!order || (delivery !== null && typeof delivery !== 'object')
    || (receipt !== null && typeof receipt !== 'object')) throw new Error('Invalid order bundle.')
  validateOrder(order)
  accountBytes(agency)
  if (order.contractId === historical.contractId || [order.supplier, order.shop, order.verifier].includes(agency)
    || (amount !== 10 && amount !== 100) || typeof fundHash !== 'string' || !txHash.test(fundHash)
    || (settlementHash !== null && (typeof settlementHash !== 'string' || !txHash.test(settlementHash)))
    || (receipt && !delivery) || (settlementHash && !receipt)
    || (settlementHash === null ? approval !== null : typeof approval !== 'string')) {
    throw new Error('Invalid or historical order bundle.')
  }
  if (receipt && delivery) {
    const digest = await verifyDelivery(order, delivery, receipt)
    if (settlementHash) await verifyApproval(order, digest, settlementHash, bundle.approval ?? '')
    return digest
  }
  if (delivery) await verifyRecord(order, delivery, 'delivery', null)
  return null
}

// The settlement CLI only emits a standard TX envelope with simple time bounds.
// Read its source and invocation prefix from the confirmed RPC envelope.
export function checkSettlementEnvelope(xdr: string, order: DeliveryOrder) {
  if (typeof xdr !== 'string' || xdr.length > 24_000) throw new Error('Missing or oversized settlement envelope.')
  const bytes = Uint8Array.from(atob(xdr), (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  let offset = 0
  function take(length: number) {
    const start = offset
    offset += length
    if (offset > bytes.length) throw new Error('Incomplete settlement envelope.')
    return bytes.subarray(start, offset)
  }
  const u32 = () => { const start = offset; take(4); return view.getUint32(start) }
  const expect = (expected: number) => { if (u32() !== expected) throw new Error('Unexpected settlement transaction structure.') }
  expect(2) // ENVELOPE_TYPE_TX
  expect(0) // KEY_TYPE_ED25519
  if (hex(take(32)) !== hex(accountBytes(order.verifier))) throw new Error('Settlement source is not the designated verifier.')
  take(12) // Fee and sequence
  expect(1) // PRECOND_TIME
  take(16)
  expect(0) // MEMO_NONE
  expect(1) // One operation
  expect(0) // No operation-source override
  expect(24) // INVOKE_HOST_FUNCTION
  expect(0) // HOST_FUNCTION_TYPE_INVOKE_CONTRACT
  expect(1) // SC_ADDRESS_TYPE_CONTRACT
  if (hex(take(32)) !== hex(contractBytes(order.contractId))) throw new Error('Settlement targeted a different contract.')
  expect(12)
  if (new TextDecoder().decode(take(12)) !== 'settle_batch') throw new Error('Expected settle_batch.')
  expect(2)
  expect(3); expect(order.batchId)
  expect(3); expect(order.quantity)
}

function contractBytes(address: string) {
  return Uint8Array.from(atob(contractInstanceKey(address)).slice(8, 40), (c) => c.charCodeAt(0))
}

export async function verifyOrderOnTestnet(bundle: DeliveryBundle, digest: string | null, request = fetch) {
  const { order, agency, amount, fundHash, settlementHash } = bundle
  const total = amount * historical.asset.unitsPerToken
  const evidence = {
    ...historical, contractId: order.contractId,
    roles: { agency, wholesaler: order.supplier, shop: order.shop, verifier: order.verifier },
    batch: { id: order.batchId, quantity: order.quantity, status: 'Funded',
      amounts: { total, wholesaler: total * 7 / 10, shop: total * 3 / 10 } },
  }
  const current = await verifyTestnet(evidence, request)
  if (current.mismatches.some((field) => field !== 'batch status')) throw new Error('Order does not match current Testnet contract fields.')
  const fund = await readTestnet('getTransaction', { hash: fundHash }, request)
  if (fund.status !== 'SUCCESS' || fund.txHash !== fundHash || !Number.isSafeInteger(fund.ledger) || fund.ledger < 1) {
    throw new Error('Funding transaction has not been independently confirmed by this RPC.')
  }
  // Do not attach a successful but unrelated transaction to this order.
  if (!fundingMatches(fund.envelopeXdr, bundle)) throw new Error('Funding transaction is not for this order.')

  if (!settlementHash) return { status: current.status, funding: true, settlement: null, ledger: current.ledger }
  const result = await readTestnet('getTransaction', { hash: settlementHash }, request)
  if (result.status === 'NOT_FOUND') return { status: current.status, funding: true, settlement: 'NOT_FOUND', ledger: current.ledger }
  if (!['SUCCESS', 'FAILED'].includes(result.status) || result.txHash !== settlementHash
    || !Number.isSafeInteger(result.ledger) || result.ledger <= fund.ledger) throw new Error('Unexpected settlement receipt.')
  if (!digest) throw new Error('Signed delivery and receipt are required to verify settlement.')
  await verifyApproval(order, digest, settlementHash, bundle.approval ?? '')
  checkSettlementEnvelope(result.envelopeXdr, order)
  if (result.status === 'SUCCESS' && current.status !== 'Settled') throw new Error('RPC receipt and live order state disagree. Try again.')
  return { status: current.status, funding: true, settlement: result.status as 'SUCCESS' | 'FAILED', ledger: result.ledger as number }
}

function fundingMatches(xdr: string, bundle: DeliveryBundle) {
  if (typeof xdr !== 'string' || xdr.length > 24_000) return false
  const bytes = Uint8Array.from(atob(xdr), (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  const read = (offset: number) => view.getUint32(offset)
  // The existing setup runner emits a single source-account invocation without a memo.
  if (bytes.length < 108 || read(0) !== 2 || read(4) !== 0 || hex(bytes.slice(8, 40)) !== hex(accountBytes(bundle.agency))) return false
  let offset = 52
  const cond = read(offset)
  offset += 4
  if (cond === 1) offset += 16
  else if (cond !== 0) return false
  if ([0, 1, 0, 24, 0, 1].some((word, i) => read(offset + 4 * i) !== word)) return false
  offset += 24
  if (hex(bytes.slice(offset, offset + 32)) !== hex(contractBytes(bundle.order.contractId))) return false
  offset += 32
  if (read(offset) !== 10 || new TextDecoder().decode(bytes.slice(offset + 4, offset + 14)) !== 'fund_batch') return false
  offset += 16
  const takeWord = () => { const word = read(offset); offset += 4; return word }
  if (takeWord() !== 7 || takeWord() !== 3 || takeWord() !== bundle.order.batchId
    || takeWord() !== 3 || takeWord() !== bundle.order.quantity) return false
  for (const address of [bundle.order.supplier, bundle.order.shop, bundle.order.verifier]) {
    if (takeWord() !== 18 || takeWord() !== 0 || takeWord() !== 0
      || hex(bytes.slice(offset, offset + 32)) !== hex(accountBytes(address))) return false
    offset += 32
  }
  for (const share of [7, 3]) {
    if (takeWord() !== 10 || view.getBigInt64(offset) !== 0n
      || view.getBigUint64(offset + 8) !== BigInt(bundle.amount * historical.asset.unitsPerToken * share / 10)) return false
    offset += 16
  }
  return true
}
