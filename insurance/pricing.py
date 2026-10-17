"""Grade -> frequency -> premium. The whole actuarial model is this file plus config/terms.yaml.

pure premium  = frequency x severity
gross premium = pure premium / target loss ratio
gross         = expected claims (pure) + Backstop commission + reinsurer margin
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import yaml


def load_terms(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


@dataclass
class Quote:
    grade: str
    frequency: float                # covered mistakes per payment
    severity_usd: float
    pure_premium_usd: float         # per payment
    gross_premium_usd: float        # per payment
    commission_usd: float           # Backstop's share per payment
    reinsurer_margin_usd: float     # per payment
    target_loss_ratio: float
    per_incident_limit_usd: float
    monthly_aggregate_usd: float
    status: str                     # bound | declined | suspended

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def cents(self) -> float:
        return round(self.gross_premium_usd * 100, 1)


def quote(grade: str, terms: dict) -> Quote:
    band = terms["grades"][grade]
    freq = float(band["frequency"])
    sev = float(terms["severity_usd"])
    lr = float(terms["target_loss_ratio"])
    pure = freq * sev
    gross = pure / lr
    commission = gross * float(terms["commission_share"])
    reinsurer_margin = gross - pure - commission
    if grade in terms.get("decline_grades", []):
        status = "declined"
    elif grade in terms.get("suspend_grades", []):
        status = "suspended"
    else:
        status = "bound"
    return Quote(grade, freq, sev, round(pure, 5), round(gross, 5), round(commission, 5),
                 round(reinsurer_margin, 5), lr, float(terms["per_incident_limit_usd"]),
                 float(terms["monthly_aggregate_usd"]), status)


def book_projection(q: Quote, payments_per_month: int) -> dict:
    """What a month of an agent's payments looks like to the insurer."""
    premium = q.gross_premium_usd * payments_per_month
    expected_claims = q.pure_premium_usd * payments_per_month
    return {
        "payments_per_month": payments_per_month,
        "gross_premium_usd": round(premium, 2),
        "expected_claim_count": round(q.frequency * payments_per_month, 1),
        "expected_claims_usd": round(expected_claims, 2),
        "commission_usd": round(q.commission_usd * payments_per_month, 2),
        "reinsurer_margin_usd": round(q.reinsurer_margin_usd * payments_per_month, 2),
        "loss_ratio": round(expected_claims / premium, 3) if premium else None,
    }


def pricing_table(terms: dict) -> list[dict]:
    rows = []
    for g in ["A", "B", "C", "D", "F"]:
        q = quote(g, terms)
        rows.append({"grade": g, "one_in": round(1 / q.frequency), "pure_cents": round(q.pure_premium_usd * 100, 2),
                     "gross_cents": round(q.gross_premium_usd * 100, 2), "status": q.status})
    return rows
