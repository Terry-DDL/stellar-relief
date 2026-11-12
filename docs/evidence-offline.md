# Evidence and offline demo

| Step | What the app records | Scope |
| --- | --- | --- |
| Supplier delivery | Batch ID, quantity and device time | Local demo |
| Shop receipt | Independently entered quantity and device time. It must match the supplier record. | Local demo |
| Voucher redemption | Voucher code, time and pending or reconciled status. Confirmed stock limits redemptions. | Browser-local, including offline |
| Audit timeline | Supplier entry, shop confirmation and voucher events | Editable browser records with unsigned role labels |
| Historical settlement | Recorded 10 USDC escrow and atomic 7 / 3 USDC settlement | [Actual Testnet evidence](testnet-evidence.md) |
| Live comparison | Current Testnet contract and batch fields at the RPC ledger | Read-only and requires connectivity |

The demo does not synchronize records across browsers or confirm identities or physical deliveries. Local reconciliation changes the browser's record status. The contract receives no local events. The Testnet verifier uses `getNetwork` and `getLedgerEntries` to compare the contract WASM hash, USDC asset contract, accounts, batch status, quantity and amounts. Missing or expired state, RPC errors and field mismatches are shown separately from the historical evidence.

## Walkthrough

1. Run `npm --prefix web run build` and `npm --prefix web run preview -- --host 127.0.0.1`. Open the URL Vite prints. The service worker is enabled only in production builds on HTTPS or localhost.
2. In **Supplier**, record delivery of three kits. In **Local Shop**, enter two kits to see the mismatch rejection, then enter three to confirm the receipt.
3. Wait until **Local Shop** says the app is cached. Go offline in the browser's developer tools and reload. Redeem `BR-1-01`, reload again, and check that the same code is rejected.
4. Reconnect. The record remains pending until you choose **Simulate reconciliation**. In **Verification**, check the delivery timeline and select **Verify on Stellar Testnet**.
5. If browser CORS blocks the RPC request, run the same read-only check in Node. It uses no wallet or signing key.

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types web/scripts/verify-testnet.mjs
```

## Sprint verification

- TypeScript, Vite production build, eight state and RPC tests, and the historical evidence comparison passed.
- The production service worker passed an isolated Cache Storage simulation. It served the precached HTML and assets after simulated network loss and bypassed RPC requests. The compiled React app also passed simulated offline entry, storage reload, duplicate rejection and reconnection in a DOM harness.
- The Playwright test exercises a real browser reload after network loss. It could not start in the managed environment because binding to loopback returned `EPERM`.
- The live Testnet check was attempted. The environment could not resolve the Testnet RPC host. The CLI reported verification unavailable, while the RPC fixture tests passed for matching, mismatch, expired state and failure cases.
