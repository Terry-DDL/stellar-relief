use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};

struct Fixture {
    env: Env,
    contract: Address,
    asset: Address,
    donor_a: Address,
    donor_b: Address,
    supplier: Address,
    shop: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let donor_a = Address::generate(&env);
        let donor_b = Address::generate(&env);
        let supplier = Address::generate(&env);
        let shop = Address::generate(&env);
        let issuer = Address::generate(&env);
        let mint = token::StellarAssetClient::new(&env, &asset);
        mint.mock_all_auths().mint(&donor_a, &60);
        mint.mock_all_auths().mint(&donor_b, &40);
        let contract = env.register(DonorPool, (&asset, &issuer, &100_i128, &2_000_u64, &3_000_u64));
        Self { env, contract, asset, donor_a, donor_b, supplier, shop }
    }

    fn client(&self) -> DonorPoolClient<'_> {
        DonorPoolClient::new(&self.env, &self.contract)
    }

    fn propose(&self, region: &str) -> Proposal {
        self.client().mock_all_auths().propose(
            &self.donor_a,
            &String::from_str(&self.env, region),
            &3,
            &self.supplier,
            &self.shop,
        )
    }

    fn fund(&self) {
        self.client().mock_all_auths().donate(&self.donor_a, &60);
        self.client().mock_all_auths().donate(&self.donor_b, &40);
    }

    fn advance(&self, timestamp: u64) {
        self.env.ledger().with_mut(|ledger| ledger.timestamp = timestamp);
    }
}

#[test]
fn donors_vote_and_matching_delivery_settles() {
    let f = Fixture::new();
    let a = f.propose("Coastal flood");
    let b = f.propose("Mountain storm");
    f.fund();
    assert_eq!(f.client().campaign().phase, Phase::Voting);
    assert_eq!(f.client().donation(&f.donor_a), 60);
    assert!(f.client().mock_all_auths().try_donate(&f.donor_a, &1).is_err());
    f.client().mock_all_auths().vote(&f.donor_a, &a.id);
    f.client().mock_all_auths().vote(&f.donor_b, &b.id);
    assert!(f.client().mock_all_auths().try_vote(&f.donor_a, &b.id).is_err());
    f.advance(2_000);
    let chosen = f.client().finalize();
    assert_eq!(chosen.phase, Phase::Approved);
    assert_eq!(chosen.winner, Some(a.id));
    assert!(f.client().try_settle(&a.id).is_err());
    assert!(f.client().try_declare_dispatch(&a.id, &3).is_err());
    f.client().mock_all_auths().declare_dispatch(&a.id, &3);
    assert!(f.client().mock_all_auths().try_declare_receipt(&a.id, &2).is_err());
    f.client().mock_all_auths().declare_receipt(&a.id, &3);
    assert!(f.client().try_settle(&a.id).is_err());
    assert!(f.client().try_attest_distribution(&a.id, &3).is_err());
    f.client().mock_all_auths().attest_distribution(&a.id, &3);
    assert_eq!(f.client().settle(&a.id).phase, Phase::Settled);
    let balances = token::TokenClient::new(&f.env, &f.asset);
    assert_eq!(balances.balance(&f.supplier), 70);
    assert_eq!(balances.balance(&f.shop), 30);
    assert!(f.client().try_settle(&a.id).is_err());
}

#[test]
fn failed_vote_returns_each_donation() {
    let f = Fixture::new();
    let a = f.propose("Coastal flood");
    let b = f.propose("Mountain storm");
    f.fund();
    f.client().mock_all_auths().vote(&f.donor_b, &b.id);
    f.advance(2_000);
    assert_eq!(f.client().finalize().phase, Phase::Refundable);
    assert_eq!(f.client().mock_all_auths().claim_refund(&f.donor_a), 60);
    assert_eq!(f.client().mock_all_auths().claim_refund(&f.donor_b), 40);
    assert!(f.client().mock_all_auths().try_claim_refund(&f.donor_a).is_err());
    assert_eq!(f.client().proposal(&a.id).unwrap().votes, 0);
}

#[test]
fn missed_delivery_deadline_unlocks_refunds() {
    let f = Fixture::new();
    let a = f.propose("Coastal flood");
    f.fund();
    f.client().mock_all_auths().vote(&f.donor_a, &a.id);
    f.advance(2_000);
    f.client().finalize();
    assert!(f.client().try_enable_refunds().is_err());
    f.advance(3_000);
    assert_eq!(f.client().enable_refunds().phase, Phase::Refundable);
    assert!(f.client().mock_all_auths().try_declare_dispatch(&a.id, &3).is_err());
    f.client().mock_all_auths().claim_refund(&f.donor_a);
    f.client().mock_all_auths().claim_refund(&f.donor_b);
}
