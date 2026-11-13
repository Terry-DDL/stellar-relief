#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env, String, U256};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Phase {
    Funding,
    Voting,
    Approved,
    Refundable,
    Settled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub target: i128,
    pub total: i128,
    pub vote_deadline: u64,
    pub delivery_deadline: u64,
    pub issuer: Address,
    pub phase: Phase,
    pub winner: Option<u32>,
    pub leading_votes: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u32,
    pub region: String,
    pub quantity: u32,
    pub supplier: Address,
    pub shop: Address,
    pub votes: i128,
    pub dispatched: u32,
    pub received: u32,
    pub distributed: u32,
    pub supplier_paid: bool,
    pub shop_paid: bool,
}

#[contracttype]
enum Key {
    Asset,
    Campaign,
    NextProposal,
    Proposal(u32),
    Donation(Address),
    Vote(Address),
    RefundRemainder,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidInput = 1,
    WrongPhase = 2,
    TargetExceeded = 3,
    NoDonation = 4,
    AlreadyVoted = 5,
    ProposalMissing = 6,
    DeadlineNotReached = 7,
    QuantityMismatch = 8,
    AlreadyDeclared = 9,
    NotReady = 10,
    AlreadyPaid = 11,
}

// Floor 70% without overflowing i128, even for the largest supported target.
fn supplier_share(total: i128) -> i128 {
    (total / 10) * 7 + (total % 10) * 7 / 10
}

fn claim_payment(env: Env, proposal_id: u32, supplier: bool) -> Result<i128, Error> {
    let store = env.storage().instance();
    let mut campaign = DonorPool::campaign(env.clone());
    if campaign.winner != Some(proposal_id)
        || !matches!(campaign.phase, Phase::Approved | Phase::Refundable | Phase::Settled)
    {
        return Err(Error::WrongPhase);
    }
    let mut proposal = DonorPool::proposal(env.clone(), proposal_id).ok_or(Error::ProposalMissing)?;
    let supplier_amount = supplier_share(campaign.total);
    let (recipient, amount) = if supplier {
        proposal.supplier.require_auth();
        if proposal.supplier_paid { return Err(Error::AlreadyPaid); }
        if proposal.received != proposal.quantity { return Err(Error::NotReady); }
        proposal.supplier_paid = true;
        (&proposal.supplier, supplier_amount)
    } else {
        proposal.shop.require_auth();
        if proposal.shop_paid { return Err(Error::AlreadyPaid); }
        if proposal.distributed != proposal.quantity { return Err(Error::NotReady); }
        proposal.shop_paid = true;
        (&proposal.shop, campaign.total - supplier_amount)
    };

    store.set(&Key::Proposal(proposal_id), &proposal);
    if proposal.supplier_paid && proposal.shop_paid {
        campaign.phase = Phase::Settled;
        store.set(&Key::Campaign, &campaign);
    }
    if amount > 0 {
        let asset = store.get(&Key::Asset).unwrap();
        token::TokenClient::new(&env, &asset).transfer(&env.current_contract_address(), recipient, &amount);
    }
    Ok(amount)
}

#[contract]
pub struct DonorPool;

#[contractimpl]
impl DonorPool {
    pub fn __constructor(
        env: Env,
        asset: Address,
        issuer: Address,
        target: i128,
        vote_deadline: u64,
        delivery_deadline: u64,
    ) {
        assert!(target > 0 && vote_deadline > env.ledger().timestamp());
        assert!(delivery_deadline > vote_deadline);
        let store = env.storage().instance();
        store.set(&Key::Asset, &asset);
        store.set(&Key::Campaign, &Campaign {
            target,
            total: 0,
            vote_deadline,
            delivery_deadline,
            issuer,
            phase: Phase::Funding,
            winner: None,
            leading_votes: 0,
        });
        store.set(&Key::NextProposal, &1_u32);
    }

    pub fn campaign(env: Env) -> Campaign {
        env.storage().instance().get(&Key::Campaign).unwrap()
    }

    pub fn proposal(env: Env, id: u32) -> Option<Proposal> {
        env.storage().instance().get(&Key::Proposal(id))
    }

    pub fn donation(env: Env, donor: Address) -> i128 {
        env.storage().instance().get(&Key::Donation(donor)).unwrap_or(0)
    }

    pub fn vote_of(env: Env, donor: Address) -> Option<u32> {
        env.storage().instance().get(&Key::Vote(donor))
    }

    /// Any signer may publish an order before voting closes. This does not move funds.
    pub fn propose(
        env: Env,
        proposer: Address,
        region: String,
        quantity: u32,
        supplier: Address,
        shop: Address,
    ) -> Result<Proposal, Error> {
        proposer.require_auth();
        let store = env.storage().instance();
        let campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Funding && campaign.phase != Phase::Voting {
            return Err(Error::WrongPhase);
        }
        if env.ledger().timestamp() >= campaign.vote_deadline {
            return Err(Error::WrongPhase);
        }
        if quantity == 0 || region.len() == 0 || supplier == shop || supplier == campaign.issuer || shop == campaign.issuer
            || supplier == env.current_contract_address() || shop == env.current_contract_address() {
            return Err(Error::InvalidInput);
        }
        let id: u32 = store.get(&Key::NextProposal).unwrap();
        let next = id.checked_add(1).ok_or(Error::InvalidInput)?;
        let proposal = Proposal { id, region, quantity, supplier, shop, votes: 0, dispatched: 0, received: 0, distributed: 0, supplier_paid: false, shop_paid: false };
        store.set(&Key::Proposal(id), &proposal);
        store.set(&Key::NextProposal, &next);
        Ok(proposal)
    }

    /// Donors pay the contract directly. The pool closes at its published target.
    pub fn donate(env: Env, donor: Address, amount: i128) -> Result<Campaign, Error> {
        donor.require_auth();
        let store = env.storage().instance();
        let mut campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Funding || env.ledger().timestamp() >= campaign.vote_deadline {
            return Err(Error::WrongPhase);
        }
        if amount <= 0 || donor == env.current_contract_address() { return Err(Error::InvalidInput); }
        let new_total = campaign.total.checked_add(amount).ok_or(Error::InvalidInput)?;
        if new_total > campaign.target { return Err(Error::TargetExceeded); }
        let asset: Address = store.get(&Key::Asset).unwrap();
        token::TokenClient::new(&env, &asset).transfer(&donor, &env.current_contract_address(), &amount);
        let prior: i128 = store.get(&Key::Donation(donor.clone())).unwrap_or(0);
        store.set(&Key::Donation(donor), &prior.checked_add(amount).ok_or(Error::InvalidInput)?);
        campaign.total = new_total;
        if new_total == campaign.target { campaign.phase = Phase::Voting; }
        store.set(&Key::Campaign, &campaign);
        Ok(campaign)
    }

    /// One vote per donor address, weighted by that address's frozen contribution.
    pub fn vote(env: Env, donor: Address, proposal_id: u32) -> Result<Proposal, Error> {
        donor.require_auth();
        let store = env.storage().instance();
        let mut campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Voting || env.ledger().timestamp() >= campaign.vote_deadline {
            return Err(Error::WrongPhase);
        }
        if store.has(&Key::Vote(donor.clone())) { return Err(Error::AlreadyVoted); }
        let weight: i128 = store.get(&Key::Donation(donor.clone())).unwrap_or(0);
        if weight == 0 { return Err(Error::NoDonation); }
        let mut proposal: Proposal = store.get(&Key::Proposal(proposal_id)).ok_or(Error::ProposalMissing)?;
        proposal.votes = proposal.votes.checked_add(weight).ok_or(Error::InvalidInput)?;
        store.set(&Key::Proposal(proposal_id), &proposal);
        store.set(&Key::Vote(donor), &proposal_id);
        if proposal.votes > campaign.leading_votes {
            campaign.leading_votes = proposal.votes;
            campaign.winner = Some(proposal_id);
            store.set(&Key::Campaign, &campaign);
        }
        Ok(proposal)
    }

    pub fn finalize(env: Env) -> Result<Campaign, Error> {
        let store = env.storage().instance();
        let mut campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Voting && campaign.phase != Phase::Funding { return Err(Error::WrongPhase); }
        if env.ledger().timestamp() < campaign.vote_deadline { return Err(Error::DeadlineNotReached); }
        campaign.phase = if campaign.total == campaign.target && campaign.leading_votes > campaign.total / 2 {
            Phase::Approved
        } else {
            campaign.winner = None;
            Phase::Refundable
        };
        store.set(&Key::Campaign, &campaign);
        Ok(campaign)
    }

    /// Supplier and shop make separate, signed declarations for the winning order.
    pub fn declare_dispatch(env: Env, proposal_id: u32, quantity: u32) -> Result<Proposal, Error> {
        let store = env.storage().instance();
        let campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Approved || campaign.winner != Some(proposal_id) || env.ledger().timestamp() >= campaign.delivery_deadline { return Err(Error::WrongPhase); }
        let mut proposal: Proposal = store.get(&Key::Proposal(proposal_id)).ok_or(Error::ProposalMissing)?;
        proposal.supplier.require_auth();
        if quantity != proposal.quantity { return Err(Error::QuantityMismatch); }
        if proposal.dispatched != 0 { return Err(Error::AlreadyDeclared); }
        proposal.dispatched = quantity;
        store.set(&Key::Proposal(proposal_id), &proposal);
        Ok(proposal)
    }

    pub fn declare_receipt(env: Env, proposal_id: u32, quantity: u32) -> Result<Proposal, Error> {
        let store = env.storage().instance();
        let campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Approved || campaign.winner != Some(proposal_id) || env.ledger().timestamp() >= campaign.delivery_deadline { return Err(Error::WrongPhase); }
        let mut proposal: Proposal = store.get(&Key::Proposal(proposal_id)).ok_or(Error::ProposalMissing)?;
        proposal.shop.require_auth();
        if proposal.dispatched == 0 || quantity != proposal.dispatched { return Err(Error::QuantityMismatch); }
        if proposal.received != 0 { return Err(Error::AlreadyDeclared); }
        proposal.received = quantity;
        store.set(&Key::Proposal(proposal_id), &proposal);
        Ok(proposal)
    }

    /// Voucher issuer attests only an aggregate count; it cannot withdraw funds.
    pub fn attest_distribution(env: Env, proposal_id: u32, count: u32) -> Result<Proposal, Error> {
        let store = env.storage().instance();
        let campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Approved || campaign.winner != Some(proposal_id) || env.ledger().timestamp() >= campaign.delivery_deadline { return Err(Error::WrongPhase); }
        campaign.issuer.require_auth();
        let mut proposal: Proposal = store.get(&Key::Proposal(proposal_id)).ok_or(Error::ProposalMissing)?;
        if proposal.received == 0 || count <= proposal.distributed || count > proposal.received { return Err(Error::InvalidInput); }
        proposal.distributed = count;
        store.set(&Key::Proposal(proposal_id), &proposal);
        Ok(proposal)
    }

    /// Accepted receipt reserves the supplier share, including after expiry.
    pub fn claim_supplier(env: Env, proposal_id: u32) -> Result<i128, Error> {
        claim_payment(env, proposal_id, true)
    }

    /// Full distribution attestation reserves the separate shop share.
    pub fn claim_shop(env: Env, proposal_id: u32) -> Result<i128, Error> {
        claim_payment(env, proposal_id, false)
    }

    /// Close fulfillment at the deadline and open refunds for unearned funds.
    pub fn enable_refunds(env: Env) -> Result<Campaign, Error> {
        let store = env.storage().instance();
        let mut campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Approved || env.ledger().timestamp() < campaign.delivery_deadline { return Err(Error::WrongPhase); }
        let winner = campaign.winner.ok_or(Error::WrongPhase)?;
        let proposal = Self::proposal(env.clone(), winner).ok_or(Error::ProposalMissing)?;
        if proposal.distributed == proposal.quantity { return Err(Error::NotReady); }
        campaign.phase = Phase::Refundable;
        store.set(&Key::Campaign, &campaign);
        Ok(campaign)
    }

    pub fn claim_refund(env: Env, donor: Address) -> Result<i128, Error> {
        donor.require_auth();
        let store = env.storage().instance();
        let campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Refundable { return Err(Error::WrongPhase); }
        let principal = Self::donation(env.clone(), donor.clone());
        if principal == 0 { return Err(Error::NoDonation); }

        let mut refund_pool = campaign.total;
        if let Some(winner) = campaign.winner {
            let proposal = Self::proposal(env.clone(), winner).ok_or(Error::ProposalMissing)?;
            if proposal.distributed == proposal.quantity {
                refund_pool = 0;
            } else if proposal.received == proposal.quantity {
                refund_pool -= supplier_share(campaign.total);
            }
        }
        if refund_pool == 0 { return Err(Error::NotReady); }

        // Carry the fractional numerator between claims. Each donor gets floor
        // or ceil of their pro-rata share, and the entire refund pool is allocated.
        let denominator = U256::from_u128(&env, campaign.total as u128);
        let carry = store.get::<_, u128>(&Key::RefundRemainder).unwrap_or(0);
        let numerator = U256::from_u128(&env, principal as u128)
            .mul(&U256::from_u128(&env, refund_pool as u128))
            .add(&U256::from_u128(&env, carry));
        let quotient = numerator.div(&denominator);
        let remainder = numerator.sub(&quotient.mul(&denominator)).to_u128().unwrap();
        let amount = quotient.to_u128().unwrap() as i128;
        store.set(&Key::RefundRemainder, &remainder);
        store.remove(&Key::Donation(donor.clone()));
        if amount > 0 {
            let asset = store.get(&Key::Asset).unwrap();
            token::TokenClient::new(&env, &asset).transfer(&env.current_contract_address(), &donor, &amount);
        }
        Ok(amount)
    }
}

#[cfg(test)]
extern crate std;
#[cfg(test)]
mod test;
