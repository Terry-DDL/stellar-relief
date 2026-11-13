#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env, String};

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
}

#[contracttype]
enum Key {
    Asset,
    Campaign,
    NextProposal,
    Proposal(u32),
    Donation(Address),
    Vote(Address),
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
        if quantity == 0 || region.len() == 0 || supplier == shop || supplier == campaign.issuer || shop == campaign.issuer {
            return Err(Error::InvalidInput);
        }
        let id: u32 = store.get(&Key::NextProposal).unwrap();
        let next = id.checked_add(1).ok_or(Error::InvalidInput)?;
        let proposal = Proposal { id, region, quantity, supplier, shop, votes: 0, dispatched: 0, received: 0, distributed: 0 };
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
        if amount <= 0 { return Err(Error::InvalidInput); }
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
        if proposal.received == 0 || count < proposal.distributed || count > proposal.received { return Err(Error::InvalidInput); }
        proposal.distributed = count;
        store.set(&Key::Proposal(proposal_id), &proposal);
        Ok(proposal)
    }

    /// Only a full matching delivery and distribution release the two payments.
    pub fn settle(env: Env, proposal_id: u32) -> Result<Campaign, Error> {
        let store = env.storage().instance();
        let mut campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Approved || campaign.winner != Some(proposal_id) || env.ledger().timestamp() >= campaign.delivery_deadline { return Err(Error::WrongPhase); }
        let proposal: Proposal = store.get(&Key::Proposal(proposal_id)).ok_or(Error::ProposalMissing)?;
        if proposal.dispatched != proposal.quantity || proposal.received != proposal.quantity || proposal.distributed != proposal.quantity { return Err(Error::NotReady); }
        let asset: Address = store.get(&Key::Asset).unwrap();
        let token = token::TokenClient::new(&env, &asset);
        let escrow = env.current_contract_address();
        let supplier_amount = campaign.total.checked_mul(7).ok_or(Error::InvalidInput)? / 10;
        let shop_amount = campaign.total - supplier_amount;
        token.transfer(&escrow, &proposal.supplier, &supplier_amount);
        token.transfer(&escrow, &proposal.shop, &shop_amount);
        campaign.phase = Phase::Settled;
        store.set(&Key::Campaign, &campaign);
        Ok(campaign)
    }

    /// If no order wins, or delivery times out, each donor can recover their contribution.
    pub fn enable_refunds(env: Env) -> Result<Campaign, Error> {
        let store = env.storage().instance();
        let mut campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Approved || env.ledger().timestamp() < campaign.delivery_deadline { return Err(Error::WrongPhase); }
        campaign.phase = Phase::Refundable;
        store.set(&Key::Campaign, &campaign);
        Ok(campaign)
    }

    pub fn claim_refund(env: Env, donor: Address) -> Result<i128, Error> {
        donor.require_auth();
        let store = env.storage().instance();
        let campaign: Campaign = store.get(&Key::Campaign).unwrap();
        if campaign.phase != Phase::Refundable { return Err(Error::WrongPhase); }
        let amount: i128 = store.get(&Key::Donation(donor.clone())).unwrap_or(0);
        if amount == 0 { return Err(Error::NoDonation); }
        store.set(&Key::Donation(donor.clone()), &0_i128);
        let asset: Address = store.get(&Key::Asset).unwrap();
        token::TokenClient::new(&env, &asset).transfer(&env.current_contract_address(), &donor, &amount);
        Ok(amount)
    }
}

#[cfg(test)]
extern crate std;
#[cfg(test)]
mod test;
