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
type Delivery = {
  batchId: number
  quantity: number
  supplierAt: string
  receipt: { quantity: number; shopAt: string } | null
}
export type Demo = { delivery: Delivery | null; redemptions: Redemption[] }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>
type Result = { ok: boolean; state: Demo; message: string }

export const scopeVouchers = (contractId: string, batchId: number, shop: string, quantity: number) => ({
  key: `stellar-relief:v1:${contractId}:${batchId}:${shop}`,
  codes: Array.from({ length: quantity }, (_, index) => `BR-${batchId}-${String(index + 1).padStart(2, '0')}`),
})

export function readDemo(storage: Storage, key: string): Demo {
  const saved = storage.getItem(key)
  if (!saved) return { delivery: null, redemptions: [] }
  const { delivery, redemptions } = JSON.parse(saved)
  // A previous one-click delivery is not a separate shop receipt.
  return { delivery: delivery ?? null, redemptions }
}

export function storeDemo(storage: Storage, key: string, state: Demo) {
  storage.setItem(key, JSON.stringify(state))
}

export function resetDemo(storage: Storage, key: string) {
  storage.removeItem(key)
}

const fail = (state: Demo, message: string): Result => ({ ok: false, state, message })

export function recordDelivery(state: Demo, batchId: number, quantity: number, maximum: number, at: string): Result {
  if (state.delivery) return fail(state, 'A delivery is already recorded for this batch.')
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) {
    return fail(state, `Enter a whole quantity from 1 to ${maximum} kits.`)
  }
  return {
    ok: true,
    state: { ...state, delivery: { batchId, quantity, supplierAt: at, receipt: null } },
    message: 'Delivery recorded. Waiting for the shop to confirm.',
  }
}

export function confirmReceipt(state: Demo, batchId: number, quantity: number, at: string): Result {
  const delivery = state.delivery
  if (!delivery || delivery.batchId !== batchId) return fail(state, 'This batch has no supplier delivery to confirm.')
  if (delivery.receipt) return fail(state, 'The shop has already confirmed this delivery.')
  if (quantity !== delivery.quantity) return fail(state, 'Received quantity must match the supplier record.')
  return {
    ok: true,
    state: { ...state, delivery: { ...delivery, receipt: { quantity, shopAt: at } } },
    message: 'Receipt confirmed on this browser.',
  }
}

export function redeem(state: Demo, batchId: number, vouchers: string[], input: string, at: string): Result {
  const code = input.trim().toUpperCase()
  if (!vouchers.includes(code)) return fail(state, 'Unknown voucher for this batch and shop.')
  if (state.redemptions.some((record) => record.code === code)) {
    return fail(state, `${code} was already redeemed on this browser.`)
  }
  const delivery = state.delivery
  if (!delivery?.receipt || delivery.batchId !== batchId) return fail(state, 'Confirm the shop receipt before redeeming a voucher.')
  if (state.redemptions.length >= delivery.receipt.quantity) return fail(state, 'All confirmed kits have already been collected.')
  return {
    ok: true,
    state: { ...state, redemptions: [...state.redemptions, { code, at, synced: false }] },
    message: `${code} recorded on this browser.`,
  }
}

export function runSampleDelivery(state: Demo, batchId: number, quantity: number, vouchers: string[], at: string): Result {
  const [voucher] = vouchers
  if (!voucher) return fail(state, 'No sample voucher is available for this batch.')

  const delivery = state.delivery
  if (delivery && (delivery.batchId !== batchId || delivery.quantity !== quantity
    || (delivery.receipt && delivery.receipt.quantity !== quantity))) {
    return fail(state, 'The existing delivery differs from the sample. Use the manual controls or Reset demo.')
  }

  let updated = state
  if (!delivery) {
    const result = recordDelivery(updated, batchId, quantity, quantity, at)
    if (!result.ok) return fail(state, result.message)
    updated = result.state
  }
  if (!updated.delivery?.receipt) {
    const result = confirmReceipt(updated, batchId, quantity, at)
    if (!result.ok) return fail(state, result.message)
    updated = result.state
  }
  if (updated.redemptions.some((record) => record.code === voucher)) {
    return {
      ok: true,
      state: updated,
      message: updated === state
        ? 'Sample delivery is already complete on this browser.'
        : `Sample receipt confirmed. ${voucher} was already redeemed on this browser.`,
    }
  }

  const result = redeem(updated, batchId, vouchers, voucher, at)
  if (!result.ok) return fail(state, result.message)
  return { ...result, message: `Sample complete. ${quantity} kits delivered and received. ${voucher} redeemed on this browser.` }
}

export function reconcile(state: Demo, online: boolean): Result {
  if (!online) return fail(state, 'Reconnect before running simulated reconciliation.')
  return {
    ok: true,
    state: { ...state, redemptions: state.redemptions.map((record) => ({ ...record, synced: true })) },
    message: 'Reconciled locally for the demo. Nothing was sent.',
  }
}

export function deliveryTimeline(state: Demo) {
  const delivery = state.delivery
  const events = state.redemptions.map(({ code, at, synced }) => ({
    actor: 'Local Shop', detail: `Redeemed ${code}`, at,
    status: synced ? 'Reconciled (demo)' : 'Pending sync',
  }))
  if (delivery) events.unshift({ actor: 'Supplier', detail: `Recorded delivery of ${delivery.quantity} kits`, at: delivery.supplierAt, status: '' })
  if (delivery?.receipt) events.splice(1, 0, { actor: 'Local Shop', detail: `Confirmed receipt of ${delivery.receipt.quantity} kits`, at: delivery.receipt.shopAt, status: '' })
  return events.sort((a, b) => a.at.localeCompare(b.at))
}

export function advanceReplay(phase: number, delta: number) {
  return Math.max(0, Math.min(steps.length - 1, phase + delta))
}
