"""Offline tests for the fixed-size Testnet swap."""
from contextlib import redirect_stdout
from decimal import Decimal
from io import StringIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import swap_testnet_usdc as s


def wallet(usdc="0", xlm="100"):
    return {"account_id": s.AGENCY, "subentry_count": 1, "balances": [
        {"asset_type": "native", "balance": xlm},
        {"asset_code": "USDC", "asset_issuer": s.e.ISSUER, "is_authorized": True,
         "balance": usdc, "limit": "1000"},
    ]}


def route(price="13.1798534", issuer=None):
    return {"source_asset_type": "native", "source_amount": price,
            "destination_asset_type": "credit_alphanum4", "destination_asset_code": "USDC",
            "destination_asset_issuer": issuer or s.e.ISSUER, "destination_amount": "10.0000000", "path": []}


class SwapTests(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name) / "swap"

    def test_quote_rejects_over_cap_and_wrong_issuer(self):
        for bad, message in [(route("15.0000001"), "15 XLM"),
                             (route(issuer="wrong"), "No direct")]:
            with self.subTest(message=message), patch.object(s.e, "request_json",
                    return_value={"_embedded": {"records": [bad]}}):
                with self.assertRaisesRegex(RuntimeError, message):
                    s.quote()

    def test_read_only_quote_never_signs_or_writes(self):
        with patch.object(s.e, "account", return_value=wallet()), \
                patch.object(s, "quote", return_value=Decimal("13.1798534")), \
                patch.object(s, "build_signed", side_effect=AssertionError("signed in read-only mode")), \
                redirect_stdout(StringIO()):
            s.run_swap(self.folder, Decimal(".5"), execute=False)
        self.assertFalse(self.folder.exists())

    def test_already_funded_skips_quote_and_swap(self):
        with patch.object(s.e, "account", return_value=wallet("10")), \
                patch.object(s, "quote", side_effect=AssertionError("unnecessary quote")), \
                patch.object(s, "build_signed", side_effect=AssertionError("unnecessary signature")), \
                redirect_stdout(StringIO()):
            s.run_swap(self.folder, Decimal(".5"), execute=True)
        self.assertFalse((self.folder / "checkpoint.json").exists())

    def test_unknown_submission_is_reconciled_and_not_resent(self):
        with patch.object(s.e, "account", return_value=wallet()), \
                patch.object(s, "quote", return_value=Decimal("13.1798534")), \
                patch.object(s, "build_signed", return_value=("signed", "a" * 64)), \
                patch.object(s.e.Testnet, "send", side_effect=OSError("lost response")) as send, \
                patch.object(s.e.Testnet, "lookup", return_value={"status": "NOT_FOUND", "hash": "a" * 64}), \
                redirect_stdout(StringIO()):
            with self.assertRaisesRegex(OSError, "lost response"):
                s.run_swap(self.folder, Decimal(".5"), execute=True)
            with self.assertRaisesRegex(RuntimeError, "NOT_FOUND"):
                s.run_swap(self.folder, Decimal(".5"), execute=True)
            send.assert_called_once()

    def test_confirmed_swap_checks_received_balance_and_repeated_run_skips(self):
        balances = [wallet(), wallet("10")]
        with patch.object(s.e, "account", side_effect=lambda _: balances[0]), \
                patch.object(s, "quote", return_value=Decimal("13.1798534")), \
                patch.object(s, "build_signed", return_value=("signed", "a" * 64)), \
                patch.object(s.e.Testnet, "send", side_effect=lambda *args: balances.pop(0)) as send, \
                patch.object(s.e.Testnet, "lookup",
                             return_value={"status": "SUCCESS", "ledger": 42, "hash": "a" * 64}), \
                redirect_stdout(StringIO()):
            s.run_swap(self.folder, Decimal(".5"), execute=True)
            s.run_swap(self.folder, Decimal(".5"), execute=True)
        send.assert_called_once()
        self.assertEqual(s.e.read_checkpoint(self.folder)["ledger"], 42)

    def test_rejects_insufficient_xlm_and_unusable_trustline(self):
        data = wallet(xlm="16.5000000")
        with self.assertRaisesRegex(RuntimeError, "XLM above reserve"):
            s.check_funding(data, Decimal(".5"))
        data = wallet()
        data["balances"][1]["is_authorized"] = False
        with self.assertRaisesRegex(RuntimeError, "trustline"):
            s.asset_line(data)

    def test_actual_cli_checks_exact_operation_and_cap(self):
        tx = {"source_account": s.AGENCY, "fee": 100, "seq_num": "1", "cond": "none",
              "memo": "none", "operations": [s.expected_operation()], "ext": "v0"}
        unsigned = s.e.xdr_cli("tx", "encode", value=json.dumps({"tx": {"tx": tx, "signatures": []}}))
        self.assertEqual(s.verify_envelope(unsigned, signed=False), tx)
        tx["operations"][0]["body"]["path_payment_strict_receive"]["send_max"] = "150000001"
        bad = s.e.xdr_cli("tx", "encode", value=json.dumps({"tx": {"tx": tx, "signatures": []}}))
        with self.assertRaisesRegex(RuntimeError, "Unexpected"):
            s.verify_envelope(bad, signed=False)


if __name__ == "__main__":
    unittest.main()
