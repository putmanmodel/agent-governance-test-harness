# Agent Governance Test Harness

A small, framework-neutral TypeScript harness that tests specified authority-transition invariants against observable runtime evidence, with coverage determined by the selected runtime integration and supported scenarios. The harness orchestrates conditions, captures observations and evaluates invariants; the runtime under test owns authority decisions and enforcement.

CDE/Kingpin RC2 is one supported integration. An independent JSONL subprocess runtime demonstrates portability without CDE/Kingpin. Requires Node 24+; zero runtime dependencies. TypeScript and Node declarations are development dependencies. No UI, LLM or agent framework is required.

The planned clone-installed v1.0.0 developer preview has an explicit [stability and release contract](docs/V1_DEVELOPER_PREVIEW.md) and [timeline schema reference](docs/TIMELINE_SCHEMA.md). Licensing terms for public/commercial use will be provided with the public release. External contributions are not yet being solicited pending publication of contribution/licensing terms.

## Quick start — portable/default path

After cloning, run these commands from the repository root with Node 24+ and npm. No global TypeScript, build step, Python or CDE/Kingpin checkout is required for this basic path.

```bash
npm ci
npm run typecheck
npm test
npm run harness -- run --runtime subprocess-reference --suite current
```

Expected suite output:

```text
Runtime: subprocess-reference
Suite: current

PASS         Retry After Revocation
UNSUPPORTED  Human Approval Replay
             missing: human-review, execution-accounting
UNSUPPORTED  Delegated Handoff
             missing: multi-principal, execution-accounting
UNSUPPORTED  In-Flight Revocation
             missing: execution-accounting, in-flight-observation

UNSUPPORTED  Staged Write After Revocation
             missing: execution-accounting

UNSUPPORTED  Capability Revocation Survives Restart
             missing: execution-accounting, durable-restart

UNSUPPORTED  Human Approval Consumption Survives Restart
             missing: human-review, execution-accounting, durable-restart

UNSUPPORTED  UNKNOWN Execution Survives Restart
             missing: execution-accounting, durable-restart, reconciliation

1 passed; 0 failed; 7 unsupported (not passed coverage).
```

- **PASS:** the selected scenario's assertions passed.
- **FAIL:** assertions failed or a supported path encountered setup, protocol or execution errors.
- **UNSUPPORTED:** prerequisites are missing; the scenario driver was not run. This is not failed governance and is not passed coverage.

Exit 0 means no FAIL results, even with unsupported scenarios. Failures, invalid usage and unknown runtime/suite names exit nonzero. The `current` convenience suite contains the eight scenarios above in this release and may grow in later releases; published scenario IDs remain stable. The common CLI writes available timelines only when `--artifact-dir` is supplied.

## Portable release smoke

With Python 3 available as `python3` (standard library only, no pip install):

```bash
npm run smoke
```

This checks help/discovery, built-in portable human/JSON output and the [checked-in Python example](examples/python-governance-runtime.py) through the external CLI. Both runtime runs must produce 1 PASS / 7 UNSUPPORTED. It checks protocol/report/timeline versions and requires no RC2 checkout. Typecheck and unit tests remain separate, so the full release sequence is `npm ci`, `npm run typecheck`, `npm test`, `npm run smoke`.

[Portable CI](.github/workflows/portable.yml) runs that sequence with Node 24 and Python 3.14 on Ubuntu 24.04. Local validation is macOS arm64; the hosted workflow still needs its first run. Windows support is not claimed. See the [environment notes](docs/V1_DEVELOPER_PREVIEW.md#environment-and-reference-integration).

## Help, discovery and failure evidence

```bash
npm run harness -- --help             # -h also works; no runtime launch
npm run harness -- runtimes
npm run harness -- capabilities
npm run --silent harness -- run --runtime subprocess-reference --suite current --json --artifact-dir ./artifacts/run
```

Help/discovery exit 0 without starting a runtime. Discovery is static; capability declarations do not install scenario drivers.

Suite JSON uses `reportVersion: "1"`, independent of timeline schema 1 and subprocess protocol 1. Existing identity, status, missing-capability, reason and count fields remain. Failed assertions add `diagnostics: [{invariantId, reason, case?}]`; available timelines add `artifacts: [{path, case?}]`. Native evidence stays in the timeline, not the suite report. UNKNOWN recovery still produces one scenario result, with `before-effect`/`after-effect` diagnostic labels.

`--artifact-dir` creates a fresh `run-*` subdirectory under the requested directory when a timeline is available, and reports absolute file paths on both PASS and FAIL. Repeated runs do not overwrite prior artifacts. Each case gets its own JSONL file. Without the option there are no common-CLI artifact writes. Drivers without timelines and errors thrown before a result is returned have no new artifact; output/write failures remain FAIL. All current completed scenario paths support this mechanism.

Human failure output includes the failed invariant and reason, optional case, and available artifact paths. Setup/protocol exceptions remain scenario FAIL with their error message; invalid CLI usage exits 1 on stderr without a suite report. Subprocess failures include at most the last 2,048 characters of captured stderr when available (including at cleanup); it is not protocol stdout and is not added to PASS reports. Treat stderr as runtime-supplied diagnostics, and keep secrets out of it and timeline evidence.

## Run your own subprocess runtime

A developer can implement the documented subprocess protocol, point the harness CLI at their executable, and run applicable governance scenarios without modifying the harness source code.

```bash
npm run harness -- run \
  --runtime subprocess \
  --command node \
  --command-arg ./reference-runtime/runtime.mjs \
  --capability revocation \
  --suite current
```

Replace the executable/path with your own process (for example `--command python3 --command-arg ./my-runtime.py`). `subprocess-reference` is the fixed built-in example; `subprocess` is externally configured. Its default report identity is `external-subprocess`; optionally set `--runtime-id my-governance-layer`. Add `--json` for CI, using `npm run --silent harness` to suppress npm's banner.

`--command` is one executable, not a shell command string. Repeat `--command-arg` for each argument; use `--command-arg=-u` for arguments beginning with a dash. Arguments retain spaces and metacharacters literally. Relative paths use the invoking working directory. This is user-supplied local code executed with the invoking user's privileges, not a security sandbox.

Repeat `--capability` to declare supported capabilities from the documented vocabulary. Governance is implicit. `revocation` enables generic retry; without it, retry is UNSUPPORTED, never PASS. Currently this profile only supplies a generic retry driver: claiming enough capabilities to make another scenario applicable produces FAIL for its missing driver. Unknown capability names, missing commands, repeated singleton options and external-only options on built-in profiles are rejected before launch. Repeated capability names are deduplicated; repeated command arguments preserve their order.

The existing protocol, five-second timeout and driver-owned cleanup apply. No real execution is added; a normal run reports 1 PASS and 7 UNSUPPORTED. See the [outside-developer example](docs/ADAPTER_AUTHORING.md#external-process-without-source-registration).

## Runtime profiles and proof boundaries

| Static profile | Current suite coverage | Execution |
| --- | --- | --- |
| `subprocess-reference` | Generic Retry After Revocation | Simulated enforcement and effects |
| `kingpin-rc2-governance` | Generic Retry After Revocation | Simulated enforcement and effects |
| `kingpin-rc2-gateway` | All eight RC2 scenario paths | Real RC2 Gateway and bounded sandbox execution |

Governance-only success does **not** prove actual side-effect enforcement. UNKNOWN implies neither cancellation nor absence of effects. The reference subprocess owns its own single-authority state; it is a portability fixture, not a production policy engine.

Generic Retry After Revocation is currently the directly portable scenario. All seven other scenario families (approval replay, handoff, in-flight revocation, staged effects, durable revocation, durable approval consumption and UNKNOWN recovery) have RC2-specific drivers and assertions. Another runtime may support these concepts, but portable drivers have not yet been generalized. Declaring capabilities does not supply those drivers. APIs are early and may change; this is not general conformance certification.

## Integrate your runtime

Start with the [adapter authoring guide](docs/ADAPTER_AUTHORING.md). Non-TypeScript runtimes can implement the [JSONL subprocess protocol](docs/SUBPROCESS_PROTOCOL.md), using `reference-runtime/runtime.mjs` as a standalone example.

Built-in runtime profiles are registered in `src/runtime-registry.ts`. The external `subprocess` profile accepts an executable and argv without source edits; JavaScript plugin/module loading is not supported. Profiles associate capabilities and scenario drivers. Static requirements live in `scenarios/registrations.ts`; `runApplicable` checks them before fixture creation. Governance is mandatory. Optional capabilities cover revocation, human review, execution accounting, reconciliation, multiple principals, durable restart and in-flight observation. Cancellation is not a prerequisite.

An explicit required-capability set passed to `runApplicable` produces FAIL if unmet, rather than allowing omitted declarations to satisfy that requirement. This programmatic check is not currently exposed as a common CLI flag. Declarations are integration claims, not independent verification.

## CI output

```bash
npm run --silent harness -- run \
  --runtime subprocess-reference \
  --suite current \
  --json
```

The command emits one JSON suite report on stdout; diagnostics may appear on stderr. Abbreviated example (only the first scenario entry shown):

```json
{
  "reportVersion": "1",
  "runtimeId": "subprocess-reference",
  "suiteId": "current",
  "results": [{
    "runtimeId": "subprocess-reference",
    "scenarioId": "retry-after-revocation",
    "scenarioName": "Retry After Revocation",
    "status": "PASS",
    "missingCapabilities": [],
    "reason": "Scenario assertions passed."
  }],
  "summary": { "passed": 1, "failed": 0, "unsupported": 7 }
}
```

Exit 0 may include UNSUPPORTED scenarios: CI should inspect the summary/results if specific coverage is required. Unsupported entries identify exact missing capabilities. This suite output is separate from timeline JSONL, versioned independently with `reportVersion: "1"`.

## Developer/debugging commands

Existing individual commands remain available:

| Command | Path / artifact under `artifacts/` |
| --- | --- |
| `npm run scenario` | Deterministic simulation: `retry-after-revocation.jsonl` |
| `npm run scenario:subprocess` | Independent governance: `retry-after-revocation.subprocess.jsonl` |
| `npm run suite:subprocess` | Applicability demonstration; no artifact |
| `npm run scenario:rc2` | RC2 governance: `retry-after-revocation.rc2.jsonl` |
| `npm run scenario:rc2-gateway` | RC2 execution: `retry-after-revocation.rc2-gateway.jsonl` |
| `npm run scenario:human-approval` | `human-approval-replay.rc2-gateway.jsonl` |
| `npm run scenario:delegated-handoff` | `delegated-handoff.rc2-gateway.jsonl` |
| `npm run scenario:in-flight` | `in-flight-revocation.rc2-gateway.jsonl` |
| `npm run scenario:staged` | `staged-write-after-revocation.rc2-gateway.jsonl` |
| `npm run scenario:restart` | `capability-revocation-survives-restart.rc2-gateway.jsonl` |
| `npm run scenario:review-restart` | `human-approval-consumption-survives-restart.rc2-gateway.jsonl` |
| `npm run scenario:unknown-restart` | Both `unknown-execution-survives-restart.rc2-gateway.jsonl` and `unknown-execution-before-effect-survives-restart.rc2-gateway.jsonl` |

`npm run typecheck` emits no build files; `npm test` runs the unit suite. RC2 integration testing requires the separate checkout described below. Timeline records retain `harness_schema_version: "1"`. Simulated and reference-subprocess artifacts are deterministic; RC2 artifacts retain native random IDs and timestamps. Replay means rerunning inputs, not artifact ingestion.

## RC2 integration details

CDE owns governance signals; Kingpin owns authority; Gateway owns mechanical enforcement; RC2 execution machinery owns effects, receipts and reconciliation. The harness does not reproduce Kingpin policy.

## RC2 connection — separate reference integration

Run `npm run test:integration` for the connected RC2 scenarios. `RC2_ROOT` defaults to sibling `agent-tool-governance-gateway`. `CDE_PYTHON` overrides its `.venv-task/bin/python` (otherwise `python3`). That checkout needs its existing Node/Python dependencies. Missing dependencies fail explicitly. No RC2 files or policy are modified. Verified against commit `0a5d2c26cabea3634a9a7c9e2bff67de6982ef46`.

Governance-only mode imports `kingpin/index.js` and batches real CDE observations through `conformance/cde_bridge.py`. Action X maps to `fs.delete`, but enforcement and all execution, including UNKNOWN, remain simulated. Authority resolves to an issued lease; nonce revocation requires both acknowledgement and native `nonce_revoked` validation.

The RC2 adapters retain native decisions and evidence. Normalization is `allow` → ALLOW, `deny`/`quarantine` → DENY, `constrain`/`human_review` → INDETERMINATE. Unsupported outcomes throw. Historical provenance is evidence, never authority.

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

Replay keeps the operation body unchanged, uses fresh harness/HTTP request IDs and links provenance to the original. `/tool/observed` produces a fresh CDE/Kingpin evaluation and new pending review, followed by an attempt to execute the **old consumed** review. RC2 returns 409. Consumption itself does not rerun CDE; a consumed-review refusal emits no new decision or denial audit, so the harness preserves the HTTP refusal without inventing either. Execution audit retains the original review's request/decision correlation. The invariant checks unchanged consumed-review history, complete ledger and file state, not merely a blocked response. All fixture state is disposable; no restart variant is tested in this scenario.

## Delegated Handoff

Run `npm run scenario:delegated-handoff` to produce `artifacts/delegated-handoff.rc2-gateway.jsonl`. Its `delegated_handoff_requires_fresh_authority` invariant checks that task/provenance handoff does not silently transfer authority. A performs one real control write; B attempts the same operation using a separate bearer credential, principal, agent and CDE session. Before the scenario, RC2's `/revoke` removes only B's write capability in B's evaluated context; default policy is unchanged.

RC2 has no task-delegation API. The delegated PROPOSE event carries `context.handoff` (scenario/handoff IDs, originating/delegated agent IDs and request IDs). The same metadata reaches B's HTTP request as an inert `harness_provenance` annotation. No A credential, lease, approval or authority reference is passed to B. Native audit must identify B and show a fresh CDE/Kingpin evaluation. Gateway denial is corroborated by unchanged complete execution accounting and file state. Agents use distinct sessions because RC2 forbids cross-principal shared CDE history. No generic core or schema change is needed.

## In-Flight Revocation

Run `npm run scenario:in-flight` for `artifacts/in-flight-revocation.rc2-gateway.jsonl`. A worker-thread Gateway uses the real sandbox adapter wrapped by a pre-effect `Atomics.wait` barrier. The parent verifies the committed STARTED receipt/audit through read-only SQLite, sends a real `/revoke`, observes a bounded 200 ms pending-acknowledgement window, and releases the write. This boundary is harness timing injection, not fabricated execution state. Temporary resources are closed and removed.

Revocation was requested while execution was outstanding, but RC2’s serialized synchronous execution completed before revocation became effective and was acknowledged. This experiment proves preservation of execution truth and subsequent authority contraction; it does not prove effective mid-flight revocation or cancellation.

Observed RC2 behavior: the synchronous adapter holds a SQLite writer transaction, and Gateway serializes requests. Revocation remained pending while the worker was blocked; native audit orders execution success before capability revocation. RC2 exposes no cancellation API here (`cancellation_supported: false`). The invariant preserves the native disposition (including FAILED or UNKNOWN when reported), then requires fresh governance and unchanged accounting/file state for later denied dispatch. It does not demand cancellation or success. Current serial-RC2 ordering is explicit; a change to concurrent acknowledgement would require reviewing this experiment's ordering checks.

Interleaving lives in adapter evidence: parent monotonic observation order records request transmission, pending acknowledgement and barrier release; native SQLite audit sequence establishes commit order. Client response arrival is not treated as execution completion time. Outer timeline timestamps remain scenario logical times. Native receipts are retrieved through the shared hardened helper. No generic scheduler or schema change is introduced.

## Staged Write After Revocation

Run `npm run scenario:staged` for `artifacts/staged-write-after-revocation.rc2-gateway.jsonl`. The current suite includes this fifth scenario, requiring revocation and execution accounting. Only the RC2 Gateway profile supplies its driver.

This tests harness-controlled deferral, not a native RC2 scheduler. A real Gateway write creates an inert deterministic `staged.json` describing a later `effect.txt` write. Its original native request/decision/evaluation references are associated in evidence after staging completion. Real capability revocation is acknowledged before a separate PROPOSE request crosses fresh CDE and Kingpin evaluation. Staging authorization and causal metadata do not authorize that later physical effect.

The invariant requires native staging success, target absence throughout, correlated fresh later governance, capability revocation ordered before evaluation, denial, and unchanged complete execution accounting. The pending record never schedules work itself; there is no deferred contract, cancellation or rollback.

## Capability Revocation Survives Restart

Run `npm run scenario:restart` for `artifacts/capability-revocation-survives-restart.rc2-gateway.jsonl`. Process A completes a real bounded write, acknowledges write-capability revocation, and closes its Gateway, CDE worker and database before exiting. Only after observing A's exit does the harness start distinct Process B, which reopens the existing SQLite database (`create: false`) and sandbox. Stable principal/context and policy metadata, database/sandbox identity, preserved audit prefix and stored capability revocation prove continuity. B performs fresh CDE/Kingpin evaluation, receives denial, and leaves the complete ledger and target file unchanged. Final cleanup removes the fixture.

This tests specific durable revocation across graceful process replacement, not crash recovery, UNKNOWN recovery, approval replay, cancellation or preservation of process-local CDE history. CDE starts fresh. No invariant prohibits unrelated policy-defined recovery. The sixth current-suite scenario requires `revocation`, `execution-accounting` and `durable-restart`; only the RC2 Gateway profile has a driver. `durable-restart` narrowly means the configured integration can replace its process and reopen preserved governance state; it does not promise restart support for all scenarios. Subprocess profiles with only revocation report 1 PASS / 7 UNSUPPORTED.

## Human Approval Consumption Survives Restart

Run `npm run scenario:review-restart` for `artifacts/human-approval-consumption-survives-restart.rc2-gateway.jsonl`. Real CDE produces HUMAN REVIEW; an authenticated reviewer approves it and the original agent consumes it once for a bounded write. Process A closes and exits before distinct Process B reopens the same database and sandbox. B directly replays `/reviews/<original-consumed-id>/execute` with the identical bound body and governed identity. RC2 returns 409; consumed review/history, execution accounting and file state remain unchanged.

No fresh post-restart CDE or Kingpin decision is expected or invented. The outer timeline records the original consumption ALLOW and real execution; the initial hold/approval, process order, and later native refusal are retained in adapter evidence as one compound experiment. The invariant tests durable one-use state, not fresh-request evaluation or concurrent consumption. Existing `human-review`, `execution-accounting`, and `durable-restart` capabilities suffice. The current suite now has eight scenarios: RC2 Gateway 8 PASS; subprocess profiles with revocation only 1 PASS / 7 UNSUPPORTED.

## UNKNOWN Execution Survives Restart

`npm run scenario:unknown-restart` runs both required cases of one registered scenario family, producing separate timelines:

- **After effect:** `artifacts/unknown-execution-survives-restart.rc2-gateway.jsonl`. A real authenticated Gateway write crosses CDE/Kingpin authorization, commits STARTED and performs the write. The harness pauses at the uncommitted terminal-success append; the parent verifies the effect and sends SIGKILL. The validated native run records UNKNOWN then `reconciled_succeeded`; the after-effect invariant also accepts an honestly evidenced `reconciliation_required`, without claiming successful completion.
- **Before effect:** `artifacts/unknown-execution-before-effect-survives-restart.rc2-gateway.jsonl`. The harness pauses inside its execute wrapper after native STARTED commits, before calling the real sandbox executor. The parent verifies the target is absent and sends SIGKILL. Native recovery records UNKNOWN then `reconciled_failed`, with the target still absent.

`reconciled_failed` here means reconciliation established that the intended effect did not occur. It is not a second execution failure, a new Kingpin DENY, cancellation or revocation. The absence of a terminal receipt does not tell the runtime whether an effect happened. Recovery uses execution evidence; it does not guess and it does not retry automatically.

Both cases inspect committed state outside A before and after death. Only after native evaluator ownership is released does distinct Process B reopen the same database/sandbox and build/policy identity, acquire the lock, and invoke native `ExecutionRuntime.recover()` before serving. Original execution/request/decision/evaluation identities persist; recovery creates no new authorization or execution entry.

The durable **harness-labelled** `execute` journal entry means entry into the harness wrapper, not completion of the underlying executor or physical write. A records one wrapper entry in each case; parent snapshots establish zero physical effects in the before case and one completed write in the after case. B records zero execute entries and one native sandbox reconciliation. Native ledger/audit and unchanged file evidence corroborate no redispatch. Reconciliation inspects evidence; retry/re-execution performs the operation again. UNKNOWN is not retry authority.

The common CLI reports one UNKNOWN-family PASS only when both experiments pass: Gateway remains 8 PASS; subprocess profiles remain 1 PASS / 7 UNSUPPORTED. Existing `execution-accounting`, `durable-restart`, and `reconciliation` capabilities suffice. This POSIX SIGKILL/flock driver tests specific crash semantics; `durable-restart` alone does not promise all crash behavior. Generic core and timeline schema remain unchanged (version 1). Direct commands refresh their respective artifacts; native IDs/PIDs/timestamps are not deterministic.
