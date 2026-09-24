# Agent Governance Test Harness

A small TypeScript harness for scenario orchestration, condition injection, observations, timeline capture, assertions and reporting. Requires Node 24+. Zero runtime dependencies; TypeScript and Node declarations are development dependencies.

CDE owns governance signals; Kingpin owns authority; Gateway owns mechanical enforcement; RC2 execution machinery owns effects, receipts and reconciliation. Harness assertions test observed behavior without reproducing authority policy. No UI, LLM or agent framework.

Run `npm ci`, `npm run typecheck`, and `npm test`. Static checking emits no build files. All modes run **Retry After Revocation** and print an ordered timeline and PASS/FAIL summary; failed invariants set a nonzero exit code.

| Command | Real components | Artifact under `artifacts/` |
| --- | --- | --- |
| `npm run scenario` | None; deterministic fixture | `retry-after-revocation.jsonl` |
| `npm run scenario:rc2` | CDE and Kingpin | `retry-after-revocation.rc2.jsonl` |
| `npm run scenario:rc2-gateway` | CDE, Kingpin, HTTP Gateway, execution and reconciliation | `retry-after-revocation.rc2-gateway.jsonl` |

Every timeline record uses `harness_schema_version: "1"`. The simulated artifact remains byte-identical across fresh runs. Connected artifacts retain native random IDs and timestamps and are not byte-identical. Replay means rerunning inputs; artifact ingestion is not implemented.

## RC2 connection

Run `npm run test:integration` for both connected paths. `RC2_ROOT` defaults to sibling `agent-tool-governance-gateway`. `CDE_PYTHON` overrides its `.venv-task/bin/python` (otherwise `python3`). That checkout needs its existing Node/Python dependencies. Missing dependencies fail explicitly. No RC2 files or policy are modified. Verified against commit `0a5d2c26cabea3634a9a7c9e2bff67de6982ef46`.

Governance-only mode imports `kingpin/index.js` and batches real CDE observations through `conformance/cde_bridge.py`. Action X maps to `fs.delete`, but enforcement and all execution, including UNKNOWN, remain simulated. Authority resolves to an issued lease; nonce revocation requires both acknowledgement and native `nonce_revoked` validation.

Both adapters retain native decisions and evidence. Normalization is `allow` → ALLOW, `deny`/`quarantine` → DENY, `constrain`/`human_review` → INDETERMINATE. Unsupported outcomes throw. Historical provenance is evidence, never authority.

## Real Gateway and execution

Gateway mode starts RC2's `createGatewayApp` in evaluation mode on an ephemeral loopback port, with fresh scoped credentials, an isolated SQLite store, `ExecutionRuntime`, and `createSandboxAdapter`. RC2's `startCde` starts its real stateful Python worker. Requests use authenticated `POST /tool/observed`; CDE computes the signals from the fixed observation text. Native request IDs come from `X-Request-ID`; native decision/evaluation/execution IDs and harness request/provenance remain in `evidence.kingpin_rc2_gateway`.

Action X maps to `fs.write({path: 'effect.txt', content: 'deterministic governance fixture\n'})`. A private mode-0700 directory under the OS temporary directory holds the sandbox; the SQLite file is outside it. A harmless read fixture establishes context before `/lease` issuance. The test performs no destructive tool operation. Listener, Python worker, database and temporary files are closed/removed in `finally`.

To exercise genuine uncertainty, a harness fault wrapper injects one failure while committing `tool.execution.succeeded`, using the transaction-collaborator mechanism demonstrated in RC2's `gateway_node/execution.test.js`. RC2 performs the actual write, rolls back its terminal receipt transaction, and emits native `unknown` / `RECEIPT_UNAVAILABLE`. The harness never authors an UNKNOWN receipt. `GET /executions/:id` observes it; `POST /executions/:id/reconcile` invokes RC2's read-only postcondition check and produces `reconciled_succeeded`. Thus completion is established by native reconciliation plus file inspection, not an initial successful HTTP response. UNKNOWN implies neither cancellation nor absence of effects.

Default RC2 policy permits `fs.write` with evidence rather than requiring a lease. Therefore nonce revocation alone would not prohibit this safe write. Gateway mode uses existing `POST /revoke` to revoke the **write capability** in its context, requiring native acknowledgement, `capability.revoked` audit and `capability_revoked` lease validation before fresh redispatch. Policy is unchanged.

`GET /audit/:request_id` supplies enforcement/start/UNKNOWN/reconciliation events. A read-only store transaction captures the complete execution ledger (the HTTP list endpoint lists only unresolved executions). The assertion requires exactly one execution, unchanged ledger across denied redispatch, no retry execution events, and unchanged file content/inode/size/timestamps. DENY alone is insufficient. Sources distinguish `harness`, `rc2:cde`, `rc2:kingpin`, `rc2:gateway` and `rc2:execution`; only the fault is harness-injected. No UNKNOWN state is simulated in this mode.

The runner's optional framework-neutral observation callback replaces its default simulated enforcement/execution. Generic event contracts and schema version remain unchanged; richer native records stay in adapter evidence. Native reconciliation success maps to generic SUCCEEDED while preserving its full native status and execution ID.
