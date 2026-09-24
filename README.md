# Agent Governance Test Harness

A small TypeScript harness for scenario orchestration, condition injection, observations, timeline capture, assertions and reporting. Requires Node 24+. Zero runtime dependencies; TypeScript and Node declarations are development dependencies.

CDE owns governance signals; Kingpin owns authority; Gateway owns mechanical enforcement; RC2 execution machinery owns effects, receipts and reconciliation. Harness assertions test observed behavior without reproducing authority policy. No UI, LLM or agent framework.

Run `npm ci`, `npm run typecheck`, and `npm test`. Static checking emits no build files. The commands below run **Retry After Revocation** and print an ordered timeline and PASS/FAIL summary; failed invariants set a nonzero exit code.

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

## Human Approval Replay

Run `npm run scenario:human-approval` for the second scenario, producing `artifacts/human-approval-replay.rc2-gateway.jsonl`. Its `human_approval_not_reusable` invariant requires a real review hold, authenticated reviewer approval, one consumed approval and one successful sandbox write, then no second execution after replay. Receipt-failure injection is disabled for this scenario.

Real CDE warmup and `.` observation (from RC2's review fixture) trigger HUMAN REVIEW through `/tool/observed`. The scoped reviewer calls `/reviews/:id/approve`; the original agent calls `/reviews/:id/execute` with the identical bound body. Native review records, binding hashes, reviewer identity and consumption audit are retained. The GRANT timeline event marks the approval operation; its native receipt appears in the following governance record's evidence.

Replay keeps the operation body unchanged, uses fresh harness/HTTP request IDs and links provenance to the original. `/tool/observed` produces a fresh CDE/Kingpin evaluation and new pending review, followed by an attempt to execute the **old consumed** review. RC2 returns 409. Consumption itself does not rerun CDE; a consumed-review refusal emits no new decision or denial audit, so the harness preserves the HTTP refusal without inventing either. Execution audit retains the original review's request/decision correlation. The invariant checks unchanged consumed-review history, complete ledger and file state, not merely a blocked response. All fixture state is disposable; no restart variant is tested.

## Delegated Handoff

Run `npm run scenario:delegated-handoff` to produce `artifacts/delegated-handoff.rc2-gateway.jsonl`. Its `delegated_handoff_requires_fresh_authority` invariant checks that task/provenance handoff does not silently transfer authority. A performs one real control write; B attempts the same operation using a separate bearer credential, principal, agent and CDE session. Before the scenario, RC2's `/revoke` removes only B's write capability in B's evaluated context; default policy is unchanged.

RC2 has no task-delegation API. The delegated PROPOSE event carries `context.handoff` (scenario/handoff IDs, originating/delegated agent IDs and request IDs). The same metadata reaches B's HTTP request as an inert `harness_provenance` annotation. No A credential, lease, approval or authority reference is passed to B. Native audit must identify B and show a fresh CDE/Kingpin evaluation. Gateway denial is corroborated by unchanged complete execution accounting and file state. Agents use distinct sessions because RC2 forbids cross-principal shared CDE history. No generic core or schema change is needed.

## In-Flight Revocation

Run `npm run scenario:in-flight` for `artifacts/in-flight-revocation.rc2-gateway.jsonl`. A worker-thread Gateway uses the real sandbox adapter wrapped by a pre-effect `Atomics.wait` barrier. The parent verifies the committed STARTED receipt/audit through read-only SQLite, sends a real `/revoke`, observes a bounded 200 ms pending-acknowledgement window, and releases the write. This boundary is harness timing injection, not fabricated execution state. Temporary resources are closed and removed.

Observed RC2 behavior: the synchronous adapter holds a SQLite writer transaction, and Gateway serializes requests. Revocation remained pending while the worker was blocked; native audit orders execution success before capability revocation. RC2 exposes no cancellation API here (`cancellation_supported: false`). The invariant preserves the native disposition (including FAILED or UNKNOWN when reported), then requires fresh governance and unchanged accounting/file state for later denied dispatch. It does not demand cancellation or success. Current serial-RC2 ordering is explicit; a change to concurrent acknowledgement would require reviewing this experiment's ordering checks.

Interleaving lives in adapter evidence: parent monotonic observation order records request transmission, pending acknowledgement and barrier release; native SQLite audit sequence establishes commit order. Client response arrival is not treated as execution completion time. Outer timeline timestamps remain scenario logical times. Native receipts are retrieved through the shared hardened helper. No generic scheduler or schema change is introduced.
