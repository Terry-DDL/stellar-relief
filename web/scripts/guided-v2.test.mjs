import assert from 'node:assert/strict'
import test from 'node:test'
import { start, update, summarize, vouchers } from '../src/guided-v2.ts'

const at = '2026-11-13T00:00:00Z'
const act = (state, action) => update(state, action, at).state
const donate = (donor) => ({ type: 'donate', donor })
const vote = (donor, proposal) => ({ type: 'vote', donor, proposal })
const approve = { type: 'approve' }
const funded = () => act(act(start(), donate(0)), donate(1))
const approved = () => act(act(act(funded(), vote(0, 0)), vote(1, 1)), approve)

test('contributions and votes are one-use and require the full pool', () => {
  const partial = act(start(), donate(0))
  assert.equal(summarize(partial).total, 6)
  assert.equal(act(partial, donate(0)), partial)
  assert.equal(act(partial, vote(0, 0)), partial)
  const voted = act(funded(), vote(0, 0))
  assert.equal(act(voted, vote(0, 1)), voted)
  assert.deepEqual(summarize(approved()).tallies, [6, 4])
  assert.equal(approved().winner, 0)
  const alternative = act(act(act(funded(), vote(0, 1)), vote(1, 0)), approve)
  assert.deepEqual(summarize(alternative).tallies, [4, 6])
  assert.equal(alternative.winner, 1)
  assert.deepEqual(alternative.votes, [1, 0])
  assert.equal(act(act(funded(), vote(1, 1)), approve).winner, null)
})

test('dispatch, receipt, offline voucher records and issuer attestation gate settlement', () => {
  const dispatch = { type: 'dispatch' }
  const receive = { type: 'receive' }
  const settle = { type: 'settle' }
  const attest = { type: 'attest' }
  const redeem = (code) => ({ type: 'redeem', code })
  assert.equal(act(start(), dispatch).field.delivery, null)
  assert.equal(act(approved(), receive).field.delivery, null)
  let state = act(act(approved(), dispatch), receive)
  assert.equal(act(state, settle), state)
  assert.equal(act(state, attest), state)
  assert.equal(act(state, redeem('BR-1-01')), state)
  state = act(state, redeem(' vr-001 '))
  assert.equal(act(state, redeem('VR-001')), state)
  assert.deepEqual([summarize(state).distributed, summarize(state).inventory.shop], [1, 2])
  state = JSON.parse(JSON.stringify(state))
  assert.equal(act(state, redeem('VR-001')), state)
  for (const code of vouchers.slice(1)) state = act(state, redeem(code))
  assert.equal(act(state, settle), state)
  state = act(act(state, attest), settle)
  assert.equal(state.settled, true)
  assert.equal(act(state, settle), state)
  assert.deepEqual(summarize(start()).tallies, [0, 0])
})

test('money and kits are conserved throughout the mission', () => {
  let state = start()
  const check = (funds, kits) => {
    const { balances, inventory, total } = summarize(state)
    assert.deepEqual(balances, { contract: funds[0], supplier: funds[1], shop: funds[2] })
    assert.deepEqual(inventory, { supplier: kits[0], transit: kits[1], shop: kits[2], families: kits[3] })
    assert.equal(funds.reduce((sum, amount) => sum + amount), total)
    assert.equal(kits.reduce((sum, count) => sum + count), 3)
    assert.ok(kits.every((count) => count >= 0))
  }
  const next = (action) => { state = act(state, action) }
  const supplier = [3, 0, 0, 0]
  const held = [10, 0, 0]
  check([0, 0, 0], supplier)
  next({ type: 'dispatch' })
  next({ type: 'receive' })
  next({ type: 'settle' })
  check([0, 0, 0], supplier)
  next(donate(0))
  check([6, 0, 0], supplier)
  next(donate(1))
  check(held, supplier)
  next(vote(0, 0))
  next(vote(1, 1))
  next(approve)
  check(held, supplier)
  next({ type: 'dispatch' })
  check(held, [0, 3, 0, 0])
  next({ type: 'receive' })
  check(held, [0, 0, 3, 0])
  next({ type: 'redeem', code: vouchers[0] })
  check(held, [0, 0, 2, 1])
  state = JSON.parse(JSON.stringify(state))
  next({ type: 'redeem', code: vouchers[0] })
  check(held, [0, 0, 2, 1])
  for (const code of vouchers.slice(1)) next({ type: 'redeem', code })
  check(held, [0, 0, 0, 3])
  next({ type: 'settle' })
  check(held, [0, 0, 0, 3])
  next({ type: 'attest' })
  check(held, [0, 0, 0, 3])
  next({ type: 'settle' })
  next({ type: 'settle' })
  check([0, 7, 3], [0, 0, 0, 3])
  state = start()
  check([0, 0, 0], supplier)
})
