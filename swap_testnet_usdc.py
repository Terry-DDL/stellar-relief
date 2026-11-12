"""Quote or explicitly buy exactly 10 USDC for the Relief agency on Testnet."""

import argparse
from decimal import Decimal, InvalidOperation
import fcntl
import json
import re
import subprocess
import sys
import time
from urllib.parse import urlencode

import testnet_e2e as e

AGENCY = "GDD3ZJLJN2UI3DXEDWHHIE4OWW3HPZXZR2V7GHAWVGCFBU5TTNAXYASL"
AMOUNT = 10
MAX_XLM = 15
FEE = 100  # Separate inclusion fee, in stroops.
FOLDER = e.PROJECT / "target" / "usdc-swap"


def quote():
    query = urlencode({
        "source_assets": "native", "destination_asset_type": "credit_alphanum4",
        "destination_asset_code": "USDC", "destination_asset_issuer": e.ISSUER,
        "destination_amount": AMOUNT,
    })
    result = e.request_json(f"{e.HORIZON}/paths/strict-receive?{query}", phase="Testnet swap quote")
    prices = []
    for row in result["_embedded"]["records"]:
        if (row.get("source_asset_type") == "native"
                and row.get("destination_asset_type") == "credit_alphanum4"
                and row.get("destination_asset_code") == "USDC"
                and row.get("destination_asset_issuer") == e.ISSUER
                and Decimal(row["destination_amount"]) == AMOUNT
                and row.get("path") == []):
            price = Decimal(row["source_amount"])
            e.require(price.is_finite() and price > 0, "Invalid direct Testnet quote")
            prices.append(price)
    e.require(prices, "No direct Testnet quote for 10 USDC from the configured issuer")
    price = min(prices)
    e.require(price <= MAX_XLM, f"Latest direct quote {price:f} XLM exceeds the 15 XLM cap")
    return price


def asset_line(data):
    e.require(data is not None and data["account_id"] == AGENCY, "Agency Testnet account missing")
    line = next((b for b in data["balances"] if b.get("asset_code") == "USDC"
                 and b.get("asset_issuer") == e.ISSUER), None)
    e.require(line is not None and line.get("is_authorized") is True,
              "Agency needs an authorized USDC trustline for the configured Testnet issuer")
    return line


def check_funding(data, base_reserve):
    line = asset_line(data)
    capacity = Decimal(line["limit"]) - Decimal(line["balance"]) - Decimal(line.get("buying_liabilities", "0"))
    e.require(capacity >= AMOUNT, f"USDC trustline only has {capacity:f} USDC of receiving capacity")
    native = next(b for b in data["balances"] if b["asset_type"] == "native")
    reserve = base_reserve * (2 + data["subentry_count"] + data.get("num_sponsoring", 0)
                              - data.get("num_sponsored", 0))
    free = Decimal(native["balance"]) - Decimal(native.get("selling_liabilities", "0")) - reserve
    e.require(free >= MAX_XLM + Decimal(FEE) / e.STROOPS,
              f"Only {free:f} XLM above reserve; need 15 XLM plus the fee")


def expected_operation():
    return {"source_account": None, "body": {"path_payment_strict_receive": {
        "send_asset": "native", "send_max": str(MAX_XLM * e.STROOPS),
        "destination": AGENCY,
        "dest_asset": {"credit_alphanum4": {"asset_code": "USDC", "issuer": e.ISSUER}},
        "dest_amount": str(AMOUNT * e.STROOPS), "path": [],
    }}}


def verify_envelope(envelope, *, signed):
    decoded = json.loads(e.xdr_cli("tx", "decode", value=envelope))["tx"]
    tx = decoded["tx"]
    e.require(tx["source_account"] == AGENCY and tx["fee"] == FEE
              and tx["operations"] == [expected_operation()]
              and bool(decoded["signatures"]) == signed,
              "Unexpected swap transaction envelope")
    return tx


def build_signed():
    unsigned = e.xdr_cli(
        "tx", "new", "path-payment-strict-receive", *e.NETWORK, "--build-only",
        "--source-account", AGENCY, "--destination", AGENCY, "--send-asset", "native",
        "--send-max", str(MAX_XLM * e.STROOPS), "--dest-asset", e.ASSET,
        "--dest-amount", str(AMOUNT * e.STROOPS), "--inclusion-fee", str(FEE), value="",
    )
    original = verify_envelope(unsigned, signed=False)
    signed = e.xdr_cli("tx", "sign", *e.NETWORK, "--sign-with-key", e.ALIASES["agency"], value=unsigned)
    e.require(verify_envelope(signed, signed=True) == original, "Signer changed the swap transaction")
    tx_hash = e.xdr_cli("tx", "hash", *e.NETWORK, value=signed).lower()
    e.require(re.fullmatch(r"[0-9a-f]{64}", tx_hash), "Invalid transaction hash")
    return signed, tx_hash


def confirm(folder, receipt, *, persist):
    tx_hash = receipt["hash"]
    e.require(receipt["network"] == e.PASSPHRASE and receipt["asset"] == e.ASSET
              and receipt["agency"] == AGENCY and re.fullmatch(r"[0-9a-f]{64}", tx_hash),
              "Unexpected swap journal")
    if not receipt.get("ledger"):
        result = e.Testnet(folder).lookup("USDC swap", tx_hash)
        e.require(result["status"] == "SUCCESS" and result.get("ledger"),
                  f"Swap {tx_hash}: {result['status']}; verify this transaction before retrying")
        receipt["ledger"] = result["ledger"]
        if persist:
            e.write_checkpoint(folder, receipt)
    print(f"Swap confirmed on ledger {receipt['ledger']}: {e.EXPLORER}/tx/{tx_hash}", flush=True)
    for attempt in range(8):
        balance = Decimal(asset_line(e.account(AGENCY))["balance"])
        if receipt.get("balance_verified") or balance >= Decimal(receipt["before_usdc"]) + AMOUNT:
            print(f"Agency USDC balance: {balance:f}")
            if persist and not receipt.get("balance_verified"):
                receipt["balance_verified"] = True
                e.write_checkpoint(folder, receipt)
            return
        if attempt != 7:
            time.sleep(2)
    raise RuntimeError(f"Swap {tx_hash} confirmed, but Horizon has not verified the balance increase")


def run_swap(folder, base_reserve, *, execute):
    def check_or_submit():
        if (folder / "checkpoint.json").is_file():
            confirm(folder, e.read_checkpoint(folder), persist=execute)
            return
        data = e.account(AGENCY)
        line = asset_line(data)
        balance = Decimal(line["balance"])
        available = balance - Decimal(line.get("selling_liabilities", "0"))
        print(f"Agency has {available:f} spendable Testnet USDC.", flush=True)
        if available >= AMOUNT:
            print("Already funded; swap skipped.")
            return
        price = quote()
        print(f"Direct quote: {price:f} XLM for 10 USDC. Cap: 15 XLM, fee separate.", flush=True)
        check_funding(data, base_reserve)
        if not execute:
            print("Read-only check complete. Use --execute to sign and submit.")
            return
        signed, tx_hash = build_signed()
        receipt = {"network": e.PASSPHRASE, "asset": e.ASSET, "agency": AGENCY,
                   "hash": tx_hash, "before_usdc": str(balance)}
        e.write_checkpoint(folder, receipt)
        print(f"Submitting Testnet swap {tx_hash}", flush=True)
        e.Testnet(folder).send("USDC swap", signed, tx_hash)
        confirm(folder, receipt, persist=True)

    if not execute:
        check_or_submit()
        return
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (folder / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        check_or_submit()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Sign and submit the Testnet swap")
    args = parser.parse_args()
    e.require(e.rpc("getNetwork")["passphrase"] == e.PASSPHRASE, "RPC is not Stellar Testnet")
    e.require(e.xdr_cli("keys", "address", e.ALIASES["agency"], value="") == AGENCY,
              "Local relief-e2e-agency identity does not match the expected agency address")
    e.Testnet(FOLDER).usdc_id()
    ledger = e.request_json(f"{e.HORIZON}/ledgers?order=desc&limit=1", phase="Horizon base reserve")
    reserve = Decimal(ledger["_embedded"]["records"][0]["base_reserve_in_stroops"]) / e.STROOPS
    run_swap(FOLDER, reserve, execute=args.execute)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, InvalidOperation, StopIteration,
            subprocess.SubprocessError) as error:
        sys.exit(f"Stopped: {error}")
