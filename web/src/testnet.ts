// Decode only the Soroban XDR types used by this deployed contract's instance.
// LedgerEntryData is returned by getLedgerEntries, so no transaction is built.
const RPC = 'https://soroban-testnet.stellar.org'
const PASSPHRASE = 'Test SDF Network ; September 2015'
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const XDR = {
  contractData: 6, contractAddress: 1, persistent: 1,
  ledgerKeyContractInstance: 20, contractInstance: 19, wasm: 0,
  address: 18, accountAddress: 0, publicKeyEd25519: 0,
  symbol: 15, u32: 3, i128: 10, vector: 16, map: 17,
} as const

type Evidence = {
  contractId: string
  wasmHash: string
  asset: { sac: string }
  batch: { id: number; quantity: number; status: string; amounts: { total: number; wholesaler: number; shop: number } }
  roles: { agency: string; wholesaler: string; shop: string; verifier: string }
}

function addressBytes(address: string) {
  if (!/^[CG][A-Z2-7]{55}$/.test(address)) throw new Error('Invalid evidence address.')
  const bits = Array.from(address, (character) => BASE32.indexOf(character).toString(2).padStart(5, '0')).join('')
  // Stellar StrKey wraps the 32-byte address in a version byte and checksum.
  return Uint8Array.from(bits.slice(8, 264).match(/.{8}/g)!, (byte) => parseInt(byte, 2))
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')

export function contractInstanceKey(contractId: string) {
  const data = new Uint8Array(48)
  const view = new DataView(data.buffer)
  view.setUint32(0, XDR.contractData)
  view.setUint32(4, XDR.contractAddress)
  data.set(addressBytes(contractId), 8)
  view.setUint32(40, XDR.ledgerKeyContractInstance)
  view.setUint32(44, XDR.persistent)
  return btoa(String.fromCharCode(...data))
}

type Value = string | number | bigint | Value[] | Map<string, Value>

function readInstance(encoded: string) {
  if (encoded.length > 16_384) throw new Error('Unexpectedly large contract instance.')
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  let offset = 0
  const unsupported = () => { throw new Error('Unsupported or malformed contract instance XDR.') }
  const read = (length: number) => {
    if (offset + length > bytes.length) return unsupported()
    const start = offset
    offset += length
    return bytes.subarray(start, offset)
  }
  const u32 = () => { const start = offset; read(4); return view.getUint32(start) }
  const expect = (expected: number) => { if (u32() !== expected) unsupported() }
  const count = () => { const length = u32(); return length <= 32 ? length : unsupported() }
  const map = (depth: number, enumKeys = false): Map<string, Value> => {
    const fields = new Map<string, Value>()
    const length = count()
    for (let index = 0; index < length; index++) {
      const rawKey = value(depth)
      const key = enumKeys && Array.isArray(rawKey) && rawKey.length === 1 ? rawKey[0] : enumKeys ? null : rawKey
      if (typeof key !== 'string' || fields.has(key)) return unsupported()
      fields.set(key, value(depth))
    }
    return fields
  }
  const value = (depth: number): Value => {
    if (depth > 4) return unsupported()
    switch (u32()) {
      case XDR.u32: return u32()
      case XDR.i128: {
        const start = offset
        read(16)
        return (view.getBigInt64(start) << 64n) | view.getBigUint64(start + 8)
      }
      case XDR.symbol: {
        const length = count()
        const symbol = new TextDecoder('utf-8', { fatal: true }).decode(read(length))
        read((4 - length % 4) % 4)
        return symbol
      }
      case XDR.address: {
        const kind = u32()
        if (kind === XDR.accountAddress) expect(XDR.publicKeyEd25519)
        else if (kind !== XDR.contractAddress) return unsupported()
        return `${kind}:${hex(read(32))}`
      }
      case XDR.vector: expect(1); return Array.from({ length: count() }, () => value(depth + 1))
      case XDR.map: expect(1); return map(depth + 1)
      default: return unsupported()
    }
  }
  expect(XDR.contractData)
  expect(0) // ContractDataEntry.ext
  expect(XDR.contractAddress)
  const contract = hex(read(32))
  expect(XDR.ledgerKeyContractInstance)
  expect(XDR.persistent)
  expect(XDR.contractInstance)
  expect(XDR.wasm)
  const wasmHash = hex(read(32))
  expect(1) // SCContractInstance.storage is present
  const storage = map(0, true)
  if (offset !== bytes.length) unsupported()
  return { contract, wasmHash, storage }
}

function expectAddress(address: string) {
  const kind = address.startsWith('C') ? XDR.contractAddress : XDR.accountAddress
  return `${kind}:${hex(addressBytes(address))}`
}

export async function readTestnet(method: 'getNetwork' | 'getLedgerEntries' | 'getTransaction', params: object, request = fetch) {
  let response: Response
  try {
    response = await request(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    throw new Error('Stellar Testnet RPC could not be reached. Check connectivity, RPC availability, or browser CORS policy.')
  }
  if (!response.ok) throw new Error(`Stellar Testnet RPC returned HTTP ${response.status}.`)
  const payload = await response.json()
  if (payload?.id !== method || payload.error || !payload.result) {
    throw new Error(`Stellar Testnet RPC did not return a valid ${method} result.`)
  }
  return payload.result
}

export async function verifyTestnet(evidence: Evidence, request = fetch) {
  const network = await readTestnet('getNetwork', {}, request)
  if (network.passphrase !== PASSPHRASE) throw new Error('RPC did not identify itself as Stellar Testnet.')
  const key = contractInstanceKey(evidence.contractId)
  const result = await readTestnet('getLedgerEntries', { keys: [key] }, request)
  if (!Number.isSafeInteger(result.latestLedger) || result.latestLedger < 1 || !Array.isArray(result.entries)) {
    throw new Error('Stellar RPC did not return a valid ledger response.')
  }
  const entry = result.entries.find((item: { key?: string }) => item?.key === key)
  if (!entry) throw new Error('Contract instance unavailable on Testnet. It may have expired or Testnet may have reset.')
  if (!Number.isSafeInteger(entry.liveUntilLedgerSeq) || entry.liveUntilLedgerSeq < result.latestLedger) {
    throw new Error('RPC did not return a currently live contract instance.')
  }
  if (typeof entry.xdr !== 'string') throw new Error('Stellar RPC did not return the contract instance XDR.')
  const current = readInstance(entry.xdr)
  if (current.contract !== hex(addressBytes(evidence.contractId))) throw new Error('RPC returned a different contract.')
  const batch = current.storage.get('Batch')
  if (!(batch instanceof Map)) throw new Error('Batch not found in the current Testnet contract instance.')
  const state = batch.get('status')
  const status = Array.isArray(state) && state.length === 1 ? state[0] : null
  if (status !== 'Funded' && status !== 'Settled') throw new Error('Unknown Testnet batch status.')
  const comparisons = [
    ['WASM hash', current.wasmHash, evidence.wasmHash],
    ['USDC asset contract', current.storage.get('Asset'), expectAddress(evidence.asset.sac)],
    ['configured agency', current.storage.get('Agency'), expectAddress(evidence.roles.agency)],
    ['batch ID', batch.get('id'), evidence.batch.id],
    ['quantity', batch.get('quantity'), evidence.batch.quantity],
    ['batch status', status, evidence.batch.status],
    ['total amount', batch.get('total_amount'), BigInt(evidence.batch.amounts.total)],
    ['wholesaler amount', batch.get('wholesaler_amount'), BigInt(evidence.batch.amounts.wholesaler)],
    ['shop amount', batch.get('shop_amount'), BigInt(evidence.batch.amounts.shop)],
    ...Object.entries(evidence.roles).map(([role, address]) => [role, batch.get(role), expectAddress(address)]),
  ]
  return {
    ledger: result.latestLedger as number,
    status,
    mismatches: comparisons.filter(([, actual, expected]) => actual !== expected).map(([field]) => String(field)),
  }
}
