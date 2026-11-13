const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const deliveryDomain = 'stellar-relief/verified-delivery/v1'
export const testnet = 'Test SDF Network ; September 2015'

export type DeliveryOrder = {
  contractId: string
  batchId: number
  quantity: number
  supplier: string
  shop: string
  verifier: string
}
export type SignedRecord = {
  kind: 'delivery' | 'receipt'
  id: string
  deliveryId: string | null
  signer: string
  quantity: number
  signature: string
}

function strkey(value: string, version: number) {
  if (!/^[A-Z2-7]{56}$/.test(value)) throw new Error('Invalid Stellar address.')
  const bits = Array.from(value, (c) => base32.indexOf(c).toString(2).padStart(5, '0')).join('')
  const bytes = Uint8Array.from(bits.match(/.{8}/g)!, (byte) => parseInt(byte, 2))
  let crc = 0
  for (const byte of bytes.subarray(0, 33)) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff
  }
  if (bytes[0] !== version || crc !== (bytes[33] | bytes[34] << 8)) throw new Error('Invalid Stellar address checksum or type.')
  return bytes.slice(1, 33)
}

export const accountBytes = (address: string) => strkey(address, 48)

export function validateOrder(order: DeliveryOrder) {
  strkey(order.contractId, 16)
  if (order.batchId !== 1 || order.quantity !== 3) throw new Error('Expected batch #001 with three kits.')
  const participants = [order.supplier, order.shop, order.verifier]
  if (new Set(participants).size !== 3) throw new Error('Supplier, shop and verifier must be distinct.')
  participants.forEach(accountBytes)
}

export function recordPayload(order: DeliveryOrder, record: Omit<SignedRecord, 'signature'>) {
  return new TextEncoder().encode(JSON.stringify([
    deliveryDomain, testnet, order.contractId, order.batchId, order.quantity,
    order.supplier, order.shop, order.verifier,
    record.kind, record.id, record.deliveryId, record.signer, record.quantity,
  ]))
}

const evidenceId = /^[0-9a-f]{32}$/

export async function verifyRecord(order: DeliveryOrder, record: SignedRecord, kind: SignedRecord['kind'], deliveryId: string | null) {
  if (record?.kind !== kind || typeof record.id !== 'string' || !evidenceId.test(record.id) || record.id === deliveryId
    || record.deliveryId !== deliveryId || record.quantity !== order.quantity
    || record.signer !== (kind === 'delivery' ? order.supplier : order.shop)) {
    throw new Error(`Invalid ${kind} order, quantity, identity or evidence ID.`)
  }
  await verifySignature(record.signer, record.signature, recordPayload(order, record), kind)
}

async function verifySignature(signer: string, signature: string, payload: Uint8Array<ArrayBuffer>, kind: string) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) {
    throw new Error(`Missing or invalid ${kind} signature.`)
  }
  const decoded = atob(signature)
  if (btoa(decoded) !== signature) throw new Error(`Noncanonical ${kind} signature.`)
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', accountBytes(signer), 'Ed25519', false, ['verify'])
  if (!await crypto.subtle.verify('Ed25519', key, bytes, payload)) throw new Error(`Invalid ${kind} signature.`)
}

export function approvalPayload(order: DeliveryOrder, digest: string, txHash: string) {
  if (![digest, txHash].every((value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value))) {
    throw new Error('Invalid approval digest or transaction hash.')
  }
  return new TextEncoder().encode(JSON.stringify([
    deliveryDomain, 'settlement-approval', testnet, order.contractId, order.batchId, order.verifier, digest, txHash,
  ]))
}

export async function verifyApproval(order: DeliveryOrder, digest: string, txHash: string, signature: string) {
  await verifySignature(order.verifier, signature, approvalPayload(order, digest, txHash), 'verifier approval')
}

export async function verifyDelivery(order: DeliveryOrder, delivery: SignedRecord, receipt: SignedRecord) {
  validateOrder(order)
  await verifyRecord(order, delivery, 'delivery', null)
  await verifyRecord(order, receipt, 'receipt', delivery.id)
  const commitment = new TextEncoder().encode(JSON.stringify([
    deliveryDomain,
    [delivery.id, delivery.signature],
    [receipt.id, receipt.signature],
  ]))
  const digest = await crypto.subtle.digest('SHA-256', commitment)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
