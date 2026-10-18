"""Public-blockchain anchoring on an EVM testnet.

Each agent's canonical fingerprint is committed as the calldata of a real on-chain transaction, so
anyone can independently verify it on a public block explorer. The tx lands in a public block in
seconds and is instantly clickable on the explorer. This complements the proof-of-work ledger and the
Bitcoin (OpenTimestamps) anchor.

Config comes from env (loaded from .env by agents.live at import):
  CHAIN_NAME, CHAIN_ID, CHAIN_RPC_URL, CHAIN_EXPLORER, CHAIN_ADDRESS, CHAIN_PRIVATE_KEY
Use a dedicated testnet key; fund it from a testnet faucet.
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
           "explorer": c["explorer"], "rpc": c["rpc"], "address": c["address"], "connected": False,
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
    # Capped at 45s to stay under the serverless function limit; the testnet usually mines in <15s.
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=45)
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


def treasury_address() -> Optional[str]:
    return _cfg()["address"] or None


def verify_tx(tx_hash: str, expect_to: str, min_value_wei: int = 0, wait: bool = True) -> dict:
    """Verify a user's MetaMask payment: confirmed, sent to our treasury, and >= the expected amount.

    By default WAITS for the tx to be mined (eth_sendTransaction returns the hash from the mempool before
    it's in a block, so a naive lookup races ahead of confirmation). Polls up to ~90s."""
    if not configured():
        return {"valid": False, "reason": "chain not configured"}
    w3, c = _w3()
    try:
        if wait:
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=45, poll_latency=3)
        else:
            receipt = w3.eth.get_transaction_receipt(tx_hash)
        tx = w3.eth.get_transaction(tx_hash)
    except Exception:
        return {"valid": False, "reason": "transaction not found or not confirmed in time — try again in a moment"}
    to = (tx.get("to") or "")
    to_ok = bool(to) and bool(expect_to) and to.lower() == expect_to.lower()
    val = int(tx.get("value") or 0)
    status_ok = receipt.get("status") == 1
    ok = to_ok and status_ok and val >= int(min_value_wei)
    reason = None
    if not to_ok:
        reason = "payment was not sent to the treasury"
    elif not status_ok:
        reason = "transaction failed on-chain"
    elif val < int(min_value_wei):
        reason = "payment amount is too low"
    return {"valid": ok, "reason": reason, "to": to, "from": tx.get("from"),
            "value_wei": val, "value_eth": round(val / 1e18, 6), "block": receipt.get("blockNumber")}


def send_payout(to_address: str, amount_wei: int) -> dict:
    """Treasury → user payout (claim settlements). Returns the tx hash + explorer URL."""
    if not configured():
        raise RuntimeError("payout wallet not configured")
    from web3 import Web3
    from eth_account import Account
    w3, c = _w3()
    acct = Account.from_key(c["key"])
    to = w3.to_checksum_address(to_address)
    amount_wei = int(amount_wei)
    if w3.eth.get_balance(acct.address) <= amount_wei + 21000 * 10 ** 9:
        raise RuntimeError("treasury has insufficient testnet balance for this payout")
    try:
        gas_price = w3.eth.gas_price
    except Exception:
        gas_price = w3.to_wei(1, "gwei")
    tx = {"from": acct.address, "to": to, "value": amount_wei,
          "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
          "chainId": c["chain_id"], "gas": 21000, "gasPrice": int(gas_price)}
    signed = acct.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction")
    tx_hash = w3.eth.send_raw_transaction(raw)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=45)
    h = tx_hash.hex()
    if not h.startswith("0x"):
        h = "0x" + h
    return {"tx_hash": h, "block_number": receipt.blockNumber, "to": to,
            "amount_wei": amount_wei, "amount_eth": round(amount_wei / 1e18, 6),
            "explorer_url": f"{c['explorer']}/tx/{h}", "chain": c["name"],
            "status": "confirmed" if receipt.status == 1 else "failed", "paid_at": int(time.time() * 1000)}
