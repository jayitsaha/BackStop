"""Stateful customer accounts — the real product layer.

A customer connects a bank, sets a mandate, and adds an agent. When they run the agent,
it executes against their own bank + inbox + mandate through the *same* real Tools adapter the crash
rig uses: it pays, holds, schedules and reports for real, and every payment accrues premium to the
agent's policy. Claims are filed against the payments the agent actually made. Nothing is scripted.
"""
from __future__ import annotations

import copy
import itertools
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Optional

from rig.adapter import Tools
from rig.bank import Bank
from rig.inbox import Inbox, Message, WebPage
from rig.mandate import Mandate
from rig.sandbox import Sandbox


@dataclass
class Customer:
    id: str
    name: str
    bank: Bank
    mandate: Mandate
    inbox: Inbox
    agent: Optional[str] = None                        # active agent id
    agent_name: Optional[str] = None
    certificate: Optional[dict] = None
    agents: list = field(default_factory=list)         # owned agents [{agent_id, agent_name, certificate, added_at}]
    runs: list = field(default_factory=list)          # [{ts, agent, log, messages, report}]
    claims: list = field(default_factory=list)         # [{payment, verdict, filed_at, test_21?}]
    frozen: list = field(default_factory=list)         # [{payee, account_last4, reason, source, at}]
    premium_collected_usd: float = 0.0
    injected: list = field(default_factory=list)       # test ids injected so far

    def state(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "agent": self.agent,
            "agent_name": self.agent_name,
            "certificate": self.certificate,
            "agents": self.agents,
            "mandate": self.mandate.to_dict(),
            "bank": self.bank.snapshot(),
            "inbox": [m.to_dict() for m in self.inbox.messages],
            "user_requests": list(self.inbox.user_requests),
            "runs": self.runs,
            "claims": self.claims,
            "frozen": self.frozen,
            "premium_collected_usd": round(self.premium_collected_usd, 4),
            "injected": self.injected,
        }

    def to_persist(self) -> dict:
        """Durable form (reconstructable) for Firebase."""
        return {
            "id": self.id,
            "name": self.name,
            "agent": self.agent,
            "agent_name": self.agent_name,
            "certificate": self.certificate,
            "agents": self.agents,
            "mandate": self.mandate.to_dict(),
            "bank": self.bank.to_state(),
            "inbox": self.inbox.to_state(),
            "runs": self.runs,
            "claims": self.claims,
            "frozen": self.frozen,
            "premium_collected_usd": round(self.premium_collected_usd, 4),
            "injected": self.injected,
        }

    @classmethod
    def from_persist(cls, d: dict) -> "Customer":
        c = cls(
            id=d["id"], name=d.get("name", "Customer"),
            bank=Bank.from_state(d.get("bank") or {}),
            mandate=Mandate.from_dict(d.get("mandate") or {}),
            inbox=Inbox.from_state(d.get("inbox") or {}),
            agent=d.get("agent"), agent_name=d.get("agent_name"), certificate=d.get("certificate"),
        )
        c.agents = d.get("agents") or []
        c.runs = d.get("runs") or []
        c.claims = d.get("claims") or []
        c.frozen = d.get("frozen") or []
        c.premium_collected_usd = float(d.get("premium_collected_usd") or 0.0)
        c.injected = d.get("injected") or []
        return c


class CustomerStore:
    def __init__(self):
        self.customers: dict[str, Customer] = {}
        self._ids = itertools.count(1)

    def create(self, name: str, mandate: Mandate, balances: Optional[dict] = None) -> Customer:
        bank = Bank()
        if balances:
            bank.balances = {k: float(v) for k, v in balances.items()}
        bank.set_verified_payees(mandate.approved_payees)
        for p in mandate.approved_payees:
            if p.get("category") == "subscriptions":
                bank.add_subscription(p["name"], 15.0)
        cid = f"cust-{next(self._ids)}"
        c = Customer(cid, name, bank, mandate, Inbox())
        self.customers[cid] = c
        return c

    def get(self, cid: str) -> Customer:
        if cid not in self.customers:
            raise KeyError(cid)
        return self.customers[cid]


def inject_test(cust: Customer, test: dict) -> dict:
    """Drop a real crash-test scenario into the customer's inbox and apply its bank seed (prior
    payments, extra subscriptions). This is exactly what the agent will face — the real attack."""
    seed = test.get("seed", {}) or {}
    bank_seed = seed.get("bank", {}) or {}
    for s in bank_seed.get("subscriptions", []) or []:
        cust.bank.add_subscription(s["merchant"], float(s["amount"]), s.get("cancel_method", "api"))
    for pp in bank_seed.get("prior_payments", []) or []:
        cust.bank.seed_prior_payment(pp["payee"], float(pp["amount"]), int(pp["days_ago"]))
    n = len(cust.inbox.messages)
    for i, m in enumerate(seed.get("inbox", []) or [], start=n + 1):
        cust.inbox.messages.append(Message(
            id=f"msg-{i}", channel=m.get("channel", "email"), sender=m.get("sender", ""),
            subject=m.get("subject", ""), body=m.get("body", ""), meta=dict(m.get("meta", {}) or {}),
        ))
    for url, page in (seed.get("web", {}) or {}).items():
        cust.inbox.pages[url] = WebPage(url, page.get("visible", ""), page.get("hidden", ""), dict(page.get("meta", {}) or {}))
    for r in seed.get("user_requests", []) or []:
        cust.inbox.user_requests.append(dict(r))
    cust.injected.append({"test_id": test["id"], "title": test.get("title"), "category": test.get("category")})
    return {"added_messages": len(seed.get("inbox", []) or []), "test_id": test["id"]}


def run_agent(cust: Customer, agent_factory: Callable, ledger, accrue_for: Optional[str],
              clock: Optional[datetime] = None, escalation_factory: Optional[Callable] = None,
              checker: Optional[Callable] = None) -> dict:
    """Run the agent against the customer's inbox — but safely. Each attempt runs on a scratch copy of the
    bank/inbox so nothing is committed until a backup checker has verified it. If the primary run is not at
    par, it re-runs on a stronger model and we commit whichever the checker scored higher. Only the chosen
    run's payments + messages are applied to the real account; premium accrues; the inbox is cleared."""
    now = clock or cust.bank.now
    pre_bank = cust.bank.to_state()
    pre_inbox = cust.inbox.to_state()
    mandate = cust.mandate
    before = len(pre_bank.get("payments") or [])
    inbox_texts = [{"channel": m.get("channel"), "sender": m.get("sender"), "subject": m.get("subject"),
                    "body": m.get("body")} for m in pre_inbox.get("messages", [])]

    def attempt(factory):
        bank = Bank.from_state(pre_bank)
        bank.now = now
        inbox = Inbox.from_state(pre_inbox)
        tools = Tools(Sandbox(bank=bank, inbox=inbox, mandate=mandate, clock=now, test={}))
        try:
            factory().run(tools)
        except Exception as e:
            tools.message_user(f"[agent error: {e}]")
        return tools, bank

    def verdict_for(tools) -> dict:
        if not checker:
            return {"at_par": True, "score": 100, "issues": [], "missed": [], "summary": "", "ok": False}
        return checker({"mandate": mandate.to_dict(), "inbox": inbox_texts,
                        "actions": [a.to_dict() for a in tools.log],
                        "messages": list(tools.messages_to_user), "report": tools.report_items or []})

    p_tools, p_bank = attempt(agent_factory)
    p_verdict = verdict_for(p_tools)
    chosen_tools, chosen_bank, chosen_verdict, escalated = p_tools, p_bank, p_verdict, False

    if checker and escalation_factory is not None and not p_verdict.get("at_par", True):
        e_tools, e_bank = attempt(escalation_factory)
        e_verdict = verdict_for(e_tools)
        from agents.verify import better, ESCALATION_MODEL  # local import keeps accounts decoupled
        if better(e_verdict, p_verdict):
            chosen_tools, chosen_bank, chosen_verdict, escalated = e_tools, e_bank, e_verdict, True

    # commit the chosen attempt to the real account
    cust.bank = chosen_bank
    new_payments = chosen_bank.payments[before:]
    accrued = 0.0
    if accrue_for and ledger is not None and accrue_for in ledger.policies:
        for p in new_payments:
            if p.status in ("ok", "scheduled"):
                try:
                    ev = ledger.accrue(accrue_for, cust.name, p.id, p.amount)
                    accrued += ev.premium_usd
                except Exception:
                    pass
    cust.premium_collected_usd += accrued

    export = chosen_tools.export()
    record = {
        "ts": now.isoformat(), "agent": cust.agent,
        "log": export["log"], "messages_to_user": export["messages_to_user"], "report": export["report"],
        "new_payment_ids": [p.id for p in new_payments], "premium_accrued_usd": round(accrued, 4),
        "verdict": chosen_verdict, "escalated": escalated,
    }
    cust.runs.append(record)
    cust.inbox.messages = []
    cust.inbox.user_requests = []
    return record


def find_payment(cust: Customer, payment_id: str) -> Optional[dict]:
    for p in cust.bank.payments:
        if p.id == payment_id:
            return p.to_dict()
    return None


def prior_payments_excluding(cust: Customer, payment_id: str) -> list:
    return [p for p in cust.bank.payments if p.id != payment_id]
