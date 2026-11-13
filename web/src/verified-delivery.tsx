import { useState } from 'react'
import { inspectBundle, verifyOrderOnTestnet } from './delivery-ledger.ts'
import type { DeliveryBundle } from './delivery-ledger.ts'

const explorer = 'https://stellar.expert/explorer/testnet'

export function VerifiedDelivery({ online }: { online: boolean }) {
  const [order, setOrder] = useState<{ bundle: DeliveryBundle; digest: string | null } | null>(null)
  const [live, setLive] = useState<Awaited<ReturnType<typeof verifyOrderOnTestnet>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function importOrder(file: File) {
    setOrder(null)
    setLive(null)
    setError('')
    setBusy(true)
    try {
      if (file.size > 16_384) throw new Error('Expected a small verified-order JSON export.')
      const bundle = JSON.parse(await file.text()) as DeliveryBundle
      const digest = await inspectBundle(bundle)
      setOrder({ bundle, digest })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not validate the order.')
    } finally {
      setBusy(false)
    }
  }

  async function check() {
    if (!order) return
    setBusy(true)
    setLive(null)
    setError('')
    try {
      setLive(await verifyOrderOnTestnet(order.bundle, order.digest))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Testnet verification failed.')
    } finally {
      setBusy(false)
    }
  }

  const bundle = order?.bundle
  const settled = live?.settlement === 'SUCCESS'
  return <section className="card" id="verified-order" aria-labelledby="verified-order-title">
    <header className="card-header"><h2 id="verified-order-title" tabIndex={-1}>Verified delivery · separate Testnet order</h2></header>
    <p className="card-description">Import a signed order export to review evidence. The verifier approves and signs settlement in the local CLI.</p>
    <label>Order export <input type="file" accept=".json,application/json" disabled={busy}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void importOrder(file)
      }} /></label>
    {bundle && <div className="verified-order-details">
      <p><strong>Procurement Order #001</strong> · <a className="evidence-link" href={`${explorer}/contract/${bundle.order.contractId}`} target="_blank" rel="noreferrer"><code>{bundle.order.contractId}</code></a></p>
      <ol className="timeline">
        <li><strong>Escrow funding</strong> · {live?.funding ? 'Confirmed on Testnet' : 'Imported hash · unverified'} · <Transaction hash={bundle.fundHash} /></li>
        <li><strong>Supplier delivery</strong> · {bundle.delivery ? 'Signature verified against imported order' : 'Pending'}
          {bundle.delivery && <small>{bundle.delivery.quantity} kits · <code>{bundle.delivery.signer}</code> · ID <code>{bundle.delivery.id}</code></small>}</li>
        <li><strong>Shop receipt</strong> · {bundle.receipt ? 'Signature verified against imported order' : 'Pending'}
          {bundle.receipt && <small>{bundle.receipt.quantity} kits · <code>{bundle.receipt.signer}</code> · ID <code>{bundle.receipt.id}</code> · Delivery <code>{bundle.receipt.deliveryId}</code></small>}</li>
        <li><strong>Verifier approval</strong> · {settled ? 'Signed approval matches the confirmed Testnet transaction'
          : bundle.approval ? 'Verifier signature checked · waiting for matching Testnet receipt'
          : 'Awaiting verifier approval'}
          <small>Designated verifier <code>{bundle.order.verifier}</code>{order.digest && <> · Evidence digest <code>{order.digest}</code></>}</small></li>
        <li><strong>Stellar settlement</strong> · {live?.settlement === 'SUCCESS' ? `SUCCESS · ledger ${live.ledger}`
          : live?.settlement === 'FAILED' ? `FAILED · ledger ${live.ledger}`
          : live?.settlement === 'NOT_FOUND' ? 'RPC has no receipt for this hash'
          : bundle.settlementHash ? 'Imported hash · unverified' : 'No settlement hash imported'}
          {bundle.settlementHash && <> · <Transaction hash={bundle.settlementHash} /></>}</li>
        <li><strong>Community distribution</strong> · Offline vouchers remain local to the demo and never initiate settlement.</li>
      </ol>
      <button type="button" className="button primary" disabled={busy || !online} onClick={() => { void check() }}>Check this order on Testnet</button>
      {live && <p role="status">Current on-chain batch status: <strong>{live.status}</strong>.</p>}
      {!online && <p>Offline. Imported signatures can still be checked locally.</p>}
      <small>Signatures attest to statements by the listed keys. The contract checks verifier authorization and quantity. A human checks physical delivery, and the app verifies evidence off-chain.</small>
    </div>}
    {busy && <p role="status">Checking order evidence…</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </section>
}

function Transaction({ hash }: { hash: string }) {
  return <a className="evidence-link" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction <code>{hash}</code></a>
}
