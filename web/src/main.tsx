import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import evidence from './evidence.json'
import { advanceReplay, confirmReceipt, deliveryTimeline, readDemo, reconcile, recordDelivery, redeem, resetDemo, scopeVouchers, steps, storeDemo, story } from './demo'
import type { Demo, Role } from './demo'
import { useConnectivity } from './connectivity'
import { verifyTestnet } from './testnet'
import './styles.css'

const { asset, batch, roles, transactions, snapshots } = evidence
const { key, codes } = scopeVouchers(evidence.contractId, batch.id, roles.shop, batch.quantity)
const money = (units: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 7 }).format(units / asset.unitsPerToken)
const shorten = (id: string) => `${id.slice(0, 8)}…${id.slice(-6)}`
const batchLabel = `Batch ${String(batch.id).padStart(3, '0')}`

const paths = {
  brand: 'M12 2v20M2 12h20M5 5l14 14M19 5 5 19',
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

function Allocation() {
  const payouts = [{ role: 'wholesaler', title: 'Supplier payment' }, { role: 'shop', title: 'Shop distribution fee' }] as const
  return <>
    <div className="split-bar" aria-label={payouts.map(({ role, title }) => `${title} ${money(batch.amounts[role])} ${asset.code}`).join(', ')}>
      {payouts.map(({ role }) => <span key={role} style={{ flexGrow: batch.amounts[role] }} />)}
    </div>
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
        <p className="card-description">USDC reserved for supplies and local distribution.</p><Allocation />
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

function DeliveryForm({ role, demo, apply }: { role: 'supplier' | 'shop'; demo: Demo; apply: ApplyAction }) {
  const [quantity, setQuantity] = useState('')
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
      ? delivery.receipt ? `Shop confirmed ${delivery.receipt.quantity} kits.` : `Supplier recorded ${delivery.quantity} kits. Awaiting shop confirmation.`
      : 'Waiting for the supplier delivery record.'}</p>
    {showForm && <form className="voucher-form" onSubmit={submit}>
      <label htmlFor="delivery-quantity">{supplier ? 'Quantity delivered' : 'Quantity received'}</label>
      <div><input id="delivery-quantity" type="number" min="1" max={batch.quantity} step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
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
    <p className="card-description">Compare the current contract and batch with the recorded Testnet run.</p>
    <button className="button secondary" disabled={checking || !online} onClick={() => { void check() }}>Verify on Stellar Testnet</button>
    <div role="status" className="notice">
      {checking && <p>Reading the current Testnet state…</p>}
      {!online && <p>Offline. Reconnect to verify live data.</p>}
      {error && <p className="error">Verification unavailable. {error}</p>}
      {online && report && <p><strong>{report.mismatches.length ? 'Live state differs from the recorded evidence.' : 'Live state matches the recorded evidence.'}</strong>
        {` Batch status: ${report.status}. RPC ledger: ${report.ledger.toLocaleString('en')}.`}
        {report.mismatches.length > 0 && ` Different fields: ${report.mismatches.join(', ')}.`}</p>}
    </div>
  </Card>
}

function Supplier({ demo, apply }: { demo: Demo; apply: ApplyAction }) {
  return <>
    <div className="grid">
      <Card title="Locked funding" extra={<Tag tone="gray">Historical</Tag>}>
        <p className="money">{money(batch.amounts.wholesaler)} <small>{asset.code}</small></p>
        <p className="card-description">The supplier’s share of the recorded funded escrow balance of {money(snapshots.funded.escrow)} {asset.code}.</p>
        <Link href={transactions.fund.url}>View funding transaction</Link>
      </Card>
      <Card title="Received payment" extra={<Tag>Confirmed</Tag>}>
        <p className="money">{money(snapshots.settled.wholesaler - snapshots.before_funding.wholesaler)} <small>{asset.code}</small></p>
        <p className="card-description">The supplier’s balance increased when the actual Testnet batch settled.</p>
        <Link href={transactions.settle.url}>View settlement transaction</Link>
      </Card>
    </div>
    <DeliveryForm role="supplier" demo={demo} apply={apply} />
    <Card title="Escrow proof" extra={<Link href={evidence.contractUrl}>View contract</Link>}><Transactions /></Card>
  </>
}

function Shop({ demo, apply, reset, online, cached }: { demo: Demo; apply: ApplyAction; reset: () => void | Promise<void>; online: boolean; cached: boolean }) {
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
    <DeliveryForm role="shop" demo={demo} apply={apply} />
    <div className="grid">
      <Card title="Redeem a paper voucher" extra={<Tag tone="amber">Local demo</Tag>}>
        <p className="card-description">{batchLabel} · {story.roles.shop.name}</p>
        <form className="voucher-form" onSubmit={submit}>
          <label htmlFor="voucher">Voucher code</label>
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

const pages: Record<Role, { title: string; detail: string }> = {
  agency: { title: 'Agency overview', detail: 'Monitor funding and distribution for your relief batch.' },
  wholesaler: { title: 'Supplier workspace', detail: 'Review escrow proof, delivery, and the confirmed supplier payout.' },
  shop: { title: 'Voucher redemption', detail: 'Confirm receipt and record aid collection, even offline after the app is cached.' },
  verifier: { title: 'Verification & settlement', detail: 'Review delivery records and inspect the verified Testnet payout.' },
}

function currentRole(): Role {
  const hash = location.hash.slice(1)
  return Object.hasOwn(pages, hash) ? hash as Role : 'agency'
}

function App() {
  const { online, cached } = useConnectivity()
  const [role, setRole] = useState(currentRole)
  const [demo, setDemo] = useState(() => readDemo(localStorage, key))
  const [replay, setReplay] = useState<number | null>(null)
  useEffect(() => {
    const onHash = () => { setRole(currentRole()); window.scrollTo(0, 0) }
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) setDemo(readDemo(localStorage, key)) }
    addEventListener('hashchange', onHash)
    addEventListener('storage', onStorage)
    return () => { removeEventListener('hashchange', onHash); removeEventListener('storage', onStorage) }
  }, [])
  async function apply(action: DemoAction) {
    const run = () => {
      const current = readDemo(localStorage, key)
      const result = action(current)
      if (result.ok) storeDemo(localStorage, key, result.state)
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
      <a className="brand" href="#agency"><span className="brand-mark"><Icon name="brand" size={21} /></span><strong>{story.name}</strong></a>
      <nav aria-label="Role views">
        <span className="nav-caption">WORKSPACE</span>
        {(Object.keys(story.roles) as Role[]).map((id) => <a key={id} href={`#${id}`} aria-current={role === id ? 'page' : undefined}><Icon name={id} />{story.roles[id].label}</a>)}
      </nav>
      <div className="sidebar-foot"><span className="network-dot" /><div><strong>{evidence.network}</strong><small>Recorded evidence</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><p>{story.subtitle}</p><Tag>{batchLabel} · {batch.status} (recorded)</Tag></header>
      <main>
        <div className="page-heading"><div><h1>{pages[role].title}</h1><p>{pages[role].detail}</p></div><Link href={evidence.contractUrl}>Open Testnet contract</Link></div>
        {replay !== null && <Replay phase={replay} setPhase={setReplay} close={() => setReplay(null)} />}
        {role === 'agency' && <Agency openReplay={() => setReplay(0)} />}
        {role === 'wholesaler' && <Supplier demo={demo} apply={apply} />}
        {role === 'shop' && <Shop demo={demo} apply={apply} reset={reset} online={online} cached={cached} />}
        {role === 'verifier' && <Verification demo={demo} online={online} />}
        <footer><span>Stellar Relief · Testnet demonstration</span><Link href={`https://stellar.expert/explorer/testnet/contract/${asset.sac}`}>USDC asset contract</Link></footer>
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
