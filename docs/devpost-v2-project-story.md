# Stellar Relief V2 — Devpost Project Story draft

Copy the text below into **About the project** for the donor-governed V2 entry. This is a draft for team review, not a submitted Devpost entry. The original V1 draft remains in `docs/devpost-submission.md`.

## Inspiration

After a disaster, people around the world may be ready to donate while local suppliers and shops still need a dependable way to deliver essentials and get paid. Donors can see that they sent money, but often cannot follow how a specific relief order was chosen or whether the supplier and shop were paid according to the plan. We asked: could donors choose the mission together, keep the money locked until the distribution claims are recorded, and inspect the payment trail without handing the donation pool to an intermediary wallet?

## What it does

Stellar Relief V2 is a donor-governed relief-payment prototype. Donors send Stellar Testnet USDC directly to a Soroban contract pool. Anyone can propose a relief order with a region, supplier, local shop, and quantity. Once the pool reaches its target, each donor votes with weight equal to their contribution. An order needs more than half of the pooled amount to win.

The selected funds stay in the contract. The chosen supplier signs a dispatch declaration, the shop separately signs a matching receipt, and an independent voucher issuer attests the aggregate number of kits distributed. Only after all three reported quantities match the order can anyone trigger settlement. The contract then pays the supplier and shop atomically. If no proposal wins or the delivery deadline passes, donors can claim refunds. Donors can inspect the public order and payment records; household identities should remain off-chain.

Our sample uses a fictional 10 USDC order for three kits and a **70/30 supplier/shop split**. Those numbers demonstrate the payment mechanism; they are not validated relief economics.

## How we built it

We kept our original Stellar Relief escrow demo as a reference and built V2 in a separate public fork. The new Rust/Soroban contract handles direct USDC deposits, weighted voting, majority selection, role-authorized delivery declarations, atomic two-recipient settlement, and refund paths. A React/TypeScript page walks through the donor, supplier, shop, issuer, and beneficiary roles. The page's buttons are local simulations; signed transactions are demonstrated separately on Stellar Testnet.

On Testnet, two demo donors deposited **6 + 4 USDC** and cast a **6–4 vote**. After the vote deadline, separate demo accounts submitted the supplier, shop, and issuer declarations. The contract [settled 7 USDC to the supplier and 3 USDC to the shop in one transaction](https://stellar.expert/explorer/testnet/tx/3be19fb3d887155d54c8db14ea82a05e28d1ad3333c5702cb008594c409327eb). The [public source and full transaction trail](https://github.com/yliu54977-bot/stellar-relief#v2-stellar-testnet-evidence) let others inspect the run.

## Challenges we ran into

The hardest boundary is between a payment rule and a real-world fact. Stellar can prove who signed a declaration and where USDC moved; it cannot by itself prove that food arrived or that a beneficiary is eligible. Supplier and shop declarations can also be false or coordinated. We therefore made their claims separate and visible and required a third issuer's aggregate attestation, while describing these as **claims**, not physical proof. A production deployment would need independent eligibility checks, signed voucher evidence, dispute handling, and audits.

Another challenge is timing: the contract cannot finalize a vote before its deadline, and it does not run itself. A caller must submit the finalization and settlement transactions. We deployed a short-deadline Testnet instance to demonstrate the whole cycle and a longer-running instance to show the live voting state.

## Accomplishments that we're proud of

- Built a donor-governed payment path that does not place the pooled USDC in an NGO wallet.
- Executed a full Testnet cycle: two deposits, two votes, winner selection, three role-specific declarations, and atomic 7 + 3 USDC settlement.
- Added contract tests for successful payment, a failed vote with refunds, and a missed-delivery deadline with refunds. All three passed; the frontend's ten existing tests and production build also passed.
- Preserved the original project unchanged and published V2 in a separate [public fork](https://github.com/yliu54977-bot/stellar-relief).

## What we learned

The strongest role for Stellar here is enforceable **payment sequencing**: donors can lock funds under public rules, vote on an order, and verify that the eventual USDC payout follows the declared conditions. Transparency improves accountability, but it does not remove the need to verify real-world delivery or protect beneficiary privacy.

## What's next for Stellar Relief

We would connect the web app to signed wallet transactions; add one-use, cryptographically verifiable vouchers and cross-device reconciliation; pilot independent delivery and eligibility verification; design disputes and partial-delivery rules; and work with regulated partners for real fiat-to-USDC donations and local-currency payouts. These are future steps, not features of the current prototype.
