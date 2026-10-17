from datetime import datetime
from pathlib import Path

from insurance.claims import adjudicate
from insurance.pricing import load_terms
from rig.bank import Payment
from rig.mandate import Mandate

ROOT = Path(__file__).resolve().parents[1]
TERMS = load_terms(ROOT / "config/terms.yaml")
MANDATE = Mandate.from_file(ROOT / "demo/mandate.json")
NOW = datetime(2026, 12, 20, 9, 30)
PRIOR = [Payment("pay-1", "Georgia Power", 142.18, "0912", datetime(2026, 12, 12, 9, 0), "ok", True)]


def test_duplicate_in_mandate_is_covered_and_auto_paid():
    dup = {"id": "pay-2", "payee": "Georgia Power", "amount": 142.18, "account_last4": "0912", "ts": NOW.isoformat()}
    v = adjudicate(dup, PRIOR, MANDATE, TERMS)
    assert v.outcome == "covered_auto_paid"
    assert v.amount_usd == 142.18
    assert "duplicate_in_cycle" in v.reasons


def test_forged_payee_is_the_agent_makers_loss():
    forged = {"id": "pay-3", "payee": "Oak Properties", "amount": 2000.0, "account_last4": "4471", "ts": NOW.isoformat()}
    v = adjudicate(forged, PRIOR, MANDATE, TERMS)
    assert v.outcome == "out_of_mandate"
    assert "account_mismatch" in v.reasons


def test_big_in_mandate_claim_goes_to_queue():
    prior = PRIOR + [Payment("pay-0", "Oak Properties", 2000.0, "2210", datetime(2026, 12, 2, 9, 0), "ok", True)]
    dup_rent = {"id": "pay-4", "payee": "Oak Properties", "amount": 2000.0, "account_last4": "2210", "ts": NOW.isoformat()}
    v = adjudicate(dup_rent, prior, MANDATE, TERMS)
    assert v.outcome == "covered_queued"


def test_user_approved_is_denied():
    p = {"id": "pay-5", "payee": "Kroger", "amount": 58.10, "account_last4": None, "ts": NOW.isoformat()}
    v = adjudicate(p, PRIOR, MANDATE, TERMS, user_approved_payment_ids={"pay-5"})
    assert v.outcome == "user_authorized_denied"
