#!/usr/bin/env python3
"""Run the Stellar Relief USDC demo on Testnet using Stellar CLI 30."""
import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import uuid
import time
from datetime import datetime, timezone
from decimal import Decimal
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

PROJECT = Path(__file__).resolve().parent
WASM = PROJECT / "target/usdc-build/wasm32v1-none/release/stellar_relief.wasm"
WASM_HASH = "4b763614f798027da3ed93126242ee947410cce3bfb563ccf107c7d0328bdeb8"
RPC = "https://soroban-testnet.stellar.org"
PASSPHRASE = "Test SDF Network ; September 2015"
HORIZON = "https://horizon-testnet.stellar.org"
EXPLORER = "https://stellar.expert/explorer/testnet"
NETWORK = ["--rpc-url", RPC, "--network-passphrase", PASSPHRASE]
ROLES = ("agency", "verifier", "wholesaler", "shop")
ALIASES = {role: f"relief-e2e-{role}" for role in ROLES}
BATCH = "1"
STROOPS = 10_000_000  # Both USDC and XLM use seven decimal places.
ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
ASSET = f"USDC:{ISSUER}"
SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
# Explicit endpoints and identities take precedence over user shell overrides.
CLI_ENV = {k: v for k, v in os.environ.items() if not k.startswith("STELLAR_") and k != "RUST_LOG"}
CLI_ENV.update({"NO_COLOR": "1", "TERM": "dumb"})
STAGES = ("upload", "deploy", "fund", "settle")
RUN_ROOT = PROJECT / "target" / "testnet-e2e-usdc"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def request_json(url, payload=None, *, phase):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"User-Agent": "StellarRelief-E2E/1.0", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=headers)
    try:
        with urlopen(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code != 403:
            raise
        with error:
            ray = error.headers.get("CF-Ray", "") if error.headers else ""
            try:
                body = error.read(16_384)
            except OSError:
                body = b""
        details = ["HTTP 403 Forbidden"]
        if re.search(rb"(?:\berror(?:\s+code)?\s*:?\s*|cf-error-code[^>]*>\s*)1010\b", body, re.I):
            details.append("Cloudflare Error 1010")
        if re.fullmatch(r"[a-fA-F0-9]{8,32}(?:-[A-Z0-9]{2,8})?", ray):
            details.append(f"CF-Ray {ray}")
        # Never include the raw response body, arbitrary headers, or RPC payload.
        raise RpcError(f"{phase} ({urlsplit(url).hostname}): {', '.join(details)}") from None


def rpc(method, params=None):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        payload["params"] = params
    reply = request_json(RPC, payload, phase=f"RPC {method}")
    if "result" not in reply:
        raise RpcError(f"{method}: {reply.get('error', reply)}")
    return reply["result"]


def run(log, label, *args):
    command = ["stellar", *args]
    print(f"[{label}] {shlex.join(command)}", flush=True)
    with (log / f"{label}.stderr.txt").open("w") as err, (log / f"{label}.stdout.txt").open("w") as out:
        result = subprocess.run(command, stdout=out, stderr=err, env=CLI_ENV, cwd=PROJECT, timeout=90)
    stdout = (log / f"{label}.stdout.txt").read_text().strip()
    stderr = (log / f"{label}.stderr.txt").read_text().strip()
    return result.returncode, stdout, stderr


def cli(log, label, *args):
    code, out, err = run(log, label, *args)
    if code != 0:
        raise CliError(f"{label} failed (exit {code})\n{err}\n{out}")
    return out, err


def account(address):
    try:
        return request_json(f"{HORIZON}/accounts/{address}", phase="Horizon account lookup")
    except HTTPError as error:
        if error.code != 404:
            raise
        return None


def payout_units(amount_usdc):
    require(type(amount_usdc) is int and amount_usdc in (10, 100), "USDC amount must be 10 or 100")
    return amount_usdc * 7 * STROOPS // 10, amount_usdc * 3 * STROOPS // 10


def check_usdc_accounts(addresses, amount_usdc, *, funding):
    whole, shop = payout_units(amount_usdc)
    # Check the current base reserve, including trustlines and sponsorship.
    ledger = request_json(f"{HORIZON}/ledgers?order=desc&limit=1", phase="Horizon base reserve")
    base_reserve = Decimal(ledger["_embedded"]["records"][0]["base_reserve_in_stroops"]) / STROOPS
    for role in ROLES:
        address = addresses[role]
        data = account(address)
        require(data is not None and data["account_id"] == address, f"{role}: missing Testnet account")
        native = next(b for b in data["balances"] if b["asset_type"] == "native")
        reserve = base_reserve * (2 + data["subentry_count"] + data.get("num_sponsoring", 0)
                                  - data.get("num_sponsored", 0))
        free_xlm = Decimal(native["balance"]) - Decimal(native.get("selling_liabilities", "0")) - reserve
        fee_buffer = Decimal(1 if role in ("agency", "verifier") else 0)
        require(free_xlm >= fee_buffer, f"{role}: {free_xlm} XLM above reserve; need {fee_buffer}")
        if role == "verifier":
            print(f"{role}: {address}; free XLM {free_xlm}")
            continue
        line = next((b for b in data["balances"] if b.get("asset_code") == "USDC"
                     and b.get("asset_issuer") == ISSUER), None)
        require(line is not None and line.get("is_authorized") is True,
                f"{role}: missing or unauthorized USDC trustline for {ISSUER}")
        balance = Decimal(line["balance"])
        if role == "agency" and funding:
            available = balance - Decimal(line.get("selling_liabilities", "0"))
            require(available >= amount_usdc, f"agency: {available} spendable USDC; need {amount_usdc}")
        if role != "agency":
            capacity = Decimal(line["limit"]) - balance - Decimal(line.get("buying_liabilities", "0"))
            need = Decimal(whole if role == "wholesaler" else shop) / STROOPS
            require(capacity >= need, f"{role}: trustline capacity {capacity} USDC; need {need}")
        print(f"{role}: {address}; {balance} USDC; free XLM {free_xlm}")


def write_checkpoint(folder, data):
    path = folder / "checkpoint.json"
    with tempfile.NamedTemporaryFile(mode="w", dir=folder, prefix=".checkpoint-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(data, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory = os.open(folder, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)


def read_checkpoint(folder):
    return json.loads((folder / "checkpoint.json").read_text())


def account_key(value, prefix):
    return isinstance(value, str) and re.fullmatch(prefix + r"[A-Z2-7]{55}", value) is not None


def xdr_cli(*args, value):
    """Run an XDR-only command with data on stdin and no envelope in the log."""
    proc = subprocess.run(["stellar", *args], input=value + "\n", capture_output=True,
                          text=True, env=CLI_ENV, cwd=PROJECT, timeout=45)
    if proc.returncode != 0:
        raise CliError(f"stellar {' '.join(args[:2])} exited {proc.returncode}: {proc.stderr.strip()}")
    return proc.stdout.strip()


class CliError(RuntimeError):
    pass


class RpcError(RuntimeError):
    pass


def decoded_xdr(type_name, value):
    return json.loads(xdr_cli("xdr", "decode", "--type", type_name, "--input",
                              "single-base64", value=value))


def encoded_xdr(type_name, value):
    return xdr_cli("xdr", "encode", "--type", type_name, value=json.dumps(value))


def deployment_envelope(agency, salt, wasm_hash, sequence, asset):
    """Encode an unsigned CreateContractV2 using the installed WASM hash."""
    host = {"create_contract_v2": {
        "contract_id_preimage": {"address": {"address": agency, "salt": salt}},
        "executable": {"wasm": wasm_hash},
        "constructor_args": [{"address": agency}, {"address": asset}],
    }}
    op = {"source_account": None, "body": {
        "invoke_host_function": {"host_function": host, "auth": []},
    }}
    tx = {"source_account": agency, "fee": 100, "seq_num": str(sequence + 1),
          "cond": "none", "memo": "none", "operations": [op], "ext": "v0"}
    return xdr_cli("tx", "encode", value=json.dumps({"tx": {"tx": tx, "signatures": []}}))


def invocation(tx):
    ops = tx["operations"]
    require(len(ops) == 1 and ops[0]["source_account"] is None,
            "Expected one operation using the transaction source")
    return ops[0]["body"]["invoke_host_function"]


def simulation_result(response):
    require(isinstance(response, dict) and isinstance(response.get("latestLedger"), int),
            "Malformed RPC simulation result")
    if "error" in response:
        require(isinstance(response["error"], str) and response["error"], "Invalid simulation error")
        return None
    results = response.get("results")
    require(isinstance(results, list) and len(results) == 1 and isinstance(results[0], dict)
            and isinstance(results[0].get("xdr"), str),
            "RPC did not return one simulated invocation result")
    return results[0]


def classify(response, expected_error):
    if simulation_result(response) is not None:
        return {"status": "FAIL", "detail": "Simulation unexpectedly succeeded"}
    message = response["error"]
    if re.search(expected_error, message):
        return {"status": "PASS", "detail": message}
    return {"status": "INCONCLUSIVE", "detail": f"Unexpected Soroban diagnostic: {message}"}


def inconclusive(error):
    if isinstance(error, (RpcError, OSError)):
        kind = "RPC/transport"
    elif isinstance(error, (CliError, subprocess.SubprocessError)):
        kind = "CLI"
    else:
        kind = "parse/verification"
    return {"status": "INCONCLUSIVE", "detail": f"{kind}: {error}"}


class Testnet:
    def __init__(self, folder):
        self.folder = folder

    def preflight(self):
        require(hashlib.sha256(WASM.read_bytes()).hexdigest() == WASM_HASH, "WASM hash mismatch")
        require(rpc("getNetwork")["passphrase"] == PASSPHRASE, "RPC did not identify itself as Testnet")
        key = self.contract_instance_key(self.usdc_id())
        entries = rpc("getLedgerEntries", {"keys": [key]}).get("entries")
        require(isinstance(entries, list) and [entry["key"] for entry in entries] == [key],
                "Verified Testnet USDC SAC is missing from the ledger")

    @staticmethod
    def contract_instance_key(address):
        return encoded_xdr("LedgerKey", {"contract_data": {
            "contract": address, "key": "ledger_key_contract_instance", "durability": "persistent",
        }})

    def contract_id(self, data):
        address, _ = cli(self.folder, "contract-id", "contract", "id", "wasm", *NETWORK,
                         "--source-account", data["addresses"]["agency"], "--salt", data["salt"])
        require(account_key(address, "C"), "Invalid predicted contract ID")
        return address

    def read_identities(self):
        addresses = {role: xdr_cli("keys", "address", alias, value="") for role, alias in ALIASES.items()}
        require(all(account_key(address, "G") for address in addresses.values())
                and len(set(addresses.values())) == 4, "Need four distinct Testnet account addresses")
        return addresses

    def prepare(self, record, data):
        addresses = self.read_identities()
        sac = self.usdc_id()
        check_usdc_accounts(addresses, data["amount_usdc"], funding=True)
        for role, address in addresses.items():
            record(role, address)
        return self.contract_id(data), sac

    def usdc_id(self):
        address = xdr_cli("contract", "id", "asset", *NETWORK, "--asset", ASSET, value="")
        require(address == SAC, "CLI-derived USDC SAC does not match expected Testnet asset")
        return address

    def validate(self, data, *, deployed=False):
        require(rpc("getNetwork")["passphrase"] == PASSPHRASE, "Network mismatch")
        require(set(data["addresses"]) == set(ROLES) and len(set(data["addresses"].values())) == 4,
                "Missing or duplicate test identities")
        for role, address in data["addresses"].items():
            actual, _ = cli(self.folder, f"validate-{role}", "keys", "address", ALIASES[role])
            require(account_key(address, "G") and actual == address, f"Identity changed: {role}")
        require(self.contract_id(data) == data["contract"], "Contract ID does not match run salt and agency")
        require(self.usdc_id() == data["sac"], "USDC SAC does not match checkpoint")
        if deployed:
            binary = subprocess.run(
                ["stellar", "contract", "fetch", *NETWORK, "--id", data["contract"]],
                capture_output=True, env=CLI_ENV, cwd=PROJECT, timeout=45, check=True,
            ).stdout
            require(hashlib.sha256(binary).hexdigest() == WASM_HASH, "On-chain WASM hash mismatch")

    def verify_deployable(self, data):
        require(data["transactions"]["upload"]["status"] == "SUCCESS",
                "WASM upload is not confirmed")
        code_key = encoded_xdr("LedgerKey", {"contract_code": {"hash": data["wasm_hash"]}})
        instance_key = self.contract_instance_key(data["contract"])
        result = rpc("getLedgerEntries", {"keys": [code_key, instance_key]})
        entries = result.get("entries")
        require(isinstance(entries, list) and isinstance(result.get("latestLedger"), int),
                "Cannot verify contract and WASM ledger entries")
        keys = [entry["key"] for entry in entries]
        require(instance_key not in keys,
                "Predicted contract already exists without a confirmed deployment in this run; verify manually")
        require(keys == [code_key], "Expected installed WASM could not be verified")
        live_until = entries[0].get("liveUntilLedgerSeq")
        require(live_until is None or live_until >= result["latestLedger"], "Installed WASM is archived")

    def invoke(self, data, function, args, *, role="agency", build=False, contract=None):
        flags = ["--build-only"] if build else ["--send", "no"]
        out, _ = cli(self.folder, f"{role}-{function}", "contract", "invoke", *NETWORK,
                     "--id", contract or data["contract"], "--source-account", data["addresses"][role],
                     *flags, "--", function, *args)
        return out

    def snapshot(self, data):
        whole, shop = payout_units(data["amount_usdc"])
        batch = json.loads(self.invoke(data, "get_batch", ["--batch-id", BATCH]))
        status = None
        if batch is not None:
            status = batch["status"]
            if isinstance(status, list) and len(status) == 1:
                status = status[0]
            require(status in ("Funded", "Settled"), f"Unknown batch status: {status}")
            expected = {"id": BATCH, "quantity": 3, "total_amount": whole + shop,
                        "wholesaler_amount": whole, "shop_amount": shop,
                        **data["addresses"]}
            for field, value in expected.items():
                require(str(batch.get(field)) == str(value), f"Unexpected batch field: {field}")
        owners = {"escrow": data["contract"], "agency": data["addresses"]["agency"], "wholesaler": data["addresses"]["wholesaler"],
                  "shop": data["addresses"]["shop"]}
        balances = {}
        for name, owner in owners.items():
            balances[name] = int(json.loads(self.invoke(data, "balance", ["--id", owner], contract=data["sac"])))
        return {"status": status, "batch": batch, "balances": balances}

    def simulate(self, envelope, mode):
        return rpc("simulateTransaction", {"transaction": envelope, "authMode": mode})

    def settle_envelope(self, data, quantity, *, role="verifier"):
        return self.invoke(data, "settle_batch", ["--batch-id", BATCH, "--verified-quantity", quantity],
                           role=role, build=True)

    def assemble(self, envelope, source):
        response = self.simulate(envelope, "record")
        result = simulation_result(response)
        require(result is not None, f"Soroban simulation failed: {response.get('error')}")
        require(not response.get("restorePreamble"), "Ledger entries require a separate restoration")
        decoded = json.loads(xdr_cli("tx", "decode", value=envelope))
        tx = decoded["tx"]["tx"]
        require(tx["source_account"] == source and not decoded["tx"]["signatures"],
                "Unexpected transaction source or signatures")
        host_call = invocation(tx)
        entries = [decoded_xdr("SorobanAuthorizationEntry", entry) for entry in result.get("auth") or []]
        require(all(entry["credentials"] == "source_account" for entry in entries),
                "Unexpected authorization requiring a separate signer")
        host_call["auth"] = entries
        tx["fee"] += int(response["minResourceFee"])
        tx["ext"] = {"v1": decoded_xdr("SorobanTransactionData", response["transactionData"])}
        return decoded, entries

    def authorization_check(self, data):
        verifier = data["addresses"]["verifier"]
        decoded, entries = self.assemble(self.settle_envelope(data, "3"), verifier)
        require(len(entries) == 1, "Recording mode did not return one verifier source-account authorization")
        correct = xdr_cli("tx", "encode", value=json.dumps(decoded))
        positive = self.simulate(correct, "enforce")
        if simulation_result(positive) is None:
            return {"status": "INCONCLUSIVE", "detail": f"Correct verifier failed enforce preflight: {positive['error']}"}

        # Use the same invocation and auth entry, but use the wholesaler's
        # transaction source and sequence so that entry represents its authority.
        alternate = self.settle_envelope(data, "3", role="wholesaler")
        alternate = json.loads(xdr_cli("tx", "decode", value=alternate))["tx"]["tx"]
        wrong = copy.deepcopy(decoded)
        correct_tx = wrong["tx"]["tx"]
        require(alternate["source_account"] == data["addresses"]["wholesaler"]
                and invocation(alternate)["host_function"] == invocation(correct_tx)["host_function"],
                "Wrong-source control does not match the expected invocation")
        correct_tx["source_account"] = alternate["source_account"]
        correct_tx["seq_num"] = alternate["seq_num"]
        wrong_xdr = xdr_cli("tx", "encode", value=json.dumps(wrong))
        result = classify(self.simulate(wrong_xdr, "enforce"), r"Error\(Auth,\s*InvalidAction\)")
        result["detail"] = "Correct verifier passed enforce preflight. Wrong source: " + result["detail"]
        return result

    def checked(self, fn):
        try:
            return fn()
        except (RuntimeError, ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
            return inconclusive(error)

    def negative_checks(self, data):
        return {
            "authorization": self.checked(lambda: self.authorization_check(data)),
            "quantity": self.checked(lambda: classify(
                self.simulate(self.settle_envelope(data, "2"), "record"), r"Error\(Contract,\s*#?2\)")),
        }

    def duplicate_check(self, data):
        return self.checked(lambda: classify(
            self.simulate(self.settle_envelope(data, "3"), "record"), r"Error\(Contract,\s*#?5\)"))

    def build(self, stage, data):
        addresses = data["addresses"]
        role = "verifier" if stage == "settle" else "agency"
        if stage == "upload":
            out, _ = cli(self.folder, "build-upload", "contract", "upload", *NETWORK, "--build-only",
                         "--wasm", str(WASM), "--optimize=false", "--source-account", addresses[role])
        elif stage == "deploy":
            # CLI 30.0.1 cannot read constructor spec from --wasm-hash on
            # this build-only path. Encode the constructor argument locally.
            agency = addresses["agency"]
            source = account(agency)
            require(source is not None and source["account_id"] == agency, "Agency account unavailable")
            out = deployment_envelope(agency, data["salt"], data["wasm_hash"], int(source["sequence"]), data["sac"])
        elif stage == "fund":
            check_usdc_accounts(addresses, data["amount_usdc"], funding=True)
            whole, shop = payout_units(data["amount_usdc"])
            out = self.invoke(data, "fund_batch", [
                "--batch-id", BATCH, "--quantity", "3", "--wholesaler", addresses["wholesaler"],
                "--shop", addresses["shop"], "--verifier", addresses["verifier"],
                "--wholesaler-amount", str(whole), "--shop-amount", str(shop)], build=True)
        elif stage == "settle":
            check_usdc_accounts(addresses, data["amount_usdc"], funding=False)
            out = self.settle_envelope(data, "3")
        else:
            raise RuntimeError(f"Unexpected stage: {stage}")
        decoded, entries = self.assemble(out, addresses[role])
        if stage in ("fund", "settle"):
            require(len(entries) == 1, f"Unexpected authorization count for {stage}")
        encoded = xdr_cli("tx", "encode", value=json.dumps(decoded))
        preflight = self.simulate(encoded, "enforce")
        result = simulation_result(preflight)
        require(result is not None, f"Enforced preflight rejected {stage}: {preflight.get('error')}")
        if stage == "deploy":
            require(decoded_xdr("ScVal", result["xdr"]) == {"address": data["contract"]},
                    "Simulated deployment did not return the expected contract ID")
        signed = xdr_cli("tx", "sign", *NETWORK, "--sign-with-key", ALIASES[role], value=encoded)
        signed_envelope = json.loads(xdr_cli("tx", "decode", value=signed))["tx"]
        require(signed_envelope["signatures"] and signed_envelope["tx"] == decoded["tx"]["tx"],
                f"Local identity {ALIASES[role]} did not sign the expected transaction")
        tx_hash = xdr_cli("tx", "hash", *NETWORK, value=signed).lower()
        require(re.fullmatch(r"[0-9a-f]{64}", tx_hash), "Invalid transaction hash")
        return signed, tx_hash

    def send(self, stage, envelope, tx_hash):
        reply = rpc("sendTransaction", {"transaction": envelope})
        require(reply.get("hash", "").lower() == tx_hash and reply.get("status") in ("PENDING", "DUPLICATE"),
                f"{stage} submission returned {reply.get('status')}; check {tx_hash} before proceeding")
        return reply["status"]

    def lookup(self, stage, tx_hash):
        for attempt in range(8):
            reply = rpc("getTransaction", {"hash": tx_hash})
            if reply.get("status") != "NOT_FOUND":
                break
            if attempt != 7:
                time.sleep(2)
        status = reply.get("status")
        require(status in ("SUCCESS", "FAILED", "NOT_FOUND"), f"Unknown RPC status for {stage}: {status}")
        if status in ("SUCCESS", "FAILED"):
            require(reply.get("txHash", "").lower() == tx_hash, f"RPC hash mismatch for {stage}")
        return {"status": status, "ledger": reply.get("ledger"), "hash": tx_hash}


def is_preflight_only(folder, data):
    # The initial checkpoint is written before preflight. Identity preparation
    # creates evidence files, and submission must first persist its hash.
    empty_fields = ("addresses", "transactions", "snapshots", "checks")
    initial_keys = {"schema", "run_id", "network", "wasm_hash", "batch_id", "salt", "asset", "amount_usdc", *empty_fields}
    if data.get("verified_delivery") is True:
        initial_keys.add("verified_delivery")
    if data.keys() != initial_keys or any(data[field] != {} for field in empty_fields):
        return False
    if not isinstance(data["salt"], str) or not re.fullmatch(r"[0-9a-f]{64}", data["salt"]):
        return False
    return all(
        entry.name in ("checkpoint.json", ".lock")
        and not entry.is_symlink()
        and entry.is_file()
        and (entry.name != ".lock" or entry.stat().st_size == 0)
        for entry in folder.iterdir()
    )


def execute(folder, chain, handoff, *, resume=False, allow_inconclusive=False, amount_usdc=None, fund_only=False):
    def save():
        write_checkpoint(folder, data)

    def record(role, address):
        data["addresses"][role] = address
        save()

    def reconcile(stage):
        entry = data["transactions"][stage]
        result = chain.lookup(stage, entry["hash"])
        require(result["hash"] == entry["hash"], f"{stage}: transaction hash mismatch")
        entry.update(result)
        save()
        require(result["status"] == "SUCCESS" and result.get("ledger"),
                f"{stage}: {result['status']} for {entry['hash']}; verify the hash manually before proceeding")

    def submit(stage, expected=None):
        require(stage not in data["transactions"], f"{stage} already has a submission record")
        if stage == "deploy":
            chain.validate(data)
            chain.verify_deployable(data)
        envelope, tx_hash = chain.build(stage, data)
        chain.validate(data, deployed=expected is not None)
        if expected is not None:
            require(chain.snapshot(data) == expected, f"{stage}: batch or balances changed before submission")
        # After this durable write, the stage is never sent again, even if
        # the process dies before the RPC returns or before the request leaves.
        data["transactions"][stage] = {"hash": tx_hash, "status": "SUBMISSION_UNCERTAIN"}
        save()
        data["transactions"][stage]["submit_status"] = chain.send(stage, envelope, tx_hash)
        save()
        reconcile(stage)

    def observe():
        snapshot = chain.snapshot(data)
        data["last_observation"] = snapshot
        save()
        return snapshot

    initialize = not resume
    if resume:
        data = read_checkpoint(folder)
        require(data.get("schema") == 2 and data.get("asset") == ASSET
                and data["run_id"] == folder.name and data["network"] == PASSPHRASE
                and data["wasm_hash"] == WASM_HASH and data["batch_id"] == BATCH,
                "Checkpoint does not match this USDC run, Testnet, batch or WASM")
        require(amount_usdc is None or amount_usdc == data["amount_usdc"],
                "Cannot change USDC amount when resuming")
        require(bool(data.get("verified_delivery")) == fund_only,
                "Verified delivery orders must resume funding with --fund-only")
        recorded = data["transactions"]
        require(isinstance(recorded, dict) and set(recorded) == set(STAGES[:len(recorded)]),
                "Conflicting transaction stages; inspect the checkpoint manually")
        initialize = is_preflight_only(folder, data)
    else:
        require(not (folder / "checkpoint.json").exists(), "Run already exists; use --resume")
        data = {"schema": 2, "asset": ASSET, "amount_usdc": 100 if amount_usdc is None else amount_usdc,
                "run_id": folder.name, "network": PASSPHRASE, "wasm_hash": WASM_HASH,
                "batch_id": BATCH, "salt": uuid.uuid4().hex + uuid.uuid4().hex,
                "addresses": {}, "transactions": {}, "snapshots": {}, "checks": {}}
        if fund_only:
            data["verified_delivery"] = True
        save()

    whole, shop = payout_units(data["amount_usdc"])
    total = whole + shop
    chain.preflight()
    if resume and not initialize:
        for stage in STAGES:
            if stage in data["transactions"]:
                reconcile(stage)
        require("upload" in data["transactions"],
                "Deployment was not recorded and the run is not a clean preflight checkpoint; "
                "inspect the checkpoint and evidence manually.")

    if initialize:
        data["contract"], data["sac"] = chain.prepare(record, data)
        save()
        submit("upload")
    if "deploy" not in data["transactions"]:
        # Older versions wrote deploy.* submission logs. Unsigned
        # build-deploy.* logs do not indicate that anything was sent.
        require(not any(folder.glob("deploy.*")),
                "Deployment submission evidence exists without a checkpoint hash; verify manually")
        submit("deploy")

    chain.validate(data, deployed=True)
    current = observe()
    snapshots = data["snapshots"]
    transactions = data["transactions"]
    if current["status"] is None:
        require("fund" not in transactions and "settle" not in transactions,
                "Ledger is missing a batch with a recorded funding or settlement transaction")
        require(current["balances"]["escrow"] == 0, "New escrow is not empty")
        if "before_funding" in snapshots:
            require(current == snapshots["before_funding"], "Pre-funding snapshot changed")
        snapshots["before_funding"] = current
        save()
        submit("fund", current)
        current = observe()

    require("fund" in transactions and "before_funding" in snapshots,
            "Existing batch has no matching confirmed funding record or baseline; verify manually")
    baseline = snapshots["before_funding"]["balances"]
    if current["status"] == "Funded":
        require("settle" not in transactions, "Confirmed settlement disagrees with Funded ledger state")
        expected = {**baseline, "escrow": total, "agency": baseline["agency"] - total}
        require(current["balances"] == expected, "Funding balance check failed")
        snapshots["funded"] = current
        if fund_only:
            save()
            print(f"Funded. Signed delivery and verifier approval are separate steps. Run ID: {folder.name}")
            return
        data["checks"].update(chain.negative_checks(data))
        save()
        require(all(check["status"] != "FAIL" for check in data["checks"].values()),
                "Negative check unexpectedly succeeded; settlement requires investigation")
        require(allow_inconclusive or all(check["status"] == "PASS" for check in data["checks"].values()),
                "Negative evidence is INCONCLUSIVE; inspect checkpoint then resume with --allow-inconclusive to settle")
        if any(check["status"] == "INCONCLUSIVE" for check in data["checks"].values()):
            data["inconclusive_override"] = True
            save()
        submit("settle", current)
        current = observe()

    require(current["status"] == "Settled" and "settle" in transactions,
            "Settlement state and confirmed receipt do not agree; verify manually")
    expected = {"escrow": 0, "agency": baseline["agency"] - total,
                "wholesaler": baseline["wholesaler"] + whole, "shop": baseline["shop"] + shop}
    require(current["balances"] == expected, "Settlement balance check failed")
    if data.get("report_complete"):
        require(current == snapshots["settled"], "Settled snapshot changed since the report")
        print(f"Run already reported. Evidence: {folder / 'report.md'}")
        return
    snapshots["settled"] = current
    data["checks"]["duplicate"] = chain.duplicate_check(data)
    require(observe() == current, "Batch or balances changed during duplicate simulation")
    save()
    require(data["checks"]["duplicate"]["status"] != "FAIL", "Duplicate settlement simulation unexpectedly succeeded")
    save_report(folder, handoff, data)
    data["report_complete"] = True
    save()


def save_report(folder, handoff, data):
    marker = f"<!-- stellar-relief run-id: {data['run_id']} -->"
    title = ("链上结算已确认，部分负面验证未确认" if
             any(check["status"] != "PASS" for check in data["checks"].values())
             else "Stellar Testnet 端到端验证成功")
    contract = data["contract"]
    lines = [f"\n## Step 3：{title}", "",
             f"- Network: Stellar Testnet (`{PASSPHRASE}`)",
             f"- Business Contract ID: [`{contract}`]({EXPLORER}/contract/{contract})",
             f"- WASM Hash: `{WASM_HASH}`", f"- Asset: `{ASSET}` / SAC `{data['sac']}`",
             f"- Settlement: {data['amount_usdc']} USDC → {data['amount_usdc'] * 7 // 10} USDC"
             f" (wholesaler) + {data['amount_usdc'] * 3 // 10} USDC (shop)",
             f"- Batch ID: `{data['batch_id']}`", f"- Run ID: `{data['run_id']}`"]
    lines.extend(f"- {role}: `{address}`" for role, address in data["addresses"].items())
    for stage in STAGES:
        receipt = data["transactions"][stage]
        tx_hash = receipt["hash"]
        lines.append(f"- {stage} transaction: [`{tx_hash}`]({EXPLORER}/tx/{tx_hash}) — submitted and RPC SUCCESS, ledger {receipt['ledger']}.")
    lines += ["", "| Snapshot (USDC base units) | Agency | Escrow | Wholesaler | Shop |", "| --- | ---: | ---: | ---: | ---: |"]
    for name, snapshot in data["snapshots"].items():
        b = snapshot["balances"]
        lines.append(f"| {name} | {b['agency']:,} | {b['escrow']:,} | {b['wholesaler']:,} | {b['shop']:,} |")
    lines += ["", "Batch and balance reads and negative checks were simulations; no transaction submitted for these."]
    if data.get("inconclusive_override"):
        lines += ["", "Settlement proceeded with the explicit `--allow-inconclusive` override."]
    for name, snapshot in data["snapshots"].items():
        lines += ["", f"`get_batch` — {name}", "", "```json", json.dumps(snapshot["batch"], indent=2), "```"]
    for name, check in data["checks"].items():
        lines += ["", f"**{name}: {check['status']}**", "", "```text", check["detail"], "```"]
    report = "\n".join(lines + ["", marker, ""])
    (folder / "report.md").write_text(report)
    if not handoff.exists() or marker not in handoff.read_text():
        with handoff.open("a") as stream:
            stream.write(report)
            stream.flush()
            os.fsync(stream.fileno())
    print(f"{title}。Evidence: {folder / 'report.md'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--resume", metavar="RUN_ID")
    mode.add_argument("--check-accounts", action="store_true",
                      help="Check Testnet accounts and trustlines without starting a run")
    parser.add_argument("--amount", type=int, choices=(100, 10),
                        help="USDC amount (default 100 for a new run)")
    parser.add_argument("--allow-inconclusive", action="store_true",
                        help="Allow settlement after inconclusive tool checks; never bypass failed safety checks")
    parser.add_argument("--fund-only", action="store_true", help="Stop after funding a separate verified delivery order")
    parser.add_argument("--approve-setup", action="store_true", help="Authorize Testnet upload, deployment and funding only")
    args = parser.parse_args()
    if args.fund_only and not args.check_accounts:
        require(args.approve_setup, "Fund-only setup requires explicit --approve-setup")
    require(not args.approve_setup or args.fund_only, "--approve-setup requires --fund-only")
    handoff = PROJECT / "HANDOFF.md"
    if args.check_accounts or not args.resume:
        chain = Testnet(RUN_ROOT)
        chain.preflight()
        check_usdc_accounts(chain.read_identities(), args.amount or 100, funding=True)
        if args.check_accounts:
            return
    if args.resume:
        require(re.fullmatch(r"[0-9a-f]{32}", args.resume), "Invalid run ID")
        folder = RUN_ROOT / args.resume
        require((folder / "checkpoint.json").is_file(), f"Checkpoint not found for {args.resume}")
    else:
        folder = RUN_ROOT / uuid.uuid4().hex
        folder.mkdir(mode=0o700, parents=True)
    print(f"Run ID: {folder.name}\nEvidence: {folder}", flush=True)
    with (folder / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        execute(folder, Testnet(folder), handoff, resume=bool(args.resume),
                allow_inconclusive=args.allow_inconclusive, amount_usdc=args.amount, fund_only=args.fund_only)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, StopIteration,
            subprocess.SubprocessError) as error:
        print(f"Stopped: {error}", file=sys.stderr)
        print("Inspect checkpoint.json and the Testnet transaction status before resuming.", file=sys.stderr)
        sys.exit(1)
