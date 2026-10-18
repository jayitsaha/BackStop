"""One-time LiveKit SIP setup for real inbound phone-call screening.

Bridges an actual phone call into a LiveKit room so the guardian can screen it with each party on its own
clean audio track (no speakerphone needed). You bring a phone number + SIP trunk from a telephony provider
(Twilio, Telnyx, etc.) and point its origination to LiveKit's SIP URI; this script creates the matching
LiveKit **inbound trunk** and a **dispatch rule** that routes each incoming call to its own `guard-call-*`
room. The guardian worker (scripts/call_guardian.py) auto-joins that room and screens the caller live.

    export SIP_PHONE_NUMBER=+15551234567           # the number your provider routes to LiveKit
    ./.venv-guardian/bin/python -m scripts.setup_sip

Then in your provider, set the trunk's origination/termination URI to the SIP host this script prints.

To tear it all down later (deletes the LiveKit dispatch rule + inbound trunk):

    ./.venv-guardian/bin/python -m scripts.setup_sip remove
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from livekit import api


def sip_host() -> str:
    """Derive the LiveKit Cloud SIP host from LIVEKIT_URL (confirm in the dashboard → SIP)."""
    url = os.environ.get("LIVEKIT_URL", "")
    host = url.replace("wss://", "").replace("https://", "").strip("/")
    sub = host.split(".livekit.cloud")[0]
    return f"{sub}.sip.livekit.cloud" if sub and "livekit.cloud" in host else "<your-project>.sip.livekit.cloud"


async def remove() -> None:
    """Delete the guardian dispatch rule + inbound trunk (and nothing else)."""
    lk = api.LiveKitAPI()
    try:
        rules = await lk.sip.list_dispatch_rule(api.ListSIPDispatchRuleRequest())
        for r in rules.items:
            if r.name == "backstop-guardian":
                await lk.sip.delete_dispatch_rule(api.DeleteSIPDispatchRuleRequest(sip_dispatch_rule_id=r.sip_dispatch_rule_id))
                print(f"✓ deleted dispatch rule {r.sip_dispatch_rule_id}")
        trunks = await lk.sip.list_inbound_trunk(api.ListSIPInboundTrunkRequest())
        number = os.environ.get("SIP_PHONE_NUMBER", "").strip()
        for t in trunks.items:
            if t.name == "Backstop Guardian" or (number and number in t.numbers):
                await lk.sip.delete_trunk(api.DeleteSIPTrunkRequest(sip_trunk_id=t.sip_trunk_id))
                print(f"✓ deleted inbound trunk {t.sip_trunk_id}")
        print("Done. (Remember to also release the number + trunk in your telephony provider.)")
    finally:
        await lk.aclose()


async def main() -> None:
    for k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
        if not os.environ.get(k):
            raise SystemExit(f"missing {k} in .env")
    if len(sys.argv) > 1 and sys.argv[1] == "remove":
        await remove()
        return
    number = os.environ.get("SIP_PHONE_NUMBER", "").strip()
    if not number:
        raise SystemExit("set SIP_PHONE_NUMBER (E.164, e.g. +15551234567) to the number your provider routes to LiveKit")

    lk = api.LiveKitAPI()  # reads LIVEKIT_URL/API_KEY/API_SECRET from env
    try:
        # 1) inbound trunk for the number ------------------------------------------------
        trunks = await lk.sip.list_inbound_trunk(api.ListSIPInboundTrunkRequest())
        trunk = next((t for t in trunks.items if number in t.numbers), None)
        if trunk:
            print(f"✓ inbound trunk exists: {trunk.sip_trunk_id} (numbers={list(trunk.numbers)})")
        else:
            trunk = await lk.sip.create_inbound_trunk(api.CreateSIPInboundTrunkRequest(
                trunk=api.SIPInboundTrunkInfo(name="Backstop Guardian", numbers=[number])))
            print(f"✓ created inbound trunk: {trunk.sip_trunk_id} (numbers={list(trunk.numbers)})")

        # 2) dispatch rule → one room per call, guardian auto-joins ----------------------
        rules = await lk.sip.list_dispatch_rule(api.ListSIPDispatchRuleRequest())
        rule = next((r for r in rules.items if r.name == "backstop-guardian"), None)
        if rule:
            print(f"✓ dispatch rule exists: {rule.sip_dispatch_rule_id}")
        else:
            rule = await lk.sip.create_dispatch_rule(api.CreateSIPDispatchRuleRequest(
                name="backstop-guardian",
                trunk_ids=[trunk.sip_trunk_id],
                rule=api.SIPDispatchRule(dispatch_rule_individual=api.SIPDispatchRuleIndividual(room_prefix="guard-call")),
            ))
            print(f"✓ created dispatch rule: {rule.sip_dispatch_rule_id}")

        print("\nNext: in your telephony provider (Twilio/Telnyx/…), route the number's calls to LiveKit SIP:")
        print(f"   SIP URI:  sip:{sip_host()}")
        print(f"   Number :  {number}")
        print("Keep the guardian worker running (python -m scripts.call_guardian dev).")
        print("An inbound call lands in a 'guard-call-*' room; the guardian joins and screens the caller live.")
    finally:
        await lk.aclose()


if __name__ == "__main__":
    asyncio.run(main())
