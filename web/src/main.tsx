import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import evidence from './evidence.json'
import { advanceReplay, confirmReceipt, deliveryTimeline, readDemo, reconcile, recordDelivery, redeem, resetDemo, runSampleDelivery, scopeVouchers, steps, storeDemo, story } from './demo'
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
const orderLabel = `Procurement Order #${batchNumber}`
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
  { title: 'People around the world contribute', short: 'Global donations', icon: 'globe' },
  { title: 'NGO secures funding', short: 'Secure funding', icon: 'lock' },
  { title: 'Supplier verifies before dispatch', short: 'Verify before dispatch', icon: 'verifier' },
  { title: 'Goods delivered & vouchers redeemed', short: 'Deliver & redeem', icon: 'box' },
  { title: 'Settlement verified', short: 'Verify settlement', icon: 'check' },
] as const

type SampleDonation = { amount: number; currency: string; route: 'fiat' | 'wallet' }
const donationStorageKey = 'stellar-relief:sample-donations:v1'

function DonorFunding() {
  const amountId = useId()
  const currencyId = useId()
  const [route, setRoute] = useState<'fiat' | 'wallet'>('fiat')
  const [currency, setCurrency] = useState('CAD')
  const [amount, setAmount] = useState('10')
  const [donations, setDonations] = useState<SampleDonation[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(donationStorageKey) ?? '[]')
      return Array.isArray(saved) ? saved.filter((item) => Number.isFinite(item.amount) && item.amount > 0 && (item.route === 'fiat' || item.route === 'wallet')) : []
    } catch { return [] }
  })
  const total = donations.reduce((sum, donation) => sum + donation.amount, 0)

  function addDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isFinite(value) || value < 1 || value > 1000) return
    const updated = [...donations, { amount: Math.round(value * 100) / 100, currency, route }]
    setDonations(updated)
    localStorage.setItem(donationStorageKey, JSON.stringify(updated))
  }

  return <div className="donor-layout">
    <Card title="Contribute to the relief pool" extra={<Tag tone="amber">Browser-local simulation</Tag>}>
      <p className="card-description">A donor can use USDC they already hold or obtain it through an available, licensed payment provider. This demo does not exchange money or send a transaction.</p>
      <div className="donor-route" role="group" aria-label="Donation route">
        <button type="button" aria-pressed={route === 'fiat'} onClick={() => setRoute('fiat')}>Pay in local currency</button>
        <button type="button" aria-pressed={route === 'wallet'} onClick={() => setRoute('wallet')}>Use existing USDC</button>
      </div>
      <form className="donor-form" onSubmit={addDonation}>
        {route === 'fiat' && <label htmlFor={currencyId}>Currency paid to the provider<select id={currencyId} value={currency} onChange={(event) => setCurrency(event.target.value)}><option>CAD</option><option>USD</option><option>EUR</option><option>PHP</option><option>Other</option></select></label>}
        <label htmlFor={amountId}>Target donation in USDC<input id={amountId} type="number" min="1" max="1000" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <p className="donor-quote">{route === 'fiat' ? 'The provider would show the actual local-currency price, fees and eligibility before payment. No exchange rate is assumed here.' : 'A live version would ask the donor to connect a Stellar wallet and approve a USDC transfer.'}</p>
        <button className="button primary" type="submit">Simulate USDC contribution <Icon name="arrow" size={15} /></button>
      </form>
    </Card>
    <Card title="How money reaches procurement" extra={<Tag tone="gray">Proposed donor flow</Tag>}>
      <ol className="donor-journey">
        <li><span>1</span><div><strong>Donor gets USDC</strong><p>An eligible provider converts the donor's payment, or the donor uses USDC already in a Stellar wallet.</p></div></li>
        <li><span>2</span><div><strong>USDC reaches a campaign wallet</strong><p>Incoming transfers and a public campaign balance would be visible on Stellar.</p></div></li>
        <li><span>3</span><div><strong>NGO commits a procurement batch</strong><p>The NGO moves an approved amount into escrow. The supplier can verify the locked funds before dispatch.</p></div></li>
      </ol>
      <div className="donor-total"><span>Sample donor pool on this browser</span><strong>{total.toFixed(2)} <small>USDC</small></strong><p>{donations.length} simulated contribution{donations.length === 1 ? '' : 's'}. These are separate from the recorded Testnet escrow deposit shown in the next step.</p></div>
    </Card>
  </div>
}

function PaymentFlow({ settled = false }: { settled?: boolean }) {
  const transaction = transactions[settled ? 'settle' : 'fund']
  return <Card title={settled ? 'Both payouts confirmed' : 'The NGO deposits before dispatch'}
    extra={<Tag>{settled ? 'Confirmed Testnet settlement' : 'Recorded Testnet deposit'}</Tag>}>
    <div className="payment-flow">
      <div className="payment-node escrow-node"><Icon name={settled ? 'check' : 'lock'} />
        <span>{settled ? 'Total settled' : 'Deposit into escrow'}</span>
        <strong>{money(batch.amounts.total)} <small>{asset.code}</small></strong>
      </div>
      <Icon name="arrow" size={23} />
      <div className="payment-node"><Icon name="wholesaler" />
        <span>{settled ? 'Supplier received' : 'Supplier allocation'}</span>
        <strong>{money(batch.amounts.wholesaler)} <small>{asset.code}</small></strong>
      </div>
      <span className="payment-plus" aria-hidden="true">+</span>
      <div className="payment-node"><Icon name="shop" />
        <span>{settled ? 'Local shop received' : 'Local shop allocation'}</span>
        <strong>{money(batch.amounts.shop)} <small>{asset.code}</small></strong>
      </div>
    </div>
    <div className="proof-footer">
      <p>{settled ? 'One transaction paid both recipients after verifier approval.' : 'The confirmed deposit was recorded before settlement.'} <small>Ledger {transaction.ledger.toLocaleString('en')}</small></p>
      <Link href={transaction.url}>{settled ? 'View settlement transaction' : 'View funding transaction'}</Link>
    </div>
  </Card>
}

function CampaignFlow() {
  return <section className="campaign-flow" aria-labelledby="campaign-flow-title">
    <h2 id="campaign-flow-title">From funding to distribution</h2>
    <ol className="campaign-path">
      <li>
        <h3>Funding sources</h3>
        <Tag tone="amber">Local donor demo</Tag>
        <p>Donors obtain USDC and contribute to a campaign wallet; on-ramp availability depends on location and provider.</p>
      </li>
      <li>
        <h3>NGO procurement</h3>
        <Tag tone="amber">Demo scenario</Tag>
        <p>Order #{batchNumber} for {batch.quantity} food and water kits for flood-affected families.</p>
      </li>
      <li>
        <h3>Stellar escrow</h3>
        <Tag>Real Testnet</Tag>
        <p>{money(batch.amounts.total)} {asset.code} deposited before settlement.</p>
        <Link href={transactions.fund.url}>Funding proof</Link>
      </li>
      <li>
        <h3>Delivery & settlement</h3>
        <div className="flow-evidence"><Tag tone="amber">Local demo</Tag><p>Delivery confirmation</p></div>
        <div className="flow-evidence"><Tag>Real Testnet</Tag><Link href={transactions.settle.url}>Atomic settlement proof</Link></div>
      </li>
      <li>
        <h3>Community distribution</h3>
        <Tag tone="amber">Local demo</Tag>
        <p>Offline voucher redemption on this device.</p>
      </li>
    </ol>
  </section>
}

function GuidedDemo(props: FieldProps) {
  const [step, setStep] = useState(0)
  const [sampleNotice, setSampleNotice] = useState<{ ok: boolean; message: string } | null>(null)
  const stageTitle = useRef<HTMLHeadingElement>(null)

  function goToStep(next: number) {
    setStep(next)
    requestAnimationFrame(() => {
      stageTitle.current?.focus({ preventScroll: true })
      stageTitle.current?.scrollIntoView({ block: 'start' })
    })
  }

  return <>
    <section className="guided-hero" aria-labelledby="guided-heading">
      <div className="guided-intro">
        <p className="eyebrow"><span>Coastal Flood Relief</span> · <span>Fictional relief scenario</span></p>
        <h1 id="guided-heading">Emergency supplies shouldn't wait for payment trust.</h1>
        <p>Donors worldwide can contribute USDC where supported. NGOs then secure procurement funds on-chain, so local suppliers can verify payment commitments before dispatch.</p>
        <div className="hero-actions">
          <button type="button" className="button hero-button" onClick={() => goToStep(0)}>Start Guided Demo <Icon name="arrow" size={16} /></button>
          <button type="button" className="button hero-shortcut" onClick={() => goToStep(2)}>Review supplier proof</button>
          <button type="button" className="button hero-shortcut" onClick={() => {
            document.getElementById('verified-order-title')?.focus()
          }}>Review signed Testnet order</button>
        </div>
      </div>
      <div className="hero-order">
        <div className="hero-order-top"><span><Icon name="lock" size={17} /> Stellar escrow · Testnet</span><Tag>{batch.status}</Tag></div>
        <h2>{orderLabel}</h2>
        <p className="hero-order-label">{batch.quantity} food and water kits · Demo order</p>
        <strong className="hero-order-amount">{money(batch.amounts.total)} <small>{asset.code}</small></strong>
        <span className="hero-order-caption">Recorded escrow deposit</span>
        <AllocationBar />
        <div className="hero-order-split">
          <div><strong>{money(batch.amounts.wholesaler)} {asset.code}</strong><span>Supplier payout</span></div>
          <div><strong>{money(batch.amounts.shop)} {asset.code}</strong><span>Local shop payout</span></div>
        </div>
      </div>
    </section>

    <CampaignFlow />

    <nav className="guided-steps" aria-label="Demo stages">
      {guidedSteps.map((item, index) => <button key={item.title} type="button" aria-current={step === index ? 'step' : undefined} onClick={() => goToStep(index)}>
        <span className="step-number">{index + 1}</span><strong>{item.short}</strong><Icon name={item.icon} size={17} />
      </button>)}
    </nav>

    <section className="guided-stage" aria-labelledby="stage-title">
      <header className="stage-header">
        <div><p className="eyebrow">Step {step + 1} of {guidedSteps.length}</p><h2 id="stage-title" ref={stageTitle} tabIndex={-1}>{guidedSteps[step].title}</h2></div>
        <div className="stage-controls">
          <button type="button" className="button secondary" aria-label="Previous step" disabled={step === 0} onClick={() => goToStep(step - 1)}><Icon name="back" size={15} /> Previous</button>
          {step < guidedSteps.length - 1
            ? <button type="button" className="button primary" aria-label="Next step" onClick={() => goToStep(step + 1)}>Next <Icon name="arrow" size={15} /></button>
            : <button type="button" className="button primary" onClick={() => goToStep(0)}>Restart walkthrough</button>}
        </div>
      </header>
      {step === 0 && <DonorFunding />}
      {step === 1 && <PaymentFlow />}
      {step === 2 && <SupplierAssurance online={props.online} />}
      {step === 3 && <>
        <div className="simulation-note">
          <div><Tag tone="amber">Browser-local simulation</Tag>
            <p>Record delivery, confirm receipt, and redeem a voucher on this browser. The forms below also work individually.</p></div>
          <button type="button" className="button primary" onClick={async () => {
            const { ok, message } = await props.apply((state) => runSampleDelivery(state, batch.id, batch.quantity, codes, new Date().toISOString()))
            setSampleNotice({ ok, message })
          }}>Run sample delivery demo</button>
          {sampleNotice && <p className={`sample-result ${sampleNotice.ok ? '' : 'error'}`} role="status">{sampleNotice.message}</p>}
        </div>
        <div className="grid delivery-pair">
          <DeliveryForm role="supplier" demo={props.demo} apply={props.apply} suggested />
          <DeliveryForm role="shop" demo={props.demo} apply={props.apply} />
        </div>
        <VoucherWorkspace {...props} guided reset={async () => {
          await props.reset()
          setSampleNotice(null)
        }} />
      </>}
      {step === 4 && <PaymentFlow settled />}
    </section>
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
  agency: { title: 'Agency overview', detail: 'Monitor funding and distribution for your relief batch.' },
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
        <span className="nav-caption">Role views</span>
        {(Object.keys(story.roles) as Role[]).map((id) => <a key={id} href={`#${id}`} aria-current={role === id ? 'page' : undefined}><Icon name={id} />{story.roles[id].label}</a>)}
      </nav>
      <div className="sidebar-foot"><span className="network-dot" /><div><strong>{evidence.network}</strong><small>Recorded evidence</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><p>Stellar Testnet prototype</p><Tag>{batchLabel} · {batch.status} (recorded)</Tag></header>
      <main>
        {role === 'overview'
          ? <GuidedDemo demo={demo} apply={apply} reset={reset} online={online} cached={cached} />
          : <div className="page-heading"><div><h1>{pages[role].title}</h1><p>{pages[role].detail}</p></div><Link href={evidence.contractUrl}>Open Testnet contract</Link></div>}
        {role === 'agency' && replay !== null && <Replay phase={replay} setPhase={setReplay} close={() => setReplay(null)} />}
        {role === 'agency' && <Agency openReplay={() => setReplay(0)} />}
        {role === 'wholesaler' && <Supplier demo={demo} apply={apply} online={online} />}
        {role === 'shop' && <Shop demo={demo} apply={apply} reset={reset} online={online} cached={cached} />}
        {role === 'verifier' && <Verification demo={demo} online={online} />}
        <VerifiedDelivery online={online} />
        <footer><span>Stellar Relief · Testnet demonstration</span><Link href={`https://stellar.expert/explorer/testnet/contract/${asset.sac}`}>USDC asset contract</Link></footer>
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
