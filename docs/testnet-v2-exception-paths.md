# V2 Testnet exception paths — November 13, 2026

These fictional campaigns use the same revised donor-pool Wasm hash, `b5724cdc03aff165a06ad9394e6147492248e82a908daf0ecc11923981b91a09`, as the [successful staged-claims run](testnet-v2-separate-claims.md). All amounts are Stellar Testnet USDC, where 1 USDC equals `10000000` base units. Previously received Testnet USDC was recycled into the demo donor accounts. No fiat donations, physical deliveries, or individual voucher scans occurred.

## Case A — voting expires without a winner

The [first exception contract](https://stellar.expert/explorer/testnet/contract/CCTQHJSLENZYPA2Q7XBVUGNVWMX4SMI7NSL577N4F34YTCIAERJ5PN5P) was [deployed](https://stellar.expert/explorer/testnet/tx/8a7ab7f987aeb473c8e65a1e33a253bb5b0a0ba1a0ed62ea369cc4cc76ff0f2c), received [6 USDC](https://stellar.expert/explorer/testnet/tx/ed49b349df59c2ce2b37bac9450ae1c0f88a14cd8fe879993887472fad216b64) and [4 USDC](https://stellar.expert/explorer/testnet/tx/1195067e6c0936e31466b122ec9050660a25fb2e991500ea6e7fa8d366f6c524), and reached its voting deadline before any vote was recorded. The attempted late vote failed in Testnet RPC simulation with `#2 WrongPhase` and was not submitted. [Finalization](https://stellar.expert/explorer/testnet/tx/5812775f173ac14a1ec91300902a6ec16e7fc5a859244962743843a7739ae5f5) returned `Refundable` with no winner. Donor A [recovered all 6 USDC](https://stellar.expert/explorer/testnet/tx/166ffdca276b12184c3de7c39f6b3b3414eeaf864d34562a82c4303cdc10e489) and donor B [recovered all 4 USDC](https://stellar.expert/explorer/testnet/tx/c427a3c7e28658899aa84d46c0cbd54fc9dbf7f5d74ec2ebfeb716aa61dddb4f). A final read-only balance call returned zero for the pool.

## Case B — accepted receipt, then distribution timeout

The [second exception contract](https://stellar.expert/explorer/testnet/contract/CAXFQFAJYAPU54DCBR67LMVOJEPWGMK6OPO4UNFGPER46NKABL2WZ5RC) was [deployed](https://stellar.expert/explorer/testnet/tx/3919af88808bcd28340692b1c7c8ce4842e9280647c0819be7326c04f981b3c1), received [6 USDC](https://stellar.expert/explorer/testnet/tx/6b217471840bfe18494df9eae65b1a88cdcda329c75b45783236b450e2391a02) and [4 USDC](https://stellar.expert/explorer/testnet/tx/c7dd09d1812e66177312ba2d6f43a1aad69c77528a9eaa8db9c964803b5d917f), and recorded [both donors' votes](https://stellar.expert/explorer/testnet/tx/87b906ea6b01dae567cbb15e91c3d5996729faf91859020d6c8690f31a1ff004) [for proposal 1](https://stellar.expert/explorer/testnet/tx/73013c4a80a419f6e636011e47d2ee00e85377c499e971d5e57e7e1edd52ce85). [Finalization](https://stellar.expert/explorer/testnet/tx/c4a18b038def99e6136e6c702d7e753fe8ddae09a66db7fae54d0c85bb67506b) approved it. The supplier [declared three kits dispatched](https://stellar.expert/explorer/testnet/tx/1e4e176e61bdd9cc7db6328d7825e745c28fe6520191636521c9b6562fe9d30a); the shop [declared three received](https://stellar.expert/explorer/testnet/tx/dfa197a5120988617496b60a2ae93741bd35c7487cbdd455cb68d42b86eb54ba). The issuer never attested distribution, so the supplier's 7 USDC share was earned and the shop's 3 USDC share was not.

After the delivery deadline, [refunds were enabled](https://stellar.expert/explorer/testnet/tx/55aba36e14b20c2ae026bf8c7b368981de7bf2ffd4e8724e817905e8434a36df). Donor A [claimed 1.8 USDC](https://stellar.expert/explorer/testnet/tx/18433d735bc2a2c11ae2d4739da271a76959880ce6b3becdbf8402c621d1f089), and donor B [claimed 1.2 USDC](https://stellar.expert/explorer/testnet/tx/6c352982419923c23de75743347e63b4941eb07c7990a2125bc6b42f4fedf560). **The pool still held 7 USDC after both refunds.** The supplier then [claimed those 7 USDC after expiry](https://stellar.expert/explorer/testnet/tx/a74afdc4399c799f5b0477bed5949a6d769b8ee6b320dfadcb9cc84647d642cb). Final read-only calls returned pool `0`, supplier `7 USDC`, shop `0`, campaign `Refundable`, and proposal flags `supplier_paid=true`, `shop_paid=false`.

| Stage | Pool | Donor A returned | Donor B returned | Supplier | Shop |
| --- | ---: | ---: | ---: | ---: | ---: |
| After donations, before timeout | 10 | 0 | 0 | 0 | 0 |
| After proportional refunds, before supplier claim | 7 | 1.8 | 1.2 | 0 | 0 |
| After supplier claim | 0 | 1.8 | 1.2 | 7 | 0 |

## Rejected operations

These checks used Testnet RPC simulation without `--send=yes`. They produced no ledger transactions. The CLI could not submit an invalid operation after simulation failed, so there is no explorer transaction hash for a rejection.

| Attempt | Result |
| --- | --- |
| Donor A votes a second time | `#5 AlreadyVoted` |
| Shop declares the same receipt a second time | `#9 AlreadyDeclared` |
| Shop claims its share without full distribution | `#10 NotReady` before and after deadline |
| Donor asks for a refund before timeout | `#2 WrongPhase` |
| Refunds are enabled before deadline | `#2 WrongPhase` |
| Donor A or B claims a second refund | `#4 NoDonation` |
| Supplier claims a second payment | `#11 AlreadyPaid` |
| Issuer attests after deadline | `#2 WrongPhase` |
| Shop account attempts `claim_supplier` | CLI refused to sign because the supplier account's signing key was absent |

The [earlier successful campaign](testnet-v2-separate-claims.md) also rejected a premature shop claim with `#10 NotReady` and both duplicate recipient claims with `#11 AlreadyPaid`. These tests show payment-rule enforcement for the demo accounts. Separate addresses do not prove different real-world operators, and signed declarations do not establish physical delivery.
