# Stellar Relief

[Try the live V2 demo](https://stellar-relief-v2.vercel.app/) · [View the current Testnet contract](https://stellar.expert/explorer/testnet/contract/CCQJYZFPUCKVA76AU3RDWIHPPNSZKSG45QNEZXE7V3QHPOSPKGJF2XNH)

Emergency suppliers need confidence they will be paid before shipping. Donors need a way to see which relief order their money funded and when local partners were paid. Stellar Relief V2 puts those decisions and payment conditions in a donor-governed Stellar contract.

1. Donors contribute USDC directly to a Soroban pool and vote with weight proportional to their contribution.
2. A proposal with more than half of the funded pool wins when voting closes.
3. The supplier signs a dispatch declaration. The shop signs a matching receipt, reserving the supplier’s 70% share.
4. Families collect kits with vouchers. When the authorized issuer attests full distribution, the shop earns the remaining 30%.
5. Each recipient can claim its earned share separately, including after expiry. Donor refunds cover only unearned funds.

## Architecture

| Component | Responsibility |
| --- | --- |
| [Rust/Soroban donor pool](contracts/donor_pool) | Holds the configured Stellar asset, records voting and signed fulfillment declarations, and enforces payment and refund rules. |
| [React, TypeScript and Vite demo](web) | Shows funding, votes, kit inventory and both payment milestones. The six steps run locally in the browser. |
| Service worker and browser storage | Cache the app and preserve sample voucher redemption and progress on the same device. |
| [Evidence and contract notes](docs/donor-governed-v2.md) | Explain authorization, refund accounting, historical deployments and the revised API. |

Stellar provides a public transaction record and a Stellar Asset Contract for USDC transfers. Soroban makes role authorization and payout rules enforceable by the contract. No NGO wallet needs custody of the pool. Signed declarations show who attested to an event. Physical delivery, eligibility and dispute resolution still require independent processes.

## Run the competition demo

Use Node.js 22.17 or later. From the repository root:

```sh
npm --prefix web ci
npm --prefix web run dev -- --host 127.0.0.1
```

Open the local URL printed by Vite and choose **Start new demo**. Fund 6 + 4 USDC, vote 6–4 for Coastal Flood Relief, and dispatch three kits. Confirm the shop receipt and simulate the 7 USDC supplier payment. Redeem the three vouchers, attest distribution and simulate the 3 USDC shop payment. **Pay & Prove** links to historical Testnet evidence. Browser actions do not submit transactions or move tokens.

To rehearse offline, run the production build and `npm --prefix web run preview -- --host 127.0.0.1`. Open the preview online first and wait for the cache message on **Deliver** before disconnecting.

## Test locally

Use Rust with the `wasm32v1-none` target, Stellar CLI 30.0.1 for contract builds and signing fixtures, Python 3, and Chrome for browser tests.

```sh
cargo test --locked
cargo test --locked --manifest-path contracts/donor_pool/Cargo.toml
stellar contract build --locked --manifest-path contracts/donor_pool/Cargo.toml
python3 -B -m unittest -q
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:offline
npm --prefix web run test:browser
```

## Verified current V2 Testnet evidence

The [current separate-claims contract](https://stellar.expert/explorer/testnet/contract/CCQJYZFPUCKVA76AU3RDWIHPPNSZKSG45QNEZXE7V3QHPOSPKGJF2XNH) ran a fresh 10 USDC campaign on Testnet. Two demo donors deposited 6 + 4 USDC and cast a 6–4 vote. After the winning order's supplier declared dispatch and the shop declared receipt, the supplier [claimed 7 USDC](https://stellar.expert/explorer/testnet/tx/ba3621b7bd9592274718ead7e5ce13874e849b2f24b529bd46644ec5262e1231). The pool then held 3 USDC, and a premature shop claim failed in read-only simulation. After the issuer attested full distribution, the shop [claimed the remaining 3 USDC](https://stellar.expert/explorer/testnet/tx/901f62794261f9c420f597849b71848a0314ca623ecbe3dd747f49ab796182b2). Final read-only calls returned `Settled`, both paid flags true, and a zero USDC pool balance. See the [full current-contract transaction trail](docs/testnet-v2-separate-claims.md). These are fictional actors and declarations, not proof of physical delivery.

Two [Testnet exception campaigns](docs/testnet-v2-exception-paths.md) verified that a failed vote refunds all 10 USDC and that, after accepted shop receipt but no distribution attestation, a timeout refunds only the unearned 3 USDC. Two donors received 1.8 and 1.2 USDC; the supplier then claimed the 7 USDC that remained reserved, even after expiry. Premature, unauthorized and duplicate operations were rejected in Testnet RPC simulations without submitting invalid transactions.

## Verified historical Testnet evidence

- The [long-running campaign](https://stellar.expert/explorer/testnet/contract/CBYAGHNNIZ44E7AJQGCLTD3YMH57JFLTTA2Z3THVRO6NQB6HX4PNSC4X) recorded 6 + 4 USDC in donations and a 6–4 vote.
- A [separate short campaign](https://stellar.expert/explorer/testnet/contract/CDLCJPEUKCNZFHHUGQI4C52KUVSRBMFX5CEQ4Y3XTX7T3WG2B4TO27ZK) executed a [confirmed atomic 7 + 3 USDC settlement](https://stellar.expert/explorer/testnet/tx/3be19fb3d887155d54c8db14ea82a05e28d1ad3333c5702cb008594c409327eb) after role attestations.

Both instances used the earlier atomic-settlement contract. The [V2 evidence notes](docs/donor-governed-v2.md#recorded-stellar-testnet-evidence) retain all historical transaction links. The current Testnet runs above verify separate payment claims and the two deadline-refund paths.

## Limitations and future work

The demo uses fictional orders and local voucher records. The on-chain issuer records an aggregate count. Verified physical delivery, cross-device redemption, disputes, wallet integration, and production custody and token controls need further work. The contract requires independent security review before production use.

## Historical V1

The [V1 escrow prototype](docs/v1-legacy.md), [Testnet evidence](docs/testnet-evidence.md), and [signed delivery tooling](docs/verified-delivery.md) remain available. **Historical V1 tools** in the web sidebar opens the archived demo workspaces.
