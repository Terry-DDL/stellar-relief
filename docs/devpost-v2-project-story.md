# Stellar Relief V2 — Devpost Project Story draft

Copy the text below into **About the project** for the donor-governed V2 entry. This is a draft for team review, not a submitted Devpost entry. The original V1 draft remains in `docs/devpost-submission.md`.

## Inspiration

After a disaster, people around the world may be ready to donate while local suppliers and shops still need a dependable way to deliver essentials and get paid. Donors can see that they sent money, but often cannot follow how a specific relief order was chosen or whether the supplier and shop were paid according to the plan. We asked: could donors choose the mission together, keep the money locked until each payment milestone is claimed, and inspect the trail without handing the donation pool to an intermediary wallet?

## What it does

Stellar Relief V2 is a donor-governed relief-payment prototype. Donors send Stellar Testnet USDC directly to a Soroban contract pool. Anyone can propose a relief order with a region, supplier, local shop, and quantity. Once the pool reaches its target, each donor votes with weight equal to their contribution. An order needs more than half of the pooled amount to win.

The selected funds stay in the contract. The chosen supplier signs a dispatch declaration and the shop separately signs a matching receipt. After accepted receipt, the supplier can claim 70% of the pool. A separate voucher issuer later attests the aggregate number of kits distributed; after full attestation, the shop can claim the remaining 30%. These are two recipient-authorized payments, not one atomic settlement. If no proposal wins, donors can claim refunds. If delivery times out, they can recover only the unearned portion; already earned recipient shares remain claimable. Donors can inspect public order and payment records; household identities should remain off-chain.

Our sample uses a fictional 10 USDC order for three kits and a **70/30 supplier/shop split**. Those numbers demonstrate the payment mechanism; they are not validated relief economics.

## How we built it

We kept our original Stellar Relief escrow demo as a reference and developed V2 first in a public fork, then integrated it into the [main repository](https://github.com/Terry-DDL/stellar-relief). The current Rust/Soroban contract handles direct USDC deposits, weighted voting, majority selection, role-authorized delivery declarations, two separate recipient claims, and proportional refunds of unearned funds. A React/TypeScript page walks through the donor, supplier, shop, issuer, and beneficiary roles. The page's buttons are local simulations; signed transactions are demonstrated separately on Stellar Testnet.

On the current contract's Testnet deployment, two demo donors deposited **6 + 4 USDC** and cast a **6–4 vote**. After the vote deadline, separate demo accounts submitted the supplier and shop declarations. The supplier then [claimed 7 USDC](https://stellar.expert/explorer/testnet/tx/ba3621b7bd9592274718ead7e5ce13874e849b2f24b529bd46644ec5262e1231) while 3 USDC stayed in the pool. After the issuer's distribution attestation, the shop [claimed that remaining 3 USDC](https://stellar.expert/explorer/testnet/tx/901f62794261f9c420f597849b71848a0314ca623ecbe3dd747f49ab796182b2). The [public source and full transaction trail](https://github.com/Terry-DDL/stellar-relief/blob/main/docs/testnet-v2-separate-claims.md) let others inspect the run.

## Challenges we ran into

The hardest boundary is between a payment rule and a real-world fact. Stellar can prove who signed a declaration and where USDC moved; it cannot by itself prove that food arrived or that a beneficiary is eligible. Supplier and shop declarations can also be false or coordinated. We therefore made their claims separate and visible and required a third issuer's aggregate attestation, while describing these as **claims**, not physical proof. A production deployment would need independent eligibility checks, signed voucher evidence, dispute handling, and audits.

Another challenge is timing: the contract cannot finalize a vote before its deadline, and it does not run itself. A caller must finalize the vote, and each payee must submit their own claim. We deployed a short-deadline Testnet instance to demonstrate the full current payment path.

## Accomplishments that we're proud of

- Built a donor-governed payment path that does not place the pooled USDC in an NGO wallet.
- Executed a full current-contract Testnet cycle: two deposits, two votes, winner selection, three role-specific declarations, and separate 7 USDC and 3 USDC claims.
- Passed eight current-contract tests, including successful staged payment, failed-vote refunds, deadline refunds, duplicate claims, and preservation of earned payouts.
- Preserved the historical V1 prototype while integrating V2 into the [team's main repository](https://github.com/Terry-DDL/stellar-relief).

## What we learned

The strongest role for Stellar here is enforceable **payment sequencing**: donors can lock funds under public rules, vote on an order, and verify that the eventual USDC payout follows the declared conditions. Transparency improves accountability, but it does not remove the need to verify real-world delivery or protect beneficiary privacy.

## What's next for Stellar Relief

We would connect the web app to signed wallet transactions; add one-use, cryptographically verifiable vouchers and cross-device reconciliation; pilot independent delivery and eligibility verification; design disputes and partial-delivery rules; and work with regulated partners for real fiat-to-USDC donations and local-currency payouts. These are future steps, not features of the current prototype.
