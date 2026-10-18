"""On-chain anchoring of agent identity + grade (tamper-proof provenance).

Two layers, both FREE (no wallet, no gas, no funding):

LAYER A  — a real, self-contained proof-of-work BLOCKCHAIN LEDGER stored in Firebase.
           Genesis block + one hash-linked, mined block per anchored agent. Each agent is
           bound to a canonical FINGERPRINT over its identity + graded behaviour, so a later
           silent edit to its grade / prompt / model makes verification fail.

LAYER B  — best-effort anchoring of the chain HEAD hash to the real Bitcoin blockchain via
           OpenTimestamps calendar servers (no wallet / no gas). If the client isn't installed
           or the calendars are unreachable it degrades gracefully — Layer A still fully works
           and the UI shows "Bitcoin anchoring: pending/unavailable".

Endpoints (mounted by api.main):
  POST /chain/anchor/{agent_id}  (auth)   anchor one agent -> mine a block, return the proof
  POST /chain/anchor-all         (auth)   anchor every not-yet-anchored agent -> summary
  GET  /chain                    (public) the full ledger: blocks + head + bitcoin status
  GET  /chain/proof/{agent_id}   (public) anchor + LIVE verify (recompute fingerprint now)
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time

from fastapi import APIRouter, Header, HTTPException

from api import firebase
from api import evm_anchor

router = APIRouter()

# --- proof-of-work parameters (fast: a 3-hex-zero target mines in well under a second) ---
DIFFICULTY = 3                 # required leading hex zeros on a block hash
TARGET = "0" * DIFFICULTY
MAX_NONCE = 5_000_000          # hard cap so mining can never hang
GENESIS_SEED = "backstop-genesis"


# ============================ hashing / fingerprint ============================
def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def fingerprint(rec: dict) -> str:
    """Canonical sha256 binding an agent's identity + graded behaviour.

    Over a stable, sorted JSON of the fields that define *who this agent is* and *how it was
    graded*. Changing any of them after anchoring (e.g. inflating the grade, swapping the model,
    or silently editing the system prompt) changes the fingerprint -> verification fails.
    """
    ident = rec.get("identity") or {}
    grade = rec.get("grade") or {}
    payload = {
        "id": rec.get("id"),
        "name": rec.get("name"),
        "version": rec.get("version"),
        "model": rec.get("model"),
        "code_hash": ident.get("code_hash"),
        "signature": ident.get("signature"),
        "grade": grade.get("grade"),
        "score": grade.get("score"),
        "prompt_hash": _sha(rec.get("system_prompt") or ""),
    }
    canon = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return _sha(canon)


# ============================ block mining ============================
def _block_hash(index: int, ts: int, prev: str, agent_id: str, fp: str, nonce: int) -> str:
    return _sha(f"{index}|{ts}|{prev}|{agent_id}|{fp}|{nonce}")


def _mine(index: int, ts: int, prev: str, agent_id: str, fp: str) -> tuple[int, str]:
    """Return (nonce, hash) with `DIFFICULTY` leading hex zeros. Bounded by MAX_NONCE."""
    h = _block_hash(index, ts, prev, agent_id, fp, 0)
    for nonce in range(MAX_NONCE):
        h = _block_hash(index, ts, prev, agent_id, fp, nonce)
        if h.startswith(TARGET):
            return nonce, h
    return MAX_NONCE - 1, h  # unreachable at difficulty 3, but never hang


# ============================ chain storage (Firebase) ============================
def _load_blocks() -> list[dict]:
    # Firebase RTDB returns sequential integer-keyed children as a JSON array (with possible
    # null holes), or as a dict if keys are sparse — handle both.
    raw = firebase.db_get("chain/blocks")
    if isinstance(raw, list):
        blocks = [b for b in raw if isinstance(b, dict)]
    elif isinstance(raw, dict):
        blocks = [raw[k] for k in sorted(raw, key=lambda x: int(x)) if isinstance(raw[k], dict)]
    else:
        return []
    return sorted(blocks, key=lambda b: b.get("index", 0))


def _ensure_genesis() -> dict:
    """Create (once) and return the chain head. Mines the genesis block if the chain is empty."""
    head = firebase.db_get("chain/head")
    if isinstance(head, dict) and head.get("hash"):
        return head
    ts = int(time.time() * 1000)
    fp = _sha(GENESIS_SEED)
    nonce, h = _mine(0, ts, "0" * 64, "genesis", fp)
    block = {"index": 0, "timestamp_ms": ts, "prev_hash": "0" * 64,
             "agent_id": "genesis", "fingerprint": fp, "nonce": nonce, "hash": h}
    firebase.db_put("chain/blocks/0", block)
    head = {"index": 0, "hash": h, "count": 1}
    firebase.db_put("chain/head", head)
    return head


def _anchor(rec: dict) -> dict:
    """Anchor one agent: mine + append a block, write the anchor lookup. Idempotent per agent."""
    agent_id = rec.get("id")
    if not agent_id:
        raise HTTPException(400, "agent has no id")
    existing = firebase.db_get(f"chain/anchors/{agent_id}")
    fp = fingerprint(rec)
    if isinstance(existing, dict) and existing.get("block_hash"):
        return {"agent_id": agent_id, "already_anchored": True, **existing}

    head = _ensure_genesis()
    index = int(head["index"]) + 1
    prev = head["hash"]
    ts = int(time.time() * 1000)
    nonce, h = _mine(index, ts, prev, agent_id, fp)
    block = {"index": index, "timestamp_ms": ts, "prev_hash": prev,
             "agent_id": agent_id, "fingerprint": fp, "nonce": nonce, "hash": h}
    firebase.db_put(f"chain/blocks/{index}", block)

    anchor = {"block_index": index, "block_hash": h, "fingerprint": fp,
              "tx": h, "anchored_at": ts}
    firebase.db_put(f"chain/anchors/{agent_id}", anchor)
    firebase.db_put("chain/head", {"index": index, "hash": h, "count": index + 1})
    return {"agent_id": agent_id, "already_anchored": False, **anchor}


def _verify_chain() -> dict:
    """Re-mine-check every block: valid PoW hash + intact prev_hash links."""
    blocks = _load_blocks()
    issues: list[str] = []
    prev = "0" * 64
    for b in blocks:
        h = _block_hash(b["index"], b["timestamp_ms"], b["prev_hash"],
                        b["agent_id"], b["fingerprint"], b["nonce"])
        if h != b.get("hash"):
            issues.append(f"block {b['index']} hash mismatch")
        if not str(b.get("hash", "")).startswith(TARGET):
            issues.append(f"block {b['index']} fails proof-of-work")
        if b.get("prev_hash") != prev:
            issues.append(f"block {b['index']} broken prev-hash link")
        prev = b.get("hash", "")
    return {"valid": not issues, "length": len(blocks), "issues": issues}


# ============================ LAYER B: OpenTimestamps / Bitcoin ============================
def _ots_stamp(digest_hex: str) -> dict:
    """Best-effort: timestamp the head hash on Bitcoin via OpenTimestamps calendar servers.

    Never raises. Returns a status dict either way:
      status 'pending'     -> submitted to calendars; a Bitcoin block will confirm it (hours),
                              proof stored base64 in `proof_b64`.
      status 'unavailable' -> client missing or calendars unreachable (sandbox offline, etc.).
    """
    try:
        ots_bin = os.path.join(os.path.dirname(sys.executable), "ots")
        if not os.path.exists(ots_bin):
            ots_bin = "ots"
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "head.txt")
            with open(src, "w") as fh:
                fh.write(digest_hex)
            proc = subprocess.run([ots_bin, "stamp", src],
                                  capture_output=True, text=True, timeout=40)
            ots_path = src + ".ots"
            if os.path.exists(ots_path):
                with open(ots_path, "rb") as fh:
                    raw = fh.read()
                return {
                    "status": "pending",
                    "digest": digest_hex,
                    "proof_b64": base64.b64encode(raw).decode(),
                    "stamped_at": int(time.time() * 1000),
                    "calendars": ["a.pool.opentimestamps.org", "b.pool.opentimestamps.org",
                                  "a.pool.eternitywall.com", "ots.btc.catallaxy.com"],
                    "detail": ("Head hash submitted to Bitcoin calendar servers. The proof "
                               "attaches to a Bitcoin block within a few hours (run `ots upgrade`)."),
                }
            return {"status": "unavailable", "digest": digest_hex,
                    "error": (proc.stderr or proc.stdout or "no .ots proof produced")[:300]}
    except FileNotFoundError:
        return {"status": "unavailable", "digest": digest_hex,
                "error": "opentimestamps-client not installed"}
    except Exception as exc:  # pragma: no cover  (network / sandbox)
        return {"status": "unavailable", "digest": digest_hex, "error": str(exc)[:300]}


def _stamp_head() -> dict:
    """Stamp the current head hash on Bitcoin (best-effort) and persist it on chain/head."""
    head = firebase.db_get("chain/head") or {}
    h = head.get("hash")
    if not h:
        return {"status": "unavailable", "error": "empty chain"}
    ots = _ots_stamp(h)
    try:
        firebase.db_patch("chain/head", {"ots": ots})
    except Exception:  # pragma: no cover
        pass
    return ots


# ============================ routes ============================
@router.post("/chain/anchor/{agent_id}")
def anchor_one(agent_id: str, authorization: str = Header(None)):
    from api.main import current_user, _agent_record
    current_user(authorization)
    rec = _agent_record(agent_id)
    rec.setdefault("id", agent_id)
    proof = _anchor(rec)
    bitcoin = _stamp_head()
    return {"ok": True, "anchor": proof, "bitcoin": bitcoin, "chain": _verify_chain()}


@router.post("/chain/anchor-all")
def anchor_all(authorization: str = Header(None)):
    from api.main import current_user, _all_agents
    current_user(authorization)
    agents = _all_agents()
    newly, already = [], []
    for rec in agents:
        if not rec.get("id"):
            continue
        res = _anchor(rec)
        (already if res.get("already_anchored") else newly).append(res["agent_id"])
    bitcoin = _stamp_head() if newly else (firebase.db_get("chain/head") or {}).get("ots") or {"status": "unavailable"}
    head = firebase.db_get("chain/head") or {}
    return {"ok": True, "anchored": newly, "already_anchored": already,
            "total_agents": len(agents), "head": {"index": head.get("index"), "hash": head.get("hash")},
            "bitcoin": bitcoin, "chain": _verify_chain()}


# ============================ LAYER C: real public testnet (Base Sepolia) ============================
def _anchor_evm(rec: dict) -> dict:
    """Commit an agent's fingerprint on a public EVM testnet in a real tx; persist tx/explorer on the anchor."""
    agent_id = rec.get("id")
    fp = fingerprint(rec)
    existing = firebase.db_get(f"chain/anchors/{agent_id}") or {}
    if isinstance(existing.get("evm"), dict) and existing["evm"].get("tx_hash"):
        return {"agent_id": agent_id, "already_onchain": True, **existing["evm"]}
    evm = evm_anchor.anchor(agent_id, fp)
    # ensure the local block anchor exists too (so the agent is in both layers)
    if not existing.get("block_hash"):
        _anchor(rec)
    firebase.db_patch(f"chain/anchors/{agent_id}", {"evm": evm})
    return {"agent_id": agent_id, "already_onchain": False, **evm}


@router.get("/chain/evm-status")
def evm_status():
    """Public: the on-chain anchoring wallet + testnet status (address, balance, connectivity)."""
    return evm_anchor.status()


@router.post("/chain/anchor-evm/{agent_id}")
def anchor_evm_one(agent_id: str, authorization: str = Header(None)):
    from api.main import current_user, _agent_record
    current_user(authorization)
    rec = _agent_record(agent_id)
    rec.setdefault("id", agent_id)
    try:
        return {"ok": True, "evm": _anchor_evm(rec)}
    except Exception as exc:
        raise HTTPException(400, str(exc)[:300])


@router.post("/chain/anchor-evm-all")
def anchor_evm_all(authorization: str = Header(None)):
    from api.main import current_user, _all_agents
    current_user(authorization)
    if not evm_anchor.configured():
        raise HTTPException(400, "on-chain anchoring not configured (CHAIN_RPC_URL / CHAIN_PRIVATE_KEY)")
    st = evm_anchor.status()
    if not st.get("funded"):
        raise HTTPException(400, f"anchoring wallet {st.get('address')} has no testnet funds — fund it from a faucet first")
    done, already, errors = [], [], []
    for rec in _all_agents():
        if not rec.get("id"):
            continue
        try:
            res = _anchor_evm(rec)
            (already if res.get("already_onchain") else done).append({"agent_id": res["agent_id"], "tx_hash": res.get("tx_hash"), "explorer_url": res.get("explorer_url")})
        except Exception as exc:
            errors.append({"agent_id": rec.get("id"), "error": str(exc)[:200]})
    return {"ok": True, "anchored_onchain": done, "already_onchain": already, "errors": errors, "wallet": st}


@router.get("/chain")
def get_chain():
    head = firebase.db_get("chain/head") or {}
    blocks = _load_blocks()
    anchors_raw = firebase.db_get("chain/anchors") or {}
    agents_raw = firebase.db_get("agents") or {}
    if not isinstance(agents_raw, dict):
        agents_raw = {}

    anchors = []
    for agent_id, a in (anchors_raw.items() if isinstance(anchors_raw, dict) else []):
        rec = agents_raw.get(agent_id) or {}
        grade = rec.get("grade") or {}
        anchors.append({
            "agent_id": agent_id,
            "name": rec.get("name") or agent_id,
            "developer": rec.get("developer"),
            "model": rec.get("model"),
            "category": rec.get("category"),
            "grade": grade.get("grade"),
            "score": grade.get("score"),
            "fingerprint": a.get("fingerprint"),
            "block_index": a.get("block_index"),
            "block_hash": a.get("block_hash"),
            "tx": a.get("tx"),
            "anchored_at": a.get("anchored_at"),
            "evm": a.get("evm"),
        })
    anchors.sort(key=lambda x: x.get("block_index") or 0)

    ots = head.get("ots") or {}
    return {
        "head": {"index": head.get("index"), "hash": head.get("hash"),
                 "count": head.get("count") or len(blocks)},
        "difficulty": DIFFICULTY,
        "block_count": len(blocks),
        "anchor_count": len(anchors),
        "integrity": _verify_chain(),
        "bitcoin": {"present": ots.get("status") == "pending",
                    "status": ots.get("status", "unavailable"),
                    "detail": ots.get("detail") or ots.get("error"),
                    "stamped_at": ots.get("stamped_at"),
                    "calendars": ots.get("calendars")},
        "evm": evm_anchor.status(),
        "blocks": blocks,
        "anchors": anchors,
    }


@router.get("/chain/proof/{agent_id}")
def get_proof(agent_id: str):
    anchor = firebase.db_get(f"chain/anchors/{agent_id}")
    head = firebase.db_get("chain/head") or {}
    ots = head.get("ots") or {}
    if not isinstance(anchor, dict) or not anchor.get("block_hash"):
        return {"agent_id": agent_id, "anchored": False, "untampered": None,
                "fingerprint": None, "current_fingerprint": None,
                "block_index": None, "block_hash": None,
                "ots_status": ots.get("status", "unavailable"),
                "chain": _verify_chain()}

    rec = firebase.db_get(f"agents/{agent_id}") or {}
    rec.setdefault("id", agent_id)
    current = fingerprint(rec) if rec else None
    anchored_fp = anchor.get("fingerprint")
    untampered = bool(current) and current == anchored_fp
    return {
        "agent_id": agent_id,
        "anchored": True,
        "fingerprint": anchored_fp,
        "current_fingerprint": current,
        "untampered": untampered,
        "block_index": anchor.get("block_index"),
        "block_hash": anchor.get("block_hash"),
        "tx": anchor.get("tx"),
        "anchored_at": anchor.get("anchored_at"),
        "evm": anchor.get("evm"),
        "ots_status": ots.get("status", "unavailable"),
        "chain": _verify_chain(),
    }
