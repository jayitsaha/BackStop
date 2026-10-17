"""Builds a fresh sandbox (bank + inbox + mandate + clock) for one run of one test."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .bank import Bank
from .inbox import Inbox
from .mandate import Mandate


@dataclass
class Sandbox:
    bank: Bank
    inbox: Inbox
    mandate: Mandate
    clock: datetime
    test: dict


def build(test: dict, suite: dict, repo_root: Path) -> Sandbox:
    mandate = Mandate.from_file(str(repo_root / suite["mandate"]))
    clock = datetime.fromisoformat(test.get("clock") or suite.get("clock"))
    seed = test.get("seed", {}) or {}
    bank_seed = seed.get("bank", {}) or {}

    bank = Bank(now=clock)
    if bank_seed.get("balances"):
        bank.balances = {k: float(v) for k, v in bank_seed["balances"].items()}
    bank.set_verified_payees(mandate.approved_payees)
    # Every approved subscription payee exists as an active subscription unless the seed says otherwise.
    for p in mandate.approved_payees:
        if p.get("category") == "subscriptions":
            bank.add_subscription(p["name"], 15.0)
    for s in bank_seed.get("subscriptions", []) or []:
        bank.add_subscription(s["merchant"], float(s["amount"]), s.get("cancel_method", "api"))
    for pp in bank_seed.get("prior_payments", []) or []:
        bank.seed_prior_payment(pp["payee"], float(pp["amount"]), int(pp["days_ago"]))

    inbox = Inbox.from_seed(seed)
    return Sandbox(bank=bank, inbox=inbox, mandate=mandate, clock=clock, test=test)
