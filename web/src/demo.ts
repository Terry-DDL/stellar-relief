export const story = {
  name: 'Stellar Relief',
  subtitle: 'Pre-funded Relief Supply with Offline Voucher Distribution',
  location: 'Bayani Community Hub',
  region: 'Philippines · Sample location',
  kit: 'Water & food kits',
  roles: {
    agency: { label: 'Agency', name: 'Relief Coordination Team' },
    wholesaler: { label: 'Supplier', name: 'Community Supply Partner' },
    shop: { label: 'Local Shop', name: 'Bayani Community Shop' },
    verifier: { label: 'Verification', name: 'Assigned Field Verifier' },
  },
}

export type Role = keyof typeof story.roles

export const steps = [
  { label: 'Agency locks funding', type: 'Testnet', detail: 'The agency deposits USDC into the escrow contract.' },
  { label: 'Supplier verifies escrow', type: 'Demo', detail: 'The supplier reviews the funding receipt before dispatch.' },
  { label: 'Goods delivered', type: 'Demo', detail: 'The supplier records delivery of the relief kits to the local shop.' },
  { label: 'Families redeem vouchers', type: 'Demo', detail: 'The shop records paper voucher redemptions and reconciles them when back online.' },
  { label: 'Verifier confirms delivery', type: 'Demo', detail: 'The assigned verifier reviews the delivered quantity and the voucher records.' },
  { label: 'Stellar settles both payments', type: 'Testnet', detail: 'The confirmed settlement transaction pays the supplier and shop atomically.' },
]

type Redemption = { code: string; at: string; synced: boolean }
export type Demo = { delivered: boolean; online: boolean; redemptions: Redemption[] }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export const scopeVouchers = (contractId: string, batchId: number, shop: string, quantity: number) => ({
  key: `stellar-relief:v1:${contractId}:${batchId}:${shop}`,
  codes: Array.from({ length: quantity }, (_, index) => `BR-${batchId}-${String(index + 1).padStart(2, '0')}`),
})

const freshDemo = (): Demo => ({ delivered: false, online: false, redemptions: [] })

export function readDemo(storage: Storage, key: string): Demo {
  const saved = storage.getItem(key)
  return saved ? JSON.parse(saved) : freshDemo()
}

export function storeDemo(storage: Storage, key: string, state: Demo) {
  storage.setItem(key, JSON.stringify(state))
}

export function resetDemo(storage: Storage, key: string) {
  storage.removeItem(key)
}

export function redeem(state: Demo, vouchers: string[], input: string, at: string) {
  const code = input.trim().toUpperCase()
  if (!vouchers.includes(code)) return { ok: false, state, message: 'Unknown voucher for this batch and shop.' }
  if (state.redemptions.some((record) => record.code === code)) {
    return { ok: false, state, message: `${code} was already redeemed on this browser.` }
  }
  return {
    ok: true,
    state: { ...state, redemptions: [...state.redemptions, { code, at, synced: false }] },
    message: `${code} recorded on this browser.`,
  }
}

export function reconcile(state: Demo): Demo {
  if (!state.online) return state
  return { ...state, redemptions: state.redemptions.map((record) => ({ ...record, synced: true })) }
}

export function advanceReplay(phase: number, delta: number) {
  return Math.max(0, Math.min(steps.length - 1, phase + delta))
}
