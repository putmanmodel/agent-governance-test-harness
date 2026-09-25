# Planned v1.0.0 developer preview

This is the release boundary for a clone-installed preview, not an announcement that v1 has been tagged. The harness tests specified authority-transition invariants against observable runtime evidence, with coverage determined by the selected runtime integration and supported scenarios. It does not certify security, universal policy correctness, exactly-once execution, cancellation, or absence of all side effects.

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

Distribution remains repository clone plus `npm ci`; `private: true` intentionally prevents npm publication. Licensing terms for public/commercial use will be provided with the public release. External contributions are not yet being solicited pending publication of contribution/licensing terms. No license grant, pricing or commercial terms are specified here. The owner must settle those terms before public release.
