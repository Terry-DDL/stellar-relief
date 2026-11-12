# Stellar Testnet USDC evidence

This extract records the confirmed transactions, read-only balance and batch snapshots, and the first line of each negative preflight result from the original local run. Stellar Testnet may reset. The linked transactions describe the recorded run.

- Network: Stellar Testnet (`Test SDF Network ; September 2015`)
- Business Contract ID: [`CCOZA3KQNXIYB3ERKKAYZ4NKWBHTZQFSIEQQS7HXEBGH3RULUXHJ7PMR`](https://stellar.expert/explorer/testnet/contract/CCOZA3KQNXIYB3ERKKAYZ4NKWBHTZQFSIEQQS7HXEBGH3RULUXHJ7PMR)
- WASM Hash: `4b763614f798027da3ed93126242ee947410cce3bfb563ccf107c7d0328bdeb8`
- Asset: `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` / SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Settlement: 10 USDC → 7 USDC (wholesaler) + 3 USDC (shop)
- Batch ID: `1`
- Run ID: `f141f179b1d94e349421b48e0bfbafe6`
- agency: `GDD3ZJLJN2UI3DXEDWHHIE4OWW3HPZXZR2V7GHAWVGCFBU5TTNAXYASL`
- verifier: `GA3SVKPZYEBIKRETVSB237DNKF6BEGSBVOSB6AWCWIG6FI7HITZ75N4V`
- wholesaler: `GDMF6PJ4KZVW774WV4QLJIFRDA2APFKCQGVM7AU6XEXQE6IZ3JZE6F76`
- shop: `GBQ5FPATOGZV76UB3TTZTD22WQXN7IXPK6OTPCY2CJ2YJM27SLTATAGD`
- upload transaction: [`55c1e7ff271d4cbc83811415c6e84278049f265d45304c9896c912e9cb6922b1`](https://stellar.expert/explorer/testnet/tx/55c1e7ff271d4cbc83811415c6e84278049f265d45304c9896c912e9cb6922b1) — submitted and RPC SUCCESS, ledger 5688193.
- deploy transaction: [`65b77d82b6bcfeaeee2b1406741ddd5e347f7b585eaa40ad72a4300a6e2f6e24`](https://stellar.expert/explorer/testnet/tx/65b77d82b6bcfeaeee2b1406741ddd5e347f7b585eaa40ad72a4300a6e2f6e24) — submitted and RPC SUCCESS, ledger 5688194.
- fund transaction: [`dc5ee151a1ef632031d0e27c7629382e02e956067f894f2135ce0ac5bf5ed5ec`](https://stellar.expert/explorer/testnet/tx/dc5ee151a1ef632031d0e27c7629382e02e956067f894f2135ce0ac5bf5ed5ec) — submitted and RPC SUCCESS, ledger 5688196.
- settle transaction: [`0ae91cd2ba8aea76a0ab470dd08f844a9290111666ce6582918ce4522ff8dda4`](https://stellar.expert/explorer/testnet/tx/0ae91cd2ba8aea76a0ab470dd08f844a9290111666ce6582918ce4522ff8dda4) — submitted and RPC SUCCESS, ledger 5688199.

| Snapshot (USDC base units) | Agency | Escrow | Wholesaler | Shop |
| --- | ---: | ---: | ---: | ---: |
| before_funding | 100,000,000 | 0 | 0 | 0 |
| funded | 0 | 100,000,000 | 0 | 0 |
| settled | 0 | 0 | 70,000,000 | 30,000,000 |

Batch and balance reads and negative checks were simulations; no transaction submitted for these.

`get_batch` — before_funding

```json
null
```

`get_batch` — funded

```json
{
  "agency": "GDD3ZJLJN2UI3DXEDWHHIE4OWW3HPZXZR2V7GHAWVGCFBU5TTNAXYASL",
  "id": 1,
  "quantity": 3,
  "shop": "GBQ5FPATOGZV76UB3TTZTD22WQXN7IXPK6OTPCY2CJ2YJM27SLTATAGD",
  "shop_amount": "30000000",
  "status": "Funded",
  "total_amount": "100000000",
  "verifier": "GA3SVKPZYEBIKRETVSB237DNKF6BEGSBVOSB6AWCWIG6FI7HITZ75N4V",
  "wholesaler": "GDMF6PJ4KZVW774WV4QLJIFRDA2APFKCQGVM7AU6XEXQE6IZ3JZE6F76",
  "wholesaler_amount": "70000000"
}
```

`get_batch` — settled

```json
{
  "agency": "GDD3ZJLJN2UI3DXEDWHHIE4OWW3HPZXZR2V7GHAWVGCFBU5TTNAXYASL",
  "id": 1,
  "quantity": 3,
  "shop": "GBQ5FPATOGZV76UB3TTZTD22WQXN7IXPK6OTPCY2CJ2YJM27SLTATAGD",
  "shop_amount": "30000000",
  "status": "Settled",
  "total_amount": "100000000",
  "verifier": "GA3SVKPZYEBIKRETVSB237DNKF6BEGSBVOSB6AWCWIG6FI7HITZ75N4V",
  "wholesaler": "GDMF6PJ4KZVW774WV4QLJIFRDA2APFKCQGVM7AU6XEXQE6IZ3JZE6F76",
  "wholesaler_amount": "70000000"
}
```

**authorization: PASS**

```text
Correct verifier passed enforce preflight. Wrong source: HostError: Error(Auth, InvalidAction)
```

**quantity: PASS**

```text
HostError: Error(Contract, #2)
```

**duplicate: PASS**

```text
HostError: Error(Contract, #5)
```
