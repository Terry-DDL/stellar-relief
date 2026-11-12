# Project Showcase form — shared copy

This mirrors the current draft in the organizer's Airtable form so the team can review the same text. The Airtable form has **not** been submitted yet. The team name and Devpost URL must be added before submission.

## Team topic and number

Team 46 - Payments

## Team name

Stellar Relief (proposed; confirm this matches the team's chosen name)

## Team members

- Kevin Li
- Yizheng Liu
- Terry Zhou
- Jian Feng

## One-line summary

Stellar Relief locks aid funds before shipment so suppliers can verify payment commitments, families can collect goods with offline vouchers, and approved deliveries trigger USDC settlement.

## Problem and future benefit

Stellar Relief targets aid agencies that distribute relief through local shops in disaster-affected communities. Small shops may lack the cash to prepay inventory, while suppliers need confidence that accepted deliveries will be paid. A local outage can also interrupt voucher recording and reconciliation even when aid has already been funded.

The agency pre-funds a specific batch in a Soroban contract, fixing the supplier, shop, verifier and payout amounts before shipment. Suppliers can independently inspect that commitment. Shops can record voucher redemption offline after the app has been cached. An authorized verifier confirms the batch quantity and triggers the supplier and shop payments together.

Our prototype demonstrates conditional USDC settlement on Stellar Testnet and single-browser offline voucher records. We aim to reduce the prepayment required from shops and the time from order approval to goods arriving. These outcomes will be tested with aid agencies, suppliers and shops. Cross-device reconciliation and local-currency payout are planned integrations.

## Why this team

Our team has built the public Stellar Relief prototype, combining a Rust/Soroban escrow contract, a React web app and Python Testnet tooling. The repository includes a recorded funding and settlement run using 10 test USDC, with 7 paid to the supplier and 3 to the shop. The contract checks the authorized verifier, matching quantities and duplicate settlement.

Our work also includes separate agency, supplier, shop and verification views, plus cached offline voucher entry. The demo identifies verified on-chain settlement and simulated delivery and reconciliation. This gives us a concrete prototype to put in front of potential users. Our next validation step is to test whether a funded commitment changes a supplier's deposit requirement or payment terms, and use that feedback to refine the workflow.

Public prototype at https://github.com/Terry-DDL/stellar-relief

## Devpost URL

Pending project creation and submission.
