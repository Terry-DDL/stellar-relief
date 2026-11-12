import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import evidence from './evidence.json'
import { advanceReplay, readDemo, reconcile, redeem, resetDemo, scopeVouchers, steps, storeDemo, story } from './demo'
import type { Demo, Role } from './demo'
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
    <small>Replay changes this panel only. The actual Testnet batch remains Settled.</small>
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

function Supplier({ demo, update }: { demo: Demo; update: (state: Demo) => void }) {
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
    <Card title="Supply delivery" extra={<Tag tone="amber">Local demo</Tag>}>
      <div className="operation">
        <span className="tile-icon"><Icon name="wholesaler" /></span>
        <div><strong>{batch.quantity} {story.kit.toLowerCase()} · {story.roles.shop.name}</strong><p>{demo.delivered ? 'Delivered · recorded on this browser' : 'Awaiting dispatch and delivery'}</p></div>
        <button className="button primary" disabled={demo.delivered} onClick={() => update({ ...demo, delivered: true })}>Record demo delivery</button>
      </div>
    </Card>
    <Card title="Escrow proof" extra={<Link href={evidence.contractUrl}>View contract</Link>}><Transactions /></Card>
  </>
}

function Shop({ demo, update, reset }: { demo: Demo; update: (state: Demo) => void; reset: () => void }) {
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState({ text: '', error: false })
  const pending = demo.redemptions.filter((record) => !record.synced).length
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = redeem(readDemo(localStorage, key), codes, input, new Date().toISOString())
    if (result.ok) {
      update(result.state)
      setInput('')
    }
    setNotice({ text: result.message, error: !result.ok })
  }
  return <>
    <div className="grid">
      <Card title="Redeem a paper voucher" extra={<Tag tone="amber">Local demo</Tag>}>
        <p className="card-description">{batchLabel} · {story.roles.shop.name}</p>
        <form className="voucher-form" onSubmit={submit}>
          <label htmlFor="voucher">Voucher code</label>
          <div><input id="voucher" value={input} onChange={(event) => setInput(event.target.value)} placeholder={codes[0]} required autoComplete="off" /><button className="button primary">Record redemption</button></div>
        </form>
        <p className={`notice ${notice.error ? 'error' : ''}`} role="status">{notice.text}</p>
      </Card>
      <Card title="Connection & reconciliation" extra={<Tag tone={demo.online ? 'teal' : 'gray'}>{demo.online ? 'Simulated online' : 'Offline'}</Tag>}>
        <p className="card-description">{pending} pending sync · Records are stored on this browser. Reconciliation only changes their local status.</p>
        <div className="shop-actions">
          <button className="button secondary" onClick={() => update({ ...demo, online: !demo.online })}>{demo.online ? 'Simulate offline' : 'Simulate online'}</button>
          <button className="button primary" disabled={!demo.online || pending === 0} onClick={() => { update(reconcile(demo)); setNotice({ text: 'Local records reconciled in the demo.', error: false }) }}>Reconcile records</button>
        </div>
      </Card>
    </div>
    <Card title="Batch vouchers" extra={<Tag tone="gray">{demo.redemptions.length} of {codes.length} redeemed</Tag>}>
      <div className="voucher-list">
        {codes.map((code) => {
          const record = demo.redemptions.find((item) => item.code === code)
          return <article key={code}><code>{code}</code><span>{record ? <time dateTime={record.at}>{new Date(record.at).toLocaleString()}</time> : '1 relief kit'}</span><Tag tone={record?.synced ? 'teal' : record ? 'amber' : 'gray'}>{record?.synced ? 'Reconciled (demo)' : record ? 'Pending sync' : 'Available'}</Tag></article>
        })}
      </div>
      <div className="reset-row"><small>Clears local delivery and voucher records and closes replay.</small><button className="button secondary" onClick={() => { reset(); setInput(''); setNotice({ text: 'Demo reset on this browser.', error: false }) }}>Reset demo</button></div>
    </Card>
  </>
}

function Verification({ demo }: { demo: Demo }) {
  return <>
    <div className="grid">
      <Card title="Field records" extra={<Tag tone="amber">Local demo</Tag>}>
        <dl className="details"><div><dt>Expected quantity</dt><dd>{batch.quantity} kits</dd></div>
          <div><dt>Delivery recorded</dt><dd>{demo.delivered ? 'Yes' : 'Pending'}</dd></div>
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
  shop: { title: 'Voucher redemption', detail: 'Record aid collection at the shop, even during a simulated outage.' },
  verifier: { title: 'Verification & settlement', detail: 'Review delivery records and inspect the verified Testnet payout.' },
}

function currentRole(): Role {
  const hash = location.hash.slice(1)
  return Object.hasOwn(pages, hash) ? hash as Role : 'agency'
}

function App() {
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
  function update(state: Demo) {
    storeDemo(localStorage, key, state)
    setDemo(state)
  }
  function reset() {
    resetDemo(localStorage, key)
    setDemo(readDemo(localStorage, key))
    setReplay(null)
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
      <header className="topbar"><p>{story.subtitle}</p><Tag>{batchLabel} · {batch.status}</Tag></header>
      <main>
        <div className="page-heading"><div><h1>{pages[role].title}</h1><p>{pages[role].detail}</p></div><Link href={evidence.contractUrl}>Open Testnet contract</Link></div>
        {replay !== null && <Replay phase={replay} setPhase={setReplay} close={() => setReplay(null)} />}
        {role === 'agency' && <Agency openReplay={() => setReplay(0)} />}
        {role === 'wholesaler' && <Supplier demo={demo} update={update} />}
        {role === 'shop' && <Shop demo={demo} update={update} reset={reset} />}
        {role === 'verifier' && <Verification demo={demo} />}
        <footer><span>Stellar Relief · Testnet demonstration</span><Link href={`https://stellar.expert/explorer/testnet/contract/${asset.sac}`}>USDC asset contract</Link></footer>
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
