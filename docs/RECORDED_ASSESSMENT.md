# Recorded external-substrate assessment

**Recorded-run assessment — not a live runtime validation.** This opt-in path
checks supplied evidence against an explicitly declared bounded contract. It does
not run a runtime, grant authority, reproduce policy, or certify a deployment.
Candidate A/B are source experiments, not normative models for every runtime.

## Run

From the repository root with Node 24+:

```bash
npm run assess:recorded -- --candidate-ab
npm run assess:recorded -- --candidate-ab --json
npm run assess:recorded -- /path/to/evidence.json
```

The bundled Candidate import uses SHA256-checked **derived publication fixtures**
of the source result documents, plus an allowlisted extract of the original native
records. The report fixtures omit local machine and evidence-storage locations;
their reported observations, native terminology, identifiers and limits are retained.
Each fixture identifies the original report’s SHA256 and is explicitly not an
unmodified source snapshot. The original experiments and source files are unchanged.
The command reads only bundled fixtures; it does not access private journals,
databases, credentials or local running services, or infer primary records from
summary conclusions. Fixture changes require review of their translation and hashes.

The human-readable report includes each declared contract, outcome, findings,
source references, configuration and limitations. JSON is a separate assessment
report with `reportVersion: "2"` and `assessmentKind: "recorded-run"`; it is not a
replacement for suite report v1. The existing CLI, scenarios, timeline schema,
capabilities and report-v1 behavior are unchanged. Output goes to stdout; redirect
it if a saved report is wanted. No artifact files are written automatically.

Representative recorded assessment:

```text
Recorded-run assessment — not a live runtime validation.
UNVERIFIED candidate-a/exact-operation (bounded-correspondence)
  PASS authorization-correspondence: observed operation matches the authorized binding.
  UNVERIFIED observation-coverage: full-window observer availability is not established.
UNVERIFIED candidate-b/review-fresh-binding (review-binary-enforcement)
  PASS fresh-binding-evidence: original approval targeted with a distinct fresh binding.
  UNVERIFIED zero-effect: independent bounded coverage is not established.
0 passed; 0 failed; 0 unsupported; 14 unverified.
```

This does not reverse the experiments' reported PASS. It distinguishes their
conclusions from what this import can independently establish. All 13 Candidate A
probes and the combined Candidate B review/fresh-binding case remain UNVERIFIED
because complete independent observation coverage is not established. Some individual
findings are supported by extracted native records. Candidate B's review inspection
and fresh-binding refusal are extracted; other summary claims remain source-reported,
not reconstructed as fabricated events.

The `candidate-ab-observations.json` fixture is an allowlisted projection from A's
`results.json`/`governed.jsonl` and B's `results.json`/`events.jsonl`/`control.jsonl`.
It retains original file SHA256 hashes, result indexes and journal line positions.
Extraction kept native decision/request identifiers, outcomes, operation/binding
hashes, authenticated context and principal mapping, selected synthetic spoof claims,
client status/reason, positive receiver observations, review inspection and consumption.
It excluded credentials, payloads, full headers and databases. A's runner event
slices supply serialized positive-effect correlation; untrusted receiver request-ID
claims are never used. Native `allow` is translated to `effectAuthorized` only here,
inside the Candidate-specific importer. B's native reason mapping also stays here.
Neither empty event slices nor a point-in-time listener snapshot are elevated to
full-window independent observation coverage.

## Outcomes and exit codes

- **PASS:** supplied primary observations support the property within declared bounds.
- **FAIL:** primary observations demonstrate a contradiction, including an observed
  violation of an explicitly declared evidence-production requirement.
- **UNSUPPORTED:** an explicitly absent prerequisite makes the property inapplicable.
  Missing records for an applicable property are not an unsupported capability.
- **UNVERIFIED:** the property applies, but evidence is insufficient to prove or refute it.

Known contradictions override incomplete evidence and unsupported declarations.
Only PASS counts as proved coverage. Exit 0 means no FAIL or UNVERIFIED (an entirely
UNSUPPORTED report still proves nothing); exit 1 means FAIL or UNVERIFIED. Exit 2
means unusable input, including structural validation errors, invalid JSON or an
unreadable source; no governance result is manufactured. Validation diagnostics go
to stderr, including in JSON mode. Missing optional observation blocks are valid
inputs and normally lead to UNVERIFIED, not a validation error or FAIL.

## Authoring evidence

See `src/recorded-assessment/evidence.ts` and
`tests/fixtures/recorded-assessment/independent-vocabulary.json` for the complete
small contract and a runnable example. Fields are closed: unknown keys, wrong
types, duplicate IDs, unknown source references, and invalid intervals/counters
are validation errors. Version 1 here identifies the **new recorded evidence
format**, not a change to the existing timeline or suite report.

Each case declares its contract, binding representation, applicability and request
locator. Observations pair typed values with source IDs. Sources distinguish
primary records from summaries. Native authority terminology stays opaque; a
native outcome is never normalized into authority DENY merely because enforcement
blocked. The authority observation’s `effectAuthorized` value must be extracted
from the native authority result, never inferred from substrate permission. Omit authority evidence when no decision occurred. `reportedFacts` retain
summary statements but do not satisfy assertions. For the Candidate A summary
import, `source-case:*` identifies a report row, not an authenticated native ID.

Two families are supported:

1. **Bounded Authorization-to-Effect Correspondence** (`bounded-correspondence`):
   independently observed effects must match the declared authorized binding, or
   an explicitly declared blocked case must have zero observed effects. Identity
   evidence compares authenticated context with the principal used for authority;
   workload claims remain separate and cannot serve as authenticated identity.
2. **Review State Across Binary Enforcement** (`review-binary-enforcement`):
   the declared rich review state remains inspectable at the observed stage and
   its reason remains visible through binary blocking. An attempted use of the
   original approval must target that approval with a distinct fresh request
   binding and must not authorize it under the declared non-transfer contract.
   Native decision names need not equal native review-state names. This is not
   a universal requirement that every approval be single-request scoped.

The importer owns runtime-specific extraction, native identifiers, canonicalization,
principal mapping and review-control interpretation. Assertions compare facts; they
do not decide whether the runtime should issue an approval or which native outcome
it should select. No new authority, approval, lease or lifecycle semantics exist.

## Observation requirements and trust boundary

An empty effect list is not zero-effect evidence. PASS requires independent effect
observations and counter baseline/final, observer availability throughout a bounded
window containing the action, a correlated request in that scope, and primary source
references. Counter deltas must agree with the effects recorded. The fixture assumes
an isolated, serialized observation scope; it does not account for arbitrary concurrent
traffic. Times are ordered numeric values in one documented observation clock.
Binding equality is meaningful only under the declared common representation and
covered fields. Canonicalization, digest construction and exclusion of later mutators
remain responsibilities of the source integration, not generic harness policy.

Primary-source labels and extracted values are supplied by the evidence producer.
This assessor validates consistency; it does not authenticate arbitrary files,
cryptographically establish independence, fetch referenced records, or detect a
producer lying about availability/scope. Review the referenced source records and
extraction before relying on an assessment. It cannot prove unobserved physical
behavior. Report limitations travel with results. A bounded zero does not establish
no effects forever, cancellation, rollback, exactly-once execution or certification.

The included PermitDesk fixture uses different native terms (`TICKET_ISSUED`,
`OPERATOR_HOLD`) and is explicitly synthetic. Its PASS tests assertion neutrality,
not an independently developed implementation. To exercise it:

```bash
npm run assess:recorded -- tests/fixtures/recorded-assessment/independent-vocabulary.json
```

## Optional bounded effect cardinality

Cases may add `contract.expectedEffectCount`: `0` with `expectedEffect: "none"`,
or `1` with `expectedEffect: "matched"`. Other values and inconsistent combinations
are validation errors. Omission preserves all previous behavior and findings;
Candidate A/B inputs are unchanged. This is an additive evidence-format extension,
not a change to timeline, subprocess, or report-v1 semantics.

The `effect-cardinality` finding requires complete bounded independent coverage,
primary effect records, correlated scope, and agreement with the counter to PASS.
Distinct correlated effects exceeding the expected count can establish FAIL even
without full-window coverage. A primary independently covered counter mismatch
also establishes FAIL, even if the effect list is missing or secondary. A complete
bounded zero refutes expected count one; missing evidence alone does not.
Producers must deduplicate exported records using observer-owned event identities;
two copies of one log record are not two physical effects. The current normalized
effect list assumes distinct, scoped observations and cannot authenticate producers.

Cardinality and authorization correspondence remain separate findings. Exactly one
observed effect within the declared window is not a distributed exactly-once
protocol or proof about later effects. The existing correspondence finding still
makes no exactly-once claim of its own.

The opt-in [OpenAI Agents SDK example](../examples/openai-agents-sdk/README.md)
captures real local tool execution and independent receiver appends, then supplies
normalized evidence to this assessor. Its constructed writer/reader policy is
application-owned; it is not independent governance-system qualification.

The [OpenCode example](../examples/opencode-qualification/README.md) exercises an
independently developed application’s native permission enforcement and supplies
separately observed receiver effects. Its locally verified permission/effect
findings PASS within declared bounds, while authenticated workload identity and
aggregate cases remain UNVERIFIED. The synthetic prohibited-effect control tests
the evaluator; it is not an observed application vulnerability.

## Assessment boundaries

The assessor evaluates supplied records; the examples capture execution separately.
Neither changes existing live scenario contracts, suite membership or report-v1.
Stronger Candidate findings require primary journals, authenticated bindings,
observer availability and bounded correlation; absent records remain UNVERIFIED.
Individual PASS findings do not imply an aggregate PASS or runtime certification.
