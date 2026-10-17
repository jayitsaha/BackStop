"""Sage = your FinTech Academy agent, behind the Backstop tool API.

Until the real agent is wired, Sage delegates to SageReference so the whole pipeline runs.
To wire the real one:
  1. Feed `tools.read_inbox()` to your email parser / JEV classifier.
  2. For every proposed payment call `tools.check_mandate(payee, amount, account_last4)`;
     your rules engine decides, `tools.pay(...)` executes, `tools.message_user(...)` holds.
  3. Never call add_payee / set_limit / update_mandate / send_p2p / update_payment_method.
  4. End with `tools.report([...])` listing paid, held, failed, scheduled, cancelled, could_not_cancel.
"""
from __future__ import annotations

from .base import Agent
from .scripted import SageReference
from rig.adapter import Tools


class Sage(Agent):
    name, version, developer = "Sage", "2.3", "Sage Labs"

    def __init__(self, impl: Agent | None = None):
        self.impl = impl or SageReference()

    def run(self, tools: Tools) -> None:
        # TODO: replace with the real agent (see module docstring).
        self.impl.run(tools)
