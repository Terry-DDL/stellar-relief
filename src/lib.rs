#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env};

const UNITS_PER_USDC: i128 = 10_000_000;
const REQUIRED_QUANTITY: u32 = 3;
const STANDARD_SPLIT: (i128, i128) = (70 * UNITS_PER_USDC, 30 * UNITS_PER_USDC);
const SMALL_TEST_SPLIT: (i128, i128) = (7 * UNITS_PER_USDC, 3 * UNITS_PER_USDC);

#[contracttype]
enum StorageKey {
    Agency,
    Asset,
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

#[contract]
pub struct StellarRelief;

#[contractimpl]
impl StellarRelief {
    pub fn __constructor(env: Env, agency: Address, asset: Address) {
        let storage = env.storage().instance();
        storage.set(&StorageKey::Agency, &agency);
        storage.set(&StorageKey::Asset, &asset);
    }

    /// Locks 100 USDC (or 10 for a smaller demo) and records the only MVP batch.
    /// Both payout amounts use seven-decimal base units.
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
        let split = (wholesaler_amount, shop_amount);
        if split != STANDARD_SPLIT && split != SMALL_TEST_SPLIT {
            return Err(ReliefError::InvalidAmounts);
        }

        let asset: Address = storage.get(&StorageKey::Asset).unwrap();
        let total_amount = wholesaler_amount + shop_amount;
        token::TokenClient::new(&env, &asset).transfer(
            &agency,
            &env.current_contract_address(),
            &total_amount,
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
            total_amount,
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

        let asset: Address = env.storage().instance().get(&StorageKey::Asset).unwrap();
        let token = token::TokenClient::new(&env, &asset);
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
