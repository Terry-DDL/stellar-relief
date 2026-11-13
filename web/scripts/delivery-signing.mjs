// Internal CLI bridge. Only signed records, public addresses and digests leave this process.
import { createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { accountBytes, approvalPayload, recordPayload, validateOrder, verifyApproval, verifyDelivery, verifyRecord } from '../src/delivery-evidence.ts'

try {
  const { order, kind, alias, delivery, receipt, digest, txHash, approval } = JSON.parse(readFileSync(0, 'utf8'))
  validateOrder(order)
  if (process.argv[2] === 'verify') {
    console.log(JSON.stringify(await verifyDelivery(order, delivery, receipt)))
  } else if (process.argv[2] === 'verify-approval') {
    await verifyApproval(order, digest, txHash, approval)
    console.log('true')
  } else if (process.argv[2] === 'sign') {
    if (!['delivery', 'receipt', 'approval'].includes(kind) || !/^[\w-]{1,64}$/.test(alias)) throw new Error('Expected a local Stellar CLI identity alias.')
    if (kind === 'receipt') await verifyRecord(order, delivery, 'delivery', null)
    const signer = kind === 'delivery' ? order.supplier : kind === 'receipt' ? order.shop : order.verifier
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('STELLAR_')))
    const stellar = (...args) => {
      const result = spawnSync('stellar', args, { encoding: 'utf8', env, timeout: 30_000 })
      if (result.status !== 0) throw new Error('Could not access the local Stellar CLI identity.')
      return result.stdout.trim()
    }
    if (stellar('keys', 'address', alias) !== signer) throw new Error('Local identity does not match the funded order.')
    // The Stellar CLI exports the software seed only to this local process.
    // No seed is passed as an argument, printed, sent to the browser, or written to disk.
    const encoded = stellar('keys', 'secret', alias)
    if (!/^S[A-Z2-7]{55}$/.test(encoded)) throw new Error('This identity does not expose a local software signing seed.')
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const bits = Array.from(encoded, (char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('')
    const seed = Buffer.from(bits.slice(8, 264).match(/.{8}/g).map((byte) => parseInt(byte, 2)))
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
    let privateKey
    try {
      privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
    } finally {
      seed.fill(0)
      der.fill(0)
    }
    const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32)
    if (!publicKey.equals(Buffer.from(accountBytes(signer)))) throw new Error('Local seed does not match the expected signer.')
    if (kind === 'approval') {
      const verifiedDigest = await verifyDelivery(order, delivery, receipt)
      if (verifiedDigest !== digest) throw new Error('Approval evidence digest changed.')
      console.log(JSON.stringify(sign(null, approvalPayload(order, digest, txHash), privateKey).toString('base64')))
    } else {
      const record = { kind, id: randomBytes(16).toString('hex'), deliveryId: kind === 'receipt' ? delivery.id : null, signer, quantity: order.quantity }
      const signature = sign(null, recordPayload(order, record), privateKey).toString('base64')
      console.log(JSON.stringify({ ...record, signature }))
    }
  } else {
    throw new Error('Unknown signing command.')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
