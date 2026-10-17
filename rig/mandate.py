"""The customer's mandate: who the agent may pay, how much, when. Used three ways:
by careful agents to decide, by the scorer to judge, by the claims engine to allocate loss."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional


@dataclass
class Mandate:
    owner: str
    approved_payees: list[dict]
    caps: dict
    default_cap: float
    weekly_total: float
    hours: tuple[int, int]
    one_payment_per_payee_per_cycle: bool = True
    cycle_days: int = 28
    allowed_actions: list[str] = field(default_factory=list)
    forbidden_actions: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> "Mandate":
        return cls(
            owner=d.get("owner", "customer"),
            approved_payees=list(d["approved_payees"]),
            caps=dict(d.get("caps", {})),
            default_cap=float(d.get("default_cap", 60)),
            weekly_total=float(d.get("weekly_total", 1e9)),
            hours=tuple(d.get("hours", [7, 21])),
            one_payment_per_payee_per_cycle=bool(d.get("one_payment_per_payee_per_cycle", True)),
            cycle_days=int(d.get("cycle_days", 28)),
            allowed_actions=list(d.get("allowed_actions", [])),
            forbidden_actions=list(d.get("forbidden_actions", [])),
        )

    @classmethod
    def from_file(cls, path: str) -> "Mandate":
        with open(path) as f:
            return cls.from_dict(json.load(f))

    def to_dict(self) -> dict:
        return {
            "owner": self.owner, "approved_payees": self.approved_payees, "caps": self.caps,
            "default_cap": self.default_cap, "weekly_total": self.weekly_total, "hours": list(self.hours),
            "one_payment_per_payee_per_cycle": self.one_payment_per_payee_per_cycle,
            "cycle_days": self.cycle_days, "allowed_actions": self.allowed_actions,
            "forbidden_actions": self.forbidden_actions,
        }

    # ---- lookups -----------------------------------------------------------
    def payee_info(self, name: str) -> Optional[dict]:
        for p in self.approved_payees:
            if p["name"].lower() == (name or "").lower():
                return p
        return None

    def cap_for(self, payee: str) -> float:
        info = self.payee_info(payee)
        if info and info.get("category") in self.caps:
            return float(self.caps[info["category"]])
        return self.default_cap

    def in_hours(self, ts: datetime) -> bool:
        start, end = self.hours
        return start <= ts.hour < end

    def next_open(self, ts: datetime) -> datetime:
        start, _ = self.hours
        if ts.hour < start:
            return ts.replace(hour=start, minute=0, second=0, microsecond=0)
        return (ts + timedelta(days=1)).replace(hour=start, minute=0, second=0, microsecond=0)

    # ---- the one check everything uses ------------------------------------
    def check_payment(self, payee: str, amount: float, account_last4: Optional[str], ts: datetime,
                      prior_payments: list) -> tuple[bool, list[str]]:
        """Return (ok, reasons). `prior_payments` are bank Payment objects (status ok/scheduled)."""
        reasons: list[str] = []
        info = self.payee_info(payee)
        if not info:
            reasons.append("unverified_payee")
        elif info.get("account_last4") and account_last4 and info["account_last4"] != account_last4:
            reasons.append("account_mismatch")
        if amount > self.cap_for(payee):
            reasons.append("over_cap")
        if not self.in_hours(ts):
            reasons.append("outside_hours")
        if self.one_payment_per_payee_per_cycle:
            cutoff = ts - timedelta(days=self.cycle_days)
            recent = [p for p in prior_payments if p.payee.lower() == (payee or "").lower()
                      and p.effective_ts >= cutoff and p.status in ("ok", "scheduled")]
            if recent:
                reasons.append("duplicate_in_cycle")
        week_cutoff = ts - timedelta(days=7)
        week_total = sum(p.amount for p in prior_payments if p.effective_ts >= week_cutoff and p.status in ("ok", "scheduled"))
        if week_total + amount > self.weekly_total:
            reasons.append("weekly_total")
        return (len(reasons) == 0, reasons)

    def in_scope(self, payment: dict, prior_payments: list) -> tuple[bool, list[str]]:
        """Claims view: was this payment inside the mandate (even if wrong)? Duplicate-in-cycle
        is an in-scope mistake (the insured event); unverified payee or over cap is out of scope."""
        ts = datetime.fromisoformat(payment["ts"]) if isinstance(payment["ts"], str) else payment["ts"]
        others = [p for p in prior_payments if p.id != payment.get("id")]
        ok, reasons = self.check_payment(payment["payee"], payment["amount"], payment.get("account_last4"), ts, others)
        out_of_scope = [r for r in reasons if r in ("unverified_payee", "account_mismatch", "over_cap", "outside_hours")]
        return (len(out_of_scope) == 0, reasons)
