"""Single-authority interoperability fixture; no tool effects or production policy."""

import json
import sys

active = False
evaluation = 0
for line in sys.stdin:
    message = json.loads(line)
    if message["protocol_version"] != "1":
        raise ValueError("unsupported protocol")
    response = {"protocol_version": "1", "id": message["id"]}
    if message["op"] == "inject":
        if message["authority_ref"] != "authority-1" or message["type"] not in ("GRANT", "REVOKE"):
            raise ValueError("unknown control")
        active = message["type"] == "GRANT"
        response.update(kind="ack", applied=True, type=message["type"], authority_ref="authority-1")
    elif message["op"] == "submit":
        request = message["request"]
        evaluation += 1
        allowed = active and request.get("authority_ref") == "authority-1"
        response.update(kind="decision", request_id=request["request_id"],
                        decision_id=f"decision-{evaluation}", evaluation_id=f"evaluation-{evaluation}",
                        outcome="allow" if allowed else "deny", reason="Current authority evaluated",
                        evidence={"authority_valid": active})
    else:
        raise ValueError("unknown operation")
    print(json.dumps(response), flush=True)
