"""Know Your Agent, the simple version: verify the developer (email domain matches the claimed
company domain, a document is on file), then issue a signed agent ID bound to a version hash.
Any change to the agent's code changes the hash, which invalidates the ID and triggers a re-test."""
from __future__ import annotations

import hashlib
import hmac
import itertools
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

SECRET = (os.environ.get("BACKSTOP_KYA_SECRET") or os.environ.get("BACKSTOP_JWT_SECRET")
          or "dev-secret-change-me").encode()


@dataclass
class Developer:
    developer_id: str
    company: str
    contact_email: str
    claimed_domain: str
    document_name: str | None
    verified: bool
    checks: dict = field(default_factory=dict)


@dataclass
class AgentIdentity:
    agent_id: str
    agent_name: str
    version: str
    code_hash: str
    developer_id: str
    issued_at: str
    signature: str
    status: str = "active"          # active | revoked

    def to_dict(self) -> dict:
        return asdict(self)


def code_hash(source: bytes | str) -> str:
    if isinstance(source, str):
        source = source.encode()
    return hashlib.sha256(source).hexdigest()[:16]


def _sign(agent_name: str, version: str, code_hash_: str, developer_id: str) -> str:
    msg = f"{agent_name}|{version}|{code_hash_}|{developer_id}".encode()
    return hmac.new(SECRET, msg, hashlib.sha256).hexdigest()[:24]


class Registry:
    def __init__(self):
        self.developers: dict[str, Developer] = {}
        self.agents: dict[str, AgentIdentity] = {}
        self._ids = itertools.count(1)

    def register_developer(self, company: str, contact_email: str, claimed_domain: str,
                           document_name: str | None = None) -> Developer:
        email_domain = contact_email.split("@")[-1].lower()
        checks = {
            "email_domain_matches": email_domain == claimed_domain.lower(),
            "document_on_file": bool(document_name),
            "not_free_mail": email_domain not in {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com"},
        }
        dev = Developer(f"dev-{next(self._ids)}", company, contact_email, claimed_domain, document_name,
                        verified=all(checks.values()), checks=checks)
        self.developers[dev.developer_id] = dev
        return dev

    def issue_agent_id(self, developer_id: str, agent_name: str, version: str, source: bytes | str) -> AgentIdentity:
        dev = self.developers[developer_id]
        if not dev.verified:
            raise PermissionError(f"developer {dev.company} is not verified: {dev.checks}")
        h = code_hash(source)
        ident = AgentIdentity(f"agt-{agent_name.lower()}-{h[:6]}", agent_name, version, h, developer_id,
                              datetime.now(timezone.utc).isoformat(), _sign(agent_name, version, h, developer_id))
        self.agents[ident.agent_id] = ident
        return ident

    def verify(self, ident: AgentIdentity, source: bytes | str | None = None) -> dict:
        expected = _sign(ident.agent_name, ident.version, ident.code_hash, ident.developer_id)
        sig_ok = hmac.compare_digest(expected, ident.signature)
        hash_ok = True if source is None else code_hash(source) == ident.code_hash
        return {"signature_valid": sig_ok, "code_unchanged": hash_ok, "status": ident.status,
                "verified": sig_ok and hash_ok and ident.status == "active"}

    def revoke(self, agent_id: str) -> None:
        self.agents[agent_id].status = "revoked"
