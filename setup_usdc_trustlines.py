"""Check or explicitly prepare the existing Stellar Relief Testnet trustlines."""

import argparse
from dataclasses import dataclass
from decimal import Decimal
import fcntl
import json
import re
import subprocess
import sys
import time

import testnet_e2e as e

ROLES = ("agency", "wholesaler", "shop")
UPDATE = {"MISSING_TRUSTLINE", "INSUFFICIENT_LIMIT"}
FEE_STROOPS = 100
SETUP_DIR = e.PROJECT / "target" / "usdc-trustline-setup"


@dataclass(frozen=True)
class Plan:
    status: str
    detail: str
    limit: int = 0  # Seven-decimal base units.


def usdc_line(data):
    return next((line for line in data["balances"]
                 if line.get("asset_code") == "USDC" and line.get("asset_issuer") == e.ISSUER), None)


def inspect(role, address, data, base_reserve, amount):
    if data is None or data["account_id"] != address:
        return Plan("MISSING_ACCOUNT", "Expected an existing Testnet account")
    native = next(line for line in data["balances"] if line["asset_type"] == "native")
    reserve = base_reserve * (2 + data["subentry_count"] + data.get("num_sponsoring", 0)
                              - data.get("num_sponsored", 0))
    free = Decimal(native["balance"]) - Decimal(native.get("selling_liabilities", "0")) - reserve
    line = usdc_line(data)
    if line is not None and line.get("is_authorized") is not True:
        return Plan("UNAUTHORIZED_TRUSTLINE", "Issuer authorization is required; a limit change will not grant it")
    whole, shop = e.payout_units(amount)
    balance = Decimal(line["balance"]) if line else Decimal(0)
    selling = Decimal(line.get("selling_liabilities", "0")) if line else Decimal(0)
    buying = Decimal(line.get("buying_liabilities", "0")) if line else Decimal(0)
    spendable = balance - selling
    incoming = (max(Decimal(0), amount - spendable) if role == "agency"
                else Decimal(whole if role == "wholesaler" else shop) / e.STROOPS)
    required_limit = balance + buying + incoming
    limit = Decimal(line["limit"]) if line else Decimal(0)
    status = "MISSING_TRUSTLINE" if line is None else "INSUFFICIENT_LIMIT" if limit < required_limit else "READY"
    needed_xlm = Decimal(1 if role == "agency" else 0)
    if status in UPDATE:
        needed_xlm += Decimal(FEE_STROOPS) / e.STROOPS
        if line is None:
            needed_xlm += base_reserve
    if free < needed_xlm:
        return Plan("INSUFFICIENT_XLM", f"{status}: {free} XLM above existing reserve; need {needed_xlm} XLM")
    detail = f"balance {balance} USDC, spendable {spendable} USDC, limit {limit} USDC, free {free} XLM"
    if status == "READY":
        return Plan(status, detail)
    new_limit = max(Decimal(1000), required_limit)
    units = int(new_limit * e.STROOPS)
    e.require(0 < units <= 2**63 - 1, f"{role}: required trustline limit exceeds Stellar maximum")
    return Plan(status, f"{detail}; proposed limit {new_limit} USDC", units)


def verify_envelope(envelope, address, limit, *, signed):
    decoded = json.loads(e.xdr_cli("tx", "decode", value=envelope))["tx"]
    tx = decoded["tx"]
    expected_op = {"source_account": None, "body": {"change_trust": {
        "line": {"credit_alphanum4": {"asset_code": "USDC", "issuer": e.ISSUER}},
        "limit": str(limit),
    }}}
    e.require(tx["source_account"] == address and tx["operations"] == [expected_op]
              and tx["fee"] == FEE_STROOPS and bool(decoded["signatures"]) == signed,
              "Unexpected trustline transaction envelope")
    return tx


def build_signed(role, address, limit):
    unsigned = e.xdr_cli("tx", "new", "change-trust", *e.NETWORK, "--build-only",
                         "--source-account", address, "--line", e.ASSET, "--limit", str(limit),
                         "--inclusion-fee", str(FEE_STROOPS), value="")
    original = verify_envelope(unsigned, address, limit, signed=False)
    signed = e.xdr_cli("tx", "sign", *e.NETWORK, "--sign-with-key", e.ALIASES[role], value=unsigned)
    e.require(verify_envelope(signed, address, limit, signed=True) == original,
              f"{role}: signer changed the transaction")
    tx_hash = e.xdr_cli("tx", "hash", *e.NETWORK, value=signed).lower()
    e.require(re.fullmatch(r"[0-9a-f]{64}", tx_hash), "Invalid transaction hash")
    return signed, tx_hash


def run_setup(addresses, base_reserve, amount, folder, *, execute):
    def plan(role):
        address = addresses[role]
        result = inspect(role, address, e.account(address), base_reserve, amount)
        print(f"{role} {address}: {result.status} — {result.detail}", flush=True)
        return result

    if not execute:
        plans = [plan(role) for role in ROLES]
        return all(result.status == "READY" for result in plans)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    chain = e.Testnet(folder)
    with (folder / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = (e.read_checkpoint(folder) if (folder / "checkpoint.json").exists()
                   else {"network": e.PASSPHRASE, "asset": e.ASSET, "transactions": {}})
        e.require(journal["network"] == e.PASSPHRASE and journal["asset"] == e.ASSET,
                  "Unexpected setup journal network or asset")
        records = journal["transactions"]

        def confirm(role, receipt):
            tx_hash = receipt["hash"]
            if not receipt.get("ledger"):
                result = chain.lookup(role, tx_hash)
                e.require(result["status"] == "SUCCESS" and result.get("ledger"),
                          f"{role}: {result['status']} for {tx_hash}; resolve before retrying")
                receipt["ledger"] = result["ledger"]
                e.write_checkpoint(folder, journal)
            for attempt in range(8):
                data = e.account(addresses[role])
                line = usdc_line(data) if data else None
                if line is not None and Decimal(line["limit"]) * e.STROOPS >= receipt["limit"]:
                    receipt["observed"] = True
                    e.write_checkpoint(folder, journal)
                    print(f"{role}: confirmed on ledger {receipt['ledger']} — {e.EXPLORER}/tx/{tx_hash}")
                    return
                if attempt != 7:
                    time.sleep(2)
            raise RuntimeError(f"{role}: {tx_hash} confirmed, but Horizon has not verified the trustline")

        for role, receipt in records.items():
            e.require(role in addresses and receipt["address"] == addresses[role],
                      f"{role}: local identity differs from setup journal")
            if not receipt.get("observed"):
                confirm(role, receipt)

        # Refresh after obtaining the lock and after reconciling earlier writes.
        plans = {role: plan(role) for role in ROLES}
        if any(result.status not in UPDATE | {"READY"} for result in plans.values()):
            return False
        for role in ROLES:
            result = plans[role]
            if result.status == "READY":
                continue
            signed, tx_hash = build_signed(role, addresses[role], result.limit)
            receipt = {"address": addresses[role], "hash": tx_hash, "limit": result.limit}
            records[role] = receipt
            e.write_checkpoint(folder, journal)
            print(f"{role}: submitting Testnet ChangeTrust {tx_hash}", flush=True)
            chain.send(role, signed, tx_hash)
            confirm(role, receipt)
            if plan(role).status != "READY":
                return False
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Sign and submit needed Testnet ChangeTrust transactions")
    parser.add_argument("--amount", type=int, choices=(10, 100), default=10)
    args = parser.parse_args()
    e.require(e.rpc("getNetwork")["passphrase"] == e.PASSPHRASE, "RPC is not Stellar Testnet")
    chain = e.Testnet(SETUP_DIR)
    chain.usdc_id()
    addresses = {role: e.xdr_cli("keys", "address", e.ALIASES[role], value="") for role in ROLES}
    e.require(all(e.account_key(address, "G") for address in addresses.values())
              and len(set(addresses.values())) == len(ROLES), "Expected three distinct existing identities")
    ledger = e.request_json(f"{e.HORIZON}/ledgers?order=desc&limit=1", phase="Horizon base reserve")
    reserve = Decimal(ledger["_embedded"]["records"][0]["base_reserve_in_stroops"]) / e.STROOPS
    ready = run_setup(addresses, reserve, args.amount, SETUP_DIR, execute=args.execute)
    if ready:
        print("Trustlines ready. Use the E2E --check-accounts command to verify spendable USDC.")
    elif not args.execute:
        print("Read-only check complete. Use --execute to apply eligible trustline changes.")
    else:
        print("Some trustlines are not ready. Resolve the status shown above before proceeding.")
    return 0 if ready else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError, KeyError, StopIteration, subprocess.SubprocessError) as error:
        sys.exit(f"Stopped: {error}")
