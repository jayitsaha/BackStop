"""Fake inbox and fake web. `meta` is the machine-readable reading of a message so scripted
agents run offline; LLM agents should read `body` and ignore `meta`."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class Message:
    id: str
    channel: str            # email | sms | web | system
    sender: str
    subject: str
    body: str
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class WebPage:
    url: str
    visible: str
    hidden: str = ""
    meta: dict = field(default_factory=dict)

    def as_text(self) -> str:
        # What a scraper would hand an agent: visible text plus hidden text, undifferentiated.
        return (self.visible + "\n" + self.hidden).strip()


@dataclass
class Inbox:
    messages: list[Message] = field(default_factory=list)
    pages: dict[str, WebPage] = field(default_factory=dict)
    user_requests: list[dict] = field(default_factory=list)

    @classmethod
    def from_seed(cls, seed: dict) -> "Inbox":
        inbox = cls()
        for i, m in enumerate(seed.get("inbox", []) or [], start=1):
            inbox.messages.append(Message(
                id=f"msg-{i}", channel=m.get("channel", "email"), sender=m.get("sender", ""),
                subject=m.get("subject", ""), body=m.get("body", ""), meta=dict(m.get("meta", {}) or {}),
            ))
        for url, page in (seed.get("web", {}) or {}).items():
            inbox.pages[url] = WebPage(url, page.get("visible", ""), page.get("hidden", ""), dict(page.get("meta", {}) or {}))
        inbox.user_requests = list(seed.get("user_requests", []) or [])
        return inbox

    def open_url(self, url: str) -> Optional[WebPage]:
        return self.pages.get(url)

    # ---- persistence -------------------------------------------------------
    def to_state(self) -> dict:
        return {
            "messages": [m.to_dict() for m in self.messages],
            "user_requests": list(self.user_requests),
            "pages": {url: {"visible": p.visible, "hidden": p.hidden, "meta": p.meta} for url, p in self.pages.items()},
        }

    @classmethod
    def from_state(cls, s: dict) -> "Inbox":
        inbox = cls()
        for m in s.get("messages") or []:
            inbox.messages.append(Message(id=m["id"], channel=m.get("channel", "email"), sender=m.get("sender", ""),
                                          subject=m.get("subject", ""), body=m.get("body", ""), meta=dict(m.get("meta", {}) or {})))
        inbox.user_requests = list(s.get("user_requests") or [])
        for url, p in (s.get("pages") or {}).items():
            inbox.pages[url] = WebPage(url, p.get("visible", ""), p.get("hidden", ""), dict(p.get("meta", {}) or {}))
        return inbox
