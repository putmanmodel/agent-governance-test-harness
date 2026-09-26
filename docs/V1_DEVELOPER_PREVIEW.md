# Planned v1.0.0 developer preview

This is the release boundary for the PUTMAN Agent Governance Test Harness clone-installed preview, not an announcement that v1 has been tagged. The harness tests specified authority-transition invariants against observable runtime evidence, with coverage determined by the selected runtime integration and supported scenarios. It does not certify security, universal policy correctness, exactly-once execution, cancellation, or absence of all side effects.

## Stabilized public surfaces

For the developer preview, preserve:

- CLI commands `run`, `runtimes`, `capabilities`, and `--help`/`-h`; core flags `--runtime`, `--suite`, `--json`, `--artifact-dir`, `--command`, repeatable `--command-arg`/`--capability`, and `--runtime-id`.
- [Subprocess protocol 1](SUBPROCESS_PROTOCOL.md), including framing, correlation, acknowledged control application and allow/deny responses.
- Suite report envelope `reportVersion: "1"`, documented below.
- Published scenario IDs: `retry-after-revocation`, `human-approval-replay`, `delegated-handoff`, `in-flight-revocation`, `staged-write-after-revocation`, `capability-revocation-survives-restart`, `human-approval-consumption-survives-restart`, `unknown-execution-survives-restart`.
- PASS (assertions passed), FAIL (assertion or setup/protocol/harness failure), and UNSUPPORTED (missing prerequisites; not executed and not passed coverage).
- Exit 0 for help/discovery and suites without FAIL, including unsupported-only suites; exit 1 for FAIL, invalid usage or unknown runtime/suite. Invalid usage reports on stderr rather than emitting a suite report.

`current` is a convenience suite containing the scenarios in that release. Membership may grow. Published IDs are not silently reused or renamed; a compelling incompatible change needs an explicit versioned migration. Pin a repository release for reproducible coverage. Human prose, temporary directory names and native evidence values are not stable machine interfaces.

## Public but experimental

[Timeline schema 1](TIMELINE_SCHEMA.md), the TypeScript `RuntimeAdapter` API, `ObserveEffects`, capability vocabulary, adapter-specific evidence, RC2 integration internals and artifact details beyond documented common fields remain experimental. Experimental does not mean arbitrary: versioned formats will not be silently repurposed. Incompatible format changes require a new version and documentation; internal API changes require release notes. Consumers should tolerate additive fields and avoid depending on opaque adapter payloads.

## Execution lifecycle scope

The current In-Flight Revocation scenario does not claim physical interruption of an already-started effect. Revocation of future authority and cancellation of existing execution are separate. An already-started non-interruptible operation may complete while subsequent authority is correctly revoked. This scenario does not establish mid-flight cancellation in RC2, and cancellation is not mandatory for every runtime.

Future integrations may declare stronger lifecycle capabilities such as cancellation, governed checkpoints or rollback. If declared, future harness scenarios may test observed behavior against that declared contract; this is not a promise to implement those features. The distinction remains:

**cancellation requested ≠ cancellation acknowledged ≠ physical effect stopped**

A scenario requiring a lifecycle capability that the integration lacks should be UNSUPPORTED rather than automatically treated as governance failure. A declared capability still needs evidence that observed behavior meets its contract; lack of evidence must not be excused as lack of support.

Authorized execution-boundary size matters: a bounded effect and a long-running batch can create different exposure before another governance boundary is reached. These distinctions do not confer certification or exactly-once guarantees.

## Suite report version 1

Reports contain `reportVersion`, `runtimeId`, `suiteId`, `results` and `summary`. Each result contains `runtimeId`, `scenarioId`, `scenarioName`, `status`, `missingCapabilities` and `reason`. Optional `diagnostics` entries carry `invariantId`, `reason`, and `case`; optional `artifacts` entries carry `path` and `case`. Summary counts are `passed`, `failed`, `unsupported`. Omitted optional fields mean unavailable, not evidence of success. Case labels describe experiments within one registered scenario.

The literal example below illustrates a hypothetical three-result report, including failure diagnostics; it is not the expected output of the eight-scenario `current` suite:

```json
{
  "reportVersion": "1",
  "runtimeId": "example-runtime",
  "suiteId": "current",
  "results": [
    {
      "runtimeId": "example-runtime",
      "scenarioId": "retry-after-revocation",
      "scenarioName": "Retry After Revocation",
      "status": "PASS",
      "missingCapabilities": [],
      "reason": "Scenario assertions passed.",
      "artifacts": [{ "path": "/tmp/harness/run-example/retry-after-revocation.jsonl" }]
    },
    {
      "runtimeId": "example-runtime",
      "scenarioId": "human-approval-replay",
      "scenarioName": "Human Approval Replay",
      "status": "UNSUPPORTED",
      "missingCapabilities": ["human-review"],
      "reason": "Runtime lacks scenario prerequisites; execution was not attempted."
    },
    {
      "runtimeId": "example-runtime",
      "scenarioId": "unknown-execution-survives-restart",
      "scenarioName": "UNKNOWN Execution Survives Restart",
      "status": "FAIL",
      "missingCapabilities": [],
      "reason": "Scenario assertions failed.",
      "diagnostics": [{
        "invariantId": "unknown_execution_survives_restart_without_redispatch",
        "reason": "Missing or inconsistent crash, ownership, durable execution, reconciliation or no-redispatch evidence.",
        "case": "before-effect"
      }],
      "artifacts": [{
        "path": "/tmp/harness/run-example/unknown-execution-survives-restart.before-effect.jsonl",
        "case": "before-effect"
      }]
    }
  ],
  "summary": { "passed": 1, "failed": 1, "unsupported": 1 }
}
```

Use `npm run --silent harness -- run ... --json` to avoid npm's banner on stdout. Exit 0 may still include UNSUPPORTED coverage. CI must inspect required scenario IDs/statuses, not just the exit code. Native evidence is in timeline files, not part of the report envelope. `--artifact-dir` creates fresh run directories; exceptions before a driver returns may have no timeline. Artifacts are local files, not hosted URLs.

## Reproduce the portable release checks

From the repository root, with Node 24+ and npm (no global TypeScript required):

```bash
npm ci
npm run typecheck
npm test
npm run harness -- --help
npm run harness -- runtimes
npm run harness -- capabilities
npm run harness -- run --runtime subprocess-reference --suite current
```

For the checked-in Python example and release smoke, also install Python 3 (`python3` on PATH; no pip packages):

```bash
npm run --silent harness -- run --runtime subprocess --command python3 --command-arg examples/python-governance-runtime.py --capability revocation --runtime-id python-example --suite current --json
npm run smoke
```

`smoke` validates CLI help/discovery, human/JSON built-in output, and the Python example through the real external CLI. It checks counts, acknowledgements, fresh IDs and protocol/report/timeline versions; temporary artifacts are removed. It deliberately points `RC2_ROOT` at a nonexistent directory. It does not reinstall dependencies or duplicate typecheck/unit tests. The workflow runs `npm ci`, typecheck, unit tests and smoke once each.

The Python fixture owns simple single-authority state; it is an interoperability example with simulated enforcement/effects, not production policy or a replacement for a real governance system.

## Environment and reference integration

Local validation: macOS arm64, Node 24.14.1, npm 11.11.0 and Python 3.14.6. Package engines allow Node >=24; the CI target is Node 24 and Python 3.14 on Ubuntu 24.04. The checked-in GitHub workflow still needs its first hosted run; configuration is not proof of Linux validation. Windows has not been tested and is not claimed supported.

The portable/default path needs no CDE/Kingpin checkout. Default unit tests read checked-in RC2 evidence fixtures but do not launch RC2. Live RC2 tests are separate (`npm run test:integration`) and require the sibling checkout or `RC2_ROOT`, its dependencies and a working Python evaluator. RC2 crash/restart experiments require POSIX SIGKILL/flock semantics; Linux execution of those experiments must be validated separately. No cancellation capability is implied.

## Publication posture

Distribution remains repository clone plus `npm ci`; `private: true` intentionally prevents npm publication. The harness is source-available under the [Source-Available Evaluation License v1.0](../LICENSE), copyright © 2026 Stephen A. Putman. Free permitted uses, the one-per-Organization 30-day commercial evaluation, ongoing commercial-use requirements and redistribution restrictions are defined there; see [commercial licensing information](../COMMERCIAL_LICENSE.md) for the contact placeholder.

Independent adapters are permitted under the license's interoperability boundary and may carry their authors' own terms. Truthful results and criticism may be published; no certification or endorsement follows from a passing run. External code contributions are not currently solicited pending contribution/IP terms; [issue reports, discussion and independent work remain welcome](../CONTRIBUTING.md).

[AI-assisted setup](../README.md#ai-assisted-setup-optional) is optional. The documented CLI/protocol path remains primary. An assistant must not weaken the core, assertions, evidence requirements or expected results to make a runtime pass. These repository-material changes do not alter the stable/experimental contract above.
