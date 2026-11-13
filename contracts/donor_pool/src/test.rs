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

    fn approve_order(&self) -> Proposal {
        let order = self.propose("Coastal flood");
        self.fund();
        self.client().mock_all_auths().vote(&self.donor_a, &order.id);
        self.advance(2_000);
        assert_eq!(self.client().finalize().phase, Phase::Approved);
        order
    }

    fn balance(&self, address: &Address) -> i128 {
        token::TokenClient::new(&self.env, &self.asset).balance(address)
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
    assert!(f.client().try_claim_shop(&a.id).is_err());
    assert!(f.client().try_declare_dispatch(&a.id, &3).is_err());
    f.client().mock_all_auths().declare_dispatch(&a.id, &3);
    assert!(f.client().mock_all_auths().try_declare_receipt(&a.id, &2).is_err());
    f.client().mock_all_auths().declare_receipt(&a.id, &3);
    assert!(f.client().try_claim_shop(&a.id).is_err());
    assert!(f.client().try_claim_supplier(&a.id).is_err());
    assert_eq!(f.client().mock_all_auths().claim_supplier(&a.id), 70);
    assert_eq!(f.balance(&f.shop), 0);
    assert!(f.client().mock_all_auths().try_claim_supplier(&a.id).is_err());
    assert!(f.client().try_attest_distribution(&a.id, &3).is_err());
    f.client().mock_all_auths().attest_distribution(&a.id, &3);
    assert_eq!(f.client().mock_all_auths().claim_shop(&a.id), 30);
    assert_eq!(f.client().campaign().phase, Phase::Settled);
    let balances = token::TokenClient::new(&f.env, &f.asset);
    assert_eq!(balances.balance(&f.supplier), 70);
    assert_eq!(balances.balance(&f.shop), 30);
    assert!(f.client().try_claim_shop(&a.id).is_err());
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

#[test]
fn accepted_delivery_reserves_supplier_funds_across_deadline_and_refunds() {
    let f = Fixture::new();
    let order = f.approve_order();
    let client = f.client().mock_all_auths();
    client.declare_dispatch(&order.id, &3);
    client.declare_receipt(&order.id, &3);
    client.attest_distribution(&order.id, &1);
    f.advance(3_000);
    assert!(client.try_attest_distribution(&order.id, &3).is_err());
    assert_eq!(client.enable_refunds().phase, Phase::Refundable);
    assert_eq!(client.claim_refund(&f.donor_a), 18);
    assert_eq!(client.claim_refund(&f.donor_b), 12);
    assert_eq!(f.balance(&f.contract), 70);
    assert!(client.try_claim_shop(&order.id).is_err());
    assert_eq!(client.claim_supplier(&order.id), 70);
    assert!(client.try_claim_supplier(&order.id).is_err());
    assert_eq!(f.balance(&f.supplier), 70);
    assert_eq!(f.balance(&f.contract), 0);
}

#[test]
fn full_attestation_reserves_both_payments_after_deadline() {
    let f = Fixture::new();
    let order = f.approve_order();
    let client = f.client().mock_all_auths();
    assert!(client.try_declare_receipt(&order.id, &3).is_err());
    assert!(client.try_declare_dispatch(&order.id, &2).is_err());
    client.declare_dispatch(&order.id, &3);
    client.declare_receipt(&order.id, &3);
    assert!(client.try_claim_shop(&order.id).is_err());
    client.attest_distribution(&order.id, &3);
    assert!(client.try_attest_distribution(&order.id, &3).is_err());
    f.advance(3_000);
    assert!(client.try_enable_refunds().is_err());
    assert!(client.try_claim_refund(&f.donor_a).is_err());
    assert!(f.client().try_claim_shop(&order.id).is_err());
    assert_eq!(client.claim_shop(&order.id), 30);
    assert_eq!(f.balance(&f.contract), 70);
    assert_eq!(client.claim_supplier(&order.id), 70);
    assert!(client.try_claim_shop(&order.id).is_err());
    assert_eq!(client.campaign().phase, Phase::Settled);
    assert_eq!(f.balance(&f.contract), 0);
}

#[test]
fn failed_transfer_leaves_supplier_claim_retriable() {
    let f = Fixture::new();
    let order = f.approve_order();
    let client = f.client().mock_all_auths();
    client.declare_dispatch(&order.id, &3);
    client.declare_receipt(&order.id, &3);
    let token = token::TokenClient::new(&f.env, &f.asset);
    token.mock_all_auths().burn(&f.contract, &40);
    assert!(client.try_claim_supplier(&order.id).is_err());
    assert!(!client.proposal(&order.id).unwrap().supplier_paid);
    assert_eq!(f.balance(&f.supplier), 0);
    token::StellarAssetClient::new(&f.env, &f.asset).mock_all_auths().mint(&f.contract, &40);
    assert_eq!(client.claim_supplier(&order.id), 70);
    assert_eq!(f.balance(&f.contract), 30);
}

#[test]
fn voting_and_fulfillment_close_at_their_deadlines() {
    let f = Fixture::new();
    let order = f.propose("Coastal flood");
    f.fund();
    let client = f.client().mock_all_auths();
    assert!(client.try_finalize().is_err());
    client.vote(&f.donor_a, &order.id);
    f.advance(2_000);
    assert!(client.try_vote(&f.donor_b, &order.id).is_err());
    assert_eq!(client.finalize().phase, Phase::Approved);
    client.declare_dispatch(&order.id, &3);
    f.advance(3_000);
    assert!(client.try_declare_receipt(&order.id, &3).is_err());
    client.enable_refunds();
    assert!(f.client().try_claim_refund(&f.donor_a).is_err());
    assert_eq!(client.claim_refund(&f.donor_a), 60);
    assert_eq!(client.claim_refund(&f.donor_b), 40);
}

#[test]
fn fractional_refunds_allocate_the_whole_unearned_share_in_either_order() {
    for reverse in [false, true] {
        let f = Fixture::new();
        // Fund a pool with shares that require rounding in token units.
        let third = Address::generate(&f.env);
        let mint = token::StellarAssetClient::new(&f.env, &f.asset);
        for (donor, amount) in [(&f.donor_a, 59), (&f.donor_b, 40), (&third, 1)] {
            let shortfall = amount - f.balance(donor);
            if shortfall > 0 { mint.mock_all_auths().mint(donor, &shortfall); }
        }
        let issuer = Address::generate(&f.env);
        let pool = f.env.register(DonorPool, (&f.asset, &issuer, &100_i128, &2_000_u64, &3_000_u64));
        let client = DonorPoolClient::new(&f.env, &pool).mock_all_auths();
        let order = client.propose(&f.donor_a, &String::from_str(&f.env, "Coastal flood"), &3, &f.supplier, &f.shop);
        for (donor, amount) in [(&f.donor_a, 59), (&f.donor_b, 40), (&third, 1)] {
            client.donate(donor, &amount);
        }
        client.vote(&f.donor_a, &order.id);
        f.advance(2_000);
        client.finalize();
        client.declare_dispatch(&order.id, &3);
        client.declare_receipt(&order.id, &3);
        f.advance(3_000);
        client.enable_refunds();
        let (first, last) = if reverse { (&third, &f.donor_a) } else { (&f.donor_a, &third) };
        assert_eq!(client.claim_refund(first) + client.claim_refund(&f.donor_b) + client.claim_refund(last), 30);
        assert!(client.try_claim_refund(last).is_err());
        assert_eq!(f.balance(&pool), 70);
        assert_eq!(client.claim_supplier(&order.id), 70);
        assert_eq!(f.balance(&pool), 0);
    }
}
