# Stellar Relief — Devpost submission draft

This file is the shared source for the team's Devpost entry. It describes the current prototype; update it alongside the Devpost page as the project changes.

## Project name

Stellar Relief

## One-line description

Pre-funded relief orders let suppliers verify payment before shipping, while local shops distribute goods with offline vouchers and receive USDC when delivery is verified.

## Project story

### The problem

After a disaster, aid money and available goods do not always meet at the right time. A small local shop may not have enough cash to prepay inventory. A supplier may hesitate to dispatch an order if payment depends on a later manual process. Connectivity outages can interrupt voucher recording at the point of distribution. These gaps can delay supplies even when an agency has already allocated funds.

### Our solution

Stellar Relief connects a funded procurement order to a local distribution workflow. An aid agency places USDC for a specified batch into a Soroban contract and fixes the supplier, shop, verifier, quantity, and payout amounts. The supplier can inspect that commitment before dispatch. The shop records receipt and voucher redemption in a browser app that can reopen offline after its first successful online load. An authorized verifier confirms the batch quantity, and the contract pays the supplier and shop together.

Our example is a fictional Coastal Flood Relief order for three kits. The recorded Stellar Testnet run funded 10 test USDC and settled 7 to the supplier and 3 to the shop. This split illustrates the payment flow; it is not a validated commercial price or fee model.

### Why Stellar

Stellar provides a shared payment record that agencies and suppliers can inspect independently. Soroban enforces the agency's funding authority, the verifier's settlement authority, matching quantity, and protection against duplicate settlement. The recorded run uses USDC through the Stellar Asset Contract.

### What we built

- Rust/Soroban escrow contract with funding, batch lookup, and atomic settlement.
- React web app with agency, supplier, local shop, verification, and guided demo views.
- Browser-local voucher entry with offline reopening after caching, persistence on reload, and duplicate-code rejection in that browser.
- Read-only lookup of the recorded Testnet contract state and public transaction evidence.
- Python tooling for submitting and checking the separate Testnet transaction run.

### What the demo proves

The published transaction evidence shows one real **Testnet** funding and settlement cycle. The web app's delivery, receipt, and voucher actions are demo records; its Testnet check reads chain state but does not submit a new payment. The contract checks an authorized signer and declared quantity, not physical delivery or beneficiary eligibility.

### What comes next

We plan to test the workflow with aid agencies, suppliers, and shops. In particular, we need to learn whether a verifiable funded order changes a supplier's deposit requirement or dispatch time. Production use would also require independent delivery verification, cross-device offline reconciliation, operational refund or cancellation rules, and regulated fiat funding and payout partners. These integrations are not in the current prototype.

## Links for Devpost

- Source code: https://github.com/Terry-DDL/stellar-relief
- Demo branch (until merged): https://github.com/Terry-DDL/stellar-relief/tree/campaign-overview
- Testnet contract: https://stellar.expert/explorer/testnet/contract/CCOZA3KQNXIYB3ERKKAYZ4NKWBHTZQFSIEQQS7HXEBGH3RULUXHJ7PMR
- Funding transaction: https://stellar.expert/explorer/testnet/tx/dc5ee151a1ef632031d0e27c7629382e02e956067f894f2135ce0ac5bf5ed5ec
- Settlement transaction: https://stellar.expert/explorer/testnet/tx/0ae91cd2ba8aea76a0ab470dd08f844a9290111666ce6582918ce4522ff8dda4
- Demo video: pending recording and public upload
- Live app: pending deployment; local setup is in the README
- Devpost draft preview (visible to the project owner while unsubmitted): https://devpost.com/software/stellar-relief

## Submission checklist

- [x] Create the Devpost project draft with its name and elevator pitch.
- [ ] Add this project story and complete the remaining Devpost fields.
- [ ] Submit the Devpost project when the team is ready. The project is currently a draft.
- [ ] Add all team members to the Devpost project.
- [ ] Record the one-minute functioning-prototype demo and add its public link.
- [ ] Add the public repository, Testnet contract, and transaction links.
- [ ] Copy the submitted Devpost project URL into the Project Showcase form and submit that form by November 13, 2026, 8:30 AM EST.
