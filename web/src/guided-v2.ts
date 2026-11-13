import { confirmReceipt, recordDelivery, redeem } from './demo.ts'
import type { Demo } from './demo.ts'

export const storageKey = 'stellar-relief:guided-v2:sample'
export const donors = [6, 4] as const
export const proposals = ['Coastal Flood Relief', 'Mountain Landslide Relief'] as const
export const vouchers = ['VR-001', 'VR-002', 'VR-003']
export const quantity = vouchers.length
export const target = 10
export const supplierAmount = 7
export const shopAmount = 3
const orderId = 1

type Choice = 0 | 1
type State = {
  deposits: [boolean, boolean]
  votes: [Choice | null, Choice | null]
  winner: Choice | null
  field: Demo
  attested: boolean
  settled: boolean
}

type Action =
  | { type: 'donate'; donor: Choice }
  | { type: 'vote'; donor: Choice; proposal: Choice }
  | { type: 'redeem'; code: string }
  | { type: 'approve' | 'dispatch' | 'receive' | 'attest' | 'settle' }

export function start(): State {
  return { deposits: [false, false], votes: [null, null], winner: null,
    field: { delivery: null, redemptions: [] }, attested: false, settled: false }
}

export function summarize(state: State) {
  const total = donors.reduce((sum, amount, index) => sum + (state.deposits[index] ? amount : 0), 0)
  const tallies = proposals.map((_, proposal) =>
    donors.reduce((sum, amount, index) => sum + (state.votes[index] === proposal ? amount : 0), 0))
  const dispatched = state.field.delivery?.quantity ?? 0
  const received = state.field.delivery?.receipt?.quantity ?? 0
  const distributed = state.field.redemptions.length
  const balances = state.settled
    ? { contract: 0, supplier: supplierAmount, shop: shopAmount }
    : { contract: total, supplier: 0, shop: 0 }
  const inventory = {
    supplier: quantity - dispatched,
    transit: dispatched - received,
    shop: received - distributed,
    families: distributed,
  }
  return { total, tallies, dispatched, received, distributed, balances, inventory }
}

export function update(state: State, action: Action, at: string): { state: State; message: string } {
  const done = (changes: Partial<State>, message: string) => ({ state: { ...state, ...changes }, message })
  const unchanged = (message: string) => ({ state, message })
  const { total, tallies, distributed } = summarize(state)
  switch (action.type) {
    case 'donate': {
      if (state.deposits[action.donor]) return unchanged('This donor has already contributed.')
      const deposits: State['deposits'] = [...state.deposits]
      deposits[action.donor] = true
      return done({ deposits }, `+${donors[action.donor]} USDC to the relief contract.`)
    }
    case 'vote': {
      if (total !== target || state.winner !== null || state.votes[action.donor] !== null) {
        return unchanged('Voting requires a full pool and one vote per donor.')
      }
      const votes: State['votes'] = [...state.votes]
      votes[action.donor] = action.proposal
      return done({ votes }, `+${donors[action.donor]} vote weight for ${proposals[action.proposal]}.`)
    }
    case 'approve': {
      if (state.winner !== null) return unchanged('The sample order is already approved.')
      const winner = tallies.findIndex((weight) => weight > target / 2)
      if (total !== target || (winner !== 0 && winner !== 1)) return unchanged('A proposal needs more than half the funded pool.')
      return done({ winner }, `${proposals[winner]} wins with ${tallies[winner]} of ${target} vote weight.`)
    }
    case 'dispatch': {
      if (state.winner === null) return unchanged('Approve a proposal before dispatch.')
      const result = recordDelivery(state.field, orderId, quantity, quantity, at)
      return result.ok ? done({ field: result.state }, `${quantity} kits moved from Supplier to In Transit.`) : unchanged(result.message)
    }
    case 'receive': {
      const result = confirmReceipt(state.field, orderId, quantity, at)
      return result.ok ? done({ field: result.state }, `${quantity} kits moved from In Transit to Local Shop.`) : unchanged(result.message)
    }
    case 'redeem': {
      const result = redeem(state.field, orderId, vouchers, action.code, at)
      return result.ok ? done({ field: result.state }, `${action.code.trim().toUpperCase()} redeemed. 1 kit moved to Families.`) : unchanged(result.message)
    }
    case 'attest':
      if (distributed !== quantity || state.attested) return unchanged('Attestation requires three redeemed sample vouchers and can only be recorded once.')
      return done({ attested: true }, `Issuer confirmed ${distributed} kits in the sample. Funds are still held.`)
    case 'settle':
      if (!state.attested || state.settled) return unchanged('Settlement requires an issuer attestation and can only be recorded once.')
      return done({ settled: true }, `Sample paid ${supplierAmount} USDC to Supplier and ${shopAmount} USDC to Local Shop together.`)
  }
}
