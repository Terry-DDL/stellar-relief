use super::*;
use soroban_sdk::{
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, EnvTestConfig, MockAuth,
        MockAuthInvoke,
    },
    xdr, Bytes, IntoVal, Symbol,
};
use std::{rc::Rc, string::ToString};

const STARTING_BALANCE: i64 = 2_500_000_000;
const TOTAL: i128 = 1_000_000_000;
const WHOLESALER: i128 = 700_000_000;
const SHOP: i128 = 300_000_000;

fn seed_classic_account(env: &Env, account_id: xdr::AccountId, balance: i64) {
    env.host()
        .add_ledger_entry(
            &Rc::new(xdr::LedgerKey::Account(xdr::LedgerKeyAccount {
                account_id: account_id.clone(),
            })),
            &Rc::new(xdr::LedgerEntry {
                last_modified_ledger_seq: 0,
                data: xdr::LedgerEntryData::Account(xdr::AccountEntry {
                    account_id,
                    balance,
                    seq_num: xdr::SequenceNumber(0),
                    num_sub_entries: 0,
                    inflation_dest: None,
                    flags: 0,
                    home_domain: Default::default(),
                    thresholds: xdr::Thresholds([1; 4]),
                    signers: Default::default(),
                    ext: xdr::AccountEntryExt::V0,
                }),
                ext: xdr::LedgerEntryExt::V0,
            }),
            None,
        )
        .unwrap();
}

struct Fixture {
    env: Env,
    contract: Address,
    asset: Address,
    agency: Address,
    wholesaler: Address,
    shop: Address,
    verifier: Address,
}

impl Fixture {
    fn new(balance: i64) -> Self {
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        let xlm = env
            .deployer()
            .with_stellar_asset(Bytes::from_array(&env, &[0; 4]))
            .deploy();
        // Native XLM comes from a classic account in the test ledger.
        let account_id =
            xdr::AccountId(xdr::PublicKey::PublicKeyTypeEd25519(xdr::Uint256([7; 32])));
        let agency = Address::from_str(&env, &account_id.to_string());
        seed_classic_account(&env, account_id, balance);

        let contract = env.register(StellarRelief, (&agency, &xlm));
        Self {
            wholesaler: Address::generate(&env),
            shop: Address::generate(&env),
            verifier: Address::generate(&env),
            env,
            contract,
            asset: xlm,
            agency,
        }
    }

    fn usdc(balance: i128) -> Self {
        use xdr::WriteXdr;
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        let issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
        let issuer_id: xdr::AccountId = issuer.parse().unwrap();
        seed_classic_account(&env, issuer_id.clone(), STARTING_BALANCE);
        let usdc = xdr::AlphaNum4 {
            asset_code: xdr::AssetCode4(*b"USDC"),
            issuer: issuer_id,
        };
        let bytes = xdr::Asset::CreditAlphanum4(usdc.clone())
            .to_xdr(xdr::Limits::none())
            .unwrap();
        let sac = env
            .deployer()
            .with_stellar_asset(Bytes::from_slice(&env, &bytes))
            .deploy();
        let classic_wallet = |seed, balance| {
            let id = xdr::AccountId(xdr::PublicKey::PublicKeyTypeEd25519(xdr::Uint256(
                [seed; 32],
            )));
            seed_classic_account(&env, id.clone(), STARTING_BALANCE);
            let asset = xdr::TrustLineAsset::CreditAlphanum4(usdc.clone());
            env.host()
                .add_ledger_entry(
                    &Rc::new(xdr::LedgerKey::Trustline(xdr::LedgerKeyTrustLine {
                        account_id: id.clone(),
                        asset: asset.clone(),
                    })),
                    &Rc::new(xdr::LedgerEntry {
                        last_modified_ledger_seq: 0,
                        data: xdr::LedgerEntryData::Trustline(xdr::TrustLineEntry {
                            account_id: id.clone(),
                            asset,
                            balance,
                            limit: i64::MAX,
                            flags: xdr::TrustLineFlags::AuthorizedFlag as u32,
                            ext: xdr::TrustLineEntryExt::V0,
                        }),
                        ext: xdr::LedgerEntryExt::V0,
                    }),
                    None,
                )
                .unwrap();
            Address::from_str(&env, &id.to_string())
        };
        let agency = classic_wallet(7, i64::try_from(balance).unwrap());
        let wholesaler = classic_wallet(9, 0);
        let shop = classic_wallet(10, 0);
        let contract = env.register(StellarRelief, (&agency, &sac));
        Self {
            wholesaler,
            shop,
            verifier: Address::generate(&env),
            env,
            contract,
            asset: sac,
            agency,
        }
    }

    fn client(&self) -> StellarReliefClient<'_> {
        StellarReliefClient::new(&self.env, &self.contract)
    }

    fn token(&self) -> token::TokenClient<'_> {
        token::TokenClient::new(&self.env, &self.asset)
    }

    fn fund(&self, id: u32) -> Batch {
        let batch = self.client().mock_all_auths().fund_batch(
            &id,
            &3,
            &self.wholesaler,
            &self.shop,
            &self.verifier,
            &WHOLESALER,
            &SHOP,
        );
        assert_eq!(
            self.env.auths(),
            std::vec![(
                self.agency.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        self.contract.clone(),
                        Symbol::new(&self.env, "fund_batch"),
                        (
                            id,
                            3_u32,
                            &self.wholesaler,
                            &self.shop,
                            &self.verifier,
                            WHOLESALER,
                            SHOP
                        )
                            .into_val(&self.env),
                    )),
                    sub_invocations: std::vec![AuthorizedInvocation {
                        function: AuthorizedFunction::Contract((
                            self.asset.clone(),
                            Symbol::new(&self.env, "transfer"),
                            (&self.agency, &self.contract, TOTAL).into_val(&self.env),
                        )),
                        sub_invocations: std::vec![],
                    }],
                },
            )]
        );
        batch
    }

    fn try_fund(
        &self,
        id: u32,
        quantity: u32,
        wholesale: i128,
        shop: i128,
        authorized: bool,
    ) -> Result<
        Result<Batch, soroban_sdk::ConversionError>,
        Result<ReliefError, soroban_sdk::InvokeError>,
    > {
        let client = self.client();
        let client = if authorized {
            client.mock_all_auths()
        } else {
            client
        };
        client.try_fund_batch(
            &id,
            &quantity,
            &self.wholesaler,
            &self.shop,
            &self.verifier,
            &wholesale,
            &shop,
        )
    }
}

#[test]
fn funds_native_xlm_and_records_batch() {
    let f = Fixture::new(STARTING_BALANCE);
    assert_eq!(f.token().balance(&f.contract), 0);
    let batch = f.fund(42);
    assert_eq!(
        f.token().balance(&f.agency),
        i128::from(STARTING_BALANCE) - TOTAL
    );
    assert_eq!(f.token().balance(&f.contract), TOTAL);
    assert_eq!(f.token().balance(&f.wholesaler), 0);
    assert_eq!(f.token().balance(&f.shop), 0);
    assert_eq!(
        batch,
        Batch {
            id: 42,
            quantity: 3,
            agency: f.agency.clone(),
            wholesaler: f.wholesaler.clone(),
            shop: f.shop.clone(),
            verifier: f.verifier.clone(),
            wholesaler_amount: WHOLESALER,
            shop_amount: SHOP,
            total_amount: TOTAL,
            status: BatchStatus::Funded,
        }
    );
    assert_eq!(f.client().get_batch(&42), Some(batch));
    assert_eq!(f.client().get_batch(&43), None);
}

#[test]
fn unknown_batch_is_absent_before_funding() {
    let f = Fixture::new(STARTING_BALANCE);
    assert_eq!(f.client().get_batch(&42), None);
}

#[test]
fn rejects_repeat_funding_even_under_a_different_id() {
    let f = Fixture::new(STARTING_BALANCE);
    let batch = f.fund(42);
    for id in [42, 43] {
        assert_eq!(
            f.try_fund(id, 3, WHOLESALER, SHOP, true),
            Err(Ok(ReliefError::BatchAlreadyFunded))
        );
    }
    assert_eq!(f.token().balance(&f.contract), TOTAL);
    assert_eq!(f.client().get_batch(&42), Some(batch));
}

#[test]
fn rejects_wrong_quantities() {
    let f = Fixture::new(STARTING_BALANCE);
    for quantity in [0, 2, 4] {
        assert_eq!(
            f.try_fund(42, quantity, WHOLESALER, SHOP, true),
            Err(Ok(ReliefError::InvalidQuantity))
        );
    }
    assert_eq!(f.client().get_batch(&42), None);
    assert_eq!(f.token().balance(&f.contract), 0);
}

#[test]
fn rejects_illegal_amounts_and_wrong_splits() {
    let f = Fixture::new(STARTING_BALANCE);
    for (wholesale, shop) in [
        (0, SHOP),
        (WHOLESALER, -1),
        (70, 30),
        (SHOP, WHOLESALER),
        (i128::MAX, SHOP),
    ] {
        assert_eq!(
            f.try_fund(42, 3, wholesale, shop, true),
            Err(Ok(ReliefError::InvalidAmounts))
        );
    }
    assert_eq!(f.client().get_batch(&42), None);
    assert_eq!(f.token().balance(&f.contract), 0);
}

#[test]
fn requires_agency_authorization() {
    let f = Fixture::new(STARTING_BALANCE);
    // Supplying the right arguments does not authorize spending the agency's XLM.
    assert!(f.try_fund(42, 3, WHOLESALER, SHOP, false).is_err());
    assert_eq!(f.token().balance(&f.agency), i128::from(STARTING_BALANCE));
    assert_eq!(f.token().balance(&f.contract), 0);
    assert_eq!(f.client().get_batch(&42), None);
}

#[test]
fn failed_transfer_leaves_no_funded_batch() {
    let f = Fixture::new(500_000_000);
    assert!(f.try_fund(42, 3, WHOLESALER, SHOP, true).is_err());
    assert_eq!(f.token().balance(&f.agency), 500_000_000);
    assert_eq!(f.token().balance(&f.contract), 0);
    assert_eq!(f.client().get_batch(&42), None);
}

#[test]
fn settles_xlm_and_updates_the_public_batch_status() {
    let f = Fixture::new(STARTING_BALANCE);
    let mut expected = f.fund(42);
    assert_eq!(
        f.client().get_batch(&42).unwrap().status,
        BatchStatus::Funded
    );

    let settled = f.client().mock_all_auths().settle_batch(&42, &3);
    assert_eq!(
        f.env.auths(),
        std::vec![(
            f.verifier.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    f.contract.clone(),
                    Symbol::new(&f.env, "settle_batch"),
                    (42_u32, 3_u32).into_val(&f.env),
                )),
                sub_invocations: std::vec![],
            },
        )]
    );
    expected.status = BatchStatus::Settled;
    assert_eq!(settled, expected);
    assert_eq!(f.client().get_batch(&42), Some(expected));
    assert_eq!(f.token().balance(&f.contract), 0);
    assert_eq!(f.token().balance(&f.wholesaler), WHOLESALER);
    assert_eq!(f.token().balance(&f.shop), SHOP);
}

#[test]
fn rejects_authorization_from_a_different_address() {
    let f = Fixture::new(STARTING_BALANCE);
    let batch = f.fund(42);

    let result = f
        .client()
        .mock_auths(&[MockAuth {
            address: &f.wholesaler,
            invoke: &MockAuthInvoke {
                contract: &f.contract,
                fn_name: "settle_batch",
                args: (42_u32, 3_u32).into_val(&f.env),
                sub_invokes: &[],
            },
        }])
        .try_settle_batch(&42, &3);

    assert_eq!(result, Err(Err(soroban_sdk::InvokeError::Abort)));
    assert_eq!(f.client().get_batch(&42), Some(batch));
    assert_eq!(f.token().balance(&f.contract), TOTAL);
    assert_eq!(f.token().balance(&f.wholesaler), 0);
    assert_eq!(f.token().balance(&f.shop), 0);
}

#[test]
fn rejects_settlement_for_wrong_quantity() {
    let f = Fixture::new(STARTING_BALANCE);
    let batch = f.fund(42);

    assert_eq!(
        f.client().mock_all_auths().try_settle_batch(&42, &2),
        Err(Ok(ReliefError::InvalidQuantity))
    );
    assert_eq!(f.client().get_batch(&42), Some(batch));
    assert_eq!(f.token().balance(&f.contract), TOTAL);
    assert_eq!(f.token().balance(&f.wholesaler), 0);
    assert_eq!(f.token().balance(&f.shop), 0);
}

#[test]
fn rejects_settlement_for_unfunded_or_unknown_batch() {
    let f = Fixture::new(STARTING_BALANCE);
    assert_eq!(
        f.client().try_settle_batch(&42, &3),
        Err(Ok(ReliefError::BatchNotFound))
    );
    let batch = f.fund(42);
    assert_eq!(
        f.client().try_settle_batch(&43, &3),
        Err(Ok(ReliefError::BatchNotFound))
    );
    assert_eq!(f.client().get_batch(&42), Some(batch));
    assert_eq!(f.token().balance(&f.contract), TOTAL);
}

#[test]
fn rejects_repeat_settlement_even_if_escrow_has_more_xlm() {
    let f = Fixture::new(STARTING_BALANCE);
    f.fund(42);
    let settled = f.client().mock_all_auths().settle_batch(&42, &3);
    // Replenish escrow so insufficient funds cannot mask a missing replay guard.
    f.token()
        .mock_all_auths()
        .transfer(&f.agency, &f.contract, &TOTAL);

    assert_eq!(
        f.client().mock_all_auths().try_settle_batch(&42, &3),
        Err(Ok(ReliefError::BatchAlreadySettled))
    );
    assert_eq!(f.client().get_batch(&42), Some(settled));
    assert_eq!(f.token().balance(&f.contract), TOTAL);
    assert_eq!(f.token().balance(&f.wholesaler), WHOLESALER);
    assert_eq!(f.token().balance(&f.shop), SHOP);
}

#[test]
fn rolls_back_first_payment_if_second_payment_is_short_one_stroop() {
    let f = Fixture::new(STARTING_BALANCE);
    let funded = f.fund(42);
    // Adjust only the test ledger. The first payment is affordable, but leaves
    // one stroop less than the shop payment needs.
    f.env.as_contract(&f.contract, || {
        f.token()
            .mock_all_auths()
            .transfer(&f.contract, &f.agency, &1);
    });
    assert_eq!(f.token().balance(&f.contract), TOTAL - 1);

    assert!(f
        .client()
        .mock_all_auths()
        .try_settle_batch(&42, &3)
        .is_err());
    assert_eq!(f.token().balance(&f.contract), TOTAL - 1);
    assert_eq!(f.token().balance(&f.wholesaler), 0);
    assert_eq!(f.token().balance(&f.shop), 0);
    assert_eq!(f.client().get_batch(&42), Some(funded));

    f.token()
        .mock_all_auths()
        .transfer(&f.agency, &f.contract, &1);
    assert_eq!(
        f.client().mock_all_auths().settle_batch(&42, &3).status,
        BatchStatus::Settled
    );
}

#[test]
fn usdc_escrow_and_settlement_use_seven_decimal_units() {
    for (whole, shop) in [(700_000_000, 300_000_000), (70_000_000, 30_000_000)] {
        let amount = whole + shop;
        let f = Fixture::usdc(amount);
        assert_eq!(f.token().decimals(), 7);
        assert_eq!(
            f.try_fund(42, 3, whole + 1, shop, true),
            Err(Ok(ReliefError::InvalidAmounts))
        );
        let funded = f.try_fund(42, 3, whole, shop, true).unwrap().unwrap();
        assert_eq!(funded.status, BatchStatus::Funded);
        assert_eq!(funded.total_amount, amount);
        assert_eq!(f.client().get_batch(&42), Some(funded.clone()));
        assert_eq!(f.token().balance(&f.agency), 0);
        assert_eq!(f.token().balance(&f.contract), amount);
        assert!(f.client().try_settle_batch(&42, &3).is_err());
        assert_eq!(
            f.client().mock_all_auths().try_settle_batch(&42, &2),
            Err(Ok(ReliefError::InvalidQuantity))
        );
        assert_eq!(f.client().get_batch(&42), Some(funded));

        let settled = f.client().mock_all_auths().settle_batch(&42, &3);
        assert_eq!(settled.status, BatchStatus::Settled);
        assert_eq!(f.client().get_batch(&42), Some(settled));
        assert_eq!(
            f.client().mock_all_auths().try_settle_batch(&42, &3),
            Err(Ok(ReliefError::BatchAlreadySettled))
        );
        assert_eq!(f.token().balance(&f.wholesaler), whole);
        assert_eq!(f.token().balance(&f.shop), shop);
        assert_eq!(f.token().balance(&f.contract), 0);
    }
}

#[test]
fn insufficient_usdc_creates_no_batch() {
    let f = Fixture::usdc(TOTAL - 1);
    assert!(f.try_fund(42, 3, WHOLESALER, SHOP, true).is_err());
    assert_eq!(f.token().balance(&f.agency), TOTAL - 1);
    assert_eq!(f.token().balance(&f.contract), 0);
    assert_eq!(f.client().get_batch(&42), None);
}

#[test]
fn usdc_second_payout_without_trustline_rolls_back_first_payout() {
    let mut f = Fixture::usdc(TOTAL);
    let shop_id = xdr::AccountId(xdr::PublicKey::PublicKeyTypeEd25519(xdr::Uint256([8; 32])));
    f.shop = Address::from_str(&f.env, &shop_id.to_string());
    seed_classic_account(&f.env, shop_id, STARTING_BALANCE);
    let funded = f.fund(42);
    assert!(f
        .client()
        .mock_all_auths()
        .try_settle_batch(&42, &3)
        .is_err());
    assert_eq!(f.token().balance(&f.wholesaler), 0);
    assert_eq!(f.token().balance(&f.contract), TOTAL);
    assert_eq!(f.client().get_batch(&42), Some(funded));
}
