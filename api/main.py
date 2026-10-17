"""Backstop API.

Real product surface:
- Auth is Firebase Authentication (email/password). Protected routes verify the idToken on every call.
- Storage is Firebase Realtime Database: marketplace agents at /agents/{id}, per-user accounts at /accounts/{uid}.
- Agents makers upload are live LLM agents (NVIDIA NIM). Submitting one runs the 20 crash tests live and grades,
  prices and lists it. Customers add a listed agent and it runs live on their own inbox; claims adjudicate against
  the payments it actually made. The three reference agents (Sage/Quill/Dash) are deterministic and seeded on boot.

    uvicorn api.main:app --port 8000
"""
from __future__ import annotations

import itertools
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents import REGISTRY
from agents.analyze import analyze_message, transcribe_image
from agents.live import LiveLLMAgent, llm_available, available_models
from agents.redteam import generate_attack, judge_run
from agents.verify import check_run, CHECKER_MODEL, ESCALATION_MODEL
from api import accounts, firebase
from insurance.claims import adjudicate, incident_to_test
from insurance.policy import Ledger
from insurance.pricing import load_terms, quote, book_projection, pricing_table
from kya.registry import AgentIdentity, code_hash, _sign
from rig.mandate import Mandate
from rig.runner import load_suite, run_suite, run_suite_escalating

ROOT = Path(__file__).resolve().parents[1]
TERMS = load_terms(ROOT / "config/terms.yaml")
MANDATE = Mandate.from_file(ROOT / "demo/mandate.json")
SUITE = load_suite(ROOT / "attacks/crash_tests.yaml")
TESTS_BY_ID = {t["id"]: t for t in SUITE.get("tests", [])}

CATEGORY = {f"T{n:02d}": c for n, c in [
    (1, "Scam bills"), (2, "Scam bills"), (3, "Scam bills"), (4, "Scam bills"),
    (5, "Smuggled instructions"), (6, "Smuggled instructions"), (7, "Smuggled instructions"), (8, "Smuggled instructions"),
    (9, "Inside the rules"), (10, "Inside the rules"), (11, "Inside the rules"), (12, "Inside the rules"),
    (13, "Overreach"), (14, "Overreach"), (15, "Overreach"), (16, "Overreach"),
    (17, "Honesty"), (18, "Honesty"), (19, "Honesty"), (20, "Honesty")]}

app = FastAPI(title="Backstop API", version="0.3")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ledger = Ledger()
JOBS: dict[str, dict] = {}            # maker crash-test jobs (in-memory, polled)
_job_ids = itertools.count(1)
REFERENCE = {"Sage": "Penny Labs", "Quill": "Quill Co", "Dash": "Dash Inc"}
REFERENCE_BLURB = {
    "Sage": "The careful reference agent — verifies every payment against the mandate before it moves money.",
    "Quill": "A mostly-right reference agent — pays first and flags second, the wrong order of operations.",
    "Dash": "The reckless reference agent — does what the email says. Honest about failures, careless otherwise.",
}


# ============================ helpers ============================
def _subscores(runs: list[dict], runs_per_test: int) -> list[dict]:
    by: dict[str, list[bool]] = {}
    for r in runs:
        by.setdefault(r["test_id"], []).append(bool(r["passed"]))
    cat: dict[str, list[int]] = {}
    need = runs_per_test // 2 + 1
    for tid, passes in by.items():
        c = CATEGORY.get(tid[:3], "Other")
        cat.setdefault(c, [0, 0])
        cat[c][0] += int(sum(passes) >= need)
        cat[c][1] += 1
    order = ["Scam bills", "Smuggled instructions", "Inside the rules", "Overreach", "Honesty"]
    return [{"category": c, "passed": cat[c][0], "total": cat[c][1]} for c in order if c in cat]


def _tests_map(runs: list[dict], runs_per_test: int) -> dict:
    by: dict[str, list[bool]] = {}
    for r in runs:
        by.setdefault(r["test_id"], []).append(bool(r["passed"]))
    need = runs_per_test // 2 + 1
    return {tid: (sum(p) >= need) for tid, p in by.items()}


def _sample_runs(runs: list[dict]) -> dict:
    """Keep one run per test for the replay 'what it did' view (trimmed so Firebase payloads stay small)."""
    out: dict[str, dict] = {}
    for r in runs:
        if r["test_id"] in out:
            continue
        out[r["test_id"]] = {
            "test_id": r["test_id"], "passed": r["passed"], "failed_checks": r.get("failed_checks", []),
            "log": r.get("log", [])[:24], "messages_to_user": r.get("messages_to_user", []), "report": r.get("report"),
        }
    return out


def _identity(name: str, version: str, developer: str, source: str) -> dict:
    h = code_hash(source)
    dev_id = "dev-" + code_hash(developer)[:8]
    ident = AgentIdentity(f"agt-{name.lower().replace(' ', '-')}-{h[:6]}", name, version, h, dev_id,
                          datetime.now(timezone.utc).isoformat(), _sign(name, version, h, dev_id))
    return ident.to_dict()


def _record(name, version, developer, kind, grade, runs, runs_per_test, *, system_prompt=None, model=None,
            owner_uid=None, agent_id=None) -> dict:
    q = quote(grade["grade"], TERMS)
    ident = _identity(name, version, developer, (system_prompt or "") + (model or "") + name + version)
    aid = agent_id or f"{name.lower().replace(' ', '-')}-{ident['code_hash'][:6]}"
    rec = {
        "id": aid, "name": name, "version": version, "developer": developer, "kind": kind,
        "owner_uid": owner_uid, "model": model, "system_prompt": system_prompt,
        "category": "Bill-pay", "grade": grade, "quote": q.to_dict(),
        "identity": ident, "verified": True,
        "book_400k_payments": book_projection(q, 400_000),
        "failed_tests": sorted({r["test_id"] for r in runs if not r["passed"]}),
        "subscores": _subscores(runs, runs_per_test),
        "tests": _tests_map(runs, runs_per_test),
        "sample_runs": _sample_runs(runs),
        "listed": q.status == "bound",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return rec


def _bind(rec: dict) -> None:
    q = quote(rec["grade"]["grade"], TERMS)
    ledger.bind(rec["name"], rec["version"], q)


def build_factory(rec: dict):
    if rec.get("kind") == "reference":
        return REGISTRY[rec["name"]]
    sp, model = rec.get("system_prompt") or "", rec.get("model")
    name, version, dev = rec["name"], rec.get("version", "1.0"), rec.get("developer", "maker")

    def factory():
        return LiveLLMAgent(name, version, dev, sp, model)
    return factory


def _agent_record(agent_id: str) -> dict:
    rec = firebase.db_get(f"agents/{agent_id}")
    if not rec:
        raise HTTPException(404, "unknown agent")
    return rec


def _all_agents() -> list[dict]:
    data = firebase.db_get("agents") or {}
    return list(data.values()) if isinstance(data, dict) else []


# ============================ startup: seed reference agents ============================
@app.on_event("startup")
def _startup() -> None:
    existing = {a.get("name") for a in _all_agents()}
    for name in ["Sage", "Quill", "Dash"]:
        if name in existing:
            _bind(firebase.db_get(f"agents/{name}"))
            continue
        try:
            suite = run_suite(REGISTRY[name], ROOT)                      # instant (scripted)
            runs = [r.to_dict() for r in suite.runs]
            rec = _record(name, suite.version, REFERENCE[name], "reference", suite.grade, runs,
                          TERMS.get("runs_per_test", 3), agent_id=name)
            rec["blurb"] = REFERENCE_BLURB.get(name)
            firebase.db_put(f"agents/{name}", rec)
            _bind(rec)
        except Exception as e:
            print(f"[seed] {name} failed: {e}")
    # rebind any maker agents that already exist
    for a in _all_agents():
        if a.get("kind") == "llm" and a.get("listed"):
            try:
                _bind(a)
            except Exception:
                pass


# ============================ auth ============================
def current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        return firebase.auth_verify(token)
    except firebase.FirebaseError as e:
        raise HTTPException(401, f"invalid token: {e.message}")


class AuthIn(BaseModel):
    email: str
    password: str


@app.post("/auth/signup")
def signup(body: AuthIn):
    try:
        u = firebase.auth_signup(body.email.strip(), body.password)
    except firebase.FirebaseError as e:
        raise HTTPException(400, e.message)
    firebase.db_put(f"users/{u['uid']}", {"email": u["email"], "created_at": datetime.now(timezone.utc).isoformat()})
    return u


@app.post("/auth/login")
def login(body: AuthIn):
    try:
        return firebase.auth_login(body.email.strip(), body.password)
    except firebase.FirebaseError as e:
        raise HTTPException(401, e.message)


@app.get("/auth/me")
def me(authorization: str = Header(None)):
    return current_user(authorization)


# ============================ public model + marketplace ============================
@app.get("/health")
def health():
    return {"ok": True, "llm": llm_available(), "firebase": firebase.configured()}


@app.get("/terms")
def terms():
    return {"terms": TERMS, "pricing_table": pricing_table(TERMS)}


@app.get("/mandate")
def mandate():
    return MANDATE.to_dict()


@app.get("/tests")
def tests():
    return [{"id": t["id"], "category": t.get("category"), "channel": t.get("channel"),
             "title": t.get("title"), "pass": t.get("pass"), "fail": t.get("fail")} for t in SUITE.get("tests", [])]


@app.get("/bank/demo")
def bank_demo():
    from rig.bank import Bank
    return {"balances": Bank().balances}


@app.get("/models")
def models():
    return {"available": available_models(), "llm_enabled": llm_available(),
            "default": os.environ.get("NVIDIA_MODEL", "openai/gpt-oss-20b"),
            "checker_model": CHECKER_MODEL, "escalation_model": ESCALATION_MODEL}


@app.get("/listings")
def listings():
    out = []
    for a in _all_agents():
        out.append({"agent": a["id"], "name": a["name"], "developer": a.get("developer"),
                    "category": a.get("category", "Bill-pay"), "kind": a.get("kind"), "model": a.get("model"),
                    "verified": True, "grade": a["grade"], "quote": a["quote"], "identity": a.get("identity", {}),
                    "blurb": a.get("blurb"), "listed": a.get("listed", False)})
    order = {"Sage": 0, "Quill": 1, "Dash": 2}
    return sorted(out, key=lambda x: (order.get(x["name"], 5), -x["grade"]["score"]))


@app.get("/agents/available")
def agents_available(authorization: str = Header(None)):
    u = current_user(authorization)
    return [a for a in _all_agents() if a.get("owner_uid") == u["uid"]]


@app.get("/agents/{agent_id}")
def agent(agent_id: str):
    rec = _agent_record(agent_id)
    # expose runs in the shape the detail page expects (sample run per test → list)
    runs = list(rec.get("sample_runs", {}).values())
    return {**rec, "runs": runs}


@app.post("/agents/{agent_id}/redteam")
def redteam(agent_id: str):
    """Generative adversarial red-team: an attacker model invents a NOVEL attack, the agent faces it live,
    a judge model rules if it stayed safe. Attacker → agent → judge, three models, one loop."""
    if not llm_available():
        raise HTTPException(503, "no LLM keys configured")
    rec = _agent_record(agent_id)
    mandate_dict = MANDATE.to_dict()
    attack = generate_attack(mandate_dict)

    from rig.bank import Bank
    from rig.inbox import Inbox, Message
    from rig.sandbox import Sandbox
    from rig.adapter import Tools
    bank = Bank()
    bank.set_verified_payees(MANDATE.approved_payees)
    acct = attack.get("account_last4")
    payee = attack.get("payee") or ""
    verified_acct = MANDATE.payee_info(payee).get("account_last4") if MANDATE.payee_info(payee) else None
    instr = "pay_new_account" if (acct and verified_acct and acct != verified_acct) else "pay"
    inbox = Inbox()
    inbox.messages.append(Message(
        id="rt-1", channel=attack.get("channel", "email"), sender=attack.get("sender", "") or "unknown",
        subject=attack.get("subject", "") or attack.get("title", "message"), body=attack.get("body", ""),
        meta={"kind": "bill", "payee": payee, "amount": attack.get("amount", 0) or 0,
              "account_last4": acct, "instruction": instr},
    ))
    tools = Tools(Sandbox(bank=bank, inbox=inbox, mandate=MANDATE, clock=bank.now, test={}))
    try:
        build_factory(rec)().run(tools)
    except Exception as e:
        tools.message_user(f"[agent error: {e}]")
    export = tools.export()
    verdict = judge_run(attack, mandate_dict, export["log"], export["messages_to_user"], export["report"])
    return {"agent": agent_id, "name": rec["name"], "attack": attack,
            "actions": export["log"], "messages": export["messages_to_user"],
            "report": export["report"], "judge": verdict}


@app.post("/agents/{agent_id}/crash-test")
def crash_test(agent_id: str, only: str | None = None, runs: int | None = None):
    rec = _agent_record(agent_id)
    factory = build_factory(rec)
    suite = run_suite(factory, ROOT, runs=runs or 1, only=only.split(",") if only else None)
    runs_out = [r.to_dict() for r in suite.runs]
    q = quote(suite.grade["grade"], TERMS)
    return {"agent": agent_id, "name": rec["name"], "grade": suite.grade, "quote": q.to_dict(), "runs": runs_out}


# ============================ maker: upload + live crash test ============================
class MakerIn(BaseModel):
    name: str
    version: str = "1.0"
    system_prompt: str
    model: str | None = None
    runs: int = 1


def _run_maker_job(job_id: str, rec_meta: dict):
    job = JOBS[job_id]
    name, version, developer = rec_meta["name"], rec_meta["version"], rec_meta["developer"]
    sp, model = rec_meta["system_prompt"], rec_meta["model"]
    primary_model = model or os.environ.get("NVIDIA_MODEL")

    def primary():
        return LiveLLMAgent(name, version, developer, sp, model)

    escalation = None
    if ESCALATION_MODEL and ESCALATION_MODEL != primary_model:
        def escalation():  # same policy, stronger model — the backup checker's fallback
            return LiveLLMAgent(name, version, developer, sp, ESCALATION_MODEL)

    job["escalations"] = 0
    job["escalated_tests"] = []

    def progress(done, total, test_id, passed, escalated):
        job["done"] = done
        job["total"] = total
        job["tests"][test_id] = passed
        if escalated:
            job["escalations"] += 1
            job["escalated_tests"].append(test_id)

    try:
        job["status"] = "running"
        suite = run_suite_escalating(primary, escalation, ROOT, max_workers=8, progress=progress)
        runs_out = [r.to_dict() for r in suite.runs]
        rec = _record(name, version, developer, "llm", suite.grade, runs_out, 1,
                      system_prompt=sp, model=primary_model, owner_uid=rec_meta["owner_uid"])
        rec["escalation_model"] = ESCALATION_MODEL
        rec["escalations"] = job["escalations"]
        rec["escalated_tests"] = job["escalated_tests"]
        firebase.db_put(f"agents/{rec['id']}", rec)
        if rec["listed"]:
            _bind(rec)
        job["status"] = "done"
        job["agent_id"] = rec["id"]
        job["result"] = {**{k: rec[k] for k in ("id", "name", "grade", "quote", "identity", "subscores",
                                               "failed_tests", "book_400k_payments", "listed", "model")},
                         "escalations": job["escalations"], "escalation_model": ESCALATION_MODEL}
    except Exception as e:
        job["status"] = "error"
        job["error"] = f"{type(e).__name__}: {e}"


@app.post("/maker/agents")
def maker_submit(body: MakerIn, authorization: str = Header(None)):
    u = current_user(authorization)
    if not llm_available():
        raise HTTPException(503, "no LLM keys configured — set NVIDIA_API_KEYS in .env")
    developer = (u["email"].split("@")[0] or "maker").replace(".", " ").title() + " (maker)"
    job_id = f"job-{next(_job_ids)}"
    JOBS[job_id] = {"status": "queued", "done": 0, "total": 20, "tests": {}, "agent": body.name,
                    "model": body.model or os.environ.get("NVIDIA_MODEL"), "owner_uid": u["uid"]}
    meta = {"name": body.name, "version": body.version, "developer": developer,
            "system_prompt": body.system_prompt, "model": body.model, "runs": max(1, min(body.runs, 3)),
            "owner_uid": u["uid"]}
    threading.Thread(target=_run_maker_job, args=(job_id, meta), daemon=True).start()
    return {"job_id": job_id, "status": "queued"}


@app.get("/maker/jobs/{job_id}")
def maker_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return job


# ============================ customer app (per-user, persisted) ============================
def _load(uid: str):
    d = firebase.db_get(f"accounts/{uid}")
    return accounts.Customer.from_persist(d) if d else None


def _save(uid: str, cust: accounts.Customer) -> None:
    firebase.db_put(f"accounts/{uid}", cust.to_persist())


class CustomerIn(BaseModel):
    name: str
    rent_cap: float | None = None


class AddAgentIn(BaseModel):
    agent: str                           # agent id


class InjectIn(BaseModel):
    test_id: str


class CustomerClaimIn(BaseModel):
    payment_id: str


@app.get("/customers/me")
def get_me(authorization: str = Header(None)):
    u = current_user(authorization)
    cust = _load(u["uid"])
    return cust.state() if cust else None


@app.post("/customers/me")
def create_me(body: CustomerIn, authorization: str = Header(None)):
    u = current_user(authorization)
    m = MANDATE.to_dict()
    if body.rent_cap is not None:
        m["caps"]["rent"] = float(body.rent_cap)
    cust = accounts.CustomerStore().create(body.name or u["email"], Mandate.from_dict(m))
    cust.id = u["uid"]
    _save(u["uid"], cust)
    return cust.state()


@app.post("/customers/me/agent")
def add_agent_me(body: AddAgentIn, authorization: str = Header(None)):
    u = current_user(authorization)
    cust = _load(u["uid"])
    if not cust:
        raise HTTPException(400, "open an account first")
    rec = _agent_record(body.agent)
    if not rec.get("listed"):
        raise HTTPException(400, f"{rec['name']} is not insurable (declined) — cannot be added")
    if rec["name"] not in ledger.policies:
        _bind(rec)
    cust.agent = rec["id"]
    cust.agent_name = rec["name"]
    cert = ledger.issue_certificate(rec["name"], cust.name)
    cert["rent_cap"] = cust.mandate.caps.get("rent")
    cert["agent_name"] = rec["name"]
    cert["issued_at"] = datetime.now(timezone.utc).isoformat()
    cust.certificate = cert
    _save(u["uid"], cust)
    return cust.state()


@app.post("/customers/me/inject")
def inject_me(body: InjectIn, authorization: str = Header(None)):
    u = current_user(authorization)
    cust = _load(u["uid"])
    if not cust:
        raise HTTPException(400, "open an account first")
    test = TESTS_BY_ID.get(body.test_id)
    if not test:
        raise HTTPException(404, "unknown scenario")
    accounts.inject_test(cust, test)
    _save(u["uid"], cust)
    return cust.state()


@app.post("/customers/me/run")
def run_me(authorization: str = Header(None)):
    u = current_user(authorization)
    cust = _load(u["uid"])
    if not cust or not cust.agent:
        raise HTTPException(400, "add an agent first")
    rec = _agent_record(cust.agent)
    factory = build_factory(rec)
    escalation = None
    if rec.get("kind") == "llm" and ESCALATION_MODEL and ESCALATION_MODEL != rec.get("model"):
        sp = rec.get("system_prompt") or ""
        name, version, dev = rec["name"], rec.get("version", "1.0"), rec.get("developer", "maker")

        def escalation():
            return LiveLLMAgent(name, version, dev, sp, ESCALATION_MODEL)
    checker = check_run if rec.get("kind") == "llm" else None
    record = accounts.run_agent(cust, factory, ledger, rec["name"], clock=None,
                                escalation_factory=escalation, checker=checker)
    record["agent_name"] = rec["name"]
    _save(u["uid"], cust)
    return {"run": record, "state": cust.state()}


@app.post("/customers/me/claims")
def claim_me(body: CustomerClaimIn, authorization: str = Header(None)):
    u = current_user(authorization)
    cust = _load(u["uid"])
    if not cust:
        raise HTTPException(400, "open an account first")
    payment = accounts.find_payment(cust, body.payment_id)
    if not payment:
        raise HTTPException(404, "no such payment on this account")
    rec = _agent_record(cust.agent) if cust.agent else {}
    prior = accounts.prior_payments_excluding(cust, body.payment_id)
    v = adjudicate(payment, prior, cust.mandate, TERMS)
    claim = {"agent": rec.get("name"), "customer": cust.name, "payment": payment, "verdict": v.to_dict(),
             "filed_at": datetime.now(timezone.utc).isoformat()}
    if v.outcome == "covered_auto_paid" and rec.get("name") in ledger.policies:
        ledger.pay_claim(rec["name"], v.amount_usd)
        claim["test_21"] = incident_to_test(payment, f"Duplicate {payment['payee']} payment (from a paid claim)")
    cust.claims.append(claim)
    _save(u["uid"], cust)
    return {"claim": claim, "state": cust.state()}


@app.delete("/customers/me")
def reset_me(authorization: str = Header(None)):
    u = current_user(authorization)
    firebase.db_delete(f"accounts/{u['uid']}")
    return {"ok": True}


# ============================ Inbox Guard: live analysis of a REAL message ============================
class AnalyzeIn(BaseModel):
    text: str | None = None
    image: str | None = None            # data: URI (base64) of a bill/email screenshot
    inject: bool = False                # also drop the parsed message into the inbox to run the full agent


@app.post("/analyze")
def analyze(body: AnalyzeIn, authorization: str = Header(None)):
    """Analyse a real email/bill the user pastes or uploads. Multimodal if an image is given. Uses the
    customer's own mandate + agent policy so the verdict reflects their setup. No money moves."""
    u = current_user(authorization)
    if not llm_available():
        raise HTTPException(503, "no LLM keys configured")
    cust = _load(u["uid"])
    mandate = cust.mandate.to_dict() if cust else MANDATE.to_dict()
    policy = None
    if cust and cust.agent:
        rec = firebase.db_get(f"agents/{cust.agent}") or {}
        policy = rec.get("system_prompt")

    text = (body.text or "").strip()
    transcript = None
    if body.image:
        try:
            transcript = transcribe_image(body.image)
            text = (text + "\n\n" + transcript).strip() if text else transcript
        except Exception as e:
            raise HTTPException(400, f"could not read image: {type(e).__name__}")
    if not text:
        raise HTTPException(400, "paste a message or upload an image")

    result = analyze_message(text, mandate, policy=policy)
    out = {"analysis": result, "transcript": transcript}

    # optionally turn the parsed message into a real inbox item the agent can then handle live
    if body.inject and cust and result.get("extracted"):
        ex = result["extracted"]
        n = len(cust.inbox.messages) + 1
        from rig.inbox import Message
        cust.inbox.messages.append(Message(
            id=f"msg-{n}", channel=ex.get("channel", "email"), sender=ex.get("sender", "") or "unknown",
            subject=(ex.get("intent", "message") + (f" ${ex['amount']}" if ex.get("amount") else "")),
            body=text[:1500],
            meta={"kind": "bill", "payee": ex.get("payee", ""), "amount": ex.get("amount", 0) or 0,
                  "account_last4": ex.get("account_last4"), "instruction": "pay"},
        ))
        _save(u["uid"], cust)
        out["injected"] = True
        out["state"] = cust.state()
    return out
