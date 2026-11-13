# Verified delivery settlement

The archived V1 Testnet batch is under **Historical escrow**. Use a new V1 contract instance for the signed workflow. Both instances use batch ID `1`, so the contract ID distinguishes them. This flow can pay 7 USDC to the supplier and 3 USDC to the shop for a 10 USDC Testnet order. It does not target the V2 donor-pool contract.

## Before the demonstration

Use Stellar CLI 30, Python 3 and Node 22. The existing Testnet CLI identities are `relief-e2e-agency`, `relief-e2e-wholesaler`, `relief-e2e-shop`, and `relief-e2e-verifier`. Each role should control its own software key. The agency needs 10 spendable Testnet USDC, and the supplier and shop need the existing USDC trustline. No private keys or signed transaction envelopes belong in a browser export.

The CLI expects the same verified contract artifact used by the existing E2E runner. If the local artifact is missing, build it and check the hash before proceeding.

```sh
CARGO_TARGET_DIR=target/usdc-build stellar contract build
python3 testnet_e2e.py --check-accounts --amount 10
```

## Demonstration

1. After explicit approval to upload, deploy, and fund a separate **Testnet** order, run the setup command. It stops after funding. Copy the printed run ID into `RUN`. If interrupted, resume that run with `--resume "$RUN" --fund-only --approve-setup`. A verified-delivery run cannot resume through the older automatic settlement path.

   ```sh
   python3 testnet_e2e.py --amount 10 --fund-only --approve-setup
   RUN=replace_with_the_printed_run_id
   ```

2. The supplier records delivery. The shop verifies that record and confirms the same three-kit quantity with its own key. The commands refuse to sign with an alias that does not match the funded order. They save signed JSON files in the run directory.

   ```sh
   python3 verified_delivery.py "$RUN" delivery --identity relief-e2e-wholesaler
   python3 verified_delivery.py "$RUN" receipt --identity relief-e2e-shop
   python3 verified_delivery.py "$RUN" review
   python3 verified_delivery.py "$RUN" export > target/verified-order.json
   ```

   For a multi-machine demo, copy the public run checkpoint to the same run directory on each participant's machine. Exchange `delivery.json` and `receipt.json` only. The receiver can also point to these files with `--delivery` and `--receipt`. Use the aliases configured locally for your own identity and keep your seed on your machine. A single machine with all the keys demonstrates signature separation, with operational separation depending on key custody.

3. In the historical **Verification** view, open **Verified delivery · separate Testnet order** and import `target/verified-order.json`. Confirm the supplier and shop addresses and IDs, then select **Check this order on Testnet**. The browser checks the current contract state and confirms the funding receipt separately from checking the signatures. It has no signing or payment controls.

4. The verifier reviews the evidence and physical delivery process, then explicitly approves a real Testnet settlement by passing the exact `approveDigest` printed by `review`. The tool checks that the order is still funded, validates the expected invocation, signs with the designated verifier, and records the transaction hash before sending. It signs a separate approval binding the evidence digest to that exact transaction hash.

   ```sh
   python3 verified_delivery.py "$RUN" settle --verifier relief-e2e-verifier --approve <reviewed-digest>
   ```

   Replace `<reviewed-digest>` with the actual digest, without angle brackets. If the command is interrupted or returns an uncertain result, use `python3 verified_delivery.py "$RUN" status`. The checkpoint is written before the first submission and the tool will only look up that hash afterward. A failed or missing receipt requires investigation before starting a new order.

5. Export again and reimport in the browser. The panel checks the signed approval and shows a confirmed settlement only when the Testnet receipt matches the verifier, contract, batch and invocation, and the current batch is settled. Open the explorer link for the recorded hash. Continue to use the browser-local voucher demo for distribution.

## Trust boundaries

- A delivery signature identifies the holder of the supplier key. A receipt signature identifies the holder of the shop key and references the supplier's unique record. Both bind the Testnet network, contract ID, batch, participants, quantity, and their own evidence ID. These are signed statements. A human process is still needed to check physical delivery.
- The verifier signs a separate approval over the signed-record digest and exact Stellar transaction hash. The browser verifies the approval against the account designated in the funded order. The contract enforces verifier authorization, quantity and one settlement per batch. It does not enforce delivery signatures or the off-chain approval. A verifier who controls the key could bypass the tool and invoke settlement directly.
- The signing bridge reads exportable Stellar CLI software seeds into its local process. It does not print or write them. Hardware-backed or non-exportable attestation keys require a different signing integration. Testnet RPC availability and retention limit live verification of transaction outcomes.
- Delivery files are exchanged manually. There is no shared voucher synchronization service. Voucher redemption remains browser-local and cannot initiate settlement.
