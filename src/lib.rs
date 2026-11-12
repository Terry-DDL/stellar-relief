#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Bytes, Env,
};

const STROOPS_PER_XLM: i128 = 10_000_000;
const REQUIRED_QUANTITY: u32 = 3;
const WHOLESALER_AMOUNT: i128 = 70 * STROOPS_PER_XLM;
const SHOP_AMOUNT: i128 = 30 * STROOPS_PER_XLM;
const TOTAL_AMOUNT: i128 = WHOLESALER_AMOUNT + SHOP_AMOUNT;

// The XDR representation of Stellar's native Asset has only the 32-bit
// ASSET_TYPE_NATIVE discriminant (0). The SDK derives its SAC address per network.
const NATIVE_ASSET_XDR: [u8; 4] = [0; 4];

#[contracttype]
enum StorageKey {
    Agency,
    Batch,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BatchStatus {
    Funded,
    Settled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Batch {
    pub id: u32,
    pub quantity: u32,
    pub agency: Address,
    pub wholesaler: Address,
    pub shop: Address,
    pub verifier: Address,
    pub wholesaler_amount: i128,
    pub shop_amount: i128,
    pub total_amount: i128,
    pub status: BatchStatus,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ReliefError {
    BatchAlreadyFunded = 1,
    InvalidQuantity = 2,
    InvalidAmounts = 3,
    BatchNotFound = 4,
    BatchAlreadySettled = 5,
}

fn native_xlm_contract(env: &Env) -> Address {
    env.deployer()
        .with_stellar_asset(Bytes::from_array(env, &NATIVE_ASSET_XDR))
        .deployed_address()
}

#[contract]
pub struct StellarRelief;

#[contractimpl]
impl StellarRelief {
    pub fn __constructor(env: Env, agency: Address) {
        env.storage().instance().set(&StorageKey::Agency, &agency);
    }

    /// Transfers 100 XLM from the configured agency and records the only MVP batch.
    /// The payout arguments are in stroops and must match the fixed 70/30 split.
    pub fn fund_batch(
        env: Env,
        batch_id: u32,
        quantity: u32,
        wholesaler: Address,
        shop: Address,
        verifier: Address,
        wholesaler_amount: i128,
        shop_amount: i128,
    ) -> Result<Batch, ReliefError> {
        let storage = env.storage().instance();
        let agency: Address = storage.get(&StorageKey::Agency).unwrap();
        agency.require_auth();

        if storage.has(&StorageKey::Batch) {
            return Err(ReliefError::BatchAlreadyFunded);
        }
        if quantity != REQUIRED_QUANTITY {
            return Err(ReliefError::InvalidQuantity);
        }
        if wholesaler_amount != WHOLESALER_AMOUNT || shop_amount != SHOP_AMOUNT {
            return Err(ReliefError::InvalidAmounts);
        }

        let xlm = native_xlm_contract(&env);
        token::TokenClient::new(&env, &xlm).transfer(
            &agency,
            &env.current_contract_address(),
            &TOTAL_AMOUNT,
        );

        let batch = Batch {
            id: batch_id,
            quantity,
            agency,
            wholesaler,
            shop,
            verifier,
            wholesaler_amount,
            shop_amount,
            total_amount: TOTAL_AMOUNT,
            status: BatchStatus::Funded,
        };
        storage.set(&StorageKey::Batch, &batch);
        Ok(batch)
    }

    /// Anyone can query the batch by ID, including before deciding to ship.
    pub fn get_batch(env: Env, batch_id: u32) -> Option<Batch> {
        let batch: Batch = env.storage().instance().get(&StorageKey::Batch)?;
        (batch.id == batch_id).then_some(batch)
    }

    /// Pays the recorded recipients after the verifier confirms the batch quantity.
    pub fn settle_batch(
        env: Env,
        batch_id: u32,
        verified_quantity: u32,
    ) -> Result<Batch, ReliefError> {
        let mut batch = Self::get_batch(env.clone(), batch_id).ok_or(ReliefError::BatchNotFound)?;
        if batch.status != BatchStatus::Funded {
            return Err(ReliefError::BatchAlreadySettled);
        }
        batch.verifier.require_auth();
        if verified_quantity != REQUIRED_QUANTITY || verified_quantity != batch.quantity {
            return Err(ReliefError::InvalidQuantity);
        }

        let xlm = native_xlm_contract(&env);
        let token = token::TokenClient::new(&env, &xlm);
        let escrow = env.current_contract_address();
        // The host authorizes this contract's direct calls spending its own
        // balance. A failed transfer aborts the whole invocation.
        token.transfer(&escrow, &batch.wholesaler, &batch.wholesaler_amount);
        token.transfer(&escrow, &batch.shop, &batch.shop_amount);

        batch.status = BatchStatus::Settled;
        env.storage().instance().set(&StorageKey::Batch, &batch);
        Ok(batch)
    }
}

#[cfg(test)]
extern crate std;
#[cfg(test)]
mod test;
