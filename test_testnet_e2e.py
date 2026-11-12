"""Offline orchestration tests. All ledger operations use an in-memory fake."""
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import testnet_e2e as e


class Fake:
    def __init__(self):
        self.status = None
        self.sent = []
        self.confirmed = {}
        self.break_after = None
        self.unknown = None
        self.checks = {"authorization": "PASS", "quantity": "PASS"}
        self.contract = "C" + "A" * 55
        self.addresses = {role: "G" + chr(65 + i) * 55 for i, role in enumerate(e.ROLES)}

    def preflight(self):
        pass

    def prepare(self, record, data):
        for role, address in self.addresses.items():
            record(role, address)
        return self.contract, "native-id"

    def validate(self, data, *, deployed=False):
        if deployed:
            assert "deploy" in self.confirmed

    def verify_deployable(self, data):
        assert "upload" in self.confirmed
        e.require("deploy" not in self.confirmed, "Predicted contract already exists")

    def snapshot(self, data):
        batch = {"status": [self.status]} if self.status else None
        balances = {"escrow": 0, "wholesaler": 50, "shop": 60}
        if self.status == "Funded":
            balances["escrow"] = 100 * e.STROOPS
        if self.status == "Settled":
            balances["wholesaler"] += 70 * e.STROOPS
            balances["shop"] += 30 * e.STROOPS
        return {"status": self.status, "batch": batch, "balances": balances}

    def build(self, stage, data):
        return stage, str(("upload", "deploy", "fund", "settle").index(stage) + 1) * 64

    def send(self, stage, envelope, tx_hash):
        self.sent.append(stage)
        if stage == "fund":
            self.status = "Funded"
        elif stage == "settle":
            self.status = "Settled"
        self.confirmed[stage] = {"status": "SUCCESS", "ledger": 42, "hash": tx_hash}
        if stage == self.break_after:
            raise ValueError("local response parsing failed after confirmation")
        return "PENDING"

    def lookup(self, stage, tx_hash):
        if stage == self.unknown:
            return {"status": "NOT_FOUND", "hash": tx_hash}
        return self.confirmed[stage]

    def negative_checks(self, data):
        return {name: {"status": result, "detail": "fixture"} for name, result in self.checks.items()}

    def duplicate_check(self, data):
        return {"status": "PASS", "detail": "fixture"}


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.handoff = self.folder / "HANDOFF.md"
        self.handoff.write_text("existing\n")
        self.run = self.folder / "run"
        self.run.mkdir()
        self.chain = Fake()

    def execute(self, resume=False, override=False):
        with redirect_stdout(StringIO()):
            e.execute(self.run, self.chain, self.handoff, resume=resume, allow_inconclusive=override)

    def interrupted(self, stage):
        self.chain.break_after = stage
        with self.assertRaisesRegex(ValueError, "parsing failed"):
            self.execute()
        self.chain.break_after = None

    def test_complete_and_repeated_resume(self):
        self.execute()
        self.execute(resume=True)
        self.assertEqual(self.chain.sent, ["upload", "deploy", "fund", "settle"])
        self.assertEqual(self.handoff.read_text().count("run-id: run"), 1)

    def stop_at_preflight(self):
        with patch.object(self.chain, "preflight", side_effect=e.RpcError("HTTP 403")):
            with self.assertRaisesRegex(e.RpcError, "HTTP 403"):
                self.execute()
        return e.read_checkpoint(self.run)

    def test_resume_clean_preflight_failure_reuses_run_and_salt_once(self):
        initial = self.stop_at_preflight()
        (self.run / ".lock").touch()
        self.assertEqual(self.chain.sent, [])
        with patch.object(self.chain, "prepare", wraps=self.chain.prepare) as prepare:
            self.execute(resume=True)
            self.execute(resume=True)
        prepare.assert_called_once()
        final = e.read_checkpoint(self.run)
        for key in ("run_id", "salt", "batch_id"):
            self.assertEqual(final[key], initial[key])
        self.assertEqual(self.chain.sent, ["upload", "deploy", "fund", "settle"])
        self.assertEqual(self.handoff.read_text().count("run-id: run"), 1)

    def test_empty_transactions_with_extra_evidence_cannot_restart(self):
        self.stop_at_preflight()
        evidence = self.run / "deploy.rpc.json"
        evidence.write_text('{"status":"PENDING"}')
        with self.assertRaisesRegex(RuntimeError, "Deployment was not recorded"):
            self.execute(resume=True)
        self.assertEqual(evidence.read_text(), '{"status":"PENDING"}')
        self.assertEqual(self.chain.sent, [])

    def test_empty_transactions_with_contract_id_cannot_restart(self):
        initial = self.stop_at_preflight()
        initial["contract"] = self.chain.contract
        e.write_checkpoint(self.run, initial)
        with self.assertRaisesRegex(RuntimeError, "Deployment was not recorded"):
            self.execute(resume=True)
        self.assertEqual(self.chain.sent, [])

    def test_conflicting_transaction_stages_stop_before_rpc_lookup(self):
        initial = self.stop_at_preflight()
        initial["transactions"]["deploy"] = {"hash": "2" * 64, "status": "SUBMISSION_UNCERTAIN"}
        e.write_checkpoint(self.run, initial)
        with patch.object(self.chain, "lookup", side_effect=AssertionError("unexpected lookup")):
            with self.assertRaisesRegex(RuntimeError, "Conflicting transaction stages"):
                self.execute(resume=True)
        self.assertEqual(self.chain.sent, [])

    def test_resume_after_deploy(self):
        self.interrupted("deploy")
        with patch.object(self.chain, "prepare", side_effect=AssertionError("created identity")):
            self.execute(resume=True)
        self.assertEqual(self.chain.sent, ["upload", "deploy", "fund", "settle"])

    def test_resume_after_fund(self):
        self.interrupted("fund")
        self.execute(resume=True)
        self.assertEqual(self.chain.sent.count("fund"), 1)

    def test_resume_after_settlement_response_parse_failure(self):
        self.interrupted("settle")
        self.execute(resume=True)
        self.assertEqual(self.chain.sent.count("settle"), 1)
        self.assertEqual(e.read_checkpoint(self.run)["snapshots"]["settled"]["status"], "Settled")

    def test_unknown_or_failed_rpc_stops_before_another_send(self):
        self.interrupted("fund")
        self.chain.unknown = "fund"
        with self.assertRaisesRegex(RuntimeError, "NOT_FOUND"):
            self.execute(resume=True)
        with patch.object(self.chain, "lookup", side_effect=OSError("offline")):
            with self.assertRaisesRegex(OSError, "offline"):
                self.execute(resume=True)
        self.assertEqual(self.chain.sent, ["upload", "deploy", "fund"])

    def test_inconclusive_requires_explicit_override(self):
        self.chain.checks["authorization"] = "INCONCLUSIVE"
        with self.assertRaisesRegex(RuntimeError, "allow-inconclusive"):
            self.execute()
        self.assertEqual(self.chain.sent, ["upload", "deploy", "fund"])
        self.execute(resume=True, override=True)
        self.assertIn("INCONCLUSIVE", self.handoff.read_text())
        self.assertEqual(self.chain.sent.count("settle"), 1)

    def test_funded_state_without_funding_receipt_is_not_replayed(self):
        self.interrupted("deploy")
        self.chain.status = "Funded"
        with self.assertRaises(RuntimeError):
            self.execute(resume=True)
        self.assertNotIn("fund", self.chain.sent)

    def test_resume_after_upload_reconciles_then_deploys_once(self):
        self.interrupted("upload")
        with patch.object(self.chain, "prepare", side_effect=AssertionError("created identity")):
            self.execute(resume=True)
            self.execute(resume=True)
        self.assertEqual(self.chain.sent, ["upload", "deploy", "fund", "settle"])

    def test_unsigned_upload_xdr_does_not_count_as_submission(self):
        self.stop_at_preflight()
        (self.run / "build-upload.stdout.txt").write_text("unsigned XDR")
        with self.assertRaisesRegex(RuntimeError, "Deployment was not recorded"):
            self.execute(resume=True)
        self.assertEqual(self.chain.sent, [])

    def test_deployment_build_error_keeps_upload_receipt_without_deploy_hash(self):
        original = self.chain.build

        def broken(stage, data):
            if stage == "deploy":
                raise e.CliError("bad constructor parameters")
            return original(stage, data)

        with patch.object(self.chain, "build", side_effect=broken):
            with self.assertRaisesRegex(e.CliError, "bad constructor"):
                self.execute()
        checkpoint = e.read_checkpoint(self.run)
        self.assertEqual(set(checkpoint["transactions"]), {"upload"})
        self.assertEqual(checkpoint["transactions"]["upload"]["status"], "SUCCESS")
        self.execute(resume=True)
        self.assertEqual(self.chain.sent, ["upload", "deploy", "fund", "settle"])

    def test_no_deploy_if_predicted_contract_already_exists(self):
        self.interrupted("upload")
        with patch.object(self.chain, "verify_deployable", side_effect=RuntimeError("contract already exists")):
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                self.execute(resume=True)
        self.assertEqual(self.chain.sent, ["upload"])

    def test_unconfirmed_upload_cannot_unlock_deployment(self):
        self.interrupted("upload")
        self.chain.unknown = "upload"
        with patch.object(self.chain, "verify_deployable", side_effect=AssertionError("unexpected deploy check")):
            with self.assertRaisesRegex(RuntimeError, "NOT_FOUND"):
                self.execute(resume=True)
        self.assertEqual(self.chain.sent, ["upload"])

    def test_deployment_evidence_without_hash_blocks_resume(self):
        self.interrupted("upload")
        (self.run / "deploy.rpc.json").write_text('{"status":"PENDING"}')
        with self.assertRaisesRegex(RuntimeError, "evidence exists"):
            self.execute(resume=True)
        self.assertEqual(self.chain.sent, ["upload"])

    def test_definitive_negative_failure_cannot_be_overridden(self):
        self.chain.checks["authorization"] = "FAIL"
        with self.assertRaisesRegex(RuntimeError, "unexpectedly succeeded"):
            self.execute(override=True)
        self.assertNotIn("settle", self.chain.sent)


class HttpTests(unittest.TestCase):
    def test_shared_client_identifies_application_and_only_posts_json_content_type(self):
        with patch.object(e, "urlopen", side_effect=[
            StringIO('{"result":{"passphrase":"Test SDF Network ; September 2015"}}'),
            StringIO('{"balances":[]}'),
        ]) as urlopen:
            self.assertEqual(e.rpc("getNetwork")["passphrase"], e.PASSPHRASE)
            self.assertEqual(e.account("example"), {"balances": []})
        post, get = (call.args[0] for call in urlopen.call_args_list)
        for request in (post, get):
            self.assertEqual(request.get_header("User-agent"), "StellarRelief-E2E/1.0")
            self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertEqual(post.get_method(), "POST")
        self.assertEqual(post.get_header("Content-type"), "application/json")
        self.assertEqual(json.loads(post.data)["method"], "getNetwork")
        self.assertEqual(get.get_method(), "GET")
        self.assertIsNone(get.get_header("Content-type"))


class AuthorizationTests(unittest.TestCase):
    def test_generic_unauthorized_or_malformed_response_is_inconclusive(self):
        diagnostic = r"Error\(Auth,\s*InvalidAction\)"
        self.assertEqual(e.classify({"latestLedger": 42, "error": "HTTP 401 unauthorized"}, diagnostic)
                         ["status"], "INCONCLUSIVE")
        chain = e.Testnet(Path("."))
        self.assertEqual(chain.checked(lambda: e.classify({"results": [None]}, diagnostic))
                         ["status"], "INCONCLUSIVE")
        self.assertEqual(e.classify({"latestLedger": 42, "error": "HostError: Error(Auth, InvalidAction)"},
                                    diagnostic)["status"], "PASS")

    def test_actual_cli_envelope_round_trip_is_local(self):
        address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        contract = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
        call = {"contract_address": contract, "function_name": "settle_batch",
                "args": [{"u32": 1}, {"u32": 3}]}
        entry = {"credentials": "source_account",
                 "root_invocation": {"function": {"contract_fn": call}, "sub_invocations": []}}
        data = {"ext": "v0", "resources": {"footprint": {"read_only": [], "read_write": []},
                                           "instructions": 200, "disk_read_bytes": 0, "write_bytes": 0},
                "resource_fee": "1"}
        host_call = {"host_function": {"invoke_contract": call}, "auth": [entry]}
        tx = {"source_account": address, "fee": 101, "seq_num": "1", "cond": "none", "memo": "none",
              "operations": [{"source_account": None, "body": {"invoke_host_function": host_call}}],
              "ext": {"v1": data}}
        obj = {"tx": {"tx": tx, "signatures": []}}
        xdr = e.xdr_cli("tx", "encode", value=json.dumps(obj))
        self.assertEqual(json.loads(e.xdr_cli("tx", "decode", value=xdr)), obj)
        self.assertRegex(e.xdr_cli("tx", "hash", *e.NETWORK, value=xdr), r"^[0-9a-fA-F]{64}$")


class DeploymentTests(unittest.TestCase):
    agency = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
    contract = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

    def test_rpc_requires_installed_wasm_and_absent_contract_instance(self):
        chain = e.Testnet(Path("."))
        data = {"wasm_hash": e.WASM_HASH, "contract": self.contract,
                "transactions": {"upload": {"status": "SUCCESS"}}}

        def ledger_reply(method, params):
            self.assertEqual(method, "getLedgerEntries")
            code, instance = params["keys"]
            self.assertEqual(e.decoded_xdr("LedgerKey", code), {"contract_code": {"hash": e.WASM_HASH}})
            self.assertEqual(e.decoded_xdr("LedgerKey", instance)["contract_data"]["contract"], self.contract)
            return {"latestLedger": 42, "entries": entries(code, instance)}

        entries = lambda code, instance: [{"key": code, "liveUntilLedgerSeq": 43}]
        with patch.object(e, "rpc", side_effect=ledger_reply):
            chain.verify_deployable(data)
            entries = lambda code, instance: [{"key": code}, {"key": instance}]
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                chain.verify_deployable(data)

    def test_actual_cli_encodes_unsigned_deployment_with_constructor(self):
        salt = "ab" * 32
        xdr = e.deployment_envelope(self.agency, salt, e.WASM_HASH, 41)
        decoded = json.loads(e.xdr_cli("tx", "decode", value=xdr))["tx"]
        self.assertEqual(decoded["signatures"], [])
        self.assertEqual(decoded["tx"]["source_account"], self.agency)
        self.assertEqual(decoded["tx"]["seq_num"], "42")
        host = e.invocation(decoded["tx"])["host_function"]["create_contract_v2"]
        self.assertEqual(host["contract_id_preimage"]["address"], {"address": self.agency, "salt": salt})
        self.assertEqual(host["executable"], {"wasm": e.WASM_HASH})
        self.assertEqual(host["constructor_args"], [{"address": self.agency}])

    def test_public_key_without_local_signer_stops_before_hash_or_submit(self):
        chain = e.Testnet(Path("."))
        data = {"addresses": {"agency": self.agency}, "contract": self.contract,
                "salt": "ab" * 32, "wasm_hash": e.WASM_HASH}
        unsigned = e.deployment_envelope(self.agency, data["salt"], e.WASM_HASH, 41)
        decoded = json.loads(e.xdr_cli("tx", "decode", value=unsigned))
        result = e.encoded_xdr("ScVal", {"address": self.contract})
        cli = e.xdr_cli
        commands = []

        def public_only(*args, value):
            commands.append(args[:2])
            if args[:2] == ("tx", "sign"):
                self.assertEqual(args[-2:], ("--sign-with-key", "relief-e2e-agency"))
                raise e.CliError("public key does not have a private signer")
            return cli(*args, value=value)

        with patch.object(e, "account", return_value={"account_id": self.agency, "sequence": "41"}), \
                patch.object(chain, "assemble", return_value=(decoded, [])), \
                patch.object(chain, "simulate", return_value={"latestLedger": 42, "results": [{"xdr": result}]}), \
                patch.object(e, "xdr_cli", side_effect=public_only), \
                patch.object(e, "rpc", side_effect=AssertionError("unexpected network call")):
            with self.assertRaisesRegex(e.CliError, "does not have a private signer"):
                chain.build("deploy", data)
        self.assertNotIn(("tx", "hash"), commands)


if __name__ == "__main__":
    unittest.main()
