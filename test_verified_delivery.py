"""Exercise approval and recovery without submitting any live transaction."""
import copy
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import testnet_e2e as e
from test_testnet_e2e import Fake
import verified_delivery as v

HISTORICAL = json.loads((e.PROJECT / "web/src/evidence.json").read_text())
CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
DIGEST = "12" * 32
APPROVAL = "test-verifier-signature"
HASH = "ab" * 32


class VerifiedSettlementTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        self.data = {
            "schema": 2, "verified_delivery": True, "network": e.PASSPHRASE,
            "asset": e.ASSET, "sac": e.SAC, "wasm_hash": e.WASM_HASH,
            "batch_id": e.BATCH, "contract": CONTRACT, "amount_usdc": 10,
            "addresses": HISTORICAL["roles"],
            "transactions": {"fund": {"hash": "34" * 32, "status": "SUCCESS"}},
        }
        self.order = v.order_from(self.data)
        self.chain = Mock(spec=e.Testnet)
        self.chain.lookup.return_value = {"hash": HASH, "status": "SUCCESS", "ledger": 42}
        self.tx = {
            "source_account": self.order["verifier"], "memo": "none",
            "operations": [{"source_account": None, "body": {"invoke_host_function": {
                "host_function": {"invoke_contract": v.expected_call(self.order)}, "auth": [],
            }}}],
        }

    def run_settlement(self, **kwargs):
        return v.settle(self.folder, self.chain, self.data, {"supplier": True}, {"shop": True}, **kwargs)

    def test_unapproved_or_unauthorized_signer_cannot_submit(self):
        with patch.object(v, "signing", return_value=DIGEST), patch.object(e, "xdr_cli", return_value=self.order["shop"]), \
             patch.object(v, "check_chain") as check:
            with self.assertRaisesRegex(RuntimeError, "Explicit approval"):
                self.run_settlement()
            with self.assertRaisesRegex(RuntimeError, "designated on-chain verifier"):
                self.run_settlement(alias="wrong-verifier", approved=DIGEST)
            check.assert_not_called()
        self.chain.send.assert_not_called()
        self.assertNotIn("verified_settlement", self.data)

    def test_already_settled_chain_status_blocks_signing(self):
        with patch.object(v, "signing", return_value=DIGEST), \
             patch.object(e, "xdr_cli", return_value=self.order["verifier"]) as stellar, \
             patch.object(v, "check_chain", side_effect=RuntimeError("Expected Funded on-chain, got Settled")):
            with self.assertRaisesRegex(RuntimeError, "got Settled"):
                self.run_settlement(alias="verifier", approved=DIGEST)
        stellar.assert_called_once_with("keys", "address", "verifier", value="")
        self.chain.send.assert_not_called()

    def test_submission_is_saved_before_send_and_resume_never_resubmits(self):
        def signing(command, **_):
            return {"verify": DIGEST, "sign": APPROVAL, "verify-approval": True}[command]

        def stellar(*args, value):
            return {
                ("keys", "address"): self.order["verifier"], ("tx", "sign"): "signed",
                ("tx", "hash"): HASH,
                ("tx", "decode"): json.dumps({"tx": {"tx": self.tx, "signatures": ["fixture"]}}),
            }[args[:2]]

        def interrupted(*_):
            saved = e.read_checkpoint(self.folder)["verified_settlement"]
            self.assertEqual(saved, {"hash": HASH, "digest": DIGEST, "approval": APPROVAL, "status": "SUBMISSION_UNCERTAIN"})
            raise RuntimeError("connection lost after sending")

        self.chain.send.side_effect = interrupted
        confirmed = {"status": "SUCCESS", "txHash": HASH, "ledger": 42, "envelopeXdr": "signed"}
        with patch.object(v, "signing", side_effect=signing), patch.object(e, "xdr_cli", side_effect=stellar), \
             patch.object(v, "check_chain") as check, patch.object(v, "prepare", return_value=(self.tx, "unsigned")), \
             patch.object(e, "rpc", return_value=confirmed), redirect_stdout(StringIO()):
            with self.assertRaisesRegex(RuntimeError, "connection lost"):
                self.run_settlement(alias="verifier", approved=DIGEST)
            self.data = e.read_checkpoint(self.folder)
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                self.run_settlement(alias="verifier", approved=DIGEST)
            check.return_value = {"status": "Settled"}
            self.assertEqual(self.run_settlement(), {"hash": HASH, "status": "SUCCESS", "ledger": 42, "batchStatus": "Settled"})
            self.assertEqual(check.call_args.args[-1], "Settled")
        self.chain.send.assert_called_once()

    def test_success_receipt_requires_designated_verifier(self):
        self.data["verified_settlement"] = {"hash": HASH, "digest": DIGEST, "approval": APPROVAL, "status": "SUBMISSION_UNCERTAIN"}
        wrong_tx = {**self.tx, "source_account": self.order["shop"]}
        with patch.object(v, "signing", return_value=DIGEST), \
             patch.object(e, "rpc", return_value={"status": "SUCCESS", "txHash": HASH, "ledger": 42, "envelopeXdr": "signed"}), \
             patch.object(e, "xdr_cli", side_effect=[HASH, json.dumps({"tx": {"tx": wrong_tx}})]):
            with self.assertRaisesRegex(RuntimeError, "designated verifier"):
                self.run_settlement()
        self.chain.send.assert_not_called()

    def test_cli_xdr_roundtrip_keeps_settlement_call(self):
        tx = {**self.tx, "fee": 100, "seq_num": "1", "ext": "v0",
              "cond": {"time": {"min_time": "0", "max_time": "2000000000"}}}
        encoded = e.xdr_cli("tx", "encode", value=json.dumps({"tx": {"tx": tx, "signatures": []}}))
        decoded = json.loads(e.xdr_cli("tx", "decode", value=encoded))["tx"]["tx"]
        self.assertEqual(decoded, tx)
        v.check_transaction(decoded, self.order)

    def test_historical_order_is_rejected_even_if_local_flags_are_edited(self):
        old = copy.deepcopy(self.data)
        old["contract"] = HISTORICAL["contractId"]
        with self.assertRaisesRegex(RuntimeError, "separate"):
            v.order_from(old)


class SetupTests(unittest.TestCase):
    def test_fund_only_resumes_after_preflight_failure_with_original_salt(self):
        with tempfile.TemporaryDirectory() as temp, redirect_stdout(StringIO()):
            folder = Path(temp)
            handoff = folder / "HANDOFF.md"
            chain = Fake()
            with patch.object(chain, "preflight", side_effect=e.RpcError("HTTP 403")):
                with self.assertRaisesRegex(e.RpcError, "HTTP 403"):
                    e.execute(folder, chain, handoff, amount_usdc=10, fund_only=True)
            salt = e.read_checkpoint(folder)["salt"]
            self.assertEqual(chain.sent, [])
            e.execute(folder, chain, handoff, resume=True, fund_only=True)
            e.execute(folder, chain, handoff, resume=True, fund_only=True)
            self.assertEqual(e.read_checkpoint(folder)["salt"], salt)
            self.assertEqual(chain.sent, ["upload", "deploy", "fund"])

    def test_fund_only_does_not_settle_and_legacy_resume_cannot_settle(self):
        with tempfile.TemporaryDirectory() as temp, redirect_stdout(StringIO()):
            folder = Path(temp)
            chain = Fake()
            e.execute(folder, chain, folder / "HANDOFF.md", amount_usdc=10, fund_only=True)
            self.assertEqual(chain.sent, ["upload", "deploy", "fund"])
            self.assertTrue(e.read_checkpoint(folder)["verified_delivery"])
            with self.assertRaisesRegex(RuntimeError, "resume funding with --fund-only"):
                e.execute(folder, chain, folder / "HANDOFF.md", resume=True)
            self.assertEqual(chain.sent, ["upload", "deploy", "fund"])
