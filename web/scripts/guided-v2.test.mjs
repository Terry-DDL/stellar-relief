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
  assert.deepEqual([summarize(state).distributed, summarize(state).remaining], [1, 2])
  state = JSON.parse(JSON.stringify(state))
  assert.equal(act(state, redeem('VR-001')), state)
  for (const code of vouchers.slice(1)) state = act(state, redeem(code))
  assert.equal(act(state, settle), state)
  state = act(act(state, attest), settle)
  assert.equal(state.settled, true)
  assert.equal(act(state, settle), state)
  assert.deepEqual(summarize(start()).tallies, [0, 0])
})
