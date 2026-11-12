"""Offline tests for the Testnet trustline setup command."""
from contextlib import redirect_stdout
from decimal import Decimal
from io import StringIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import setup_usdc_trustlines as setup


def wallet(address="agency", *, balance="0", limit="1000", line=True, authorized=True, xlm="10"):
    balances = [{"asset_type": "native", "balance": xlm}]
    if line:
        balances.append({"asset_code": "USDC", "asset_issuer": setup.e.ISSUER, "balance": balance,
                         "limit": limit, "is_authorized": authorized})
    return {"account_id": address, "subentry_count": int(line), "balances": balances}


class TrustlineTests(unittest.TestCase):
    def test_distinguishes_missing_unauthorized_capacity_and_reserve(self):
        reserve = Decimal("0.5")
        for data, status in [
            (None, "MISSING_ACCOUNT"),
            (wallet(line=False), "MISSING_TRUSTLINE"),
            (wallet(authorized=False), "UNAUTHORIZED_TRUSTLINE"),
            (wallet(limit="5"), "INSUFFICIENT_LIMIT"),
            (wallet(line=False, xlm="1"), "INSUFFICIENT_XLM"),
            (wallet(), "READY"),
        ]:
            with self.subTest(status=status):
                self.assertEqual(setup.inspect("agency", "agency", data, reserve, 10).status, status)

    def test_recipient_checks_buying_liabilities_and_agency_checks_spendable(self):
        data = wallet(limit="10", balance="8")
        data["balances"][1]["buying_liabilities"] = "1"
        data["balances"][1]["selling_liabilities"] = "2"
        for role in ("agency", "wholesaler", "shop"):
            self.assertEqual(setup.inspect(role, "agency", data, Decimal(".5"), 10).status,
                             "INSUFFICIENT_LIMIT")

    def test_default_check_never_submits(self):
        addresses = {role: role for role in setup.ROLES}
        with TemporaryDirectory() as tmp, redirect_stdout(StringIO()), \
                patch.object(setup.e, "account", side_effect=lambda role: wallet(role, line=False)), \
                patch.object(setup, "build_signed", side_effect=AssertionError("dry-run tried to sign")):
            folder = Path(tmp) / "setup"
            self.assertFalse(setup.run_setup(addresses, Decimal(".5"), 10, folder, execute=False))
            self.assertFalse(folder.exists())

    def test_execute_reconciles_success_and_repeated_run_skips_all(self):
        addresses = {role: role for role in setup.ROLES}
        accounts = {role: wallet(role, line=False) for role in addresses}
        sent = []
        def send(label, envelope, tx_hash):
            sent.append(label)
            accounts[label] = wallet(label)
        with TemporaryDirectory() as tmp, redirect_stdout(StringIO()), \
                patch.object(setup.e, "account", side_effect=accounts.get), \
                patch.object(setup, "build_signed", side_effect=lambda *args: ("signed", "a" * 64)), \
                patch.object(setup.e.Testnet, "send", side_effect=send), \
                patch.object(setup.e.Testnet, "lookup", return_value={"status": "SUCCESS", "ledger": 5,
                                                                      "hash": "a" * 64}):
            folder = Path(tmp)
            self.assertTrue(setup.run_setup(addresses, Decimal(".5"), 10, folder, execute=True))
            self.assertTrue(setup.run_setup(addresses, Decimal(".5"), 10, folder, execute=True))
        self.assertEqual(sent, list(setup.ROLES))

    def test_uncertain_submission_is_not_resent(self):
        addresses = {role: role for role in setup.ROLES}
        with TemporaryDirectory() as tmp, redirect_stdout(StringIO()), \
                patch.object(setup.e, "account", side_effect=lambda role: wallet(role, line=False)), \
                patch.object(setup, "build_signed", return_value=("signed", "a" * 64)), \
                patch.object(setup.e.Testnet, "send", side_effect=OSError("lost reply")) as send, \
                patch.object(setup.e.Testnet, "lookup", return_value={"status": "NOT_FOUND", "hash": "a" * 64}):
            folder = Path(tmp)
            with self.assertRaisesRegex(OSError, "lost reply"):
                setup.run_setup(addresses, Decimal(".5"), 10, folder, execute=True)
            with self.assertRaisesRegex(RuntimeError, "NOT_FOUND"):
                setup.run_setup(addresses, Decimal(".5"), 10, folder, execute=True)
            send.assert_called_once()

    def test_local_cli_round_trip_checks_exact_asset_limit_and_source(self):
        address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        limit = 1000 * setup.e.STROOPS
        op = {"source_account": None, "body": {"change_trust": {
            "line": {"credit_alphanum4": {"asset_code": "USDC", "issuer": setup.e.ISSUER}},
            "limit": str(limit),
        }}}
        tx = {"source_account": address, "fee": 100, "seq_num": "1", "cond": "none",
              "memo": "none", "operations": [op], "ext": "v0"}
        envelope = setup.e.xdr_cli("tx", "encode", value=json.dumps({"tx": {"tx": tx, "signatures": []}}))
        self.assertEqual(setup.verify_envelope(envelope, address, limit, signed=False), tx)
        with self.assertRaisesRegex(RuntimeError, "Unexpected trustline"):
            setup.verify_envelope(envelope, address, limit + 1, signed=False)


if __name__ == "__main__":
    unittest.main()
