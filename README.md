# Stellar Relief

**Pre-funded Relief Supply with Offline Voucher Distribution**

## Donor-governed V2

V2 is the intended product direction. Donors contribute directly to a Soroban pool and vote on relief procurement without handing custody to an NGO. The separate [V2 contract](contracts/donor_pool) and [technical notes](docs/donor-governed-v2.md) document the two recorded Testnet campaigns, authorization model, and refund release blocker. The current V2 prototype releases both payments together after the issuer attests full distribution. Separate supplier and shop payouts remain future work.

The web app continues to open the existing Guided Demo. The V1 escrow and signed-delivery tooling below remain available as historical and technical references. The imported V2 frontend is reserved for a later UI migration.

## Project Overview

Stellar Relief is a donor-governed humanitarian payment prototype. Donors contribute USDC to a Soroban pool and vote on a relief procurement proposal. The contract holds the funds while the supplier, shop, and distribution issuer authorize their respective declarations. The current V2 contract pays the supplier and shop together after full distribution attestation. A refund deadline can still displace payment after accepted delivery.

The Guided Demo illustrates V2 using browser-local interactions and links to separate recorded Testnet campaigns. The architecture and escrow tools documented below describe the archived V1 prototype.

## The Problem

Local suppliers can face delays between accepting a relief order and getting paid. The uncertainty can hold up shipments, while unreliable connectivity can interrupt voucher distribution and reconciliation.

## Our Solution

The agency funds the batch upfront and records who is authorized to verify it. A supplier can inspect the deposit before shipping. The shop can record aid collection during an outage and reconcile its records after reconnecting. The current contract enforces the payment terms. The browser demo illustrates the field operations.

## How the historical V1 escrow works

1. The agency funds a batch and registers the supplier, shop, verifier, and payout amounts.
2. The supplier verifies the escrow and records a batch delivery in the demo. The shop independently enters and confirms the received quantity.
3. The shop records voucher redemptions up to the confirmed quantity, including offline after the production app is cached. After reconnecting, it can mark records reconciled locally.
4. The authorized verifier submits the quantity. Soroban atomically pays the supplier and shop and marks the batch settled.

For a 100 USDC relief batch, the intended split is 70 USDC for the supplier and 30 USDC for the shop. The recorded Testnet run used **10 USDC → 7 USDC + 3 USDC**.

## Why Stellar & Soroban?

Stellar gives agencies and suppliers a shared transaction record they can inspect independently. Soroban lets the contract enforce authorization and batch state and commit both payouts together. The Testnet run used USDC through its Stellar Asset Contract.

## Key Features

- USDC escrow with agency funding authorization, verifier-only settlement, quantity validation, and duplicate-settlement protection.
- Historical escrow, Supplier, Local Shop, and Verification tools for V1.
- Separate supplier and shop actions with a batch-scoped audit timeline and redemption count.
- A production service worker caches the app for offline reopening after an initial online visit. The three paper vouchers support offline entry, reload persistence, duplicate rejection, and simulated reconciliation.
- Read-only Testnet lookup that compares live contract state with the recorded run.
- Historical Replay of the verified batch, with field operations labeled as simulations.

## System Architecture

```mermaid
flowchart LR
    Agency["Agency funds batch"] --> Escrow["Soroban USDC escrow"]
    Verifier["Authorized verifier confirms quantity"] --> Escrow
    Escrow --> Supplier["Supplier payout"]
    Escrow --> Shop["Shop payout"]
    Evidence["Recorded Testnet evidence"] --> UI["React role views and Replay"]
    UI --> Storage["Local delivery and voucher records"]
```

The Python E2E runner manages Testnet transactions and checkpoints separately from the web app. The frontend reads a checked-in evidence snapshot and stores the delivery and voucher demo on the current browser.

## Demo Screenshots

Run the demo locally to explore the four role views.

## Stellar Testnet Deployment

| Field | Recorded value |
| --- | --- |
| Network | Stellar Testnet |
| Run ID | `f141f179b1d94e349421b48e0bfbafe6` |
| Contract | [`CCOZA3KQNXIYB3ERKKAYZ4NKWBHTZQFSIEQQS7HXEBGH3RULUXHJ7PMR`](https://stellar.expert/explorer/testnet/contract/CCOZA3KQNXIYB3ERKKAYZ4NKWBHTZQFSIEQQS7HXEBGH3RULUXHJ7PMR) |
| WASM SHA-256 | `4b763614f798027da3ed93126242ee947410cce3bfb563ccf107c7d0328bdeb8` |
| Batch | `1`, three kits, `Settled` |

## Real USDC Settlement Proof

The run recorded four transactions with RPC status `SUCCESS`.

| Transaction | Ledger | Stellar Explorer |
| --- | ---: | --- |
| Upload WASM | 5,688,193 | [Testnet transaction](https://stellar.expert/explorer/testnet/tx/55c1e7ff271d4cbc83811415c6e84278049f265d45304c9896c912e9cb6922b1) |
| Deploy contract | 5,688,194 | [Testnet transaction](https://stellar.expert/explorer/testnet/tx/65b77d82b6bcfeaeee2b1406741ddd5e347f7b585eaa40ad72a4300a6e2f6e24) |
| Fund 10 USDC | 5,688,196 | [Testnet transaction](https://stellar.expert/explorer/testnet/tx/dc5ee151a1ef632031d0e27c7629382e02e956067f894f2135ce0ac5bf5ed5ec) |
| Settle 7 USDC + 3 USDC | 5,688,199 | [Testnet transaction](https://stellar.expert/explorer/testnet/tx/0ae91cd2ba8aea76a0ab470dd08f844a9290111666ce6582918ce4522ff8dda4) |

| Balance in USDC | Agency | Escrow | Supplier | Shop |
| --- | ---: | ---: | ---: | ---: |
| Before funding | 10 | 0 | 0 | 0 |
| Funded | 0 | 10 | 0 | 0 |
| Settled | 0 | 0 | 7 | 3 |

Balances and batch status came from read-only RPC simulations. Wrong-verifier, wrong-quantity, and duplicate-settlement checks also ran as simulations. See the [curated evidence](docs/testnet-evidence.md) for transaction hashes, asset identifiers, and batch snapshots. Testnet history may become unavailable after a network reset.

## Installation & Local Development

Use Node.js 22.17 or later. From the repository root:

```sh
npm --prefix web ci
npm --prefix web run dev -- --host 127.0.0.1
```

Open the URL printed by Vite. **Guided Demo** opens with the donor-governed V2 sample. Donations, votes, fulfillment, vouchers, and settlement controls use browser-local sample data. Explorer links point to recorded Testnet evidence from two separate campaigns. V1 escrow, supplier, voucher, and verification tools remain under **Historical V1 tools**.

### 60-second guided demo

1. **0–10 s · Donate.** Simulate the 6 and 4 USDC contributions to fill the sample pool.
2. **10–20 s · Decide.** Give Donor A’s six votes to Coastal and Donor B’s four votes to Mountain. Select **Close sample vote** to show Coastal winning 6–4.
3. **20–32 s · Dispatch and receive.** Show the 7/3 USDC allocations. Record three kits dispatched, then confirm the shop receipt.
4. **32–46 s · Distribute.** Redeem the three sample vouchers and simulate the issuer’s aggregate attestation.
5. **46–60 s · Settle and audit.** Simulate settlement, then show the confirmed 7 + 3 USDC transaction in the separate completed Testnet campaign.

**Reset demo** clears only the V2 sample on this browser. For an offline rehearsal, build and preview the production app on HTTPS or localhost:

```sh
npm --prefix web run build
npm --prefix web run preview -- --host 127.0.0.1
```

Open the app online and wait for **Deliver** to report that it is cached. Disconnect and reload. Sample voucher redemptions persist on the device. Reconnect to use the read-only V1 chain check under **Supplier** or **Verification**. If browser CORS blocks the request, run the same read-only check from the repository root:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types web/scripts/verify-testnet.mjs
```

See the [evidence and offline technical notes](docs/evidence-offline.md) for the full walkthrough.

## Verified delivery settlement

The [verified delivery walkthrough](docs/verified-delivery.md) uses a separate Testnet order. The supplier and shop sign independent records, and the designated verifier explicitly authorizes the payment. The verifier’s signed approval links the evidence digest to the exact Testnet transaction hash. Import the public order export in the historical **Verification** view to verify the evidence and check the ledger outcome.

The original settled order remains available as historical evidence. The smart contract enforces verifier authorization and quantity. Delivery evidence is verified off-chain, and voucher redemption remains local.

## Smart Contract Functions

| Function | Purpose |
| --- | --- |
| `__constructor(agency, asset)` | Stores the authorized funding account and token contract. |
| `fund_batch(...)` | Requires agency authorization, validates the quantity and payout split, and escrows funds while registering the batch. |
| `get_batch(batch_id)` | Returns the matching batch and its funding or settlement status. |
| `settle_batch(batch_id, verified_quantity)` | Requires the registered verifier and matching quantity. Pays both recipients and updates state atomically. |

## Testing & Verification

The local suite covers 16 Rust contract tests, 41 Python tests for the E2E and account tools, and frontend demo-state and evidence checks. Use Python 3.10+, Rust with `wasm32v1-none`, and Stellar CLI 30.0.1 for the full local workflow.

```sh
cargo test
CARGO_TARGET_DIR=target/usdc-build stellar contract build
python3 -B -m unittest -q
npm --prefix web run build
npm --prefix web test
npm --prefix web run test:offline
npm --prefix web run test:browser
```

The browser test requires Google Chrome and a loopback listener. The standard frontend evidence test uses the checked-in extract. If the original local report is present, compare it with the same JSON using `node web/scripts/evidence.mjs --original`. These commands run tests or build artifacts. The Python E2E runner is a separate tool that can submit Testnet transactions.

On November 12, 2026, the production build and real Chromium suite passed on a Mac. The suite verified that the service worker served the document, JavaScript, and CSS during offline reloads. It also covered voucher persistence, duplicate rejection, all four role views while offline, and a fresh HTTP response after reconnecting. A separate read-only Stellar RPC check at ledger `5689239` reported `Settled` with no mismatches.

## Security & Limitations

- This is a Testnet prototype with one batch per contract instance and a fixed quantity of three. It has no production audit.
- Replay reads historical evidence. Supplier delivery and shop receipt are unsigned demo records. Vouchers persist and reject duplicate codes within the same browser. Reconciliation is simulated. The contract verifies the signer and declared quantity. Physical delivery and voucher eligibility remain outside the contract.
- Offline reopening requires a successful initial online load of the production build. Clearing browser site data removes the cache and local records.
- The live RPC check requires network access. It compares ledger fields and does not sign or submit a transaction. Testnet resets or expired contract state can make live verification unavailable.
- The demo does not support global fiat on-ramps, real-world delivery verification, cross-device sync, or local fiat off-ramps.
- Keep signing identities, raw checkpoints, local run evidence, and environment files outside the public repository.

## Future Roadmap

Explore real delivery verification, cross-device offline reconciliation, fiat funding and payout integrations, and operational controls for multiple relief batches.

## Team / Hackathon

University of Waterloo Stellar Blockchain Innovation Challenge

## License

No license file is present. Contact the project authors before reusing or redistributing the code.
