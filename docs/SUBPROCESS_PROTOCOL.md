# Subprocess protocol version 1

[`SubprocessAdapter`](../src/adapters/subprocess/adapter.ts) launches a command with an argument array, without a shell, and translates this protocol into generic harness types. [`reference-runtime/runtime.mjs`](../reference-runtime/runtime.mjs) is a standalone JavaScript implementation. A Python, Go or other runtime can implement the same boundary. Use `--runtime subprocess --command <executable>` with repeatable `--command-arg` and `--capability` options to connect without source registration. The fixed `subprocess-reference` profile remains available. Commands execute as local code with the invoking user's privileges, without shell interpolation.

## Framing and lifecycle

Send one JSON object per newline-terminated stdin line; return one JSON object per stdout line. Flush responses promptly. Reserve stdout for protocol responses; logs belong on stderr. The adapter captures the last 8192 characters of stderr separately (`adapter.stderr`), not in timeline evidence by default. Normal shutdown closes stdin; the child must exit cleanly with code 0. The driver must await `adapter.close()` in `finally`.

The constructor is `new SubprocessAdapter(command, args, timeoutMs = 5000)`. Each response and normal shutdown have a five-second default timeout. Malformed JSON, invalid envelopes, unknown kinds/outcomes, mismatches, duplicate/unsolicited responses and invalid payloads fail explicitly, reject pending work and terminate the child with SIGKILL. Timeouts do likewise. A process exit before requested shutdown, a nonzero exit, or an exit with pending requests is an error. Spawn/write errors also fail. `close()` rethrows a recorded failure; protocol errors never become INDETERMINATE. There is no structured error-response kind: a bridge should emit diagnostics on stderr and fail, rather than invent a governance decision.

## Envelope and correlation

Every message has string `protocol_version: "1"` and a nonempty string `id`. The adapter generates message IDs; the process echoes them exactly. Responses are matched by ID, not arrival order, so out-of-order responses can correlate correctly. This does not make control application unordered: acknowledge an injection only after its change is observable by subsequent requests. The scenario runner waits for that acknowledgement before its next submission.

Controls use `op: "inject"`, `type: "GRANT" | "REVOKE"`, and `authority_ref`. Return `kind: "ack"`, `applied: true`, and the exact type/reference. A false or mismatched acknowledgement is an error.

Submissions use `op: "submit"` and `request` containing:

- `request_id`, `principal_id`, `agent_id`, `action`, `target`;
- optional `authority_ref` and `lease_ref`;
- `provenance: {scenario_id, retry_of?}` and a `context` object.

Decisions use `kind: "decision"`, matching `request_id`, nonempty `decision_id`, `evaluation_id`, `reason`, an `evidence` object, and `outcome: "allow" | "deny"`. Optional `authority_ref`, if returned, must equal the submitted reference. Native allow maps to ALLOW; deny maps to DENY. Other outcomes throw, even though the generic TypeScript contract separately supports INDETERMINATE.

Decision and evaluation IDs must each be fresh across submissions in that adapter instance. Preserve native identifiers when available. If your runtime lacks them, a bridge may assign correlation IDs to actual newly performed evaluations/decisions and document their bridge-generated origin in evidence. This does not establish freshness by itself: do not relabel a cached permission as a new evaluation. If the bridge cannot establish a new present-time evaluation, it cannot honestly satisfy this protocol's retry experiment. The adapter checks uniqueness, not the runtime's internal computation.

## Literal JSONL transcript

Each fenced block below is one wire line. Send the request on stdin and read the corresponding response from stdout. IDs are illustrative but consistently correlated. The authority behavior is owned by the reference process; it is not prescribed production policy.

GRANT request:

```jsonl
{"protocol_version":"1","id":"message-1","op":"inject","type":"GRANT","authority_ref":"authority-1"}
```

GRANT response, after application:

```jsonl
{"protocol_version":"1","id":"message-1","kind":"ack","applied":true,"type":"GRANT","authority_ref":"authority-1"}
```

Original submission request:

```jsonl
{"protocol_version":"1","id":"message-2","op":"submit","request":{"request_id":"request-1","principal_id":"principal-a","agent_id":"agent-a","action":"action-x","target":"target-x","authority_ref":"authority-1","provenance":{"scenario_id":"retry-after-revocation"},"context":{}}}
```

Allowed response:

```jsonl
{"protocol_version":"1","id":"message-2","kind":"decision","request_id":"request-1","decision_id":"reference-decision-1","evaluation_id":"reference-evaluation-1","outcome":"allow","reason":"Current authority is valid.","authority_ref":"authority-1","evidence":{"authority_valid":true,"principal_id":"principal-a","agent_id":"agent-a","provenance":{"scenario_id":"retry-after-revocation"}}}
```

REVOKE request:

```jsonl
{"protocol_version":"1","id":"message-3","op":"inject","type":"REVOKE","authority_ref":"authority-1"}
```

REVOKE response, after application:

```jsonl
{"protocol_version":"1","id":"message-3","kind":"ack","applied":true,"type":"REVOKE","authority_ref":"authority-1"}
```

Fresh retry request:

```jsonl
{"protocol_version":"1","id":"message-4","op":"submit","request":{"request_id":"request-2","principal_id":"principal-a","agent_id":"agent-a","action":"action-x","target":"target-x","authority_ref":"authority-1","provenance":{"scenario_id":"retry-after-revocation","retry_of":"request-1"},"context":{}}}
```

Denied response:

```jsonl
{"protocol_version":"1","id":"message-4","kind":"decision","request_id":"request-2","decision_id":"reference-decision-2","evaluation_id":"reference-evaluation-2","outcome":"deny","reason":"Current authority is absent or revoked.","authority_ref":"authority-1","evidence":{"authority_valid":false,"principal_id":"principal-a","agent_id":"agent-a","provenance":{"scenario_id":"retry-after-revocation","retry_of":"request-1"}}}
```

## Evidence and scope

The adapter retains the native response and accumulated acknowledged controls in `RuntimeDecision.evidence.subprocess`, alongside source labels identifying simulated enforcement/execution. Authority references remain in that opaque evidence; the adapter does not synthesize a generic authority state. Use JSON-safe native evidence without secrets.

This protocol provides governance only. The existing runner simulates UNKNOWN for the initial execution and blocking for the denied retry. A passing scenario does not prove real side-effect enforcement or containment.

Wire `protocol_version: "1"` is independent of timeline `harness_schema_version: "1"`. Suite JSON reports are a third, separate output shape. No new report/version negotiation is implied.
