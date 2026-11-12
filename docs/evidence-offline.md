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

- TypeScript, Vite production build, eight state and RPC tests, the historical evidence comparison, and the service worker cache simulation passed.
- On November 12, 2026, the real Chromium suite passed on a Mac. It confirmed service worker responses for the page and assets during offline reloads, persistence of the redeemed voucher, duplicate rejection, navigation through all four role views, and a fresh HTTP response after reconnecting.
- The same Mac validation ran the live read-only Testnet check. It returned ledger `5689239`, status `Settled`, and an empty mismatch list. This result describes that ledger observation. Later reads may be unavailable if Testnet resets or the contract state expires.
