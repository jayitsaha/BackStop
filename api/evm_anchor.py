"""Real public-blockchain anchoring on a free EVM testnet (Base Sepolia by default).

Each agent's canonical fingerprint is committed as the calldata of a real on-chain transaction, so
anyone can independently verify it on a public block explorer — no trusted server required. This is the
genuinely-decentralized layer (the Firebase PoW ledger is only tamper-evident notarization; Bitcoin via
OpenTimestamps is real but confirmation-delayed). Here the tx lands in a public testnet block in seconds
and is instantly clickable on Basescan.

Config comes from env (loaded from .env by agents.live at import):
  CHAIN_NAME, CHAIN_ID, CHAIN_RPC_URL, CHAIN_EXPLORER, CHAIN_ADDRESS, CHAIN_PRIVATE_KEY
The key is a throwaway testnet key (no real value); fund it from a Base Sepolia faucet.
"""
from __future__ import annotations

import os
import time
from typing import Optional

# A 7-byte marker so the calldata is self-describing on the explorer: "BKSTOP1" + <32-byte fingerprint>.
_MARKER = b"BKSTOP1"


def _cfg() -> dict:
    return {
        "name": os.environ.get("CHAIN_NAME", "Base Sepolia"),
        "chain_id": int(os.environ.get("CHAIN_ID", "84532") or 84532),
        "rpc": os.environ.get("CHAIN_RPC_URL", ""),
        "explorer": os.environ.get("CHAIN_EXPLORER", "").rstrip("/"),
        "address": os.environ.get("CHAIN_ADDRESS", ""),
        "key": os.environ.get("CHAIN_PRIVATE_KEY", ""),
    }


def configured() -> bool:
    c = _cfg()
    return bool(c["rpc"] and c["key"])


def _w3():
    from web3 import Web3  # lazy import so the app runs without web3 installed
    c = _cfg()
    return Web3(Web3.HTTPProvider(c["rpc"], request_kwargs={"timeout": 20})), c


def status() -> dict:
    """Wallet + chain status for the UI (address, balance, connectivity). Never raises."""
    c = _cfg()
    out = {"configured": configured(), "name": c["name"], "chain_id": c["chain_id"],
           "explorer": c["explorer"], "address": c["address"], "connected": False,
           "balance_eth": None, "funded": False}
    if not configured():
        out["error"] = "set CHAIN_RPC_URL + CHAIN_PRIVATE_KEY in .env"
        return out
    try:
        w3, _ = _w3()
        out["connected"] = bool(w3.is_connected())
        if out["connected"] and c["address"]:
            wei = w3.eth.get_balance(w3.to_checksum_address(c["address"]))
            eth = wei / 1e18
            out["balance_eth"] = round(eth, 6)
            out["funded"] = wei > 0
    except Exception as exc:  # pragma: no cover
        out["error"] = str(exc)[:200]
    return out


def anchor(agent_id: str, fingerprint_hex: str) -> dict:
    """Commit <fingerprint> on-chain in a real transaction. Returns the tx hash + explorer URL.

    Sends a 0-value self-transaction whose calldata is MARKER + the 32-byte fingerprint, so the explorer
    shows the exact fingerprint in the tx input. Raises RuntimeError on misconfig / no funds / tx failure.
    """
    if not configured():
        raise RuntimeError("EVM anchoring not configured (CHAIN_RPC_URL / CHAIN_PRIVATE_KEY)")
    from web3 import Web3
    from eth_account import Account

    w3, c = _w3()
    if not w3.is_connected():
        raise RuntimeError(f"cannot reach {c['name']} RPC")

    acct = Account.from_key(c["key"])
    addr = acct.address
    bal = w3.eth.get_balance(addr)
    if bal == 0:
        raise RuntimeError(
            f"anchoring wallet {addr} has 0 balance on {c['name']} — fund it from a faucet first")

    fp = (fingerprint_hex or "").lower().replace("0x", "")
    if len(fp) != 64:
        raise RuntimeError("fingerprint must be a 32-byte (64-hex) sha256")
    data = "0x" + _MARKER.hex() + fp   # calldata: "BKSTOP1" marker + the 32-byte fingerprint

    try:
        gas_price = w3.eth.gas_price
    except Exception:
        gas_price = w3.to_wei(1, "gwei")

    tx = {
        "from": addr,
        "to": addr,                     # self-send; the payload is the point, not the transfer
        "value": 0,
        "data": data,
        "nonce": w3.eth.get_transaction_count(addr, "pending"),
        "chainId": c["chain_id"],
        "gas": 60000,
        "gasPrice": int(gas_price),
    }
    signed = acct.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction")
    tx_hash = w3.eth.send_raw_transaction(raw)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    txh = tx_hash.hex()
    if not txh.startswith("0x"):
        txh = "0x" + txh
    return {
        "chain": c["name"],
        "chain_id": c["chain_id"],
        "tx_hash": txh,
        "block_number": receipt.blockNumber,
        "explorer_url": f"{c['explorer']}/tx/{txh}",
        "from": addr,
        "fingerprint": fp,
        "status": "confirmed" if receipt.status == 1 else "failed",
        "anchored_at": int(time.time() * 1000),
    }
