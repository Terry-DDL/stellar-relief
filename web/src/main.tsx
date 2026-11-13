import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import evidence from './evidence.json'
import v2Evidence from './v2-evidence.json'
import { donors, proposals, quantity, shopAmount, start, storageKey, summarize, supplierAmount, target, update, vouchers } from './guided-v2'
import { advanceReplay, confirmReceipt, deliveryTimeline, readDemo, reconcile, recordDelivery, redeem, resetDemo, scopeVouchers, steps, storeDemo, story } from './demo'
import type { Demo, Role } from './demo'
import { useConnectivity } from './connectivity'
import { verifyTestnet } from './testnet'
import { VerifiedDelivery } from './verified-delivery'
import './styles.css'
import './guided.css'

const { asset, batch, roles, transactions, snapshots } = evidence
const { key, codes } = scopeVouchers(evidence.contractId, batch.id, roles.shop, batch.quantity)
const money = (units: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 7 }).format(units / asset.unitsPerToken)
const shorten = (id: string) => `${id.slice(0, 8)}…${id.slice(-6)}`
const batchNumber = String(batch.id).padStart(3, '0')
const batchLabel = `Batch ${batchNumber}`
const payouts = [{ role: 'wholesaler', title: 'Supplier payment' }, { role: 'shop', title: 'Shop distribution fee' }] as const

const paths = {
  brand: 'M12 2v20M2 12h20M5 5l14 14M19 5 5 19',
  overview: 'M3 5h18v14H3zM3 9h18m-12 0v10',
  back: 'M20 12H5m6-6-6 6 6 6',
  agency: 'M3 21h18M4 9l8-5 8 5M6 10v7m6-7v7m6-7v7M3 18h18',
  wholesaler: 'M2 5h12v12H2zM14 9h4l4 4v4h-8M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  shop: 'M3 9l2-5h14l2 5M3 9v3a2 2 0 0 0 4 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2 2 0 0 0 4 0V9H3Zm2 6v5h14v-5',
  verifier: 'M12 22s8-3.5 8-11V5l-8-3-8 3v6c0 7.5 8 11 8 11Zm-4-10 3 3 5-6',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  external: 'M13 5h6v6m0-6-9 9M10 5H5v14h14v-5',
  play: 'm8 5 11 7-11 7z',
  check: 'm5 12 4 4 10-10',
  pin: 'M20 10c0 6-8 11-8 11s-8-5-8-11a8 8 0 1 1 16 0Zm-8 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  box: 'm12 3 9 4.5v9L12 21l-9-4.5v-9L12 3Zm-9 4.5 9 4.5 9-4.5M12 12v9',
  families: 'M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM3 20v-3a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v3m1-6h1a4 4 0 0 1 4 4v2',
  wallet: 'M4 6h15v13H4zM4 6l12-3v3m3 4h-5v5h5',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-10 10h20M12 2c3 3 4 6 4 10s-1 7-4 10c-3-3-4-6-4-10s1-7 4-10Z',
  history: 'M3 11a9 9 0 1 1 2 6M3 5v6h6m3-4v5l4 2',
} satisfies Record<string, string>

function Icon({ name, size = 19 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

function Tag({ children, tone = 'teal' }: { children: ReactNode; tone?: 'teal' | 'gray' | 'amber' }) {
  return <span className={`tag ${tone}`}><span />{children}</span>
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return <a className="evidence-link" href={href} target="_blank" rel="noreferrer">{children}<Icon name="external" size={14} /></a>
}

function Card({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return <section className="card"><header className="card-header"><h2>{title}</h2>{extra}</header>{children}</section>
}

function Transactions() {
  return <div className="transaction-list">
    {(['fund', 'settle'] as const).map((stage) => {
      const tx = transactions[stage]
      return <div className="transaction" key={stage}>
        <span className="tile-icon"><Icon name={stage === 'fund' ? 'lock' : 'check'} size={17} /></span>
        <div><strong>{stage === 'fund' ? 'Funding confirmed' : 'Settlement confirmed'}</strong><small>Ledger {tx.ledger.toLocaleString('en')}</small></div>
        <Link href={tx.url}><code title={tx.hash}>{shorten(tx.hash)}</code></Link>
      </div>
    })}
  </div>
}

function AllocationBar() {
  return <div className="split-bar" role="img" aria-label={payouts.map(({ role, title }) => `${title} ${money(batch.amounts[role])} ${asset.code}`).join(', ')}>
    {payouts.map(({ role }) => <span key={role} style={{ flexGrow: batch.amounts[role] }} />)}
  </div>
}

function Allocation() {
  return <>
    <AllocationBar />
    {payouts.map(({ role, title }) => <div className="allocation" key={role}>
      <span className={`legend ${role}`} /><span>{title}</span>
      <strong>{money(batch.amounts[role])} <small>{asset.code}</small></strong>
    </div>)}
  </>
}

function Replay({ phase, setPhase, close }: { phase: number; setPhase: (next: number) => void; close: () => void }) {
  const step = steps[phase]
  const first = phase === 0
  const last = phase === steps.length - 1
  return <section className="card replay" aria-label="Historical Replay">
    <header className="card-header"><h2><Icon name="history" /> Historical Replay</h2><button className="text-button" onClick={close}>Close replay</button></header>
    <div className="replay-track" aria-label={`Step ${phase + 1} of ${steps.length}`}>
      {steps.map((item, index) => <button key={item.label} title={item.label} aria-label={item.label} aria-current={phase === index ? 'step' : undefined} onClick={() => setPhase(index)}>{index + 1}</button>)}
    </div>
    <div className="replay-detail" aria-live="polite">
      <Tag tone={step.type === 'Testnet' ? 'teal' : 'amber'}>{step.type === 'Testnet' ? 'Recorded Testnet transaction' : 'Simulated field operation'}</Tag>
      <h3>{step.label}</h3><p>{step.detail}</p>
      <strong>Replay status · {last ? 'Settled' : 'Funded'}</strong>
      {(first || last) && <Link href={transactions[last ? 'settle' : 'fund'].url}>View recorded transaction</Link>}
    </div>
    <div className="replay-actions">
      <button className="button secondary" onClick={() => setPhase(0)}>Restart replay</button>
      <button className="button secondary" disabled={first} onClick={() => setPhase(advanceReplay(phase, -1))}>Back</button>
      <button className="button primary" disabled={last} onClick={() => setPhase(advanceReplay(phase, 1))}>Next step <Icon name="arrow" size={16} /></button>
    </div>
    <small>Replay changes this panel only. The recorded Testnet batch is Settled.</small>
  </section>
}

function Agency({ openReplay }: { openReplay: () => void }) {
  return <>
    <section className="hero">
      <div className="hero-content">
        <Tag>Recorded Testnet evidence</Tag>
        <h2>{story.location}</h2>
        <p><Icon name="pin" size={17} /> {story.region} <span className="hero-divider" /> {batchLabel}</p>
        <button className="button hero-button" onClick={openReplay}><Icon name="play" size={16} /> Start historical replay</button>
      </div>
      <div className="hero-orbit" aria-hidden="true"><div className="orbit one" /><div className="orbit two" /><div className="orbit three" /><span><Icon name="box" size={52} /></span><i /><b /></div>
    </section>
    <section className="stats" aria-label="Batch overview">
      {([
        { label: 'Total funded', value: money(batch.amounts.total), unit: asset.code, note: 'Confirmed deposit', icon: 'lock' },
        { label: 'Total settled', value: money(snapshots.settled.wholesaler + snapshots.settled.shop), unit: asset.code, note: 'Two payouts in one transaction', icon: 'wallet' },
        { label: 'Relief supplies', value: batch.quantity, unit: 'kits', note: story.kit, icon: 'box' },
      ] as const).map(({ label, value, unit, note, icon }) => <article className="stat" key={label}><div><span>{label}</span><span className="tile-icon"><Icon name={icon} size={17} /></span></div><strong>{value} <small>{unit}</small></strong><p>{note}</p></article>)}
    </section>
    <div className="grid">
      <Card title="Funding allocation" extra={<Tag>{batch.status}</Tag>}>
        <p className="card-description">Recorded allocation for supplies and local distribution.</p><Allocation />
      </Card>
      <Card title="Testnet timeline" extra={<Link href={evidence.contractUrl}>Contract</Link>}><Transactions /></Card>
    </div>
    <Card title="Batch participants">
      <div className="participants">
        {(Object.keys(story.roles) as Role[]).map((role) => <div key={role}><span className="tile-icon"><Icon name={role} /></span><div><small>{story.roles[role].label}</small><strong>{story.roles[role].name}</strong><code title={roles[role]}>{shorten(roles[role])}</code></div></div>)}
      </div>
    </Card>
  </>
}

type DemoAction = (state: Demo) => ReturnType<typeof recordDelivery>
type ApplyAction = (action: DemoAction) => Promise<ReturnType<DemoAction>>

function DeliveryForm({ role, demo, apply, suggested = false }: { role: 'supplier' | 'shop'; demo: Demo; apply: ApplyAction; suggested?: boolean }) {
  const inputId = useId()
  const [quantity, setQuantity] = useState(suggested ? String(batch.quantity) : '')
  const [notice, setNotice] = useState({ text: '', error: false })
  const supplier = role === 'supplier'
  const delivery = demo.delivery
  const showForm = supplier ? !delivery : Boolean(delivery && !delivery.receipt)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const at = new Date().toISOString()
    const result = await apply((state) => supplier
      ? recordDelivery(state, batch.id, Number(quantity), batch.quantity, at)
      : confirmReceipt(state, batch.id, Number(quantity), at))
    setNotice({ text: result.message, error: !result.ok })
  }

  return <Card title={supplier ? 'Supply delivery' : 'Shop receipt'} extra={<Tag tone="amber">Local demo</Tag>}>
    <p className="card-description">{batchLabel} · {story.roles.shop.name} · Expected {batch.quantity} kits</p>
    <p className="card-description">{delivery
      ? delivery.receipt
        ? supplier ? `Supplier recorded ${delivery.quantity} kits. Shop receipt confirmed.` : `Shop confirmed ${delivery.receipt.quantity} kits.`
        : `Supplier recorded ${delivery.quantity} kits. Awaiting shop confirmation.`
      : 'Waiting for the supplier delivery record.'}</p>
    {showForm && <form className="voucher-form" onSubmit={submit}>
      <label htmlFor={inputId}>{supplier ? 'Quantity delivered' : 'Quantity received'}</label>
      <div><input id={inputId} type="number" min="1" max={batch.quantity} step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        <button className="button primary">{supplier ? 'Record demo delivery' : 'Confirm demo receipt'}</button></div>
    </form>}
    <p className={`notice ${notice.error ? 'error' : ''}`} role="status">{notice.text}</p>
    <small>Demo roles share this browser. The records use device timestamps and have no identity signatures.</small>
  </Card>
}

function LiveVerification({ online }: { online: boolean }) {
  const [checking, setChecking] = useState(false)
  const [report, setReport] = useState<Awaited<ReturnType<typeof verifyTestnet>> | null>(null)
  const [error, setError] = useState('')

  async function check() {
    setReport(null)
    setError('')
    setChecking(true)
    try {
      setReport(await verifyTestnet(evidence))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not verify the live Testnet state.')
    } finally {
      setChecking(false)
    }
  }

  return <Card title="Live Testnet verification" extra={<Tag tone="gray">Read only</Tag>}>
    <p className="card-description">Compare current contract and batch fields with the recorded run.</p>
    <p className="rpc-scope">Current USDC escrow balance is outside this check.</p>
    <button className="button primary" disabled={checking || !online} onClick={() => { void check() }}>Verify on Stellar Testnet</button>
    <div role="status" className="notice">
      {checking && <p>Reading the current Testnet state…</p>}
      {!online && <p>Offline. Reconnect to verify live data.</p>}
      {error && <p className="error">Verification unavailable. {error}</p>}
      {online && report && <div className="rpc-result">
        <div><Tag tone={report.mismatches.length ? 'amber' : 'teal'}>Live {report.status}</Tag><small>Ledger {report.ledger.toLocaleString('en')}</small></div>
        <p><strong>{report.mismatches.length ? 'Live state differs from the recorded evidence.' : 'Live state matches the recorded evidence.'}</strong>
          {report.mismatches.length > 0 && ` Different fields: ${report.mismatches.join(', ')}.`}</p>
      </div>}
    </div>
  </Card>
}

function SupplierAssurance({ online }: { online: boolean }) {
  const paid = snapshots.settled.wholesaler - snapshots.before_funding.wholesaler
  return <div className="assurance-layout">
    <Card title="Supplier payment assurance" extra={<Tag tone="gray">Historical funding proof</Tag>}>
      <div className="assurance-amounts">
        <div><span>Supplier payout</span><strong>{money(batch.amounts.wholesaler)} <small>{asset.code}</small></strong></div>
        <div><span>Recorded deposit</span><strong>{money(snapshots.funded.escrow)} <small>{asset.code}</small></strong></div>
      </div>
      <dl className="assurance-terms">
        <div><dt>Supplier receiving address</dt><dd><code>{roles.wholesaler}</code></dd></div>
        <div><dt>Authorized verifier</dt><dd><code>{roles.verifier}</code></dd></div>
        <div><dt>Settlement conditions</dt><dd>Settlement requires the assigned verifier to confirm delivery. The contract checks the signature and the quantity of {batch.quantity} kits.</dd></div>
      </dl>
      <Link href={transactions.fund.url}>View funding transaction</Link>
    </Card>
    <div className="assurance-side">
      <Card title="What suppliers can verify" extra={<Tag tone="gray">Recorded {batch.status}</Tag>}>
        <ul className="assurance-checks">
          <li>The NGO previously committed funds to escrow.</li>
          <li>The order specifies the supplier payout and receiving address.</li>
          <li>Settlement requires approval from the designated verifier.</li>
        </ul>
        <p className="assurance-benefit">Verifiable payment commitments reduce uncertainty about whether the buyer has secured funds before dispatch.</p>
        <p className="recorded-note">This batch settled and the supplier received {money(paid)} {asset.code}. The receipt applies to this order only.</p>
      </Card>
      <LiveVerification online={online} />
    </div>
  </div>
}

function Supplier({ demo, apply, online }: { demo: Demo; apply: ApplyAction; online: boolean }) {
  return <>
    <SupplierAssurance online={online} />
    <DeliveryForm role="supplier" demo={demo} apply={apply} />
    <Card title="Escrow and payout history" extra={<Link href={evidence.contractUrl}>View contract</Link>}><Transactions /></Card>
  </>
}

type FieldProps = { demo: Demo; apply: ApplyAction; reset: () => void | Promise<void>; online: boolean; cached: boolean }

function VoucherWorkspace({ demo, apply, reset, online, cached, guided = false }: FieldProps & { guided?: boolean }) {
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState({ text: '', error: false })
  const pending = demo.redemptions.filter((record) => !record.synced).length
  const confirmed = demo.delivery?.receipt?.quantity
  const unusedStatus = confirmed === undefined ? 'Awaiting receipt'
    : demo.redemptions.length >= confirmed ? 'No confirmed stock' : 'Available'
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result = await apply((state) => redeem(state, batch.id, codes, input, new Date().toISOString()))
    if (result.ok) setInput('')
    setNotice({ text: result.message, error: !result.ok })
  }
  return <>
    <div className="grid">
      <Card title="Redeem a paper voucher" extra={<Tag tone="amber">Local demo</Tag>}>
        <p className="card-description">{batchLabel} · {story.roles.shop.name}</p>
        <form className="voucher-form" onSubmit={submit}>
          <div className="voucher-label"><label htmlFor="voucher">Voucher code</label>
            {guided && <button type="button" className="text-button" onClick={() => setInput(codes[0])}>Use sample voucher</button>}</div>
          <div><input id="voucher" value={input} onChange={(event) => setInput(event.target.value)} placeholder={codes[0]} required autoComplete="off" /><button className="button primary">Record redemption</button></div>
        </form>
        <p className={`notice ${notice.error ? 'error' : ''}`} role="status">{notice.text}</p>
      </Card>
      <Card title="Connection & reconciliation" extra={<Tag tone={online ? 'teal' : 'gray'}>{online ? 'Browser online' : 'Browser offline'}</Tag>}>
        <p className="card-description">{pending} pending sync · {cached ? 'App cached for offline reopening.' : 'Offline reopening requires the cached production app.'}</p>
        <p className="card-description">Records remain on this browser. Reconciliation only changes their local demo status.</p>
        <button className="button secondary" disabled={!online || pending === 0} onClick={async () => {
          const result = await apply((state) => reconcile(state, navigator.onLine))
          setNotice({ text: result.message, error: !result.ok })
        }}>Simulate reconciliation</button>
      </Card>
    </div>
    <Card title="Batch vouchers" extra={<Tag tone="gray">{demo.redemptions.length} of {codes.length} redeemed</Tag>}>
      <div className="voucher-list">
        {codes.map((code) => {
          const record = demo.redemptions.find((item) => item.code === code)
          return <article key={code}><code>{code}</code><span>{record ? <time dateTime={record.at}>{new Date(record.at).toLocaleString()}</time> : '1 relief kit'}</span><Tag tone={record?.synced ? 'teal' : record ? 'amber' : 'gray'}>{record?.synced ? 'Reconciled (demo)' : record ? 'Pending sync' : unusedStatus}</Tag></article>
        })}
      </div>
      <div className="reset-row"><small>Clears local delivery and voucher records and closes replay.</small><button className="button secondary" onClick={async () => {
        try {
          await reset()
          setInput('')
          setNotice({ text: 'Demo reset on this browser.', error: false })
        } catch {
          setNotice({ text: 'Could not reset browser storage.', error: true })
        }
      }}>Reset demo</button></div>
    </Card>
  </>
}

function Shop(props: FieldProps) {
  return <>
    <DeliveryForm role="shop" demo={props.demo} apply={props.apply} />
    <VoucherWorkspace {...props} />
  </>
}

const guidedSteps = [
  { short: 'Fund', title: 'People around the world fund the relief mission', icon: 'globe' },
  { short: 'Decide', title: 'Donors choose which relief mission to fund', icon: 'check' },
  { short: 'Supply', title: 'A local supplier delivers three relief kits', icon: 'wholesaler' },
  { short: 'Verify', title: 'The community shop confirms delivery', icon: 'shop' },
  { short: 'Deliver', title: 'Three families collect their supplies', icon: 'box' },
  { short: 'Pay & Prove', title: 'Local partners get paid. Donors can verify the payment.', icon: 'history' },
] as const

const v2Explorer = 'https://stellar.expert/explorer/testnet/tx/'
const contributionTx = [
  '0e6d18fe321bbb6beca1465cabb51580fafbb8e5a5d4df31e915df13e23f2fda',
  '8c4636705e16ca9c1d65894f96a09ff14ce1d70315c995271102f39b9a97b29a',
]
const voteTx = [
  'e645550fa6ce0c8ffc74fca774a4e49d39a1479c3c56c9d80b5275924edf6ef6',
  '4b4df4d12cb2880cd1c348802959cfb2671e6a9885a7d118f50311ea5c2ba3f5',
]

function readGuidedSample() {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) return JSON.parse(saved) as ReturnType<typeof start>
  } catch { /* The demo can start fresh if local storage is unavailable. */ }
  return start()
}

function MissionTrackers({ balances, inventory, settled, attested }: Pick<ReturnType<typeof summarize>, 'balances' | 'inventory'> & {
  settled: boolean; attested: boolean
}) {
  const locations = [
    { label: 'Supplier', icon: 'box', count: inventory.supplier },
    { label: 'In Transit', icon: 'wholesaler', count: inventory.transit },
    { label: 'Local Shop', icon: 'shop', count: inventory.shop },
    { label: 'Families', icon: 'families', count: inventory.families },
  ] as const
  return <div className="mission-trackers">
    <section className="mission-tracker" aria-labelledby="mission-money">
      <header><h2 id="mission-money">Where’s the money?</h2><span>{settled && balances.supplier > 0 ? 'Both payouts recorded' : attested && !settled ? 'Shop payment ready' : balances.supplier > 0 ? 'Supplier paid' : 'Held pending claims'}</span></header>
      <dl className="mission-money" data-settled={settled && balances.supplier > 0}>
        {([
          ['Relief Contract', 'Currently held', 'lock', balances.contract],
          ['Supplier', 'Received from this order', 'wallet', balances.supplier],
          ['Local Shop', 'Received from this order', 'shop', balances.shop],
        ] as const).map(([label, detail, icon, amount]) => <div className="mission-money-node" key={label} data-active={amount > 0}>
          <dt><Icon name={icon} size={14} />{label}</dt>
          <dd><strong key={amount} className={amount > 0 || settled ? 'mission-arrival' : undefined}>{amount}</strong> <small>USDC</small></dd>
          <dd className="mission-node-detail">{detail}</dd>
          <dd><progress value={amount} max={target} aria-label={`${label} share of the ${target} USDC sample budget`} /></dd>
        </div>)}
      </dl>
      {(balances.supplier > 0 || balances.shop > 0) && <div className="mission-transfers mission-arrival" aria-label="Sample payouts from the Relief Contract">
        {balances.supplier > 0 && <span><Icon name="arrow" size={14} /> {supplierAmount} to Supplier</span>}
        {balances.shop > 0 && <span><Icon name="arrow" size={14} /> {shopAmount} to Local Shop</span>}
      </div>}
    </section>
    <section className="mission-tracker" aria-labelledby="mission-goods">
      <header><h2 id="mission-goods">Where are the kits?</h2><span>{quantity} kits total</span></header>
      <ol className="mission-goods">
        {locations.map(({ label, icon, count }, index) => <li key={label} className="mission-goods-node" data-active={count > 0}>
          <strong><Icon name={icon} size={14} />{label}</strong>
          <div className="mission-stock" key={count}>
            <b>{count}</b>
            <span className="mission-kit-icons" aria-hidden="true">{Array.from({ length: count }, (_, kit) => <Icon key={kit} name="box" size={13} />)}</span>
          </div>
          {index < locations.length - 1 && <span className="mission-goods-arrow"><Icon name="arrow" size={13} /></span>}
        </li>)}
      </ol>
    </section>
  </div>
}

function GuidedDemo({ online, cached }: { online: boolean; cached: boolean }) {
  const [activeStep, setStep] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem(storageKey)
      const saved = Number(stored)
      return stored !== null && Number.isInteger(saved) && saved >= 0 && saved < guidedSteps.length ? saved : null
    } catch {
      return null
    }
  })
  const step = activeStep ?? 0
  const [sample, setSample] = useState(readGuidedSample)
  const [resumed, setResumed] = useState(activeStep !== null && sample.deposits.some(Boolean))
  const [notice, setNotice] = useState('')
  const [voucherCode, setVoucherCode] = useState('')
  const stageTitle = useRef<HTMLHeadingElement>(null)
  const { total, tallies, dispatched, received, distributed, balances, inventory, supplierPaid } = summarize(sample)
  const winner = sample.winner === null ? null : proposals[sample.winner]

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setSample(readGuidedSample())
    }
    addEventListener('storage', sync)
    return () => removeEventListener('storage', sync)
  }, [])

  function goToStep(next: number) {
    setStep(next)
    setNotice('')
    try { sessionStorage.setItem(storageKey, String(next)) } catch { /* Navigation can continue without session storage. */ }
    requestAnimationFrame(() => {
      stageTitle.current?.focus({ preventScroll: true })
      stageTitle.current?.scrollIntoView({ block: 'nearest' })
    })
  }

  async function change(action: Parameters<typeof update>[1] | 'reset') {
    const run = () => {
      if (action === 'reset') {
        localStorage.removeItem(storageKey)
        setSample(start())
        setResumed(false)
        setVoucherCode('')
        goToStep(0)
        return
      }
      const result = update(readGuidedSample(), action, new Date().toISOString())
      localStorage.setItem(storageKey, JSON.stringify(result.state))
      setSample(result.state)
      setNotice(result.message)
    }
    try {
      await (navigator.locks ? navigator.locks.request(storageKey, run) : run())
    } catch {
      setNotice('Browser storage is unavailable. The sample record was not saved.')
    }
  }

  const donorName = (index: number) => index === 0 ? 'Donor A' : 'Donor B'
  const mission = winner ?? proposals[0]
  const winningWeight = sample.winner === null ? 0 : tallies[sample.winner]
  const resumeStep = received && !supplierPaid ? 3 : sample.attested ? 5 : received ? 4 : dispatched ? 3 : winner ? 2 : total === target ? 1 : 0
  const stageHint = [
    'Donations go to the contract. Families receive kits.',
    'Donors decide which order can use the pool.',
    'The supplier checks committed funds before sending goods.',
    'A separate shop account acknowledges receipt. The two declarations do not prove physical delivery.',
    'Each voucher moves one kit to a family. A separate issuer attests the total.',
    'The shop claims its share after full distribution is attested.',
  ][step]
  const nextRequirement = total < target ? 'Fund the pool'
    : !winner ? 'Close voting on a winning proposal'
    : !dispatched ? 'Declare dispatch'
    : !received ? 'Confirm shop receipt'
    : !supplierPaid ? 'Pay the supplier'
    : distributed < quantity ? 'Redeem the remaining vouchers'
    : !sample.attested ? 'Attest distribution'
    : !sample.settled ? 'Pay the local shop' : 'Inspect the recorded Testnet proof'

  return <>
    {activeStep === null && <section className="guided-hero" aria-labelledby="guided-heading">
      <div className="guided-intro">
        <p className="eyebrow">Coastal Flood Relief</p>
        <h1 id="guided-heading">Three families need emergency supplies.</h1>
        <p>Global donors fund the purchase. A local supplier and shop get food and water to the families. Stellar makes the payment trail verifiable.</p>
        <div className="hero-actions">
          <button type="button" className="button hero-button" onClick={() => void change('reset')}>Start new demo <Icon name="arrow" size={16} /></button>
          {total > 0 && <button type="button" className="button hero-shortcut" onClick={() => { setResumed(true); goToStep(resumeStep) }}>Resume saved demo</button>}
        </div>
        {notice && <p role="status">{notice}</p>}
      </div>
      <div className="hero-order">
        <div className="hero-order-top"><span><Icon name="box" size={17} /> Food and water kits</span><Tag>Fictional mission</Tag></div>
        <strong className="hero-order-amount">{target} <small>USDC</small></strong>
        <span className="hero-order-caption">Budget for {quantity} kits, one per family</span>
        <div className="hero-order-split v2-hero-budget"><div><strong>{supplierAmount} USDC</strong><span>Supplier · provides kits</span></div><div><strong>{shopAmount} USDC</strong><span>Shop · receives and distributes</span></div></div>
      </div>
    </section>}

    {activeStep !== null && <>
      <section className="v2-mission" aria-label="Sample mission summary">
        <div className="v2-mission-heading"><strong>{mission}</strong><Tag tone="amber">Browser simulation</Tag></div>
        <p>{target} USDC budget · {quantity} kits · {quantity} families</p>
        {resumed ? <p>Resumed saved sample</p> : step < resumeStep && <p>Showing this step with current sample progress</p>}
        <p className="mission-next"><strong>Next:</strong> {nextRequirement}</p>
        <button type="button" className="text-button mission-reset" onClick={() => void change('reset')}>Reset demo</button>
      </section>

      <nav className="guided-steps v2-steps" aria-label="Guided Demo steps">
        {guidedSteps.map((item, index) => <button key={item.short} type="button" aria-current={step === index ? 'step' : undefined} onClick={() => goToStep(index)}>
          <span className="step-number" aria-hidden="true">{index + 1}</span><strong>{item.short}</strong><Icon name={item.icon} size={17} />
        </button>)}
      </nav>

      <section className="guided-stage" aria-labelledby="stage-title">
        <header className="stage-header">
          <div><p className="eyebrow">Step {step + 1} of {guidedSteps.length}</p>
            <h1 id="stage-title" ref={stageTitle} tabIndex={-1}>{guidedSteps[step].title}</h1></div>
          <div className="stage-controls">
            <button type="button" className="button secondary" aria-label="Previous step" disabled={step === 0} onClick={() => goToStep(step - 1)}><Icon name="back" size={15} /> Previous</button>
            {step < guidedSteps.length - 1
              ? <button type="button" className="button primary" aria-label="Next step" onClick={() => goToStep(step + 1)}>Next <Icon name="arrow" size={15} /></button>
              : <button type="button" className="button primary" onClick={() => void change('reset')}>Restart walkthrough</button>}
          </div>
        </header>
        <MissionTrackers balances={balances} inventory={inventory} settled={sample.settled} attested={sample.attested} />
        <p className="mission-action-result" role="status">{notice || stageHint}</p>

        {step === 0 && <Card title="A 10 USDC relief purchase">
          <div className="v2-donor-grid">
            {donors.map((amount, index) => <div className="v2-item" key={amount}><strong>{donorName(index)} · {amount} USDC</strong>
              <button type="button" className="button primary" disabled={sample.deposits[index]} onClick={() => void change({ type: 'donate', donor: index === 0 ? 0 : 1 })}>
                {sample.deposits[index] ? `${donorName(index)} contributed` : `Simulate ${amount} USDC contribution`}
              </button>
            </div>)}
          </div>
          <div className="v2-total v2-funding"><p><strong>{total} of {target} USDC</strong> in the sample pool</p><progress value={total} max={target} aria-label="Sample funding progress" /></div>
          <div className="v2-proof"><Tag>Recorded Testnet · funding and voting campaign</Tag><Link href={v2Evidence.contractUrl}>Long-running funding campaign</Link>
            {contributionTx.map((hash, index) => <Link href={v2Explorer + hash} key={hash}>{donorName(index)} deposit</Link>)}
          </div>
        </Card>}

        {step === 1 && <Card title="Two proposals, one budget">
          <p className="card-description">Each donor votes once. Their contribution sets their voting weight. The proposal with more than {target / 2} of the {target} total weight wins.</p>
          <div className="v2-donor-grid">
            {proposals.map((proposal, index) => <div className="v2-item" key={proposal} data-winner={sample.winner === index}>
              <strong>{proposal}</strong>
              <span>{tallies[index]} / {target} voting weight</span>
              <progress className="mission-vote-meter" value={tallies[index]} max={target} aria-label={`${proposal} voting weight`} />
            </div>)}
            {donors.map((amount, index) => <div className="v2-item" key={amount}><strong>{donorName(index)} · {amount} weight</strong>
              <div className="v2-actions">{proposals.map((proposal, choice) => <button key={proposal} type="button" className="button secondary"
                disabled={total !== target || sample.winner !== null || sample.votes[index] !== null}
                aria-pressed={sample.votes[index] === choice}
                onClick={() => void change({ type: 'vote', donor: index === 0 ? 0 : 1, proposal: choice === 0 ? 0 : 1 })}>
                {donorName(index)}: {choice === 0 ? 'Coastal' : 'Mountain'}
                {sample.votes[index] === choice && <Icon name="check" size={14} />}
              </button>)}</div>
              {sample.votes[index] === null && <span>Suggested: {index === 0 ? 'Coastal' : 'Mountain'}</span>}
            </div>)}
          </div>
          <button type="button" className="button primary" disabled={winner !== null || !tallies.some((weight) => weight > target / 2)} onClick={() => void change({ type: 'approve' })}>Close sample vote</button>
          {winner && <p className="v2-total"><strong>{winner}</strong> · Procurement Order #001 <span>· {winningWeight} / {target} weight</span></p>}
          <div className="v2-proof"><Tag>Recorded Testnet · funding and voting campaign</Tag>{voteTx.map((hash, index) => <Link href={v2Explorer + hash} key={hash}>{donorName(index)} vote</Link>)}</div>
        </Card>}

        {step === 2 && <Card title="Procurement Order #001">
          <p className="v2-total"><strong>{winner ?? 'Awaiting the vote'}</strong> · {quantity} food and water kits</p>
          <p className="card-description">{supplierAmount} USDC allocated to the supplier, claimable after shop receipt. On-chain, the designated supplier signs the dispatch declaration.</p>
          <button type="button" className="button primary" disabled={!winner || Boolean(dispatched)} onClick={() => void change({ type: 'dispatch' })}>{dispatched ? '3 kits dispatched in the sample' : 'Simulate dispatch of 3 kits'}</button>
          <div className="v2-proof"><Tag>Recorded Testnet evidence</Tag><Link href={v2Evidence.contractUrl}>Inspect long-running funding pool</Link><Link href={v2Explorer + 'f17872955c55f488c0b5be75ab632fa5dd728cde1fc578d72e0927d5ed8c77d9'}>Supplier declaration · separate completed campaign</Link></div>
        </Card>}

        {step === 3 && <Card title="A second account confirms the same kits">
          <button type="button" className="button primary" disabled={!dispatched || Boolean(received)} onClick={() => void change({ type: 'receive' })}>{received ? '3 kits received in the sample' : 'Simulate receipt of 3 kits'}</button>
          {received > 0 && <button type="button" className="button primary" disabled={supplierPaid}
            onClick={() => void change({ type: 'paySupplier' })}>{supplierPaid ? 'Supplier paid in the sample' : 'Simulate 7 USDC supplier payment'}</button>}
          <div className="v2-proof"><Tag>Recorded Testnet transaction</Tag><Link href={v2Explorer + '881ae6920559dec3c1da0c820ca6678cdd52fa48e1399450e2b73f76b45dbc6c'}>Shop declaration · separate completed campaign</Link></div>
        </Card>}

        {step === 4 && <Card title="Redeem sample vouchers" extra={<Tag tone={online ? 'teal' : 'amber'}>{online ? 'Browser online' : 'Browser offline'}</Tag>}>
          <p className="card-description">Families need no crypto wallet. The shop’s offline redemptions stay on this device. On-chain, the authorized issuer signs a separate distribution count.</p>
          <div className="v2-actions">{vouchers.map((code) => {
            const used = sample.field.redemptions.some((item) => item.code === code)
            return <button type="button" key={code} className="button secondary" disabled={!received || used}
              onClick={() => void change({ type: 'redeem', code })}>{used ? `${code} redeemed` : `Redeem ${code}`}</button>
          })}</div>
          <form className="v2-voucher-entry" onSubmit={(event) => { event.preventDefault(); void change({ type: 'redeem', code: voucherCode }) }}>
            <label>Sample voucher code<input value={voucherCode} onChange={(event) => setVoucherCode(event.target.value)} placeholder="VR-001" required /></label>
            <button className="button secondary" type="submit" disabled={!received}>Record sample voucher</button>
          </form>
          {cached && <p className="card-description">App cached for offline reopening.</p>}
          <button type="button" className="button primary" disabled={distributed !== quantity || sample.attested}
            onClick={() => void change({ type: 'attest' })}>{sample.attested ? 'Sample distribution attested' : 'Simulate issuer attestation'}</button>
        </Card>}

        {step === 5 && <>
          <Card title="Sample settlement" extra={<Tag tone="amber">No real funds move</Tag>}>
            <p className="card-description">{sample.settled
              ? 'The shop payout is recorded in the sample.'
              : `The shop can claim ${shopAmount} USDC after the authorized issuer attests full distribution. The supplier claims separately after receipt.`}</p>
            <div className="v2-pay">
              <button type="button" className="button primary" disabled={!sample.attested || sample.settled}
                onClick={() => void change({ type: 'settle' })}>{sample.settled ? 'Shop paid in the sample' : 'Simulate 3 USDC shop payment'}</button>
            </div>
          </Card>
          <Card title="Real Stellar Testnet Proof" extra={<Tag>Separate completed Testnet campaign</Tag>}>
            <p className="card-description">The short-duration campaign paid 7 USDC to its supplier and 3 USDC to its shop in one confirmed transaction. It has its own contract and transaction history.</p>
            <div className="v2-proof"><Link href={v2Evidence.demoSettlementTx}>View confirmed V2 settlement</Link><Link href={v2Evidence.demoContractUrl}>View short-duration contract</Link><Link href={v2Explorer + '8028310be8d9fc92348674ccfd9e494c838de216ee6137db8e52f5f85575d719'}>Recorded issuer attestation</Link></div>
            <p className="v2-limitations"><strong>Historical evidence.</strong> This transaction used the earlier contract. The separate claims and refund protections in this release have local tests and no new Testnet deployment.</p>
          </Card>
        </>}
      </section>
    </>}
  </>
}

function Verification({ demo, online }: { demo: Demo; online: boolean }) {
  const timeline = deliveryTimeline(demo)
  return <>
    <div className="grid">
      <Card title="Field records" extra={<Tag tone="amber">Local demo</Tag>}>
        <dl className="details"><div><dt>Expected quantity</dt><dd>{batch.quantity} kits</dd></div>
          <div><dt>Supplier delivery</dt><dd>{demo.delivery ? `${demo.delivery.quantity} kits` : 'Pending'}</dd></div>
          <div><dt>Shop receipt</dt><dd>{demo.delivery?.receipt ? `${demo.delivery.receipt.quantity} kits confirmed` : 'Pending'}</dd></div>
          <div><dt>Voucher redemptions</dt><dd>{demo.redemptions.length} / {batch.quantity}</dd></div>
          <div><dt>Locally reconciled</dt><dd>{demo.redemptions.filter((item) => item.synced).length} / {batch.quantity}</dd></div>
        </dl>
        <p className="card-description">The contract checks verifier authorization and quantity. Voucher reconciliation stays in the browser.</p>
      </Card>
      <Card title="Atomic settlement" extra={<Tag>{batch.status}</Tag>}>
        <p className="card-description">Authorized verifier <code title={roles.verifier}>{shorten(roles.verifier)}</code></p>
        <Allocation /><Link href={transactions.settle.url}>View confirmed settlement</Link>
      </Card>
    </div>
    <Card title="Delivery audit timeline" extra={<Tag tone="amber">Local demo</Tag>}>
      <p className="card-description">{batchLabel} · Browser records with device timestamps. Entries are unsigned, editable locally, and have no effect on escrow.</p>
      {timeline.length === 0 ? <p className="card-description">No field events recorded yet.</p> : <ol className="timeline">
        {timeline.map(({ actor, detail, at, status }) => <li key={detail}><strong>{actor} · {detail}</strong>{status && <small> · {status}</small>} <time dateTime={at}>{new Date(at).toLocaleString()}</time></li>)}
      </ol>}
    </Card>
    <LiveVerification online={online} />
    <Card title="USDC balance snapshots" extra={<Tag>Recorded Testnet reads</Tag>}>
      <div className="table-scroll"><table><thead><tr><th scope="col">Account</th><th scope="col">Before funding</th><th scope="col">Funded</th><th scope="col">Settled</th></tr></thead>
        <tbody>{(['agency', 'escrow', 'wholesaler', 'shop'] as const).map((role) => <tr key={role}>
          <th scope="row">{role === 'escrow' ? 'Escrow contract' : story.roles[role].label}</th>
          {(['before_funding', 'funded', 'settled'] as const).map((phase) => <td key={phase}>{money(snapshots[phase][role])} {asset.code}</td>)}
        </tr>)}</tbody>
      </table></div>
    </Card>
    <Card title="Settlement safeguards" extra={<Tag tone="gray">Testnet simulations</Tag>}>
      <dl className="details">{([
        ['authorization', 'Wrong verifier rejected'],
        ['quantity', 'Wrong quantity rejected'],
        ['duplicate', 'Duplicate settlement rejected'],
      ] as const).map(([id, label]) => <div key={id}><dt>{label}</dt><dd><code>{evidence.negativeChecks[id].error}</code> <Tag>{evidence.negativeChecks[id].result}</Tag></dd></div>)}</dl>
    </Card>
  </>
}

type Page = Role | 'overview'

const pages: Record<Role, { title: string; detail: string }> = {
  agency: { title: 'Historical V1 escrow', detail: 'Inspect the archived V1 procurement batch and its Testnet evidence.' },
  wholesaler: { title: 'Supplier workspace', detail: 'Review the funding commitment, payout terms, and live contract status.' },
  shop: { title: 'Voucher redemption', detail: 'Confirm receipt and record aid collection, even offline after the app is cached.' },
  verifier: { title: 'Verification & settlement', detail: 'Review delivery records and inspect the verified Testnet payout.' },
}

function currentPage(): Page {
  const hash = location.hash.slice(1)
  return Object.hasOwn(pages, hash) ? hash as Role : 'overview'
}

function App() {
  const { online, cached } = useConnectivity()
  const [role, setRole] = useState(currentPage)
  const [demo, setDemo] = useState(() => readDemo(localStorage, key))
  const [replay, setReplay] = useState<number | null>(null)
  useEffect(() => {
    const onHash = () => { setRole(currentPage()); window.scrollTo(0, 0) }
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) setDemo(readDemo(localStorage, key)) }
    addEventListener('hashchange', onHash)
    addEventListener('storage', onStorage)
    return () => { removeEventListener('hashchange', onHash); removeEventListener('storage', onStorage) }
  }, [])
  async function apply(action: DemoAction) {
    const run = () => {
      const current = readDemo(localStorage, key)
      const result = action(current)
      if (result.ok && result.state !== current) storeDemo(localStorage, key, result.state)
      setDemo(result.state)
      return result
    }
    try {
      return await (navigator.locks ? navigator.locks.request(key, run) : run())
    } catch {
      return { ok: false, state: demo, message: 'Could not save this record in browser storage.' }
    }
  }
  function reset() {
    const run = () => {
      resetDemo(localStorage, key)
      setDemo(readDemo(localStorage, key))
      setReplay(null)
    }
    return navigator.locks ? navigator.locks.request(key, run) : run()
  }
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark"><Icon name="brand" size={21} /></span><strong>{story.name}</strong></a>
      <nav aria-label="Workspace navigation">
        <a className="overview-link" href="#overview" aria-current={role === 'overview' ? 'page' : undefined}><Icon name="overview" />Guided Demo</a>
        <span className="nav-caption">Historical V1 tools</span>
        {(Object.keys(story.roles) as Role[]).map((id) => <a key={id} href={`#${id}`} aria-current={role === id ? 'page' : undefined}><Icon name={id} />{id === 'agency' ? 'Historical escrow' : story.roles[id].label}</a>)}
      </nav>
      <div className="sidebar-foot"><span className="network-dot" /><div><strong>{evidence.network}</strong><small>Recorded evidence</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><p>Stellar Testnet prototype</p><Tag>{role === 'overview' ? 'Donor-governed V2' : `${batchLabel} · ${batch.status} (recorded)`}</Tag></header>
      <main>
        {role === 'overview'
          ? <GuidedDemo online={online} cached={cached} />
          : <div className="page-heading"><div><h1>{pages[role].title}</h1><p>{pages[role].detail}</p></div><Link href={evidence.contractUrl}>Open Testnet contract</Link></div>}
        {role === 'agency' && replay !== null && <Replay phase={replay} setPhase={setReplay} close={() => setReplay(null)} />}
        {role === 'agency' && <Agency openReplay={() => setReplay(0)} />}
        {role === 'wholesaler' && <Supplier demo={demo} apply={apply} online={online} />}
        {role === 'shop' && <Shop demo={demo} apply={apply} reset={reset} online={online} cached={cached} />}
        {role === 'verifier' && <Verification demo={demo} online={online} />}
        {role === 'verifier' && <VerifiedDelivery online={online} />}
        <footer><span>Stellar Relief · Testnet demonstration</span><Link href={`https://stellar.expert/explorer/testnet/contract/${asset.sac}`}>USDC asset contract</Link></footer>
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
