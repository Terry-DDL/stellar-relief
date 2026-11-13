#!/usr/bin/env python3
"""Sign delivery evidence and explicitly approve settlement of a separate Testnet order."""
import argparse
import fcntl
import json
from pathlib import Path
import re
import subprocess
import sys
import time

import testnet_e2e as e

HISTORICAL = json.loads((e.PROJECT / "web/src/evidence.json").read_text())["contractId"]
BRIDGE = e.PROJECT / "web/scripts/delivery-signing.mjs"


def signing(command, **payload):
    result = subprocess.run(
        ["node", "--disable-warning=ExperimentalWarning", "--experimental-strip-types", str(BRIDGE), command],
        input=json.dumps(payload), text=True, capture_output=True, env=e.CLI_ENV, timeout=45,
    )
    e.require(result.returncode == 0, result.stderr.strip() or "Evidence signing or validation failed")
    return json.loads(result.stdout)


def order_from(data):
    e.require(data.get("schema") == 2 and data.get("verified_delivery") is True
              and data["network"] == e.PASSPHRASE and data["asset"] == e.ASSET
              and data["sac"] == e.SAC and data["wasm_hash"] == e.WASM_HASH and data["batch_id"] == e.BATCH
              and e.account_key(data["contract"], "C") and data["contract"] != HISTORICAL,
              "Use a separate verified delivery Testnet order")
    e.payout_units(data["amount_usdc"])
    addresses = data["addresses"]
    e.require(set(addresses) == set(e.ROLES) and len(set(addresses.values())) == 4
              and all(e.account_key(address, "G") for address in addresses.values()), "Expected four distinct order addresses")
    e.require(data["transactions"]["fund"]["status"] == "SUCCESS"
              and re.fullmatch(r"[0-9a-f]{64}", data["transactions"]["fund"]["hash"])
              and "settle" not in data["transactions"], "Expected a confirmed funding receipt and no legacy settlement")
    return {"contractId": data["contract"], "batchId": int(e.BATCH), "quantity": 3,
            "supplier": data["addresses"]["wholesaler"], "shop": data["addresses"]["shop"],
            "verifier": data["addresses"]["verifier"]}


def check_chain(chain, data, expected):
    e.require(e.rpc("getNetwork")["passphrase"] == e.PASSPHRASE, "Network mismatch")
    key = chain.contract_instance_key(data["contract"])
    result = e.rpc("getLedgerEntries", {"keys": [key]})
    entries = result["entries"]
    e.require(len(entries) == 1 and entries[0]["key"] == key
              and entries[0]["liveUntilLedgerSeq"] >= result["latestLedger"], "Contract instance is missing or archived")
    instance = e.decoded_xdr("LedgerEntryData", entries[0]["xdr"])["contract_data"]
    e.require(instance["contract"] == data["contract"]
              and instance["key"] == "ledger_key_contract_instance" and instance["durability"] == "persistent",
              "Unexpected contract instance")
    value = instance["val"]["contract_instance"]
    e.require(value["executable"] == {"wasm": e.WASM_HASH}, "Unexpected contract code")
    fields = {item["key"]["vec"][0]["symbol"]: item["val"] for item in value["storage"]}
    e.require(fields.get("Asset") == {"address": e.SAC}
              and fields.get("Agency") == {"address": data["addresses"]["agency"]}, "Unexpected asset or agency")
    snapshot = chain.snapshot(data)
    e.require(snapshot["status"] == expected, f"Expected {expected} on-chain, got {snapshot['status']}")
    if expected == "Funded":
        check_funding(data)
        e.require(snapshot["balances"]["escrow"] == data["amount_usdc"] * e.STROOPS,
                  "Escrow does not hold the expected USDC amount")
    return snapshot


def check_funding(data):
    tx_hash = data["transactions"]["fund"]["hash"]
    funding = e.rpc("getTransaction", {"hash": tx_hash})
    e.require(funding.get("status") == "SUCCESS" and funding.get("txHash") == tx_hash,
              "Funding has not been independently confirmed by Testnet RPC")
    envelope = funding["envelopeXdr"]
    e.require(e.xdr_cli("tx", "hash", *e.NETWORK, value=envelope).lower() == tx_hash, "Funding envelope hash mismatch")
    tx = json.loads(e.xdr_cli("tx", "decode", value=envelope))["tx"]["tx"]
    addresses = data["addresses"]
    supplier, shop = e.payout_units(data["amount_usdc"])
    call = {"contract_address": data["contract"], "function_name": "fund_batch",
            "args": [{"u32": int(e.BATCH)}, {"u32": 3},
                     *({"address": addresses[role]} for role in ("wholesaler", "shop", "verifier")),
                     {"i128": str(supplier)}, {"i128": str(shop)}]}
    e.require(tx["source_account"] == addresses["agency"]
              and e.invocation(tx)["host_function"] == {"invoke_contract": call},
              "Funding receipt does not match this order")


def expected_call(order):
    return {"contract_address": order["contractId"], "function_name": "settle_batch",
            "args": [{"u32": order["batchId"]}, {"u32": order["quantity"]}]}


def check_transaction(tx, order):
    e.require(tx["source_account"] == order["verifier"] and tx["memo"] == "none"
              and e.invocation(tx)["host_function"] == {"invoke_contract": expected_call(order)},
              "Transaction does not match the designated verifier and settlement call")


def prepare(chain, data, order):
    decoded, entries = chain.assemble(chain.settle_envelope(data, str(order["quantity"])), order["verifier"])
    e.require(len(entries) == 1 and entries[0]["credentials"] == "source_account"
              and entries[0]["root_invocation"]["function"] == {"contract_fn": expected_call(order)},
              "Expected one designated verifier authorization")
    tx = decoded["tx"]["tx"]
    tx["cond"] = {"time": {"min_time": "0", "max_time": str(int(time.time()) + 300)}}
    check_transaction(tx, order)
    unsigned = e.xdr_cli("tx", "encode", value=json.dumps(decoded))
    preflight = chain.simulate(unsigned, "enforce")
    e.require(e.simulation_result(preflight) is not None, f"Enforced preflight rejected settlement: {preflight.get('error')}")
    return tx, unsigned


def settle(folder, chain, data, delivery, receipt, *, alias=None, approved=None):
    order = order_from(data)
    digest = signing("verify", order=order, delivery=delivery, receipt=receipt)
    e.require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest), "Invalid evidence digest")
    record = data.get("verified_settlement")
    if record is None:
        e.require(approved == digest and alias and re.fullmatch(r"[\w-]{1,64}", alias),
                  "Explicit approval requires --approve with the reviewed evidence digest and --verifier with the local identity alias")
        e.require(e.xdr_cli("keys", "address", alias, value="") == order["verifier"],
                  "Local signer is not the designated on-chain verifier")
        check_chain(chain, data, "Funded")
        tx, unsigned = prepare(chain, data, order)
        signed = e.xdr_cli("tx", "sign", *e.NETWORK, "--sign-with-key", alias, value=unsigned)
        envelope = json.loads(e.xdr_cli("tx", "decode", value=signed))["tx"]
        e.require(envelope["tx"] == tx and len(envelope["signatures"]) == 1, "Signer changed the prepared settlement envelope")
        tx_hash = e.xdr_cli("tx", "hash", *e.NETWORK, value=signed).lower()
        e.require(re.fullmatch(r"[0-9a-f]{64}", tx_hash), "Invalid settlement hash")
        approval = signing("sign", order=order, kind="approval", alias=alias, delivery=delivery, receipt=receipt,
                           digest=digest, txHash=tx_hash)
        signing("verify-approval", order=order, digest=digest, txHash=tx_hash, approval=approval)
        check_chain(chain, data, "Funded")
        record = {"hash": tx_hash, "digest": digest, "approval": approval, "status": "SUBMISSION_UNCERTAIN"}
        data["verified_settlement"] = record
        e.write_checkpoint(folder, data)
        print(f"Settlement hash: {tx_hash}", flush=True)
        chain.send("settle", signed, tx_hash)
    else:
        e.require(approved is None, "A settlement attempt already exists. Use status to look up its hash.")
        e.require(record["digest"] == digest, "Evidence differs from the existing settlement attempt")
        e.require(re.fullmatch(r"[0-9a-f]{64}", record["hash"]), "Invalid saved settlement hash")
        signing("verify-approval", order=order, digest=digest, txHash=record["hash"], approval=record["approval"])

    # On recovery never resend. The on-chain contract independently rejects repeat settlements.
    tx_hash = record["hash"]
    reply = chain.lookup("settle", tx_hash)
    record.update(reply)
    e.write_checkpoint(folder, data)
    e.require(record["status"] == "SUCCESS" and type(record["ledger"]) is int and record["ledger"] > 0,
              f"Settlement {record['status']}: {tx_hash}. No automatic resubmission.")
    on_chain = e.rpc("getTransaction", {"hash": tx_hash})
    e.require(on_chain.get("status") == "SUCCESS" and on_chain.get("txHash") == tx_hash
              and on_chain.get("ledger") == record["ledger"], "Settlement RPC receipt changed")
    confirmed = on_chain["envelopeXdr"]
    e.require(e.xdr_cli("tx", "hash", *e.NETWORK, value=confirmed).lower() == tx_hash, "Confirmed envelope hash mismatch")
    confirmed_tx = json.loads(e.xdr_cli("tx", "decode", value=confirmed))["tx"]["tx"]
    check_transaction(confirmed_tx, order)
    snapshot = check_chain(chain, data, "Settled")
    return {"hash": tx_hash, "status": "SUCCESS", "ledger": record["ledger"], "batchStatus": snapshot["status"]}


def load(path):
    return json.loads(Path(path).read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", help="Run ID from the separately funded Testnet order")
    parser.add_argument("action", choices=("delivery", "receipt", "review", "settle", "status", "export"))
    parser.add_argument("--identity", help="Local Stellar CLI alias for delivery or receipt")
    parser.add_argument("--delivery", help="Supplier's signed JSON (defaults to the run folder)")
    parser.add_argument("--receipt", help="Shop's signed JSON (defaults to the run folder)")
    parser.add_argument("--verifier", help="Local Stellar CLI alias for approved settlement")
    parser.add_argument("--approve", help="Exact SHA-256 digest shown by review")
    args = parser.parse_args()
    e.require(re.fullmatch(r"[0-9a-f]{32}", args.run), "Invalid run ID")
    folder = e.RUN_ROOT / args.run
    e.require((folder / "checkpoint.json").is_file(), "Verified delivery run not found")
    with (folder / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        data = e.read_checkpoint(folder)
        e.require(data["run_id"] == args.run, "Run ID does not match checkpoint")
        order = order_from(data)
        chain = e.Testnet(folder)
        delivery_path = Path(args.delivery) if args.delivery else folder / "delivery.json"
        receipt_path = Path(args.receipt) if args.receipt else folder / "receipt.json"
        if args.action == "export":
            delivery = load(delivery_path) if delivery_path.is_file() else None
            receipt = load(receipt_path) if receipt_path.is_file() else None
            if receipt is not None:
                signing("verify", order=order, delivery=delivery, receipt=receipt)
            print(json.dumps({"order": order, "agency": data["addresses"]["agency"],
                              "amount": data["amount_usdc"], "fundHash": data["transactions"]["fund"]["hash"],
                              "delivery": delivery, "receipt": receipt,
                              "settlementHash": data.get("verified_settlement", {}).get("hash"),
                              "approval": data.get("verified_settlement", {}).get("approval")}, indent=2))
            return
        delivery = None if args.action == "delivery" else load(delivery_path)
        if args.action in ("delivery", "receipt"):
            e.require(not data.get("verified_settlement"), "Settlement already attempted for this order")
            e.require(args.identity, "Provide your own --identity alias")
            destination = folder / f"{args.action}.json"
            e.require(not destination.exists(), f"{args.action.capitalize()} evidence already exists")
            check_chain(chain, data, "Funded")
            record = signing("sign", order=order, kind=args.action, alias=args.identity, delivery=delivery)
            with destination.open("x") as out:
                json.dump(record, out, indent=2)
                out.write("\n")
            print(f"Signed {args.action}: {destination}")
            return
        receipt = load(receipt_path)
        if args.action == "review":
            check_chain(chain, data, "Funded")
            digest = signing("verify", order=order, delivery=delivery, receipt=receipt)
            print(json.dumps({"order": order, "delivery": delivery, "receipt": receipt, "approveDigest": digest}, indent=2))
            return
        if args.action == "status":
            e.require(data.get("verified_settlement"), "No settlement has been attempted")
        else:
            e.require(args.approve and args.verifier, "Settlement requires --approve and --verifier")
        settlement = settle(folder, chain, data, delivery, receipt, alias=args.verifier, approved=args.approve)
        print(json.dumps({**settlement, "explorer": f"{e.EXPLORER}/tx/{settlement['hash']}"}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f"Stopped: {error}", file=sys.stderr)
        sys.exit(1)
