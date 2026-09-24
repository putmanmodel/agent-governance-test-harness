# Agent Governance Test Harness

A small TypeScript harness for deterministic governance scenarios, injected failures/revocations, runtime adapters, timeline capture, and invariant reporting. Zero runtime dependencies; requires Node 24 or newer for native TypeScript execution. TypeScript and Node type declarations are development dependencies only.

The harness does not decide authority or implement Kingpin policy. CDE owns deviation signals; Kingpin owns authority decisions; Gateway owns enforcement; execution adapters own effects and cancellation semantics. This project has no UI, LLM, agent framework, or real effects.

Run `npm ci`, `npm run typecheck`, `npm test`, then `npm run scenario`. Static checking emits no build files. The example prints a console timeline and PASS/FAIL summary, and overwrites `artifacts/retry-after-revocation.jsonl` with deterministic ordered data. Every JSONL record carries `harness_schema_version: "1"`, identifying the harness contract. Failed invariants set a nonzero exit code. Replay means rerunning the same scenario inputs with a fresh adapter; no artifact ingestion is implemented.

Retry After Revocation injects a grant, an initial request whose execution becomes UNKNOWN, revocation, and a retry with a new request ID. Its invariant requires a new denial after revocation and no retry dispatch. A deliberately broken adapter is tested to prove historical permission reuse fails.

The simulated runtime is a temporary, single-authority fixture. Its optional broken mode exists only for negative testing. The runner's simulated Gateway dispatches only ALLOW results; the simulated executor reports scenario-selected outcomes. UNKNOWN makes no claim about whether an original effect completed; cancellation is not modeled.

The generic async adapter accepts requests and acknowledged grant/revoke injections; injection completion must make a change observable to the next request. Runtime decisions expose opaque authority references, rationale, and evidence, with ALLOW/DENY/INDETERMINATE normalization. Authority policy remains in the external runtime. Real Gateway enforcement and execution observations will need integration separately; current enforcement records describe only the simulation.

Logical timestamps and event order come from scenarios. The runner processes events serially, assigns contiguous timeline sequences, and rejects ambiguous order. Retries retain action/target/authority and link to the original through provenance, but always submit a new request. Fresh simulated adapters reset deterministic decision IDs each run.

## Real RC2 governance

Run `npm run test:integration` and `npm run scenario:rc2`. The adapter defaults to the sibling `agent-tool-governance-gateway` checkout; override with `RC2_ROOT`. CDE uses `CDE_PYTHON`, otherwise that checkout's `.venv-task/bin/python`, otherwise `python3`; its existing Python dependencies must be installed there. Missing runtime/dependencies fail explicitly, with no simulated fallback. No new harness runtime dependencies are required.

The integration was verified against source commit `0a5d2c26cabea3634a9a7c9e2bff67de6982ef46`. It dynamically imports `kingpin/index.js` and keeps one `KingpinAuthority` instance with default isolated memory state and a fixed lease clock. The source checkout's `conformance/cde_bridge.py` runs in a child process and calls real `CDEEngine.process_turn` and `build_response`. Three fixed calm turns (setup, proposal, retry) are evaluated by one CDE engine in a batch; these inputs do not depend on governance results. The adapter passes each native signal and selected event ID to `decide(signal, request, evaluation_id, auditContext)` without constructing CDE signals or implementing Kingpin policy.

The RC2-specific fixture explicitly binds `action-x` / `target-x` to `fs.delete({ path: '/project' })`. No filesystem effect occurs. Setup evaluates `fs.list` to establish context, then asks RC2's trusted `issue` control-plane method for a 60-second lease. RC2 owns issuance eligibility. Harness `authority-1` resolves to that returned lease; its bearer token stays internal, while its native `lease_id` (nonce) is retained in evidence. No epoch mutation or approval flow is used.

Revocation calls `revokeLeaseNonce(lease_id)`, requires `{ revoked: true, lease_nonce: <same ID> }`, and then requires `validateLease` to return `{ valid: false, reason: 'nonce_revoked' }`. Failure aborts before retry submission. The receipt, validation and native revocation audit are preserved in subsequent decision evidence. The existing `inject(): Promise<void>` contract fits: resolution acknowledges visibility, and evidence is retained under `evidence.kingpin_rc2.controls` without adding a generic control-event type.

Request IDs and principal IDs go into native audit correlation; agent maps to `speaker_id`, scenario to `session_id`, and adapter configuration supplies channel/scene and exact tool arguments. A new retry ID is required. Original-request provenance and all harness context remain in `evidence.kingpin_rc2.harnessRequest`; they are not passed as authority claims. Native `AuthorityRequest` has no retry-provenance field. Harness-generated decision correlation IDs are supplied to RC2, then verified against its emitted audit records.

Normalization maps `allow` to ALLOW; `deny` and `quarantine` to DENY; `constrain` and `human_review` to INDETERMINATE (both remain blocked pending evidence/review). Unsupported native contracts/outcomes throw rather than fabricating a decision. Complete native decisions, CDE observations, correlated audit, lease checks and control receipts remain under `evidence.kingpin_rc2`.

The console labels this as real governance with **simulated enforcement and execution**, and each governance record carries those mode labels. UNKNOWN is injected by the harness executor and says nothing about cancellation or whether a real effect occurred. This does not exercise Gateway HTTP authentication, enforcement, side effects, or cancellation. The trusted module caller supplies principal metadata; it is not an authenticated HTTP identity.

The RC2 artifact is `artifacts/retry-after-revocation.rc2.jsonl`, also schema version 1. Native random event IDs, nonce identities and audit timestamps are intentionally preserved, so real integration artifacts are not byte-identical across runs. Deterministic mapping tests are separate from the process-level integration test; the existing simulated scenario and byte-identical replay tests remain unchanged.
