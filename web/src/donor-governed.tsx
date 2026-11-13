import { useState } from 'react'
import v2Evidence from './v2-evidence.json'
import './donor-governed.css'

type Region = 'Coastal Flood Relief' | 'Mountain Landslide Relief'
type State = {
  deposits: [boolean, boolean]
  votes: [Region | null, Region | null]
  winner: Region | null
  dispatched: number
  received: number
  issued: boolean
  redeemed: string[]
  settled: boolean
}

const regions: Region[] = ['Coastal Flood Relief', 'Mountain Landslide Relief']
const donors = [{ name: 'Donor A · Canada', amount: 6 }, { name: 'Donor B · Philippines', amount: 4 }] as const
const vouchers = ['VR-001', 'VR-002', 'VR-003']
const initial: State = { deposits: [false, false], votes: [null, null], winner: null, dispatched: 0, received: 0, issued: false, redeemed: [], settled: false }

export function DonorGovernedDemo() {
  const [state, setState] = useState<State>(initial)
  const total = donors.reduce((sum, donor, index) => sum + (state.deposits[index] ? donor.amount : 0), 0)
  const tallies = regions.map((region) => donors.reduce((sum, donor, index) => sum + (state.votes[index] === region ? donor.amount : 0), 0))
  const remaining = Math.max(0, state.received - state.redeemed.length)

  function deposit(index: number) {
    setState((current) => ({ ...current, deposits: current.deposits.map((done, i) => i === index ? true : done) as State['deposits'] }))
  }

  function vote(index: number, region: Region) {
    setState((current) => ({ ...current, votes: current.votes.map((choice, i) => i === index ? region : choice) as State['votes'] }))
  }

  function finalize() {
    const winningIndex = tallies.findIndex((votes) => votes > total / 2)
    if (winningIndex >= 0) setState((current) => ({ ...current, winner: regions[winningIndex] }))
  }

  return <div className="governance-page">
    <section className="governance-hero">
      <span className="governance-kicker">DONOR-GOVERNED RELIEF · VERSION 2</span>
      <h1>Donors choose the mission. The contract holds the funds.</h1>
      <p>Global donors contribute USDC directly to a pool, vote on a public relief order, then inspect the delivery and payment record. No NGO wallet takes custody of the pool.</p>
      <div className="governance-hints"><span>V2 Testnet pool: 10 USDC donated, 6–4 vote recorded</span><span>Actions below: browser simulation</span><span>Original Testnet demo remains available</span></div>
      <a className="governance-contract-link" href={v2Evidence.contractUrl} target="_blank" rel="noreferrer">Inspect V2 Testnet contract ↗</a>
      <a className="governance-contract-link" href={v2Evidence.demoSettlementTx} target="_blank" rel="noreferrer">View recorded Testnet 7 + 3 USDC settlement ↗</a>
      <p className="governance-note">Actual Testnet donations and votes are linked in the <a href="https://github.com/yliu54977-bot/stellar-relief#v2-stellar-testnet-evidence" target="_blank" rel="noreferrer">public evidence</a>. The buttons here do not sign transactions.</p>
    </section>

    <div className="governance-metrics" aria-label="Public campaign totals">
      <div><small>Donor pool</small><strong>{total} / 10 USDC</strong></div>
      <div><small>Winning order</small><strong>{state.winner ?? 'Awaiting vote'}</strong></div>
      <div><small>Families served</small><strong>{state.redeemed.length} / 3</strong></div>
      <div><small>Shop stock remaining</small><strong>{remaining} kits</strong></div>
    </div>

    <div className="governance-grid">
      <section className="governance-card">
        <header><span>01</span><h2>Donate directly to the pool</h2></header>
        <p>Each donor would obtain Stellar USDC through an available provider or wallet and transfer it straight to the contract. These buttons only simulate that transfer.</p>
        {donors.map((donor, index) => <div className="governance-row" key={donor.name}><div><strong>{donor.name}</strong><small>{donor.amount} USDC contribution</small></div><button disabled={state.deposits[index]} onClick={() => deposit(index)}>{state.deposits[index] ? 'In sample pool' : 'Simulate deposit'}</button></div>)}
      </section>

      <section className="governance-card">
        <header><span>02</span><h2>Vote on the relief order</h2></header>
        <p>Two public sample orders compete for the same 10 USDC budget. Voting weight equals each donor's contribution; a proposal needs more than half of the pool.</p>
        {regions.map((region, regionIndex) => <div className="governance-option" key={region}><strong>{region}</strong><span>{tallies[regionIndex]} / 10 USDC votes</span><small>3 food and water kits · Supplier 7 USDC · Shop service fee 3 USDC</small></div>)}
        {donors.map((donor, index) => <div className="governance-voter" key={donor.name}><strong>{donor.name}</strong>{state.votes[index] ? <span>Voted: {state.votes[index]}</span> : <div>{regions.map((region) => <button key={region} disabled={total < 10 || Boolean(state.winner)} onClick={() => vote(index, region)}>Vote {region.startsWith('Coastal') ? 'Coastal' : 'Mountain'}</button>)}</div>}</div>)}
        <button className="governance-primary" disabled={total < 10 || !state.votes.some(Boolean) || Boolean(state.winner)} onClick={finalize}>Close vote and lock winning order</button>
      </section>

      <section className="governance-card">
        <header><span>03</span><h2>Compare independent delivery claims</h2></header>
        <p>The supplier and shop submit separate declarations. In the new contract, their addresses must authorize their own declarations.</p>
        <div className="governance-row"><div><strong>Supplier dispatch</strong><small>{state.dispatched ? `${state.dispatched} kits declared` : 'No declaration'}</small></div><button disabled={!state.winner || Boolean(state.dispatched)} onClick={() => setState((current) => ({ ...current, dispatched: 3 }))}>Declare 3 sent</button></div>
        <div className="governance-row"><div><strong>Shop receipt</strong><small>{state.received ? `${state.received} kits declared` : 'No declaration'}</small></div><button disabled={!state.dispatched || Boolean(state.received)} onClick={() => setState((current) => ({ ...current, received: 3 }))}>Declare 3 received</button></div>
        <p className="governance-note">Two matching claims are public records, not physical proof. Disputes still require an independent check.</p>
      </section>

      <section className="governance-card">
        <header><span>04</span><h2>Issue and scan relief vouchers</h2></header>
        <p>A separate relief issuer registers eligible households and gives them one-use vouchers. The shop can redeem, but cannot issue them. QR scanning and eligibility are simulated here.</p>
        <button disabled={!state.received || state.issued} onClick={() => setState((current) => ({ ...current, issued: true }))}>{state.issued ? '3 sample vouchers issued' : 'Relief issuer: issue 3 vouchers'}</button>
        {state.issued && <div className="governance-vouchers">{vouchers.map((code) => <button key={code} disabled={state.redeemed.includes(code)} onClick={() => setState((current) => ({ ...current, redeemed: [...current.redeemed, code] }))}>{state.redeemed.includes(code) ? `${code} · redeemed` : `Simulate QR scan · ${code}`}</button>)}</div>}
      </section>
    </div>

    <section className="governance-card governance-audit">
      <header><span>05</span><h2>Public donor audit and settlement</h2></header>
      <p>Every donor sees aggregate quantities and payment status. Household names and locations stay private.</p>
      <div className="governance-audit-grid"><div>Supplier sent <strong>{state.dispatched} kits</strong></div><div>Shop received <strong>{state.received} kits</strong></div><div>Families collected <strong>{state.redeemed.length} kits</strong></div><div>Shop should hold <strong>{remaining} kits</strong></div></div>
      <button className="governance-primary" disabled={state.redeemed.length !== 3 || state.dispatched !== 3 || state.received !== 3 || state.settled} onClick={() => setState((current) => ({ ...current, settled: true }))}>{state.settled ? 'Sample payment settled' : 'Simulate 7 + 3 USDC settlement'}</button>
      <p className="governance-note">The live version needs signed voucher evidence and an independent dispute process. This local simulation does not move USDC or prove physical delivery.</p>
      <button className="governance-reset" onClick={() => setState(initial)}>Reset new demo</button>
    </section>
  </div>
}
