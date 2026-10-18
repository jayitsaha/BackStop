"""MetaMask payments on a public EVM testnet.

  - BUY an agent: the user pays the treasury a small testnet fee from MetaMask; we verify the tx on-chain
    then add the agent to their account and record the purchase tx.
  - CLAIM payout: when a litigation claim is approved, the treasury sends a testnet payout to the user's
    MetaMask address — a real on-chain settlement.

The treasury is the same wallet that anchors agents (CHAIN_* in .env). All on testnet; amounts are tiny.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from api import evm_anchor, firebase

router = APIRouter()

AGENT_PRICE_WEI = 200_000_000_000_000        # 0.0002 ETH flat testnet price per agent
MAX_PAYOUT_ETH = 0.001                       # cap any single payout (testnet, symbolic)
MIN_PAYOUT_ETH = 0.0002


@router.get("/pay/config")
def pay_config():
    """Everything the browser needs to pay: treasury address + network params for MetaMask."""
    st = evm_anchor.status()
    cid = st.get("chain_id") or 0
    return {
        "configured": st.get("configured"),
        "treasury": st.get("address"),
        "chain_id": cid,
        "chain_id_hex": hex(cid),
        "chain_name": st.get("name"),
        "rpc": st.get("rpc"),
        "explorer": st.get("explorer"),
        "agent_price_wei": str(AGENT_PRICE_WEI),
        "agent_price_eth": AGENT_PRICE_WEI / 1e18,
    }


class BuyIn(BaseModel):
    agent: str
    tx_hash: str


@router.post("/pay/buy")
def buy_agent(body: BuyIn, authorization: str = Header(None)):
    """Verify the user's MetaMask payment to the treasury, then add the agent to their account."""
    from api.main import current_user, add_agent_me, AddAgentIn, _load, _save
    u = current_user(authorization)
    treasury = evm_anchor.treasury_address()
    if not treasury:
        raise HTTPException(400, "on-chain payments not configured")
    v = evm_anchor.verify_tx(body.tx_hash, treasury, AGENT_PRICE_WEI)
    if not v.get("valid"):
        raise HTTPException(400, f"payment not valid — {v.get('reason') or 'could not verify'}")
    # one payment = one purchase (prevent replaying the same tx to buy many agents)
    txkey = (body.tx_hash or "").lower().replace("0x", "")
    if firebase.db_get(f"used_tx/{txkey}"):
        raise HTTPException(400, "that payment was already used for a purchase")
    firebase.db_put(f"used_tx/{txkey}", {"agent": body.agent, "uid": u["uid"], "at": int(time.time() * 1000)})

    # add the agent via the normal path (issues the certificate, sets active, saves)
    add_agent_me(AddAgentIn(agent=body.agent), authorization)

    # record the purchase tx on the owned-agent entry
    explorer = evm_anchor.status().get("explorer")
    purchase = {"tx_hash": body.tx_hash, "explorer_url": f"{explorer}/tx/{body.tx_hash}",
                "paid_wei": str(v.get("value_wei")), "paid_eth": v.get("value_eth"),
                "from": v.get("from"), "paid_at": int(time.time() * 1000)}
    cust = _load(u["uid"])
    for a in (cust.agents or []):
        if a.get("agent_id") == body.agent:
            a["purchase"] = purchase
    _save(u["uid"], cust)
    return {"ok": True, "purchase": purchase, "state": cust.state()}


class PayoutIn(BaseModel):
    case_id: str
    to_address: str


@router.post("/pay/claim-payout")
def claim_payout(body: PayoutIn, authorization: str = Header(None)):
    """Pay an approved litigation claim out to the user's MetaMask address (treasury → user, on-chain)."""
    from api.main import current_user
    u = current_user(authorization)
    case = firebase.db_get(f"litigation/{u['uid']}/{body.case_id}")
    if not case:
        raise HTTPException(404, "no such claim")
    dec = case.get("decision") or {}
    if case.get("status") != "decided" or dec.get("outcome") != "approved":
        raise HTTPException(400, "this claim isn't approved for payout")
    if case.get("payout"):
        return {"ok": True, "already_paid": True, "payout": case["payout"]}

    usd = float(dec.get("amount_usd") or 0)
    # scale the (symbolic) USD amount to a tiny testnet payout, floored + capped
    payout_eth = min(MAX_PAYOUT_ETH, max(MIN_PAYOUT_ETH, (usd / 5000.0) * MAX_PAYOUT_ETH))
    wei = int(round(payout_eth * 1e18))
    try:
        res = evm_anchor.send_payout(body.to_address, wei)
    except Exception as exc:
        raise HTTPException(400, str(exc)[:200])
    case["payout"] = {**res, "to_address": res["to"], "usd": usd}
    firebase.db_put(f"litigation/{u['uid']}/{body.case_id}", case)
    return {"ok": True, "payout": case["payout"]}
