# Authoring an adapter

Start with generic Retry After Revocation. It grants a fixture authority, submits an action, simulates UNKNOWN execution, revokes authority and submits a fresh retry. Your runtime must evaluate current authority; historical provenance must not become permission. You do not need CDE/Kingpin.

Read [`RuntimeAdapter`](../src/core/runtime-adapter.ts), [`runScenario` and `ObserveEffects`](../src/core/runner.ts), and the [generic scenario/invariant](../scenarios/retry-after-revocation.ts). For another language, use the [subprocess protocol](SUBPROCESS_PROTOCOL.md).

## Contract and semantics

- `inject({type: 'GRANT' | 'REVOKE', authorityRef})` returns `Promise<void>`. Resolve only after the change is observable by subsequent submissions, not merely after sending it. Await your runtime's acknowledgement/validation; reject on failure. The runner awaits injection before continuing. The scenario control event is recorded before injection; it is not independent native acknowledgement evidence. Preserve native control evidence in later decision evidence when available.
- `submit(request)` translates principal, agent, action, target, optional authority/lease references, provenance and context to your runtime. Map `action-x`, `target-x` and `authority-1` to your own fixture resources. These are scenario identifiers, not prescribed runtime objects. Authority behavior belongs to the runtime, not the adapter.
- Return the original harness `requestId` and the observed decision ID. Preserve native request IDs separately if different. The runner checks request correlation; the retry invariant requires a different decision ID for the fresh retry. Do not manufacture freshness by relabeling a cached authorization.
- Normalize to `ALLOW`, `DENY` or `INDETERMINATE` at the adapter boundary. Document your native mapping. INDETERMINATE is a real observed unresolved governance outcome, not an error fallback. Protocol/runtime failures must throw. The default simulated enforcement dispatches only ALLOW.
- `rationale` explains the observed decision. `evidence` is opaque to the core; use an adapter-specific namespace and preserve native outcome, correlation and relevant acknowledgement records. There is no universal evidence schema. Values must survive `structuredClone` and JSON serialization: prefer plain JSON data, avoid functions/cycles/BigInt, and exclude credentials. Optional `authority` describes returned authority information; do not invent it if absent.
- `RuntimeAdapter` does not define startup, timeout or cleanup methods. Your driver owns these and must close external resources in `finally`. `runScenario` does not close the adapter.

## Minimal runnable-style TypeScript integration

This uses the existing subprocess adapter so authority stays in an independent process. Save the example at the repository root to use these relative imports; run it with Node 24. Replace the command/arguments with your protocol bridge once it implements the wire contract.

```ts
import { fileURLToPath } from 'node:url';
import { SubprocessAdapter } from './src/adapters/subprocess/adapter.ts';
import { runScenario } from './src/core/runner.ts';
import { retryAfterRevocation } from './scenarios/retry-after-revocation.ts';

const adapter = new SubprocessAdapter(process.execPath, [
  fileURLToPath(new URL('./reference-runtime/runtime.mjs', import.meta.url)),
]);
try {
  const result = await runScenario(retryAfterRevocation, adapter);
  console.log(result.assertions);
  process.exitCode = result.passed ? 0 : 1;
} finally {
  await adapter.close();
}
```

For a direct TypeScript integration, implement the two methods in `RuntimeAdapter` instead of constructing `SubprocessAdapter`. Keep native request translation, acknowledged control injection and normalization there; retain the same driver/cleanup pattern. See the [reference adapter](../src/adapters/subprocess/adapter.ts) for transport/correlation handling and [reference process](../reference-runtime/runtime.mjs) for the separate authority behavior. A passing retry and a deliberately broken runtime that reuses revoked authority should respectively pass and fail the unchanged generic invariant; see [tests](../tests/subprocess.test.ts).

## Execution observation

Successful governance testing does not prove actual side-effect enforcement unless the runtime also supplies real execution observation.

`runScenario(scenario, adapter)` defaults to simulated enforcement/execution using scenario-defined outcomes. `runScenario(scenario, adapter, observeEffects)` instead invokes the async observation callback after each decision. It returns `{enforcement: 'DISPATCH' | 'BLOCK', executions: ExecutionResult[]}` with matching harness request IDs. Report observed starts/dispositions rather than inferring completion from ALLOW or absence of effects from DENY. UNKNOWN means neither cancellation nor absence of side effects.

The callback is not a generic execution engine or cancellation API. Real proof also requires assertions that check the relevant native evidence. Existing RC2 execution assertions illustrate one runtime's accounting, not a universal contract. Logical timeline timestamps do not establish native concurrent event order.

## Static common-CLI registration

Add a profile to [`src/runtime-registry.ts`](../src/runtime-registry.ts), associating an identity, truthful capabilities and drivers. For example, once `runMyRetry()` creates your adapter, runs the generic scenario and closes resources:

```ts
'my-runtime': {
  runtime: { id: 'my-runtime', capabilities: ['revocation'] },
  drivers: { 'retry-after-revocation': runMyRetry },
},
```

Then use `npm run harness -- run --runtime my-runtime --suite current`. Source registration is required for a custom TypeScript/common-CLI profile. Protocol-compatible external processes can instead use `--runtime subprocess` without source edits, as below. Dynamic JavaScript loading is not supported. A driver returns at least `{passed: boolean}`. Fixture construction belongs inside the driver so unsupported scenarios do not start resources. Profile-specific `requirements` can select an existing registration variant, as Gateway retry does for reconciliation/accounting. Do not weaken prerequisites to claim support.

## Capabilities and applicability

Governance submission is mandatory. Current optional capabilities are:

| Name | Meaning for current scenario paths |
| --- | --- |
| `revocation` | Apply and acknowledge relevant authority revocation |
| `human-review` | Observe approval, consumption and attempted replay |
| `execution-accounting` | Observe native execution records sufficient to establish execution/no second execution |
| `reconciliation` | Obtain native resolution of uncertain execution in the Gateway retry path |
| `multi-principal` | Exercise separately authenticated principal/agent identities |
| `durable-restart` | Replace the runtime process and reopen preserved governance state for the implemented restart driver; not crash/UNKNOWN recovery or CDE-history persistence |
| `in-flight-observation` | Establish execution start and observe revocation/disposition ordering while outstanding |

Declarations live beside adapters; requirements live in [`scenarios/registrations.ts`](../scenarios/registrations.ts). They are claims about configured integration paths, not automatic detection. Cancellation is not required for in-flight revocation. Human review, handoff and in-flight drivers/assertions currently remain RC2-specific; your capability flags alone do not port them.

`runApplicable` checks prerequisites before execution: missing prerequisites give UNSUPPORTED; assertion failures and supported-path exceptions give FAIL. Unsupported coverage is not passed coverage. Its optional explicit caller-required set produces FAIL when missing; the suite/CLI currently does not expose this argument. A supported registration with no driver fails. See [applicability](../src/core/applicability.ts) and [suite runner](../src/suite-runner.ts).

These interfaces are early. The mandatory control method, separate observation callback and driver-owned cleanup are current conventions, not a finalized SDK.

## External process without source registration

For a minimal standalone process, save this as `my-runtime.py` outside the harness. It is a single-authority example, not production policy; replace its authority behavior with calls to your runtime. It emits no tool effects.

```python
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
```

From the harness directory:

```bash
npm run harness -- run --runtime subprocess \
  --command python3 --command-arg /absolute/path/to/my-runtime.py \
  --capability revocation --runtime-id my-governance-layer --suite current
```

No source registration is needed. Use repeated `--command-arg` entries for argv (dash-prefixed values use `--command-arg=-u`), not a quoted shell command. Local code executes with your privileges. Omit `--runtime-id` for `external-subprocess`; stderr remains separate from JSONL stdout. `--json` uses the existing suite report format.

All seven existing capability names are recognized, but only generic retry has a subprocess driver. Declarations do not implement new drivers: an applicable scenario without a driver fails. With only `revocation`, expect 1 PASS / 5 UNSUPPORTED. Without capabilities, expect 0 PASS / 6 UNSUPPORTED and no process launch. Unknown capabilities/options fail early. The driver closes the process in `finally` on success and failure; CLI usage validation finishes before driver creation.
