# Timeline schema 1 (public experimental)

A timeline is newline-delimited JSON: one complete record per line, in capture order. Each record contains:

| Field | Meaning |
| --- | --- |
| `harness_schema_version` | Literal string `"1"`; independent of protocol/report versions |
| `sequence` | Consecutive capture order, starting at 1 within this timeline |
| `scenarioId` | Scenario identifier |
| `timestamp` | Scenario-defined finite logical time, not a wall-clock measurement |
| `eventOrder` | Originating scenario event's order; several records may share it |
| `category` | `scenario`, `governance`, `enforcement`, `execution`, or `assertion` |
| `data` | Category payload described below |

`scenario` captures GRANT/REVOKE authority-reference controls or PROPOSE/RETRY request events. `governance` contains the normalized request/decision correlation, ALLOW/DENY/INDETERMINATE, rationale and evidence. `enforcement` contains request/decision references and DISPATCH/BLOCK. `execution` contains a request reference, NOT_STARTED/STARTED/SUCCEEDED/FAILED/UNKNOWN and reason. `assertion` contains invariant ID/name, pass boolean, reason and supporting sequence references.

For exact current types see [timeline.ts](../src/core/timeline.ts), [events.ts](../src/core/events.ts), [runtime-adapter.ts](../src/core/runtime-adapter.ts) and [assertions.ts](../src/core/assertions.ts). Adapter-specific fields inside `evidence` are opaque to the generic contract; they are not frozen by this document. Evidence should be JSON-safe and exclude credentials.

Logical ordering is deterministic for identical scenario inputs. Simulated/reference-process runs can produce byte-identical data. Native runtime IDs, timestamps, PIDs and filesystem identities may vary legitimately. An outer logical timestamp does not prove native concurrency or commit order; the relevant audit/observation evidence must establish that. A captured control event alone is not independent proof of native acknowledgement.

Enforcement/effects may be simulated when no observation callback is supplied. UNKNOWN means neither cancellation, absence of effects nor retry authority. Native reconciliation dispositions remain in adapter evidence even when mapped to generic execution status. Each paired recovery experiment has its own timeline; do not concatenate runs and imply one sequence.

Artifacts are evidence records, not security certificates. They record what was observed and asserted under a particular fixture; they do not prove universal runtime correctness. Replay currently means rerunning inputs, not importing an artifact to recreate execution. Schema 1 is public experimental: changes will be documented and incompatible meanings require a new version rather than silently repurposing existing fields.
