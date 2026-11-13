# Stellar Relief V2 — November 16 Project Showcase pack

This is a team draft for the **current donor-governed V2**. It does not describe the older agency-funded V1 workflow in `showcase-form.md`.

## Organizer instructions received by the team

- **Monday, November 16, 2026:** arrive at **4:00 PM** to set up; programming runs roughly **4:30–6:30 PM**; our pitch slot is **6:09 PM**.
- **Place:** Pearl Sullivan Engineering building, second-floor event space. Use the organizer's direct email if older public pages show a different location.
- Bring a **complete trifold board**, deliver a **three-minute presentation by one speaker**, and include a **one-minute video of the functioning prototype**. Host the video publicly and add its link to the Devpost project. Slide-only footage does not meet the instruction.
- Keep the **Stellar Testnet contract ID** and **live app URL** in the Devpost entry so judges can inspect the prototype.

## One-sentence thesis

**Stellar Relief turns global disaster donations into staged payment commitments that let a supplier ship, a local shop distribute essentials, and residents receive kits without paying cash up front.**

The financial service is **conditional payment for emergency procurement and last-mile distribution**. Donor voting chooses which relief order receives the pool. The prototype does not verify physical delivery or operate with real money.

## Customer and benefit — answer the panel's questions

| Question | Working answer for this prototype | Evidence gap before a real launch |
| --- | --- | --- |
| Who is the customer? | **B2B2C:** a relief campaign organizer or local emergency program arranges the order; suppliers and neighborhood shops are the immediate payment recipients; disaster-affected households receive goods. Donors fund the pool directly rather than transferring custody to an NGO wallet. | Choose one pilot geography and identify a real organizer, supplier, and shop. No partner has committed yet. |
| What problem do they have? | A supplier may hesitate to ship before payment is secured; a shop may hesitate to distribute inventory without a clear settlement rule; households may lack cash during a disruption. Donors need visibility into the chosen order and subsequent payments. | Interview partners to quantify deposit requirements, payment delays, and reconciliation costs. |
| How many have the problem? | [UNDRR reports roughly 100 million people affected by disasters per year](https://www.undrr.org/implementing-sendai-framework/monitoring-sendai-framework/sfm-data-and-analytics). This is **end-user need**, not a count of paying customers or proof all need this product. | Count eligible procurement programs, merchants, and suppliers in a chosen pilot market. Do not present the 100 million figure as customers or market size. |
| What is the direct benefit? | Supplier: inspect funded commitment and claim the earned 70% after accepted shop receipt. Shop: earn the remaining 30% after distribution attestation. Donors: inspect on-chain allocation and payment claims. Households: redeem aid kits without paying the shop first. | Quantify whether this actually changes supplier terms, speeds delivery, or lowers administration costs. The sample 70/30 split is not validated economics. |
| Which partners are essential? | A locally trusted **voucher eligibility issuer** and independent delivery checker; supplier and shop networks; regulated fiat-to-USDC and local payout providers for real-money deployment. These partners need not custody the donation pool. | Identity, fraud prevention, dispute resolution, local-currency conversion, and partner agreements are not in the prototype. |
| How could the business sustain itself? | **Hypothesis, not current revenue:** charge a transparent software/setup fee to a campaign organizer for configuring and reporting on campaigns. Donations in the current prototype are allocated to supplier and shop; no platform fee exists in the contract. | Test willingness to pay and cost per campaign. Do not claim a validated business model or no need for donor funding. |

## Trifold board copy

### Left panel — the payment gap

**Money pledged is not the same as goods delivered.** A supplier needs payment assurance before dispatch. A neighborhood shop needs a dependable settlement rule before distributing kits. Families may be unable to pay cash during a disaster. Globally, about **100 million people are affected by disasters each year** ([UNDRR](https://www.undrr.org/implementing-sendai-framework/monitoring-sendai-framework/sfm-data-and-analytics)); the first merchant and organizer pilot still needs to be selected.

### Center panel — how Stellar Relief works

`Global donors → Testnet USDC pool → weighted vote → funded order → supplier dispatch + shop receipt → supplier claims 70% → issuer attests distribution → shop claims 30%`

Soroban holds the pool and enforces who can claim each payment. If no order wins, donors can recover their deposits. If distribution times out after shop receipt, donors recover only the unearned portion; the supplier's already-earned share stays claimable. Household identities stay off-chain.

### Right panel — proof and limits

**Built and verified on Testnet:** two donors deposited 6 + 4 test USDC and voted 6–4. The supplier [claimed 7 USDC](https://stellar.expert/explorer/testnet/tx/ba3621b7bd9592274718ead7e5ce13874e849b2f24b529bd46644ec5262e1231); after issuer attestation, the shop [claimed 3 USDC](https://stellar.expert/explorer/testnet/tx/901f62794261f9c420f597849b71848a0314ca623ecbe3dd747f49ab796182b2). [Exception-path evidence](testnet-v2-exception-paths.md) covers full refunds, partial refunds that preserve an earned supplier payout, and rejected unauthorized or duplicate actions.

**Try it:** https://stellar-relief-v2.vercel.app/

**Code:** https://github.com/Terry-DDL/stellar-relief

**Current contract:** https://stellar.expert/explorer/testnet/contract/CCQJYZFPUCKVA76AU3RDWIHPPNSZKSG45QNEZXE7V3QHPOSPKGJF2XNH

**Honest boundary:** The web buttons are a browser walkthrough; the linked Testnet transactions are actual contract calls. Signed declarations record claims by named roles, but do not independently prove that physical goods arrived. Voucher eligibility, independent checks, wallet-connected web payments, and real fiat conversion need partners and further work.

## Three-minute presentation script (English draft)

The spoken parts target roughly two minutes; the video takes the other minute. Rehearse aloud and cut words as needed.

**0:00–0:35 — Customer problem**

"After a disaster, donations may arrive quickly, but a supplier still asks: will I be paid if I ship? A neighborhood shop asks the same question before giving out essentials. Families may not have cash when they reach the store. That is the payment gap Stellar Relief addresses. Our first customer would be a relief procurement program working with local suppliers and shops; households are the people it serves."

**0:35–1:00 — Payment mechanism**

"Donors put test USDC directly into a Stellar smart contract and vote on a relief order. The money stays locked under public rules. Once the supplier declares dispatch and the shop confirms receipt, the supplier can claim its earned share. After a separate issuer attests distribution, the shop can claim its share. Refunds cannot take money a supplier already earned."

**1:00–2:00 — Play the one-minute prototype video.**

**2:00–2:40 — What is real today**

"This is a working Testnet contract, not just a design. In our sample, two donors funded ten test USDC and voted six to four. The supplier claimed seven USDC; after distribution attestation, the shop claimed three. We also tested a failed vote and a distribution timeout: donors recovered only unearned funds, while the supplier's earned payment remained safe. These transactions and the contract ID are publicly linked in our repository."

**2:40–3:00 — Value and boundary**

"Stellar gives us low-cost cross-border transfer, public payment records, and enforceable payout rules without one intermediary holding the pool. The next step is a real pilot with independent eligibility and delivery checks. We would test whether a procurement organizer will pay for faster, more auditable campaign operations."

## One-minute video shot list

Use screen recording of the **actual app** and **actual Testnet explorer**, not slides. Add small on-screen labels so judges do not confuse the two.

| Time | Screen | Label |
| --- | --- | --- |
| 0–8 s | Open live V2 app and show donor funding step | Browser walkthrough |
| 8–17 s | Show 6 + 4 contribution and 6–4 vote | Browser walkthrough |
| 17–30 s | Show supplier dispatch and matching shop receipt | Browser walkthrough |
| 30–42 s | Show 7 USDC supplier claim milestone | Browser walkthrough |
| 42–51 s | Show voucher redemption, issuer attestation, and 3 USDC shop claim | Browser walkthrough |
| 51–60 s | Open supplier and shop transaction pages in Stellar Expert Testnet | Actual Testnet transactions |

Before the event, verify that the public video link, live app URL, current contract ID, and GitHub URL are present in the **submitted** Devpost entry. Keep a local copy of the video in case event Wi-Fi is unreliable.

## Likely judge questions

1. **How do you know goods arrived?** We do not prove this on-chain. The contract authenticates declarations and releases funds at defined stages. Independent delivery checks and disputes are needed in a pilot.
2. **What stops a supplier and shop from colluding?** Their signatures create an attributable trail, but signatures alone do not prevent collusion. A separate issuer, recipient evidence, audits, and dispute procedures are needed.
3. **Why does this need Stellar?** It combines cross-border stablecoin funding, publicly inspectable escrow, role-specific claims, and refunds that preserve earned payouts in one contract.
4. **Why 70/30?** It is an illustrative allocation in the Testnet demo, not a validated price. Real procurement should quote goods, transport, shop operations, and fees separately.
5. **How does the business earn revenue?** No revenue is implemented. The first commercial test is whether relief procurement organizers will pay a disclosed software/setup fee for a verified payment workflow.
