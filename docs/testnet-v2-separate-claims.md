# V2 separate-claims Testnet run — November 13, 2026

This run deployed the donor-pool source from `39ec98107a96bedbdf103812c6f193d53342daae` on Stellar Testnet. It verifies the current two-stage payment API, replacing the historical atomic `settle` transaction. The relief order and actors are fictional; no physical goods or individual voucher scans were verified.

| Item | Value |
| --- | --- |
| Contract | [`CCQJYZFPUCKVA76AU3RDWIHPPNSZKSG45QNEZXE7V3QHPOSPKGJF2XNH`](https://stellar.expert/explorer/testnet/contract/CCQJYZFPUCKVA76AU3RDWIHPPNSZKSG45QNEZXE7V3QHPOSPKGJF2XNH) |
| Wasm hash | `b5724cdc03aff165a06ad9394e6147492248e82a908daf0ecc11923981b91a09` |
| Asset | Testnet USDC, Stellar Asset Contract `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Target | 10 USDC (`100000000` base units) |
| Winning order | Coastal Flood Relief, three sample kits, proposal 1 |
| Final state | `Settled`, `supplier_paid=true`, `shop_paid=true`, pool balance 0 USDC |

## Transaction trail

| Step | Confirmed Testnet transaction |
| --- | --- |
| Upload current Wasm | [`15c63f7b…`](https://stellar.expert/explorer/testnet/tx/15c63f7ba8bface31d355f394eec7edf064d7269f1ddbb8353e9aef108cbac9e) |
| Deploy and initialize current contract | [`285a52c9…`](https://stellar.expert/explorer/testnet/tx/285a52c9526ef749aec904fc5a46ae3dbcb1bb38ed0a87b3eab9c07cb1dd7cf2) |
| Propose Coastal / Mountain | [`187a2823…`](https://stellar.expert/explorer/testnet/tx/187a28238ac06b748b8526cb421934eab66e881b7b3bf5180cbe54942b8c86f2), [`00e952f4…`](https://stellar.expert/explorer/testnet/tx/00e952f4a2f01894534739b3cdc0494b637ef9508f9cbbe27ff90cd6767b89ec) |
| Donor A deposits 6 USDC | [`9b557e61…`](https://stellar.expert/explorer/testnet/tx/9b557e610e35fb1b8fbbc851c75f03d63e54880d75a12da274ea740e9857e9dd) |
| Donor B deposits 4 USDC | [`a3602fd2…`](https://stellar.expert/explorer/testnet/tx/a3602fd29b614034a9162111deab3d2af1f89301e37913e338f3b49a91db69fd) |
| Donor A votes 6 for Coastal | [`567c705e…`](https://stellar.expert/explorer/testnet/tx/567c705e9317730c908d2d4c6fbb0042be39ca28b9a6e5a3a5f4faee859424b5) |
| Donor B votes 4 for Mountain | [`fb4013b9…`](https://stellar.expert/explorer/testnet/tx/fb4013b9773930432e5f499d86c5793759ecf19e25b6fb3fb29ed3a950be7395) |
| Finalize 6–4 result | [`ccad5134…`](https://stellar.expert/explorer/testnet/tx/ccad5134199b56e977c7a8c59af170da1389b1994389d4811c9f3b297d0983b8) |
| Supplier declares 3 dispatched | [`ed68a40e…`](https://stellar.expert/explorer/testnet/tx/ed68a40e84e22ad91cb4297f4a634b6467d67ce5b60fa76caf9ec1b6306f19fa) |
| Shop declares 3 received | [`a7ed5284…`](https://stellar.expert/explorer/testnet/tx/a7ed5284a4bf5f66c48d9eda3c1ada21abf0425927073da26c68e31502fb79be) |
| Supplier claims 7 USDC | [`ba3621b7…`](https://stellar.expert/explorer/testnet/tx/ba3621b7bd9592274718ead7e5ce13874e849b2f24b529bd46644ec5262e1231) |
| Issuer attests 3 distributed | [`7464f475…`](https://stellar.expert/explorer/testnet/tx/7464f47587fa12646de7fa3d58a3144592c3e5b24856ac91b566b2a1bdecac1d) |
| Shop claims 3 USDC | [`901f6279…`](https://stellar.expert/explorer/testnet/tx/901f62794261f9c420f597849b71848a0314ca623ecbe3dd747f49ab796182b2) |

The 10 Testnet USDC was recycled from the previous demonstration: its supplier account transferred 6 USDC to donor A and 1 to donor B, and its shop account transferred 3 to donor B. These [three transfers](https://stellar.expert/explorer/testnet/tx/5409e6ab04fa6ee8b318ef97c9eb2c3caaa069e2add3fc6891187fd72693b350) [are](https://stellar.expert/explorer/testnet/tx/9a04b2b30ee37090331582a40a594ff9a5793c4aae2cee65893e21c345fa2249) [public](https://stellar.expert/explorer/testnet/tx/036cdf8fc9e0549d6e87923611a9e9df3f34ac058b9a895504c095baa3781dac). This is a Testnet payment-mechanics demonstration, not evidence of new fiat donations.

## Independent balance and guard checks

Read-only contract calls returned:

| State | Pool | Supplier | Shop |
| --- | ---: | ---: | ---: |
| After donations | 10 USDC | 0 | 0 |
| After receipt and supplier claim, before issuer attestation | 3 USDC | 7 USDC | 0 |
| After issuer attestation and shop claim | 0 | 7 USDC | 3 USDC |

Before issuer attestation, simulating `claim_shop(1)` failed with contract error `#10 NotReady`. After both claims, the campaign read `phase=Settled`, and proposal 1 read `supplier_paid=true`, `shop_paid=true`. Simulating either duplicate claim failed with `#11 AlreadyPaid`. These failed attempts were read-only simulations and were not submitted as transactions.

The current contract's eight unit tests passed, including deadline refunds and preservation of earned payouts. This Testnet run verifies the successful staged-claim path. It does not test the refund branch on Testnet, establish independent actor ownership, or prove physical dispatch, receipt, eligibility, or voucher redemption. The web buttons remain local simulations rather than signed contract calls.
