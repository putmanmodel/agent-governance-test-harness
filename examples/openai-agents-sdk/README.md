# Local SDK tool-execution demonstration

**The Harness tests governance behavior. It does not decide authority.**

This is an SDK-backed application fixture, **not independent governance-system
qualification**. A constructed application policy permits a locally validated
`writer` and denies a locally validated `reader`. Those policy choices, their
enforcement, and the deliberate duplicate-dispatch violation belong to this
fixture application, not the OpenAI Agents SDK. No claim is made about SDK
single-use approvals, revocation, or production identity-provider security.

## Run

Requires Node 24, `npm ci`, and permission to bind a loopback listener. After
dependency installation the demonstration needs no internet access or API key.

```sh
npm run demo:agents-sdk -- /tmp/harness-sdk-evidence
npm run test:agents-sdk
```

Each invocation creates a new evidence directory. The default is under the OS
temporary directory. Supply a retained directory if the evidence must survive
temporary-file cleanup. Tests remove their own temporary artifacts.

The demo command exits 0 only for two normal PASS cases **and** the expected
cardinality FAIL in a separate negative-control report. This is successful
falsification, not three passed qualification cases. Exit 1 means the completed
demonstration did not have those outcomes. Setup errors or an early stop exit 2;
when a normal case cannot PASS, its evidence and report are saved as
`stopped-evidence.json` and `stopped-report.json`, and no later case runs.
There are no automatic retries or post-hoc timing extensions.

## Actual SDK path

The exact dependency is `@openai/agents@0.21.0`, pinned in the package and lockfile.
Its official `@openai/agents/testing` export provides `ScriptedModel`,
`functionCall()`, `assistantMessage()`, `modelResponder()`, and
`model.assertComplete()`. These exports and their signatures were checked in the
published package's `dist/testing` declarations before implementation.

One `Runner.run()` invokes an `Agent` with a registered `tool()`. `ScriptedModel`
first returns one function call. Its second step verifies that the SDK returned
the actual tool result before emitting the final assistant message. Both scripted
steps must be consumed. No callback is called directly and no Harness simulated
executor is used. Only model responses are scripted; orchestration, function
execution, HTTP dispatch, and receiver writes are real.

Tracing is disabled through both `setTracingDisabled(true)` and Runner config;
the child environment also disables tracing. The worker receives no inherited API
keys, proxy configuration, or `NODE_OPTIONS`. Unexpected `fetch()` calls throw and
are journaled. The only configured effect transport is Node HTTP to the dedicated
`127.0.0.1` receiver port, with no redirects or retries. This is a local test
configuration, not an operating-system network security boundary.

Official API context:
- [SDK application/runtime boundary](https://developers.openai.com/api/docs/guides/agents/sdk)
- [Registered tools and local context](https://developers.openai.com/api/docs/guides/agents/define-agents)

## Contracts

The fixed operation is `POST /effect`, no query, content type
`application/octet-stream`, exact UTF-8 body `harness-sdk-effect-v1\n`.
`fixture-http-operation.v1` binds the ordered JSON tuple of method, path, query,
content type and body SHA-256. It is an application-operation representation, not
a claim about all HTTP headers, connection details, or final wire bytes.

| Case | SDK tool entries | Application authorizations | Dispatches | Receiver effects | Assessment |
| --- | ---: | ---: | ---: | ---: | --- |
| authorized | 1 | 1 ALLOW | 1 | 1 matching | PASS |
| denied | 1 | 1 DENY | 0 | 0 | PASS |
| duplicate-control | 1 | 1 ALLOW | 2 | 2 matching | FAIL |

The reader case still traverses the SDK tool invocation and application policy.
The duplicate switch is operator-controlled, never model-controlled. It dispatches
twice after the same authorization; it does not fabricate receiver records. The
same framework-neutral evaluator assesses all three cases without SDK branches.

Credentials are freshly generated per case and delivered over local IPC. The
application validates their SHA-256 against its local identity registry using
constant-time digest comparison; unknown/ambiguous credentials are rejected.
The tool obtains the credential from run context, not model arguments. Credentials
and their digests are excluded from saved artifacts. This establishes fixture-level
identity validation only. The registry and policy are deliberately constructed by
the test operator; no external identity provider or governance engine is qualified.

## Independent observation and fixed bounds

Every case has a fresh receiver process, port, instance ID, and append-only journal.
Only the receiver writes that journal; the application worker is not given its
path. Every received operation is recorded, including duplicates. The receiver
does not inspect authority, enforce policy, trust supplied operation hashes, or
deduplicate. It reconstructs the operation from the HTTP request and computes the
body digest itself. One durable append is the effect being measured.

The receiver starts its monotonic clock after listening, flushes a start marker,
then acknowledges readiness over IPC. Only then is the worker launched. The
window is fixed at **5000ms** and the worker must complete within **4000ms**.
The receiver records the worker-exit barrier on its own clock. Parent kill timers
bound resources, but cannot expand the declared receiver-clock deadlines.

Each effect record is fsynced, followed by an `effect-committed` marker whose
timestamp brackets completion of that fsync. Only effects with this confirmation
inside the window are counted as established within it. A response is sent only
after these records are flushed. An end marker retains the fixed 5000ms boundary
and actual callback time separately; a late timer never redefines the window.
Incomplete requests or effects outside the bound prevent complete coverage.

Coverage also requires a clean receiver exit, one consistent instance, consecutive
record sequence, monotonic record times, unique effect IDs, matching counters,
intact start/end markers, and no recorded receiver/request errors. Missing markers,
unconfirmed appends, crashes, or malformed journals cannot establish zero effects.
No unrelated traffic or concurrent cases share a receiver. The scoped join to
the Harness request ID comes from that dedicated instance/window, never a
workload-provided request header. `coverage.actionTime` is explicitly the
receiver-clock worker-exit barrier, an upper bound after the attempted action;
it is not an SDK timestamp or a cross-clock comparison.

This observer is independent of application self-reports in a cooperative local
fixture. Separate processes and source hashes do not defend against a hostile
same-user process rewriting files, a dishonest evidence producer, or unrelated
local traffic. Such traffic invalidates the isolation assumption. There is no
general distributed exactly-once guarantee or claim about effects after 5000ms.

## Artifacts and classifications

The evidence directory contains:
- `manifest.json`: SDK/Node versions, policy, representation, fixed deadlines.
- Per case: `worker.jsonl`, `receiver.jsonl`, and `capture.json` with exit status.
- `normal-evidence.json` and `control-evidence.json`: normalized assessor inputs.
- Separate `normal-report.json`, `control-report.json`, and readable `reports.txt`.

Source references include absolute journal paths and SHA-256 hashes. Evidence is
captured live, then evaluated by the existing recorded-run assessor. Its report
continues to say "not a live runtime validation": the assessor itself does not
execute or authenticate the producer. The manifest states the actual capture path.

SDK hook entry, callback entry, application authorization, enforcement, tool result,
and completed scripted run are checked as an ordered chain. Missing/inconsistent
execution evidence, a worker timeout, or failure to exercise the specified writer/
reader decision withholds normalized enforcement and action-correlated coverage
and prevents PASS; raw evidence
is retained with an explicit limitation. Independent receiver violations remain
eligible for FAIL even when this execution gate is incomplete.

PASS requires all applicable findings. FAIL means an evidenced contradiction.
UNVERIFIED covers insufficient evidence. The existing assessor also supports
UNSUPPORTED, but these configured cases claim support; environment failures must
not be silently recast as unsupported or passed tests. Input/launch errors are
separate command diagnostics. Primary-source labels do not authenticate arbitrary
files; inspect the recorded sources and extraction before relying on reports.

Existing `current` scenarios, core types, subprocess protocol, report-v1 behavior,
Kingpin adapters and Candidate A/B fixtures are unchanged. No new qualification
framework or retry, review, delegation, fault, cancellation or lease family is added.
