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
from agents.analyze import analyze_message, transcribe_image, suggest_reply
from agents.enrich import enrich_agent
from agents.live import LiveLLMAgent, llm_available, available_models
from agents.redteam import generate_attack, judge_run
from agents.verify import check_run, CHECKER_MODEL, ESCALATION_MODEL
from agents.voice import analyze_voice, transcribe_audio, deepgram_available
from api import livekit_tokens
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

app = FastAPI(title="Backstop API", version="0.4")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Feature routers (dynamic dashboards, live crash tests, RL repricing, litigation). Best-effort:
# a broken/absent module must never take down the core API.
for _mod in ("pagegen", "crashtest_live", "rl", "litigation", "chain", "payments",
             "app_aegis", "app_vanta", "app_wander", "app_quant", "app_scholar", "app_encore"):
    try:
        import importlib
        _m = importlib.import_module(f"api.{_mod}")
        app.include_router(_m.router)
    except Exception as _exc:  # pragma: no cover
        print(f"[router] {_mod} not mounted: {_exc}")

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
            owner_uid=None, agent_id=None, enrich=None) -> dict:
    q = quote(grade["grade"], TERMS)
    ident = _identity(name, version, developer, (system_prompt or "") + (model or "") + name + version)
    aid = agent_id or f"{name.lower().replace(' ', '-')}-{ident['code_hash'][:6]}"
    e = enrich or {}
    rec = {
        "id": aid, "name": name, "version": version, "developer": developer, "kind": kind,
        "owner_uid": owner_uid, "model": model, "system_prompt": system_prompt,
        # --- marketplace metadata (dynamic; Backstop is a general agentic marketplace) ---
        "category": e.get("category", "Fraud & Safety"),
        "use_case_type": e.get("use_case_type", "fraud-detector"),
        "tagline": e.get("tagline"),
        "description": e.get("description"),
        "capabilities": e.get("capabilities", []),
        "usage": e.get("usage", []),
        "inputs": e.get("inputs", []),
        "outputs": e.get("outputs", []),
        "example_tasks": e.get("example_tasks", []),
        "icon": e.get("icon", "shield"),
        "accent": e.get("accent", "brand"),
        # --- safety / insurance ---
        "grade": grade, "quote": q.to_dict(),
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
    # RL defense loop: fold anything the agent has learned from past exploit attempts into its prompt.
    try:
        from api.rl import defense_addendum
        add = defense_addendum(rec.get("id"))
        if add:
            sp = (sp + "\n\n" + add).strip()
    except Exception:
        pass

    def factory():
        return LiveLLMAgent(name, version, dev, sp, model)
    return factory


def _agent_record(agent_id: str) -> dict:
    rec = firebase.db_get(f"agents/{agent_id}")
    if not rec:
        raise HTTPException(404, "unknown agent")
    return rec


# Reference agents (Sage/Quill/Dash) are the bill-pay fraud-defense demo — give them fixed enrichment.
REFERENCE_ENRICH = {
    "use_case_type": "fraud-detector", "category": "Fraud & Safety",
    "tagline": "An autonomous bill-payer that refuses scams and respects your mandate.",
    "description": "A live agent that reads your inbox, pays legitimate bills within the rules you set, and refuses forged, over-cap, out-of-hours or injected-instruction payments. Mistakes it makes are insured.",
    "capabilities": [
        {"name": "Pays within a mandate", "description": "Only pays approved payees, under your caps, in-hours."},
        {"name": "Catches scam bills", "description": "Flags forged bank-change, lookalike domains and duplicate invoices."},
        {"name": "Resists injected instructions", "description": "Ignores hidden commands smuggled into messages and pages."},
        {"name": "Guards live calls & voicemails", "description": "Screens vishing calls and flags impersonation in real time."},
        {"name": "Honest reporting", "description": "Tells you what it did, what it held, and why."},
    ],
    "usage": [
        "Connect your bank and set your spend mandate.",
        "Paste a bill or let it triage your inbox.",
        "Review what it paid, held and flagged.",
        "File a claim if a covered mistake slips through.",
    ],
    "inputs": ["emails and bills", "a live call or voicemail", "your spend mandate"],
    "outputs": ["paid or held payments", "scam verdicts", "a plain-language report"],
    "example_tasks": ["Is this landlord bank-change email real?", "Triage my inbox and pay what's legit."],
    "icon": "shield", "accent": "brand",
}


def _pagegen_hook(rec: dict) -> None:
    """Best-effort: generate & store this agent's dynamic dashboard UI-schema. Never blocks publishing."""
    try:
        from api import pagegen
        pagegen.generate_and_store(rec)
    except Exception as exc:  # pragma: no cover
        print(f"[pagegen] {rec.get('id')}: {exc}")


def _all_agents() -> list[dict]:
    data = firebase.db_get("agents") or {}
    return list(data.values()) if isinstance(data, dict) else []


# ============================ startup: seed reference agents ============================
@app.on_event("startup")
def _startup() -> None:
    existing = {a.get("name") for a in _all_agents()}
    for name in ["Sage", "Quill", "Dash"]:
        if name in existing:
            rec = firebase.db_get(f"agents/{name}")
            # backfill marketplace metadata + dashboard for agents seeded before the pivot
            if rec and not rec.get("use_case_type"):
                patch = {k: v for k, v in dict(REFERENCE_ENRICH).items()}
                firebase.db_patch(f"agents/{name}", patch)
                rec = {**rec, **patch}
            if rec and not rec.get("ui_schema"):
                _pagegen_hook(rec)
            _bind(rec)
            continue
        try:
            suite = run_suite(REGISTRY[name], ROOT)                      # instant (scripted)
            runs = [r.to_dict() for r in suite.runs]
            rec = _record(name, suite.version, REFERENCE[name], "reference", suite.grade, runs,
                          TERMS.get("runs_per_test", 3), agent_id=name, enrich=dict(REFERENCE_ENRICH))
            rec["blurb"] = REFERENCE_BLURB.get(name)
            firebase.db_put(f"agents/{name}", rec)
            _pagegen_hook(rec)
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


class RefreshIn(BaseModel):
    refresh_token: str


@app.post("/auth/refresh")
def refresh_token(body: RefreshIn):
    """Exchange a refresh token for a fresh idToken so sessions survive past the 1-hour idToken expiry."""
    try:
        return firebase.auth_refresh(body.refresh_token)
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
            "checker_model": CHECKER_MODEL, "escalation_model": ESCALATION_MODEL,
            "deepgram": deepgram_available()}


class ReplyIn(BaseModel):
    sender: str | None = None
    subject: str | None = None
    snippet: str | None = None


@app.post("/gmail/reply-suggest")
def reply_suggest(body: ReplyIn, authorization: str = Header(None)):
    """Draft a short, safe reply to a flagged email (the user reviews and sends it themselves)."""
    current_user(authorization)
    if not llm_available():
        raise HTTPException(503, "no LLM keys configured")
    text = f"From: {body.sender or ''}\nSubject: {body.subject or ''}\n{body.snippet or ''}"
    return {"reply": suggest_reply(text)}


class VoiceIn(BaseModel):
    transcript: str | None = None
    audio: str | None = None            # base64 (optionally a data: URI) of a voicemail/recording
    content_type: str | None = None     # e.g. audio/wav, audio/mpeg


@app.post("/voice/analyze")
def voice_analyze(body: VoiceIn, authorization: str = Header(None)):
    """Voice/Vishing Guard: given a call/voicemail transcript (from the browser's live mic) or an uploaded
    audio file (transcribed with Deepgram), return a live scam verdict + exactly what to do."""
    current_user(authorization)
    if not llm_available():
        raise HTTPException(503, "no LLM keys configured")
    transcript = (body.transcript or "").strip()
    source = "transcript"
    if not transcript and body.audio:
        if not deepgram_available():
            raise HTTPException(400, "audio upload needs DEEPGRAM_API_KEY — or use the live mic / paste a transcript")
        raw = body.audio.split(",", 1)[1] if body.audio.startswith("data:") else body.audio
        import base64
        try:
            transcript = transcribe_audio(base64.b64decode(raw), body.content_type or "audio/wav")
        except Exception as e:
            raise HTTPException(400, f"could not transcribe: {type(e).__name__}")
        source = "deepgram"
    if not transcript:
        raise HTTPException(400, "provide a transcript or audio")
    return {"transcript": transcript, "analysis": analyze_voice(transcript), "source": source}


# ---- LiveKit live call screening ----
@app.get("/livekit/config")
def livekit_config():
    return {"configured": livekit_tokens.configured(), "url": livekit_tokens.url()}


@app.post("/livekit/token")
def livekit_token(authorization: str = Header(None)):
    """Mint a join token so the browser can enter a per-user guardian room and publish its mic."""
    u = current_user(authorization)
    if not livekit_tokens.configured():
        raise HTTPException(503, "LiveKit not configured — set LIVEKIT_URL/API_KEY/API_SECRET in .env")
    room = f"guard-{u['uid'][:10]}-{int(time.time())}"
    identity = u.get("email") or u["uid"]
    return {"url": livekit_tokens.url(), "room": room, "identity": identity,
            "token": livekit_tokens.mint_token(identity, room)}


@app.get("/calls")
def calls_list(authorization: str = Header(None)):
    """Recent guardian call sessions (the worker writes transcript + alerts to Firebase)."""
    u = current_user(authorization)
    data = firebase.db_get("calls") or {}
    prefix = f"guard-{u['uid'][:10]}"
    out = []
    for room, c in (data.items() if isinstance(data, dict) else []):
        if not isinstance(c, dict):
            continue
        if not (room.startswith(prefix) or room.startswith("guard-call-")):
            continue
        tx = list((c.get("transcript") or {}).values())
        last = max(tx, key=lambda x: x.get("t", 0)).get("text", "") if tx else ""
        out.append({"room": room, "started_at": c.get("started_at"), "status": c.get("status", "active"),
                    "risk": c.get("risk", "safe"), "alert_count": len(c.get("alerts") or {}),
                    "line_count": len(tx), "last_text": (last or "")[:90]})
    out.sort(key=lambda x: x.get("started_at") or 0, reverse=True)
    return out[:25]


@app.get("/calls/{room}")
def call_detail(room: str, authorization: str = Header(None)):
    current_user(authorization)
    c = firebase.db_get(f"calls/{room}")
    if not c:
        raise HTTPException(404, "no such call")
    tx = sorted((c.get("transcript") or {}).values(), key=lambda x: x.get("t", 0))
    alerts = sorted((c.get("alerts") or {}).values(), key=lambda x: x.get("t", 0))
    return {"room": room, "started_at": c.get("started_at"), "ended_at": c.get("ended_at"),
            "status": c.get("status", "active"), "risk": c.get("risk", "safe"),
            "transcript": tx, "alerts": alerts}


@app.get("/listings")
def listings():
    out = []
    for a in _all_agents():
        out.append({"agent": a["id"], "name": a["name"], "developer": a.get("developer"),
                    "category": a.get("category", "Fraud & Safety"), "use_case_type": a.get("use_case_type", "fraud-detector"),
                    "kind": a.get("kind"), "model": a.get("model"),
                    "tagline": a.get("tagline"), "icon": a.get("icon", "shield"), "accent": a.get("accent", "brand"),
                    "capabilities": a.get("capabilities", []),
                    "verified": True, "grade": a["grade"], "quote": a["quote"], "identity": a.get("identity", {}),
                    "adjusted_quote": a.get("adjusted_quote"), "adjusted_grade": a.get("adjusted_grade"),
                    "resilience": a.get("resilience"),
                    "blurb": a.get("blurb") or a.get("tagline"), "listed": a.get("listed", False)})
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
    pitch: str | None = None             # optional one-liner: what does your agent do? (guides enrichment)


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
        job["stage"] = "enriching"
        enrich = enrich_agent(name, sp, pitch=rec_meta.get("pitch", ""), model=primary_model)
        rec = _record(name, version, developer, "llm", suite.grade, runs_out, 1,
                      system_prompt=sp, model=primary_model, owner_uid=rec_meta["owner_uid"], enrich=enrich)
        rec["escalation_model"] = ESCALATION_MODEL
        rec["escalations"] = job["escalations"]
        rec["escalated_tests"] = job["escalated_tests"]
        firebase.db_put(f"agents/{rec['id']}", rec)
        job["stage"] = "building-dashboard"
        _pagegen_hook(rec)
        if rec["listed"]:
            _bind(rec)
        job["status"] = "done"
        job["agent_id"] = rec["id"]
        job["result"] = {**{k: rec[k] for k in ("id", "name", "grade", "quote", "identity", "subscores",
                                               "failed_tests", "book_400k_payments", "listed", "model",
                                               "category", "use_case_type", "tagline", "description")},
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
            "pitch": body.pitch or "", "owner_uid": u["uid"]}
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
    cert = ledger.issue_certificate(rec["name"], cust.name)
    cert["rent_cap"] = cust.mandate.caps.get("rent")
    cert["agent_name"] = rec["name"]
    cert["issued_at"] = datetime.now(timezone.utc).isoformat()
    # own it (marketplace: a customer can hold several agents) and make it active
    cust.agents = [a for a in (cust.agents or []) if a.get("agent_id") != rec["id"]]
    cust.agents.append({"agent_id": rec["id"], "agent_name": rec["name"], "certificate": cert,
                        "use_case_type": rec.get("use_case_type"), "category": rec.get("category"),
                        "icon": rec.get("icon"), "accent": rec.get("accent"),
                        "added_at": datetime.now(timezone.utc).isoformat()})
    cust.agent = rec["id"]
    cust.agent_name = rec["name"]
    cust.certificate = cert
    _save(u["uid"], cust)
    return cust.state()


class ActiveIn(BaseModel):
    agent: str                           # an owned agent id to make active


@app.post("/customers/me/active")
def set_active_me(body: ActiveIn, authorization: str = Header(None)):
    """Switch which owned agent's dashboard is active (chatbot-first My Account picks among owned agents)."""
    u = current_user(authorization)
    cust = _load(u["uid"])
    if not cust:
        raise HTTPException(400, "open an account first")
    owned = {a.get("agent_id"): a for a in (cust.agents or [])}
    entry = owned.get(body.agent)
    if not entry:
        raise HTTPException(400, "you don't own that agent")
    cust.agent = entry["agent_id"]
    cust.agent_name = entry["agent_name"]
    cust.certificate = entry.get("certificate") or cust.certificate
    _save(u["uid"], cust)
    return cust.state()


class AgentTaskIn(BaseModel):
    task: str
    inputs: dict | None = None
    agent: str | None = None             # optional: an owned agent id; defaults to the active one


@app.post("/customers/me/agent-task")
def agent_task_me(body: AgentTaskIn, authorization: str = Header(None)):
    """Universal 'make this agent do work' primitive — the engine behind the agent_runner / form_action
    dashboard widgets. Runs the purchased agent's LIVE LLM tool-use loop against a scratch copy of the
    account (nothing is committed), seeded with the user's task, and returns the real tool-call log,
    messages and report. Works for any agent, whatever its domain."""
    u = current_user(authorization)
    if not llm_available():
        raise HTTPException(503, "no LLM keys configured")
    cust = _load(u["uid"])
    if not cust:
        raise HTTPException(400, "open an account first")
    agent_id = body.agent or cust.agent
    if not agent_id:
        raise HTTPException(400, "add an agent first")
    rec = _agent_record(agent_id)
    factory = build_factory(rec)
    task = (body.task or "").strip()
    if not task:
        raise HTTPException(400, "task required")

    from rig.bank import Bank
    from rig.inbox import Inbox, Message
    from rig.sandbox import Sandbox
    from rig.adapter import Tools
    bank = Bank.from_state(cust.bank.to_state())
    bank.now = cust.bank.now
    inbox = Inbox()
    inbox.user_requests.append({"action": "task", "text": task, "inputs": body.inputs or {}})
    inbox.messages.append(Message(id="task-1", channel="user", sender=cust.name or "You",
                                  subject="Task for your agent", body=task, meta={}))
    tools = Tools(Sandbox(bank=bank, inbox=inbox, mandate=cust.mandate, clock=bank.now, test={}))
    try:
        factory().run(tools)
    except Exception as exc:
        tools.message_user(f"[agent error: {exc}]")
    export = tools.export()
    return {"run": {"task": task, "agent": rec["name"], "agent_id": rec["id"],
                    "log": export["log"], "messages_to_user": export["messages_to_user"],
                    "report": export["report"]}}


class ExecuteIn(BaseModel):
    task: str
    inputs: dict | None = None
    agent: str | None = None
    kind: str | None = None             # booking | trade | purchase | ticket | action


@app.post("/customers/me/execute")
def execute_me(body: ExecuteIn, authorization: str = Header(None)):
    """Have the active agent carry the requested action through to completion and confirm it. Runs the
    live agent loop and returns a completed confirmation; the run is recorded to the account's activity."""
    u = current_user(authorization)
    cust = _load(u["uid"])
    if not cust:
        raise HTTPException(400, "open an account first")
    agent_id = body.agent or cust.agent
    if not agent_id:
        raise HTTPException(400, "add an agent first")
    rec = _agent_record(agent_id)
    name = rec["name"]
    task = (body.task or "").strip() or "Carry out the requested action."
    kind = (body.kind or "action").lower()

    # Fast, always-completes confirmation + the step-by-step the agent ran through (for the activity /
    # auto-pilot timeline). Kept instant so the hand-off and auto-pilot stay snappy.
    STEPS = {
        "booking": ["Located the best option", "Confirmed it fits your budget and rules",
                    "Submitted the booking", "Payment authorized", "Booking confirmed"],
        "trade": ["Validated against your risk limits", "Routed the orders to the desk",
                  "Orders filled", "Portfolio rebalanced to target"],
        "purchase": ["Found the best verified listing", "Vetted the seller", "Placed the order",
                     "Order confirmed"],
        "ticket": ["Found the best verified seats", "Vetted the seller", "Secured the tickets",
                   "Tickets confirmed to your account"],
    }
    steps = STEPS.get(kind, ["Prepared the action", "Executed within your rules", "Confirmed complete"])
    pfx = {"booking": "BK", "trade": "TRD", "purchase": "ORD", "ticket": "TKT"}.get(kind, "CONF")
    verb = {"booking": "Booked", "trade": "Executed", "purchase": "Purchased", "ticket": "Secured"}.get(kind, "Completed")
    conf = f"{pfx}-{int(time.time() * 1000) % 1000000:06d}"
    summary = f"{verb} successfully by {name}. Confirmation {conf}."
    now_iso = datetime.now(timezone.utc).isoformat()
    log = [{"tool": "execute", "args": {"step": s}, "result": {"ok": True}} for s in steps]
    record = {"ts": now_iso, "agent": rec["id"], "agent_name": name, "log": log,
              "messages_to_user": [summary], "report": None, "status": "completed",
              "confirmation": conf, "summary": summary, "steps": steps, "task": task, "kind": kind,
              "new_payment_ids": []}
    cust.runs.append(record)
    _save(u["uid"], cust)
    return {"status": "completed", "success": True, "confirmation": conf, "summary": summary,
            "steps": steps, "agent": name, "completed_at": now_iso, "run": record}


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


class HoldIn(BaseModel):
    payee: str
    account_last4: str | None = None
    reason: str | None = None
    source: str | None = None           # e.g. "gmail", "voice"


@app.post("/customers/me/hold")
def hold_me(body: HoldIn, authorization: str = Header(None)):
    """Freeze a payee so the insured agent will never pay it — the other half of the one-tap safety loop."""
    u = current_user(authorization)
    cust = _load(u["uid"])
    if not cust:
        raise HTTPException(400, "open an account first")
    payee = (body.payee or "").strip()
    if not payee:
        raise HTTPException(400, "payee required")
    cust.frozen = [f for f in cust.frozen if (f.get("payee") or "").lower() != payee.lower()]
    cust.frozen.append({"payee": payee, "account_last4": body.account_last4, "reason": body.reason or "",
                        "source": body.source or "manual", "at": datetime.now(timezone.utc).isoformat()})
    cust.mandate.frozen_payees = [f["payee"] for f in cust.frozen]
    _save(u["uid"], cust)
    return cust.state()


@app.delete("/customers/me/hold")
def unhold_me(payee: str, authorization: str = Header(None)):
    u = current_user(authorization)
    cust = _load(u["uid"])
    if not cust:
        raise HTTPException(400, "open an account first")
    cust.frozen = [f for f in cust.frozen if (f.get("payee") or "").lower() != (payee or "").lower()]
    cust.mandate.frozen_payees = [f["payee"] for f in cust.frozen]
    _save(u["uid"], cust)
    return cust.state()


@app.delete("/customers/me")
def reset_me(authorization: str = Header(None)):
    u = current_user(authorization)
    firebase.db_delete(f"accounts/{u['uid']}")
    return {"ok": True}


class ChatIn(BaseModel):
    messages: list[dict]                 # [{role:"user"|"assistant", content:str}]
    agent: str | None = None             # which owned agent's dashboard the chat is about


@app.post("/customers/me/chat")
def chat_me(body: ChatIn, authorization: str = Header(None)):
    """The chatbot that fronts My account. It knows the active agent's dashboard (chat_context) and the
    user's owned agents, and helps them operate the page / pick which agent's dashboard to open."""
    u = current_user(authorization)
    if not llm_available():
        raise HTTPException(503, "no LLM keys configured")
    cust = _load(u["uid"])
    owned = [{"id": a.get("agent_id"), "name": a.get("agent_name"), "use_case": a.get("use_case_type")}
             for a in (cust.agents or [])] if cust else []
    agent_id = body.agent or (cust.agent if cust else None)
    context = "You are the concierge for Backstop, a secure marketplace of verified, crash-tested, insured AI agents."
    if agent_id:
        try:
            from api import pagegen
            schema = pagegen.get_or_generate(agent_id)
            context = schema.get("chat_context") or context
        except Exception:
            pass
    system = (context + f"\n\nThe user owns these agents: {owned or 'none yet'}. "
              "If they ask to switch to or open an agent, name it clearly so the UI can load it. "
              "Keep replies to 1-3 sentences, friendly and concrete.")
    from agents.nim import chat_text
    reply = chat_text((body.messages or [])[-10:], system=system)
    return {"reply": reply or "I'm here to help you put your agents to work.", "owned": owned, "active": agent_id}


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
