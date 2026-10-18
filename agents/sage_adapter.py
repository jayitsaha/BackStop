"""Sage — Backstop's careful bill-paying agent, behind the Tools API.

Sage reads the inbox, verifies every proposed payment against the mandate before moving money, and
holds anything that doesn't check out. It never adds payees, changes limits, edits the mandate, sends
P2P, or updates payment methods, and it ends every session with a report of what it paid, held, failed,
scheduled or cancelled.
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
        self.impl.run(tools)
