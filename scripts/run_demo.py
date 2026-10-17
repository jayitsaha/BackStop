"""Run the whole loop once for Sage, Quill and Dash and print what the pitch needs:
grade, score, stability band, quote, book projection, and the three demo claims.
Writes demo/results.json for the web app.

    python -m scripts.run_demo            # all 20 tests x 3 runs for 3 agents (offline, a few seconds)
    python -m scripts.run_demo --only T01_forged_bank_change
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from agents import REGISTRY
from insurance.claims import adjudicate, incident_to_test
from insurance.policy import Ledger
from insurance.pricing import load_terms, quote, book_projection, pricing_table
from kya.registry import Registry
from rig.bank import Payment
from rig.mandate import Mandate
from rig.runner import run_suite

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None, help="test ids to run")
    ap.add_argument("--agents", nargs="*", default=["Sage", "Quill", "Dash"])
    ap.add_argument("--runs", type=int, default=None)
    args = ap.parse_args()

    terms = load_terms(ROOT / "config/terms.yaml")
    registry = Registry()
    ledger = Ledger()
    out: dict = {"generated_at": datetime.now(timezone.utc).isoformat(), "pricing_table": pricing_table(terms), "agents": {}}

    print(f"\nBackstop crash test  ({'all 20 tests' if not args.only else ', '.join(args.only)}; "
          f"{args.runs or terms['runs_per_test']} runs each)\n")
    print(f"{'agent':<8}{'grade':<7}{'score':<8}{'band':<14}{'premium/payment':<17}{'status':<10}{'unstable'}")
    for name in args.agents:
        cls = REGISTRY[name]
        probe = cls()
        # 1. KYA
        dev = registry.register_developer(probe.developer, f"ops@{probe.developer.lower().replace(' ', '')}.com",
                                          f"{probe.developer.lower().replace(' ', '')}.com", document_name="incorporation.pdf")
        ident = registry.issue_agent_id(dev.developer_id, probe.name, probe.version, cls.__name__ + probe.version)
        # 2. crash test
        suite = run_suite(cls, ROOT, runs=args.runs, only=args.only)
        g = suite.grade
        # 3. quote and bind
        q = quote(g["grade"], terms)
        policy = ledger.bind(probe.name, probe.version, q)
        proj = book_projection(q, 400_000)
        band = f"{g['band'][0]:.0f}-{g['band'][1]:.0f}"
        print(f"{name:<8}{g['grade']:<7}{g['score']:<8}{band:<14}{q.cents:>5.1f}c           {q.status:<10}{len(g['unstable_tests'])}")
        failed = sorted({r.test_id for r in suite.runs if not r.score.passed})
        out["agents"][name] = {
            "identity": ident.to_dict(), "developer_verified": dev.verified, "grade": g,
            "failed_tests": failed, "quote": q.to_dict(), "book_400k_payments": proj,
            "policy": policy.to_dict(), "runs": [r.to_dict() for r in suite.runs],
        }
        if failed:
            print(f"{'':<8}failed: {', '.join(failed)}")

    # 4. the three demo claims against Sage's policy
    mandate = Mandate.from_file(ROOT / "demo/mandate.json")
    now = datetime(2026, 12, 20, 9, 30)
    prior = [Payment("pay-1", "Georgia Power", 142.18, "0912", datetime(2026, 12, 12, 9, 0), "ok", True)]
    dup = {"id": "pay-2", "payee": "Georgia Power", "amount": 142.18, "account_last4": "0912", "ts": now.isoformat()}
    forged = {"id": "pay-3", "payee": "Oak Properties", "amount": 2000.0, "account_last4": "4471", "ts": now.isoformat()}
    big = {"id": "pay-4", "payee": "Oak Properties", "amount": 2000.0, "account_last4": "2210", "ts": now.isoformat()}
    approved = {"id": "pay-5", "payee": "Kroger", "amount": 58.10, "account_last4": None, "ts": now.isoformat()}
    prior_big = prior + [Payment("pay-0", "Oak Properties", 2000.0, "2210", datetime(2026, 12, 2, 9, 0), "ok", True)]
    claims = {
        "duplicate_utility_140": adjudicate(dup, prior, mandate, terms).to_dict(),
        "forged_payee_2000": adjudicate(forged, prior, mandate, terms).to_dict(),
        "duplicate_rent_2000": adjudicate(big, prior_big, mandate, terms).to_dict(),
        "user_approved_58": adjudicate(approved, prior, mandate, terms, user_approved_payment_ids={"pay-5"}).to_dict(),
    }
    print("\nDemo claims (Sage policy):")
    for k, v in claims.items():
        print(f"  {k:<24}{v['outcome']:<24}${v['amount_usd']:<9.2f}{v['who_pays']}")
    out["claims"] = claims
    out["test_21"] = incident_to_test(dup, "Duplicate utility payment (from a paid claim)")

    print("\nPricing table:")
    for row in out["pricing_table"]:
        print(f"  {row['grade']}  1 in {row['one_in']:>6,}   pure {row['pure_cents']:>5.2f}c   gross {row['gross_cents']:>6.2f}c   {row['status']}")

    (ROOT / "demo").mkdir(exist_ok=True)
    with open(ROOT / "demo/results.json", "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nWrote demo/results.json")


if __name__ == "__main__":
    main()
