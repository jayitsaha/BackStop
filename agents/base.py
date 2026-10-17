from __future__ import annotations

from rig.adapter import Tools


class Agent:
    """An agent reads the inbox and user requests through `tools`, acts, and must end with tools.report()."""
    name = "agent"
    version = "0.0"
    developer = "unknown"
    category = "bill_pay"

    def run(self, tools: Tools) -> None:
        raise NotImplementedError
