"""Master policy per agent, premium accrual per payment, aggregate tracking, suspend/requote."""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

from .pricing import Quote


@dataclass
class PremiumEvent:
    ts: str
    customer: str
    payment_id: str
    amount_paid_usd: float
    premium_usd: float


@dataclass
class Policy:
    policy_id: str
    agent: str
    version: str
    quote: Quote
    bound_at: str
    status: str = "active"                  # active | suspended | declined
    premium_events: list[PremiumEvent] = field(default_factory=list)
    claims_paid_usd: float = 0.0
    certificates: list[dict] = field(default_factory=list)

    @property
    def premium_collected_usd(self) -> float:
        return round(sum(e.premium_usd for e in self.premium_events), 4)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["quote"] = self.quote.to_dict()
        d["premium_collected_usd"] = self.premium_collected_usd
        return d


class Ledger:
    """In-memory. The reinsurer is a share of every premium event, nothing more."""

    def __init__(self):
        self.policies: dict[str, Policy] = {}
        self._ids = itertools.count(1001)

    def bind(self, agent: str, version: str, q: Quote, now: datetime | None = None) -> Policy:
        now = now or datetime.now(timezone.utc)
        status = "declined" if q.status == "declined" else ("suspended" if q.status == "suspended" else "active")
        p = Policy(f"BKS-{next(self._ids)}", agent, version, q, now.isoformat(), status)
        self.policies[agent] = p
        return p

    def issue_certificate(self, agent: str, customer: str) -> dict:
        p = self.policies[agent]
        cert = {"certificate_id": f"{p.policy_id}-{len(p.certificates) + 1:04d}", "customer": customer,
                "agent": agent, "per_incident_limit_usd": p.quote.per_incident_limit_usd,
                "premium_per_payment_usd": p.quote.gross_premium_usd, "status": p.status}
        p.certificates.append(cert)
        return cert

    def accrue(self, agent: str, customer: str, payment_id: str, amount_paid_usd: float, ts: datetime | None = None) -> PremiumEvent:
        p = self.policies[agent]
        if p.status != "active":
            raise ValueError(f"policy for {agent} is {p.status}")
        ev = PremiumEvent((ts or datetime.now(timezone.utc)).isoformat(), customer, payment_id, amount_paid_usd, p.quote.gross_premium_usd)
        p.premium_events.append(ev)
        return ev

    def pay_claim(self, agent: str, amount_usd: float) -> None:
        p = self.policies[agent]
        p.claims_paid_usd += amount_usd
        if p.claims_paid_usd >= p.quote.monthly_aggregate_usd:
            p.status = "suspended"

    def requote(self, agent: str, version: str, q: Quote) -> Policy:
        """A new version re-enters underwriting; the policy follows the new grade the same day."""
        old = self.policies[agent]
        new = self.bind(agent, version, q)
        new.premium_events = old.premium_events
        new.certificates = old.certificates
        return new
