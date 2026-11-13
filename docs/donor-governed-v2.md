# Donor-governed Stellar Relief V2

V2 is the intended product direction. Donors send USDC directly to a Soroban pool. Their contribution-weighted votes select a procurement proposal. Local actors declare dispatch, receipt, and distribution. The pool pays the supplier and shop. An NGO is optional and does not need to hold donor funds. A trustworthy process still needs oversight, voucher issuance, and dispute resolution.

The [V2 contract](../contracts/donor_pool) and [V2 evidence metadata](../web/src/v2-evidence.json) are imported from the teammate fork. The existing web entry point, Guided Demo, and role views continue to run the V1 demonstration. The imported V2 view is isolated source for a future migration. Its controls are local simulations. The fork’s Devpost drafts are retained as drafts, and the external submission has not been edited.

## Implemented contract behavior

| Stage | V2 behavior |
| --- | --- |
| Funding | Donor authorization precedes a transfer to the contract. Amounts are recorded by address. The configured token address is chosen at deployment. The recorded campaigns used Testnet USDC. |
| Proposals and votes | Any authenticated proposer can name a supplier, shop, region, and positive quantity before voting closes. Once funding reaches the exact target, donors can vote once per address, weighted by contribution. A winner needs strictly more than half of the funded pool. |
| Approval and delivery | Anyone can finalize after the vote deadline. For the approved proposal, the designated supplier authorizes dispatch and the designated shop authorizes a matching receipt. Both must match the full order quantity. |
| Distribution and payment | The configured issuer attests a nondecreasing aggregate count, bounded by the received quantity. Anyone can trigger settlement after all counts match and before the deadline. One transaction transfers 70% to the supplier, rounded down in token units, and the remainder to the shop. |
| Refunds | An unsuccessful campaign becomes refundable after finalization. An approved campaign becomes refundable at the delivery deadline if it has not settled. Each donor must authorize their own claim. The claim zeros their balance before transferring their original contribution. |

## Recorded Stellar Testnet evidence

These are historical records from the fork. Contract IDs identify distinct runs, and the recorded campaign states are snapshots. This integration checked the recorded transactions through read-only Testnet queries. It did not deploy or submit any transactions.

At read-only snapshot ledger `5701853`, the long campaign was `Voting` and the short campaign was `Settled`. Both used archived Wasm `bab4145170e0599b7c276e83bfe3a691b6d9359124fc871ce3a9371bf2623d12`.

The [long-running campaign contract](https://stellar.expert/explorer/testnet/contract/CBYAGHNNIZ44E7AJQGCLTD3YMH57JFLTTA2Z3THVRO6NQB6HX4PNSC4X) has a 10 USDC target. Two Testnet donors [deposited 6 USDC](https://stellar.expert/explorer/testnet/tx/0e6d18fe321bbb6beca1465cabb51580fafbb8e5a5d4df31e915df13e23f2fda) and [4 USDC](https://stellar.expert/explorer/testnet/tx/8c4636705e16ca9c1d65894f96a09ff14ce1d70315c995271102f39b9a97b29a) directly. They [voted 6](https://stellar.expert/explorer/testnet/tx/e645550fa6ce0c8ffc74fca774a4e49d39a1479c3c56c9d80b5275924edf6ef6) for Coastal Flood Relief and [voted 4](https://stellar.expert/explorer/testnet/tx/4b4df4d12cb2880cd1c348802959cfb2671e6a9885a7d118f50311ea5c2ba3f5) for Mountain Landslide Relief. The recorded vote deadline is November 16, 2026 at 21:00 UTC. This evidence set ends at the recorded votes.

A [second Testnet instance](https://stellar.expert/explorer/testnet/contract/CDLCJPEUKCNZFHHUGQI4C52KUVSRBMFX5CEQ4Y3XTX7T3WG2B4TO27ZK) uses a short demo deadline. It independently received [6 USDC](https://stellar.expert/explorer/testnet/tx/48a1229c1719c5867950379e18836b4828ad0efdaabdde576e7efd1bd1627c8c) and [4 USDC](https://stellar.expert/explorer/testnet/tx/4c7ce95768f08e7965cc63d693f705b13067daf7cb723d27ed26881525312218), then [recorded a 6-vote](https://stellar.expert/explorer/testnet/tx/04d28154c7e6cfaa087713dd93efd985d68926876e8db8a2c6205b4992e1901f) and [4-vote](https://stellar.expert/explorer/testnet/tx/e7280052bbaa863c853a4beeb2d37e9809753ba83bc10f8f279aeefa7414df35) split. Both instances use Circle's Testnet USDC asset contract. These are fictional relief orders and Testnet funds; no physical goods were shipped.

The short campaign [finalized the 6–4 vote](https://stellar.expert/explorer/testnet/tx/e31de132688372dcc91d7657216ce99a5ca06d82473629fb8b3a5c3d6f5c0aae). A supplier address [declared 3 kits dispatched](https://stellar.expert/explorer/testnet/tx/f17872955c55f488c0b5be75ab632fa5dd728cde1fc578d72e0927d5ed8c77d9), a separate shop address [declared 3 received](https://stellar.expert/explorer/testnet/tx/881ae6920559dec3c1da0c820ca6678cdd52fa48e1399450e2b73f76b45dbc6c), and an issuer address [attested 3 distributed](https://stellar.expert/explorer/testnet/tx/8028310be8d9fc92348674ccfd9e494c838de216ee6137db8e52f5f85575d719). The contract then [settled 7 USDC to the supplier and 3 USDC to the shop in one transaction](https://stellar.expert/explorer/testnet/tx/3be19fb3d887155d54c8db14ea82a05e28d1ad3333c5702cb008594c409327eb), returning `phase=Settled`. These are signed declarations by demo accounts, not independent physical-delivery proof or real voucher scans.

The short campaign settled in ledger `5701421`. The transaction effects record the 7 and 3 USDC debits from that pool and matching credits to the designated recipients. The [V1 escrow transactions](testnet-evidence.md) are archived separately. V2’s declared deliveries and distribution counts were submitted by demo accounts for fictional orders. They do not establish physical delivery, household eligibility, or individual voucher use.

## Release blocker and follow-up

**An accepted supplier delivery has no protected payment obligation.** `declare_receipt` records acceptance, but `settle` still requires full distribution and rejects calls at or after the deadline. `enable_refunds` can move any still-approved campaign into full refunds once that deadline is reached, without considering its delivery or distribution records. This applies even when all attestations were recorded before the cutoff and nobody completed settlement in time. A missing issuer attestation, partial distribution, or failed shop transfer can also block supplier payment. The current V2 contract is retained unchanged for review and historical reproducibility.

The V2 contract test suite documents this behavior for accepted delivery with both zero and full distribution attestation. The payout redesign needs separately tracked supplier and shop obligations. Reserve the supplier amount at accepted delivery and keep that earned amount claimable after the cutoff. Make the shop amount payable when distribution is validated. Define which remaining funds donors can reclaim, including allocation and rounding when some funds are already owed. Define outcomes for partial fulfillment, failed transfers, disputes, and unsolicited or residual balances. Test deadline boundaries, repeated claims and payouts, and isolation between supplier and shop transfers. The existing state guards prevent a second successful settlement or refund claim under the current model.

Additional trust and operational boundaries:

- **Proposal quality.** Proposer authorization proves who submitted the proposal. The contract has no qualification, pricing, role-consent, or proposal moderation policy. It permits proposals during voting. Funding and voting share the same cutoff, so reaching the target late can leave very little voting time.
- **Voting power.** A majority contributor can decide the outcome. Splitting funds across addresses does not create extra aggregate weight, but can divide votes across proposals and obscure common ownership. The design provides no person-level identity or delegation rules.
- **Delivery authorization.** Soroban authenticates role-specific invocations against the selected proposal, and the contract checks roles, quantities, and state. Distinct addresses do not establish independent operators. Parties can misreport physical events, and one issuer can control the distribution count without per-voucher evidence. The issuer cannot withdraw the pool directly.
- **Voucher verification.** Define eligibility and one-use redemption, authenticated reconciliation, privacy safeguards, and a dispute process. A browser-local QR scan or voucher entry is not an on-chain attestation. Keep beneficiary identities off the public ledger.
- **Scale and availability.** Proposals, donations, and votes share instance storage. Before scaling, bound campaign data, test ledger-entry limits, and plan storage lifetime and restoration. The constructor accepts a configured asset contract. Production deployment tooling should verify the intended token and its transfer behavior.

## V1 compatibility and UI migration

The V1 [signed delivery workflow](verified-delivery.md), historical evidence, read-only RPC verification, offline PWA, and browser-local vouchers remain usable on their existing V1 paths. V1’s NGO-funded escrow is a historical reference for the product direction.

A future V2 CLI can reuse the Ed25519 verification primitives, explicit review and approval, and durable transaction-hash recovery patterns. It needs new payloads bound to the V2 contract, campaign, proposal, roles, and quantities. The V1 `fund_batch` and `settle_batch` formats and designated-verifier approval do not match V2. V2 has separate authenticated dispatch, receipt, and issuer calls followed by permissionless settlement. A later UI migration can add wallet signing and V2 ledger checks against the reviewed contract while preserving the historic V1 evidence and clearly labeling simulations.

## Local validation

From the repository root:

```sh
cargo test --locked
cargo test --locked --manifest-path contracts/donor_pool/Cargo.toml
stellar contract build --locked --manifest-path contracts/donor_pool/Cargo.toml
python3 -B -m unittest -q
npm --prefix web ci
npm --prefix web run build
npm --prefix web test
npm --prefix web run test:offline
npm --prefix web run test:browser
```

The local V2 build is separate from the archived deployment. Its Wasm hash must not be used as the historical deployment hash.
