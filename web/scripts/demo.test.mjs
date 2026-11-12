import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceReplay, readDemo, redeem, reconcile, resetDemo, storeDemo, scopeVouchers } from '../src/demo.ts'

const { key, codes: vouchers } = scopeVouchers('contract', 1, 'shop', 3)

function storage() {
  const data = new Map()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
}

test('a valid voucher is saved once, and duplicate and foreign codes are rejected', () => {
  const disk = storage()
  const result = redeem(readDemo(disk, key), vouchers, vouchers[0].toLowerCase(), '2026-11-12T01:00:00Z')
  assert.equal(result.ok, true)
  storeDemo(disk, key, result.state)
  const reloaded = readDemo(disk, key)
  assert.equal(reloaded.redemptions.length, 1)
  assert.equal(reloaded.redemptions[0].synced, false)
  assert.equal(redeem(reloaded, vouchers, vouchers[0], '').ok, false)
  assert.equal(redeem(reloaded, vouchers, 'OTHER-BATCH-01', '').ok, false)
})

test('reconciliation requires simulated connectivity and is idempotent', () => {
  const disk = storage()
  const pending = redeem(readDemo(disk, key), vouchers, vouchers[0], '2026-11-12T01:00:00Z').state
  assert.equal(reconcile(pending).redemptions[0].synced, false)
  const online = { ...pending, online: true }
  const synced = reconcile(online)
  storeDemo(disk, key, synced)
  assert.deepEqual(reconcile(readDemo(disk, key)), synced)
  assert.equal(synced.redemptions[0].synced, true)
})

test('reset clears only the demo and a replay can be completed twice', () => {
  const disk = storage()
  disk.setItem('unrelated', 'retained')
  storeDemo(disk, key, { ...readDemo(disk, key), delivered: true, online: true })
  resetDemo(disk, key)
  assert.equal(readDemo(disk, key).delivered, false)
  assert.equal(readDemo(disk, key).online, false)
  assert.equal(disk.getItem('unrelated'), 'retained')
  const play = () => [0, 1, 2, 3, 4].reduce((phase) => advanceReplay(phase, 1), 0)
  assert.equal(play(), 5)
  assert.equal(play(), 5)
  assert.equal(advanceReplay(5, 1), 5)
  assert.equal(advanceReplay(0, -1), 0)
})
