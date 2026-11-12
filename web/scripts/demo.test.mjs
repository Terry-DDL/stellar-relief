import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceReplay, confirmReceipt, deliveryTimeline, readDemo, recordDelivery, redeem, reconcile, resetDemo, storeDemo, scopeVouchers } from '../src/demo.ts'

const batchId = 1
const { key, codes: vouchers } = scopeVouchers('contract', batchId, 'shop', 3)
const at = (second) => `2026-11-12T01:00:0${second}Z`
const empty = { delivery: null, redemptions: [] }
const delivered = (quantity = 3) => recordDelivery(empty, batchId, quantity, 3, at(1)).state
const received = (quantity = 3) => confirmReceipt(delivered(quantity), batchId, quantity, at(2)).state
const useVoucher = (state, code) => redeem(state, batchId, vouchers, code, at(3))

function storage() {
  const data = new Map()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
}

test('shop must separately confirm the correct batch and supplier quantity before redemption', () => {
  assert.equal(recordDelivery(empty, batchId, 0, 3, at(1)).ok, false)
  assert.equal(recordDelivery(empty, batchId, 3.5, 3, at(1)).ok, false)
  assert.equal(recordDelivery(delivered(), batchId, 3, 3, at(1)).ok, false)
  assert.equal(confirmReceipt(empty, batchId, 3, at(2)).ok, false)
  assert.equal(confirmReceipt(delivered(), 2, 3, at(2)).ok, false)
  assert.equal(confirmReceipt(delivered(), batchId, 2, at(2)).ok, false)
  assert.equal(useVoucher(delivered(), vouchers[0]).ok, false)
  assert.equal(confirmReceipt(received(), batchId, 3, at(2)).ok, false)
  const state = useVoucher(received(), vouchers[0]).state
  assert.deepEqual(deliveryTimeline(state).map(({ actor, at }) => [actor, at]), [
    ['Supplier', at(1)], ['Local Shop', at(2)], ['Local Shop', at(3)],
  ])
})

test('a voucher is saved once, foreign codes are rejected and confirmed stock caps redemption', () => {
  const disk = storage()
  const result = useVoucher(received(1), vouchers[0].toLowerCase())
  assert.equal(result.ok, true)
  storeDemo(disk, key, result.state)
  const reloaded = readDemo(disk, key)
  assert.equal(reloaded.delivery.receipt.quantity, 1)
  assert.equal(reloaded.redemptions.length, 1)
  assert.equal(reloaded.redemptions[0].synced, false)
  assert.match(useVoucher(reloaded, vouchers[0]).message, /already redeemed/)
  assert.match(useVoucher(reloaded, vouchers[1]).message, /All confirmed kits/)
  assert.match(useVoucher(reloaded, 'OTHER-BATCH-01').message, /Unknown voucher/)
})

test('reconnection preserves pending records until explicit simulated reconciliation', () => {
  const disk = storage()
  const pending = useVoucher(received(), vouchers[0]).state
  assert.equal(reconcile(pending, false).ok, false)
  storeDemo(disk, key, pending)
  assert.equal(readDemo(disk, key).redemptions[0].synced, false)
  const reconciled = reconcile(readDemo(disk, key), true)
  assert.equal(reconciled.state.redemptions[0].synced, true)
  assert.deepEqual(reconcile(reconciled.state, true).state, reconciled.state)
})

test('legacy records retain redeemed codes without inferring a signed or confirmed receipt', () => {
  const disk = storage()
  disk.setItem(key, JSON.stringify({ delivered: true, online: true, redemptions: [{ code: vouchers[0], at: at(3), synced: true }] }))
  const state = readDemo(disk, key)
  assert.equal(state.delivery, null)
  assert.match(useVoucher(state, vouchers[0]).message, /already redeemed/)
  assert.match(useVoucher(state, vouchers[1]).message, /Confirm the shop receipt/)
})

test('reset clears only the demo and a replay can be completed twice', () => {
  const disk = storage()
  disk.setItem('unrelated', 'retained')
  storeDemo(disk, key, received())
  resetDemo(disk, key)
  assert.deepEqual(readDemo(disk, key), empty)
  assert.equal(disk.getItem('unrelated'), 'retained')
  const play = () => [0, 1, 2, 3, 4].reduce((phase) => advanceReplay(phase, 1), 0)
  assert.equal(play(), 5)
  assert.equal(play(), 5)
  assert.equal(advanceReplay(5, 1), 5)
  assert.equal(advanceReplay(0, -1), 0)
})
